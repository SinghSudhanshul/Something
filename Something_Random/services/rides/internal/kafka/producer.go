package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

// Producer wraps kafka-go writer for publishing events.
type Producer struct {
	writer *kafka.Writer
	logger *zap.Logger
}

// NewProducer creates a new Kafka producer.
func NewProducer(brokers []string, logger *zap.Logger) *Producer {
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Balancer:     &kafka.LeastBytes{},
		BatchTimeout: 10 * time.Millisecond,
		WriteTimeout: 10 * time.Second,
		RequiredAcks: kafka.RequireAll,
	}

	return &Producer{
		writer: w,
		logger: logger,
	}
}

// Event represents a Kafka event with type and payload.
type Event struct {
	Type          string      `json:"type"`
	Payload       interface{} `json:"payload"`
	Timestamp     string      `json:"timestamp"`
	CorrelationID string      `json:"correlationId"`
}

// Publish sends a message to the specified Kafka topic.
func (p *Producer) Publish(ctx context.Context, topic string, key string, event Event) error {
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339)
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	msg := kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: data,
	}

	if err := p.writer.WriteMessages(ctx, msg); err != nil {
		p.logger.Error("failed to publish kafka message",
			zap.String("topic", topic),
			zap.String("key", key),
			zap.Error(err),
		)
		return fmt.Errorf("failed to publish to %s: %w", topic, err)
	}

	p.logger.Debug("published kafka message",
		zap.String("topic", topic),
		zap.String("key", key),
		zap.String("type", event.Type),
	)

	return nil
}

// Close closes the Kafka producer.
func (p *Producer) Close() error {
	return p.writer.Close()
}
