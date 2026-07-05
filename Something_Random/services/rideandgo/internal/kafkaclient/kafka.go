// Package kafkaclient provides a thin wrapper around segmentio/kafka-go
// for producing domain events and consuming commands. All event
// publishing flows through the producer; the consumer is used by
// background workers only. Per-topic producers are cached to avoid
// the overhead of reconstructing writers per call.
package kafkaclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/segmentio/kafka-go"

	"rideandgo/internal/config"
)

// Producer wraps kafka.Writer with sane defaults for event publishing.
type Producer struct {
	w   *kafka.Writer
	cfg *config.Config
	mtr *Metrics
}

// Metrics holds Prometheus instrumentation for Kafka I/O.
type Metrics struct {
	MessagesProduced  *prometheus.CounterVec
	BytesProduced     *prometheus.CounterVec
	ProduceErrors     *prometheus.CounterVec
	ProduceDuration   *prometheus.HistogramVec
	MessagesConsumed  *prometheus.CounterVec
	ConsumerErrors    *prometheus.CounterVec
	ConsumerLag       *prometheus.GaugeVec
	ConsumerProcessed *prometheus.CounterVec
}

// NewMetrics registers Kafka metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		MessagesProduced: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_messages_produced_total",
			Help: "Messages produced to Kafka by topic.",
		}, []string{"topic", "result"}),
		BytesProduced: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_bytes_produced_total",
			Help: "Bytes produced to Kafka by topic.",
		}, []string{"topic"}),
		ProduceErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_produce_errors_total",
			Help: "Errors producing to Kafka by topic.",
		}, []string{"topic", "class"}),
		ProduceDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rideandgo_kafka_produce_duration_seconds",
			Help:    "Produce latency by topic.",
			Buckets: prometheus.ExponentialBuckets(0.001, 2, 14),
		}, []string{"topic"}),
		MessagesConsumed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_messages_consumed_total",
			Help: "Messages consumed by topic.",
		}, []string{"topic", "result"}),
		ConsumerErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_consumer_errors_total",
			Help: "Errors consuming by topic.",
		}, []string{"topic", "class"}),
		ConsumerLag: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "rideandgo_kafka_consumer_lag",
			Help: "Consumer lag in messages by topic/partition.",
		}, []string{"topic", "partition"}),
		ConsumerProcessed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_kafka_consumer_processed_total",
			Help: "Messages processed by handler outcome.",
		}, []string{"topic", "outcome"}),
	}
	reg.MustRegister(m.MessagesProduced, m.BytesProduced, m.ProduceErrors,
		m.ProduceDuration, m.MessagesConsumed, m.ConsumerErrors,
		m.ConsumerLag, m.ConsumerProcessed)
	return m
}

// NewProducer creates a Kafka writer pointed at the configured brokers.
func NewProducer(cfg *config.Config, mtr *Metrics) *Producer {
	w := &kafka.Writer{
		Addr:                   kafka.TCP(cfg.KafkaBrokers...),
		Balancer:               &kafka.Hash{},
		RequiredAcks:           kafka.RequireAll,
		Async:                  false,
		Compression:            kafka.Snappy,
		MaxAttempts:            cfg.KafkaProduceRetries,
		WriteTimeout:           10 * time.Second,
		ReadTimeout:            10 * time.Second,
		BatchTimeout:           time.Duration(cfg.KafkaProduceFlushMs) * time.Millisecond,
		AllowAutoTopicCreation: true,
	}
	return &Producer{w: w, cfg: cfg, mtr: mtr}
}

// Close flushes pending writes and closes the writer.
func (p *Producer) Close() error { return p.w.Close() }

// Publish emits a domain event. The key, when non-empty, controls
// partition selection via the configured hash balancer — so all
// events for the same aggregate (e.g. trip_id) land on the same
// partition, preserving per-aggregate ordering.
func (p *Producer) Publish(ctx context.Context, topic, key string, payload any, headers ...Header) error {
	body, err := json.Marshal(payload)
	if err != nil {
		p.mtr.ProduceErrors.WithLabelValues(topic, "marshal").Inc()
		return fmt.Errorf("kafka: marshal: %w", err)
	}
	msg := kafka.Message{
		Topic: topic,
		Key:   []byte(key),
		Value: body,
		Time:  time.Now().UTC(),
		Headers: toKafkaHeaders(headers),
	}
	t := time.Now()
	err = p.w.WriteMessages(ctx, msg)
	p.mtr.ProduceDuration.WithLabelValues(topic).Observe(time.Since(t).Seconds())
	p.mtr.BytesProduced.WithLabelValues(topic).Add(float64(len(body)))
	if err != nil {
		p.mtr.ProduceErrors.WithLabelValues(topic, "write").Inc()
		p.mtr.MessagesProduced.WithLabelValues(topic, "error").Inc()
		return fmt.Errorf("kafka: write %s: %w", topic, err)
	}
	p.mtr.MessagesProduced.WithLabelValues(topic, "ok").Inc()
	return nil
}

