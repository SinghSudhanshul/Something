package log

import (
	"os"
	"sync"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var (
	logger *zap.Logger
	once   sync.Once

	samplingInitial    int
	samplingThereafter int
)

func Init(
	level string,
	encoding string,
	outputPaths []string,
	errorOutputPaths []string,
	disableCaller bool,
	samplingInitialVal int,
	samplingThereafterVal int,
) (*zap.Logger, error) {
	once.Do(func() {
		samplingInitial = samplingInitialVal
		samplingThereafter = samplingThereafterVal

		lvl, err := zapcore.ParseLevel(level)
		if err != nil {
			lvl = zapcore.InfoLevel
		}

		cfg := zap.Config{
			Level:             zap.NewAtomicLevelAt(lvl),
			Development:       false,
			DisableCaller:     disableCaller,
			DisableStacktrace: true,
			Encoding:          encoding,
			EncoderConfig: zapcore.EncoderConfig{
				TimeKey:        "timestamp",
				LevelKey:       "level",
				NameKey:        "logger",
				CallerKey:      "caller",
				FunctionKey:    zapcore.OmitKey,
				MessageKey:     "message",
				StacktraceKey:  "stacktrace",
				LineEnding:     zapcore.DefaultLineEnding,
				EncodeLevel:    zapcore.LowercaseLevelEncoder,
				EncodeTime:     zapcore.ISO8601TimeEncoder,
				EncodeDuration: zapcore.SecondsDurationEncoder,
				EncodeCaller:   zapcore.ShortCallerEncoder,
			},
			OutputPaths:      outputPaths,
			ErrorOutputPaths: errorOutputPaths,
		}

		if samplingInitial > 0 && samplingThereafter > 0 {
			cfg.Sampling = &zap.SamplingConfig{
				Initial:    samplingInitial,
				Thereafter: samplingThereafter,
			}
		}

		var err error
		logger, err = cfg.Build(zap.AddCallerSkip(1))
		if err != nil {
			return
		}

		zap.ReplaceGlobals(logger)
	})

	return logger, nil
}

func Get() *zap.Logger {
	if logger == nil {
		once.Do(func() {
			var err error
			logger, err = Init("info", "json", []string{"stdout"}, []string{"stderr"}, false, 100, 100)
			if err != nil {
				panic(err)
			}
		})
	}
	return logger
}

func Sugared() *zap.SugaredLogger {
	return Get().Sugar()
}

func Sync() error {
	if logger != nil {
		return logger.Sync()
	}
	return nil
}

func With(fields ...zap.Field) *zap.Logger {
	return Get().With(fields...)
}

func Named(name string) *zap.Logger {
	return Get().Named(name)
}

func Debug(msg string, fields ...zap.Field) {
	Get().Debug(msg, fields...)
}

func Info(msg string, fields ...zap.Field) {
	Get().Info(msg, fields...)
}

func Warn(msg string, fields ...zap.Field) {
	Get().Warn(msg, fields...)
}

func Error(msg string, fields ...zap.Field) {
	Get().Error(msg, fields...)
}

func Fatal(msg string, fields ...zap.Field) {
	Get().Fatal(msg, fields...)
	os.Exit(1)
}

func Panic(msg string, fields ...zap.Field) {
	Get().Panic(msg, fields...)
}

func DPanic(msg string, fields ...zap.Field) {
	Get().DPanic(msg, fields...)
}

func Level() zapcore.Level {
	return Get().Level()
}

type ZapLogger struct {
	*zap.Logger
}

func (l *ZapLogger) Debugw(msg string, keysAndValues ...interface{}) {
	l.Sugar().Debugw(msg, keysAndValues...)
}

func (l *ZapLogger) Infow(msg string, keysAndValues ...interface{}) {
	l.Sugar().Infow(msg, keysAndValues...)
}

func (l *ZapLogger) Warnw(msg string, keysAndValues ...interface{}) {
	l.Sugar().Warnw(msg, keysAndValues...)
}

func (l *ZapLogger) Errorw(msg string, keysAndValues ...interface{}) {
	l.Sugar().Errorw(msg, keysAndValues...)
}

func (l *ZapLogger) Fatalw(msg string, keysAndValues ...interface{}) {
	l.Sugar().Fatalw(msg, keysAndValues...)
}

func NewZapLogger(l *zap.Logger) *ZapLogger {
	return &ZapLogger{Logger: l}
}