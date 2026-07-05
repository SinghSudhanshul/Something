package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	kafkago "github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// MessageHandler is a function that processes a Kafka message.
type MessageHandler func(ctx context.Context, topic string, key []byte, value json.RawMessage) error

// RetryConfig defines retry behavior for message processing.
type RetryConfig struct {
	MaxRetries    int
	InitialDelay  time.Duration
	MaxDelay      time.Duration
	BackoffFactor float64
}

// DefaultRetryConfig returns the default retry configuration.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:    3,
		InitialDelay:  500 * time.Millisecond,
		MaxDelay:      10 * time.Second,
		BackoffFactor: 2.0,
	}
}

// Consumer wraps kafka-go readers for consuming events with retry and DLQ.
type Consumer struct {
	brokers  []string
	groupID  string
	readers  map[string]*kafkago.Reader
	handlers map[string]MessageHandler
	dlqTopic string
	retry    RetryConfig
	logger   *zap.Logger
}

// NewConsumer creates a new Kafka consumer with default retry config.
func NewConsumer(brokers []string, groupID string, logger *zap.Logger) *Consumer {
	return &Consumer{
		brokers:  brokers,
		groupID:  groupID,
		readers:  make(map[string]*kafkago.Reader),
		handlers: make(map[string]MessageHandler),
		dlqTopic: fmt.Sprintf("nexus.dlq.%s", groupID),
		retry:    DefaultRetryConfig(),
		logger:   logger,
	}
}

// NewConsumerWithRetry creates a consumer with custom retry config.
func NewConsumerWithRetry(brokers []string, groupID string, retry RetryConfig, logger *zap.Logger) *Consumer {
	c := NewConsumer(brokers, groupID, logger)
	c.retry = retry
	return c
}

// Subscribe registers a handler for a specific topic.
func (c *Consumer) Subscribe(topic string, handler MessageHandler) {
	reader := kafkago.NewReader(kafkago.ReaderConfig{
		Brokers:          c.brokers,
		GroupID:          c.groupID,
		Topic:            topic,
		MinBytes:         1e3,    // 1KB
		MaxBytes:         10e6,   // 10MB
		MaxWait:          500 * time.Millisecond,
		CommitInterval:   time.Second,
		HeartbeatInterval: 3 * time.Second,
		SessionTimeout:   30 * time.Second,
		StartOffset:      kafkago.LastOffset,
	})
	c.readers[topic] = reader
	c.handlers[topic] = handler
}

// Start begins consuming messages from all subscribed topics.
func (c *Consumer) Start(ctx context.Context) {
	for topic, reader := range c.readers {
		handler := c.handlers[topic]
		go c.consumeTopic(ctx, topic, reader, handler)
	}
	c.logger.Info("all consumers started",
		zap.Int("topics", len(c.readers)),
		zap.String("groupID", c.groupID),
	)
}

func (c *Consumer) consumeTopic(ctx context.Context, topic string, reader *kafkago.Reader, handler MessageHandler) {
	c.logger.Info("starting consumer",
		zap.String("topic", topic),
		zap.String("groupID", c.groupID),
	)

	for {
		select {
		case <-ctx.Done():
			c.logger.Info("consumer stopping", zap.String("topic", topic))
			return
		default:
			msg, err := reader.ReadMessage(ctx)
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				c.logger.Error("failed to read message",
					zap.String("topic", topic),
					zap.Error(err),
				)
				time.Sleep(time.Second) // Backoff on read errors
				continue
			}

			c.processMessage(ctx, topic, msg, handler)
		}
	}
}

// processMessage handles a single message with retry logic.
func (c *Consumer) processMessage(ctx context.Context, topic string, msg kafkago.Message, handler MessageHandler) {
	delay := c.retry.InitialDelay

	for attempt := 0; attempt <= c.retry.MaxRetries; attempt++ {
		err := handler(ctx, topic, msg.Key, msg.Value)
		if err == nil {
			return // Success
		}

		if attempt < c.retry.MaxRetries {
			c.logger.Warn("message processing failed, retrying",
				zap.String("topic", topic),
				zap.String("key", string(msg.Key)),
				zap.Int("attempt", attempt+1),
				zap.Int("maxRetries", c.retry.MaxRetries),
				zap.Duration("retryDelay", delay),
				zap.Error(err),
			)

			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}

			// Exponential backoff
			delay = time.Duration(float64(delay) * c.retry.BackoffFactor)
			if delay > c.retry.MaxDelay {
				delay = c.retry.MaxDelay
			}
		} else {
			// All retries exhausted — send to DLQ
			c.logger.Error("message processing failed after all retries, sending to DLQ",
				zap.String("topic", topic),
				zap.String("key", string(msg.Key)),
				zap.Error(err),
			)
			c.sendToDLQ(ctx, topic, msg, err)
		}
	}
}

// sendToDLQ publishes a failed message to the dead-letter queue topic.
func (c *Consumer) sendToDLQ(ctx context.Context, originalTopic string, msg kafkago.Message, processErr error) {
	dlqPayload := map[string]interface{}{
		"original_topic":   originalTopic,
		"original_key":     string(msg.Key),
		"original_value":   string(msg.Value),
		"error":            processErr.Error(),
		"failed_at":        time.Now().UTC().Format(time.RFC3339),
		"consumer_group":   c.groupID,
		"partition":        msg.Partition,
		"offset":           msg.Offset,
	}

	dlqData, _ := json.Marshal(dlqPayload)

	writer := &kafkago.Writer{
		Addr:     kafkago.TCP(c.brokers...),
		Topic:    c.dlqTopic,
		Balancer: &kafkago.LeastBytes{},
	}
	defer writer.Close()

	dlqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	err := writer.WriteMessages(dlqCtx, kafkago.Message{
		Key:   msg.Key,
		Value: dlqData,
	})
	if err != nil {
		c.logger.Error("failed to send message to DLQ",
			zap.String("dlqTopic", c.dlqTopic),
			zap.Error(err),
		)
	} else {
		c.logger.Info("message sent to DLQ",
			zap.String("dlqTopic", c.dlqTopic),
			zap.String("originalTopic", originalTopic),
			zap.String("key", string(msg.Key)),
		)
	}
}

// Close closes all Kafka readers.
func (c *Consumer) Close() error {
	var firstErr error
	for topic, reader := range c.readers {
		if err := reader.Close(); err != nil {
			c.logger.Error("failed to close reader", zap.String("topic", topic), zap.Error(err))
			if firstErr == nil {
				firstErr = fmt.Errorf("failed to close reader for %s: %w", topic, err)
			}
		}
	}
	return firstErr
}