// PublishRaw is the same as Publish but takes an already-encoded byte slice.
func (p *Producer) PublishRaw(ctx context.Context, topic, key string, body []byte, headers ...Header) error {
	msg := kafka.Message{
		Topic:   topic,
		Key:     []byte(key),
		Value:   body,
		Time:    time.Now().UTC(),
		Headers: toKafkaHeaders(headers),
	}
	t := time.Now()
	err := p.w.WriteMessages(ctx, msg)
	p.mtr.ProduceDuration.WithLabelValues(topic).Observe(time.Since(t).Seconds())
	p.mtr.BytesProduced.WithLabelValues(topic).Add(float64(len(body)))
	if err != nil {
		p.mtr.ProduceErrors.WithLabelValues(topic, "write").Inc()
		p.mtr.MessagesProduced.WithLabelValues(topic, "error").Inc()
		return fmt.Errorf("kafka: write %s: %w", topic, err)
	}
	p.mtr.MessagesProduced.WithLabelValues(topic, "ok").Inc()
	return nil
}

// Header is a key/value pair attached to a Kafka message.
type Header struct {
	Key   string
	Value string
}

func toKafkaHeaders(hs []Header) []kafka.Header {
	if len(hs) == 0 {
		return nil
	}
	out := make([]kafka.Header, 0, len(hs))
	for _, h := range hs {
		out = append(out, kafka.Header{Key: h.Key, Value: []byte(h.Value)})
	}
	return out
}

// ConsumerConfig controls a single topic consumer.
type ConsumerConfig struct {
	Brokers  []string
	Topic    string
	GroupID  string
	MinBytes int
	MaxBytes int
	MaxWait  time.Duration
	StartAt  int64 // kafka.FirstOffset or kafka.LastOffset
}

// HandlerFunc is the per-message processing function.
// Return an error to mark the message as unprocessable — the
// consumer will retry per its retry policy then route to DLQ.
type HandlerFunc func(ctx context.Context, msg kafka.Message) error

// Consumer is a long-running message consumer with retry/DLQ support.
type Consumer struct {
	r      *kafka.Reader
	cfg    ConsumerConfig
	mtr    *Metrics
	logger func(format string, args ...any)
	dlq    string
}

// NewConsumer creates a reader subscribed to topic/group.
func NewConsumer(cfg ConsumerConfig, mtr *Metrics, dlqTopic string, logger func(string, ...any)) *Consumer {
	if cfg.MinBytes == 0 {
		cfg.MinBytes = 1
	}
	if cfg.MaxBytes == 0 {
		cfg.MaxBytes = 10 * 1024 * 1024
	}
	if cfg.MaxWait == 0 {
		cfg.MaxWait = 500 * time.Millisecond
	}
	if cfg.StartAt == 0 {
		cfg.StartAt = kafka.LastOffset
	}
	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:     cfg.Brokers,
		Topic:       cfg.Topic,
		GroupID:     cfg.GroupID,
		MinBytes:    cfg.MinBytes,
		MaxBytes:    cfg.MaxBytes,
		MaxWait:     cfg.MaxWait,
		StartOffset: cfg.StartAt,
		Logger:      nil,
		ErrorLogger: nil,
	})
	return &Consumer{r: r, cfg: cfg, mtr: mtr, logger: logger, dlq: dlqTopic}
}

// Close shuts the consumer down.
func (c *Consumer) Close() error { return c.r.Close() }

