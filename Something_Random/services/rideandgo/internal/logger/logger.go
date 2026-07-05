// Package logger provides a structured, leveled logger used across
// the service. We use uber/zap in production for its allocation
// efficiency and JSON output compatibility with log aggregators.
// All log lines carry service, env, version, and instance_id
// fields so multi-instance deployments can be filtered easily.
package logger

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// ctxKey is unexported to prevent context-key collisions.
type ctxKey int

const (
	requestIDKey ctxKey = iota
	userIDKey
	tripIDKey
	driverIDKey
	traceIDKey
)

// Logger is a thin wrapper around zap.SugaredLogger that adds
// scoped helpers and context-aware field injection. It is the
// only logger type the rest of the codebase should reference.
type Logger struct {
	z   *zap.Logger
	s   *zap.SugaredLogger
	mu  sync.RWMutex
	cfg Config
}

// Config controls logger behavior.
type Config struct {
	Level    string // debug | info | warn | error | fatal
	Format   string // json | console
	Service  string
	Env      string
	Version  string
	Instance string
}

// New constructs a configured logger. Level parsing is permissive:
// empty string defaults to info. Format defaults to json. The
// returned logger must be Sync'd at shutdown to flush buffers.
func New(cfg Config) (*Logger, error) {
	level := parseLevel(cfg.Level)

	encoderCfg := zapcore.EncoderConfig{
		TimeKey:        "ts",
		LevelKey:       "level",
		NameKey:        "logger",
		CallerKey:      "caller",
		MessageKey:     "msg",
		StacktraceKey:  "stacktrace",
		LineEnding:     zapcore.DefaultLineEnding,
		EncodeLevel:    zapcore.LowercaseLevelEncoder,
		EncodeTime:     zapcore.ISO8601TimeEncoder,
		EncodeDuration: zapcore.MillisDurationEncoder,
		EncodeCaller:   zapcore.ShortCallerEncoder,
	}

	var encoder zapcore.Encoder
	switch cfg.Format {
	case "console", "":
		encoderCfg.EncodeLevel = zapcore.CapitalColorLevelEncoder
		encoder = zapcore.NewConsoleEncoder(encoderCfg)
	case "json":
		encoder = zapcore.NewJSONEncoder(encoderCfg)
	default:
		return nil, fmt.Errorf("logger: unknown format %q", cfg.Format)
	}

	core := zapcore.NewCore(
		encoder,
		zapcore.Lock(os.Stdout),
		zap.NewAtomicLevelAt(level),
	)

	z := zap.New(
		core,
		zap.AddCaller(),
		zap.AddStacktrace(zapcore.ErrorLevel),
		zap.Fields(
			zap.String("service", cfg.Service),
			zap.String("env", cfg.Env),
			zap.String("version", cfg.Version),
			zap.String("instance", cfg.Instance),
		),
	)
	return &Logger{z: z, s: z.Sugar(), cfg: cfg}, nil
}

// WithRequestID attaches a request ID to a context for downstream
// logs to inherit. Generated per HTTP request at the middleware layer.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// WithUserID attaches the authenticated user ID to context.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}

// WithTripID attaches a trip ID to context.
func WithTripID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, tripIDKey, id)
}

// WithDriverID attaches a driver ID to context.
func WithDriverID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, driverIDKey, id)
}

// WithTraceID attaches an OpenTelemetry trace ID to context.
func WithTraceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, traceIDKey, id)
}

// FromContext returns a logger pre-populated with fields drawn
// from the context (request ID, user ID, trip ID). Use this when
// the calling function receives a context and wants contextual logs.
func (l *Logger) FromContext(ctx context.Context) *Logger {
	if ctx == nil {
		return l
	}
	fields := make([]zap.Field, 0, 5)
	if v, ok := ctx.Value(requestIDKey).(string); ok && v != "" {
		fields = append(fields, zap.String("request_id", v))
	}
	if v, ok := ctx.Value(userIDKey).(string); ok && v != "" {
		fields = append(fields, zap.String("user_id", v))
	}
	if v, ok := ctx.Value(tripIDKey).(string); ok && v != "" {
		fields = append(fields, zap.String("trip_id", v))
	}
	if v, ok := ctx.Value(driverIDKey).(string); ok && v != "" {
		fields = append(fields, zap.String("driver_id", v))
	}
	if v, ok := ctx.Value(traceIDKey).(string); ok && v != "" {
		fields = append(fields, zap.String("trace_id", v))
	}
	if len(fields) == 0 {
		return l
	}
	return &Logger{z: l.z.With(fields...), s: l.s.With(fields...), cfg: l.cfg}
}

// With returns a logger with extra structured fields attached.
func (l *Logger) With(args ...any) *Logger {
	return &Logger{z: l.z.With(zap.Any("extra", args)...), s: l.s.With(args...), cfg: l.cfg}
}

// Debug logs at debug level.
func (l *Logger) Debug(msg string, args ...any) { l.s.Debugw(msg, args...) }

// Info logs at info level.
func (l *Logger) Info(msg string, args ...any) { l.s.Infow(msg, args...) }

// Warn logs at warn level.
func (l *Logger) Warn(msg string, args ...any) { l.s.Warnw(msg, args...) }

// Error logs at error level.
func (l *Logger) Error(msg string, args ...any) { l.s.Errorw(msg, args...) }

// Fatal logs at fatal level then exits.
func (l *Logger) Fatal(msg string, args ...any) { l.s.Fatalw(msg, args...) }

// Sync flushes buffered logs. Call on shutdown.
func (l *Logger) Sync() error { return l.z.Sync() }

// parseLevel converts a string to zapcore.Level.
// Unknown values fall back to info to keep the service running.
func parseLevel(s string) zapcore.Level {
	switch s {
	case "debug":
		return zapcore.DebugLevel
	case "info", "":
		return zapcore.InfoLevel
	case "warn", "warning":
		return zapcore.WarnLevel
	case "error":
		return zapcore.ErrorLevel
	case "fatal":
		return zapcore.FatalLevel
	default:
		return zapcore.InfoLevel
	}
}

// TimeOp is a helper to time operations consistently.
// Usage: defer logger.TimeOp(ctx, "trip.match")()
func (l *Logger) TimeOp(ctx context.Context, op string) func() {
	start := time.Now()
	ll := l.FromContext(ctx)
	ll.Debug("op.start", "operation", op)
	return func() {
		ll.Debug("op.end",
			"operation", op,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	}
}