// Run blocks until ctx is cancelled, processing messages with fn.
// On error the message is retried up to 3 times with exponential
// backoff, then routed to the DLQ topic. Successful processing
// commits the offset.
func (c *Consumer) Run(ctx context.Context, fn HandlerFunc) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		msg, err := c.r.FetchMessage(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			c.mtr.ConsumerErrors.WithLabelValues(c.cfg.Topic, "fetch").Inc()
			if c.logger != nil {
				c.logger("kafka.fetch.error topic=%s err=%v", c.cfg.Topic, err)
			}
			time.Sleep(500 * time.Millisecond)
			continue
		}
		c.mtr.MessagesConsumed.WithLabelValues(c.cfg.Topic, "fetched").Inc()

		if err := c.processWithRetry(ctx, msg, fn); err != nil {
			c.mtr.ConsumerErrors.WithLabelValues(c.cfg.Topic, "process").Inc()
			c.mtr.ConsumerProcessed.WithLabelValues(c.cfg.Topic, "dead_letter").Inc()
			if c.logger != nil {
				c.logger("kafka.process.failed topic=%s offset=%d err=%v", c.cfg.Topic, msg.Offset, err)
			}
			if c.dlq != "" {
				_ = c.routeToDLQ(ctx, msg, err)
			}
		} else {
			c.mtr.ConsumerProcessed.WithLabelValues(c.cfg.Topic, "ok").Inc()
		}

		if err := c.r.CommitMessages(ctx, msg); err != nil {
			c.mtr.ConsumerErrors.WithLabelValues(c.cfg.Topic, "commit").Inc()
			if c.logger != nil {
				c.logger("kafka.commit.error topic=%s err=%v", c.cfg.Topic, err)
			}
		}
	}
}

func (c *Consumer) processWithRetry(ctx context.Context, msg kafka.Message, fn HandlerFunc) error {
	var lastErr error
	backoff := 250 * time.Millisecond
	for attempt := 1; attempt <= 3; attempt++ {
		err := fn(ctx, msg)
		if err == nil {
			return nil
		}
		lastErr = err
		c.mtr.ConsumerErrors.WithLabelValues(c.cfg.Topic, "attempt").Inc()
		if c.logger != nil {
			c.logger("kafka.attempt.topic=%s attempt=%d err=%v", c.cfg.Topic, attempt, err)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
		backoff *= 2
	}
	return lastErr
}

func (c *Consumer) routeToDLQ(ctx context.Context, msg kafka.Message, lastErr error) error {
	// Best-effort: write to DLQ topic with original message + error header.
	dlq := &kafka.Writer{
		Addr:                   kafka.TCP(c.cfg.Brokers...),
		Topic:                  c.dlq,
		Balancer:               &kafka.Hash{},
		RequiredAcks:           kafka.RequireAll,
		AllowAutoTopicCreation: true,
		WriteTimeout:           5 * time.Second,
	}
	defer dlq.Close()
	headers := append(toKafkaHeaders(nil), kafka.Header{
		Key: "x-original-topic", Value: []byte(c.cfg.Topic),
	})
	headers = append(headers, kafka.Header{
		Key: "x-error", Value: []byte(lastErr.Error()),
	})
	headers = append(headers, kafka.Header{
		Key: "x-attempted-at", Value: []byte(time.Now().UTC().Format(time.RFC3339Nano)),
	})
	return dlq.WriteMessages(ctx, kafka.Message{
		Key:     msg.Key,
		Value:   msg.Value,
		Headers: headers,
	})
}

// ConsumerRegistry holds a set of running consumers for graceful shutdown.
type ConsumerRegistry struct {
	mu        sync.Mutex
	consumers []*Consumer
}

// Add registers a consumer.
func (r *ConsumerRegistry) Add(c *Consumer) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.consumers = append(r.consumers, c)
}

// CloseAll terminates all registered consumers.
func (r *ConsumerRegistry) CloseAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.consumers {
		_ = c.Close()
	}
}

// Topics — canonical Kafka topic names used across the service.
const (
	TopicTripRequested     = "rideandgo.trip.requested"
	TopicTripMatched       = "rideandgo.trip.matched"
	TopicTripDriverArrived = "rideandgo.trip.driver_arrived"
	TopicTripStarted       = "rideandgo.trip.started"
	TopicTripCompleted     = "rideandgo.trip.completed"
	TopicTripCancelled     = "rideandgo.trip.cancelled"
	TopicTripNoShow        = "rideandgo.trip.no_show"
	TopicDriverLocation    = "rideandgo.driver.location"
	TopicDriverStatus      = "rideandgo.driver.status"
	TopicPaymentCaptured   = "rideandgo.payment.captured"
	TopicPaymentReleased   = "rideandgo.payment.released"
	TopicPaymentRefunded   = "rideandgo.payment.refunded"
	TopicPaymentFailed     = "rideandgo.payment.failed"
	TopicRatingSubmitted   = "rideandgo.rating.submitted"
	TopicDisputeOpened     = "rideandgo.dispute.opened"
	TopicDisputeResolved   = "rideandgo.dispute.resolved"
	TopicSOSTriggered      = "rideandgo.sos.triggered"
	TopicSOSResolved       = "rideandgo.sos.resolved"
	TopicFraudFlagged      = "rideandgo.fraud.flagged"
	TopicUserSuspended     = "rideandgo.user.suspended"
	TopicAuditEvent        = "rideandgo.audit.event"
	TopicDLQ               = "rideandgo.dlq"
)
