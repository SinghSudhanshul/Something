// Package redisclient wraps go-redis with service-specific
// operations for geospatial indexing, presence, and ephemeral
// trip state. The package is safe for concurrent use; it shares
// a single connection pool across all callers.
package redisclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/extra/redisotel/v9"
	"github.com/redis/go-redis/v9"

	"rideandgo/internal/config"
)

// Client wraps redis.UniversalClient (cluster or single).
type Client struct {
	c   redis.UniversalClient
	cfg *config.Config
	mtr *Metrics
}

// Metrics holds Prometheus instrumentation for Redis operations.
type Metrics struct {
	OpsTotal   *prometheus.CounterVec
	OpDuration *prometheus.HistogramVec
	Hits       prometheus.Counter
	Misses     prometheus.Counter
	Errors     *prometheus.CounterVec
	PoolActive prometheus.Gauge
	PoolIdle   prometheus.Gauge
	Connected  prometheus.Gauge
}

// NewMetrics creates and registers Redis metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		OpsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_redis_ops_total",
			Help: "Redis operations by command.",
		}, []string{"op", "result"}),
		OpDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "rideandgo_redis_op_duration_seconds",
			Help:    "Redis operation latency by command.",
			Buckets: prometheus.ExponentialBuckets(0.0001, 2, 12),
		}, []string{"op"}),
		Hits: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "rideandgo_redis_cache_hits_total",
			Help: "Cache hits.",
		}),
		Misses: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "rideandgo_redis_cache_misses_total",
			Help: "Cache misses.",
		}),
		Errors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "rideandgo_redis_errors_total",
			Help: "Redis errors by class.",
		}, []string{"class"}),
		PoolActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_redis_pool_active",
			Help: "Active connections in the pool.",
		}),
		PoolIdle: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_redis_pool_idle",
			Help: "Idle connections in the pool.",
		}),
		Connected: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "rideandgo_redis_connected",
			Help: "1 if the client is connected, 0 otherwise.",
		}),
	}
	reg.MustRegister(m.OpsTotal, m.OpDuration, m.Hits, m.Misses,
		m.Errors, m.PoolActive, m.PoolIdle, m.Connected)
	return m
}

// New creates a Redis client. In single-node mode it parses the
// URL and connects. In cluster mode the URL is treated as a comma
// list of node addresses.
func New(ctx context.Context, cfg *config.Config, mtr *Metrics) (*Client, error) {
	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("redis: parse url: %w", err)
	}
	opts.Password = cfg.RedisPassword
	opts.DB = cfg.RedisDB
	opts.PoolSize = cfg.RedisPoolSize
	opts.MinIdleConns = cfg.RedisMinIdleConns
	opts.DialTimeout = cfg.RedisDialTimeout
	opts.ReadTimeout = cfg.RedisReadTimeout
	opts.WriteTimeout = cfg.RedisWriteTimeout
	opts.PoolTimeout = cfg.RedisReadTimeout * 2

	var client redis.UniversalClient
	if cfg.RedisClusterMode {
		client = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:        []string{opts.Addr},
			Password:     opts.Password,
			PoolSize:     opts.PoolSize,
			MinIdleConns: opts.MinIdleConns,
			DialTimeout:  opts.DialTimeout,
			ReadTimeout:  opts.ReadTimeout,
			WriteTimeout: opts.WriteTimeout,
		})
	} else {
		client = redis.NewClient(opts)
	}

	if err := redisotel.InstrumentTracing(client); err != nil {
		// OTel is optional; we log at startup if it fails but proceed.
		_ = err
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis: ping failed: %w", err)
	}

	c := &Client{c: client, cfg: cfg, mtr: mtr}
	go c.collectPoolStats(ctx)
	return c, nil
}

// Close shuts down the client cleanly.
func (c *Client) Close() error { return c.c.Close() }

// Raw returns the underlying client. Use sparingly — prefer the
// typed helpers below. Direct access is required for transactions,
// pipelines, and pub/sub that don't fit the helper signatures.
func (c *Client) Raw() redis.UniversalClient { return c.c }

// Get retrieves a string value. Returns ("", false, nil) on miss.
func (c *Client) Get(ctx context.Context, key string) (string, bool, error) {
	t := time.Now()
	v, err := c.c.Get(ctx, key).Result()
	c.mtr.OpDuration.WithLabelValues("get").Observe(time.Since(t).Seconds())
	if errors.Is(err, redis.Nil) {
		c.mtr.Misses.Inc()
		c.mtr.OpsTotal.WithLabelValues("get", "miss").Inc()
		return "", false, nil
	}
	if err != nil {
		c.mtr.Errors.WithLabelValues("get").Inc()
		c.mtr.OpsTotal.WithLabelValues("get", "error").Inc()
		return "", false, err
	}
	c.mtr.Hits.Inc()
	c.mtr.OpsTotal.WithLabelValues("get", "ok").Inc()
	return v, true, nil
}

// SetEX stores a value with a TTL.
func (c *Client) SetEX(ctx context.Context, key, val string, ttl time.Duration) error {
	t := time.Now()
	err := c.c.SetEx(ctx, key, val, ttl).Err()
	c.mtr.OpDuration.WithLabelValues("setex").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("setex").Inc()
		c.mtr.OpsTotal.WithLabelValues("setex", "error").Inc()
		return err
	}
	c.mtr.OpsTotal.WithLabelValues("setex", "ok").Inc()
	return nil
}

// Del removes one or more keys. Returns the count removed.
func (c *Client) Del(ctx context.Context, keys ...string) (int64, error) {
	t := time.Now()
	n, err := c.c.Del(ctx, keys...).Result()
	c.mtr.OpDuration.WithLabelValues("del").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("del").Inc()
		return 0, err
	}
	c.mtr.OpsTotal.WithLabelValues("del", "ok").Inc()
	return n, nil
}

// Incr atomically increments a counter and returns the new value.
func (c *Client) Incr(ctx context.Context, key string) (int64, error) {
	t := time.Now()
	n, err := c.c.Incr(ctx, key).Result()
	c.mtr.OpDuration.WithLabelValues("incr").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("incr").Inc()
		return 0, err
	}
	c.mtr.OpsTotal.WithLabelValues("incr", "ok").Inc()
	return n, nil
}

// Expire sets a TTL on an existing key. No-op if the key doesn't exist.
func (c *Client) Expire(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	t := time.Now()
	ok, err := c.c.Expire(ctx, key, ttl).Result()
	c.mtr.OpDuration.WithLabelValues("expire").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("expire").Inc()
		return false, err
	}
	c.mtr.OpsTotal.WithLabelValues("expire", "ok").Inc()
	return ok, nil
}

// GetJSON loads JSON-encoded T from Redis. Returns (zero, false, nil) on miss.
func GetJSON[T any](ctx context.Context, c *Client, key string) (T, bool, error) {
	var zero T
	s, ok, err := c.Get(ctx, key)
	if err != nil || !ok {
		return zero, ok, err
	}
	var v T
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		return zero, false, fmt.Errorf("redis: json unmarshal: %w", err)
	}
	return v, true, nil
}

// SetJSON marshals T and stores with a TTL.
func SetJSON[T any](ctx context.Context, c *Client, key string, v T, ttl time.Duration) error {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("redis: json marshal: %w", err)
	}
	return c.SetEX(ctx, key, string(b), ttl)
}

// HSet stores fields in a hash.
func (c *Client) HSet(ctx context.Context, key string, fields map[string]any) error {
	t := time.Now()
	err := c.c.HSet(ctx, key, fields).Err()
	c.mtr.OpDuration.WithLabelValues("hset").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("hset").Inc()
		return err
	}
	c.mtr.OpsTotal.WithLabelValues("hset", "ok").Inc()
	return nil
}

// HGetAll retrieves all fields of a hash.
func (c *Client) HGetAll(ctx context.Context, key string) (map[string]string, error) {
	t := time.Now()
	m, err := c.c.HGetAll(ctx, key).Result()
	c.mtr.OpDuration.WithLabelValues("hgetall").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("hgetall").Inc()
		return nil, err
	}
	c.mtr.OpsTotal.WithLabelValues("hgetall", "ok").Inc()
	return m, nil
}

// EvalSha executes a cached Lua script.
func (c *Client) EvalSha(ctx context.Context, sha string, keys []string, args ...any) (any, error) {
	t := time.Now()
	r, err := c.c.EvalSha(ctx, sha, keys, args...).Result()
	c.mtr.OpDuration.WithLabelValues("evalsha").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("evalsha").Inc()
		return nil, err
	}
	c.mtr.OpsTotal.WithLabelValues("evalsha", "ok").Inc()
	return r, nil
}

// ScriptLoad caches a Lua script and returns its SHA.
func (c *Client) ScriptLoad(ctx context.Context, script string) (string, error) {
	t := time.Now()
	sha, err := c.c.ScriptLoad(ctx, script).Result()
	c.mtr.OpDuration.WithLabelValues("script_load").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("script_load").Inc()
		return "", err
	}
	c.mtr.OpsTotal.WithLabelValues("script_load", "ok").Inc()
	return sha, nil
}

// GeoAdd adds a geospatial point.
func (c *Client) GeoAdd(ctx context.Context, key string, lat, lng float64, member string) error {
	t := time.Now()
	err := c.c.GeoAdd(ctx, key, &redis.GeoLocation{
		Latitude:  lat,
		Longitude: lng,
		Name:      member,
	}).Err()
	c.mtr.OpDuration.WithLabelValues("geoadd").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("geoadd").Inc()
		return err
	}
	c.mtr.OpsTotal.WithLabelValues("geoadd", "ok").Inc()
	return nil
}

// GeoRemove removes a geospatial member.
func (c *Client) GeoRemove(ctx context.Context, key, member string) error {
	t := time.Now()
	err := c.c.GeoRemove(ctx, key, member).Err()
	c.mtr.OpDuration.WithLabelValues("georem").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("georem").Inc()
		return err
	}
	c.mtr.OpsTotal.WithLabelValues("georem", "ok").Inc()
	return nil
}

// GeoSearch runs a GEOSEARCH query and returns matching members.
func (c *Client) GeoSearch(ctx context.Context, key string, q GeoQuery) ([]GeoResult, error) {
	t := time.Now()
	cmd := c.c.GeoSearchLocation(ctx, key, &redis.GeoSearchLocationQuery{
		GeoSearchQuery: redis.GeoSearchQuery{
			Longitude:  q.CenterLng,
			Latitude:   q.CenterLat,
			Radius:     q.Radius,
			RadiusUnit: "m",
			Sort:       "ASC",
			Count:      q.Count,
		},
		WithCoord: true,
		WithDist:  true,
	})
	locations, err := cmd.Result()
	c.mtr.OpDuration.WithLabelValues("geosearch").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("geosearch").Inc()
		return nil, err
	}
	c.mtr.OpsTotal.WithLabelValues("geosearch", "ok").Inc()
	results := make([]GeoResult, 0, len(locations))
	for _, loc := range locations {
		results = append(results, GeoResult{
			Member: loc.Name,
			Lat:    loc.Latitude,
			Lng:    loc.Longitude,
			DistM:  loc.Dist,
		})
	}
	return results, nil
}

// GeoQuery represents a radius search.
type GeoQuery struct {
	CenterLat float64
	CenterLng float64
	Radius    float64
	Count     int
}

// GeoResult is one member returned from a radius search.
type GeoResult struct {
	Member string
	Lat    float64
	Lng    float64
	DistM  float64
}

// Publish sends a message to a channel.
func (c *Client) Publish(ctx context.Context, channel, message string) (int64, error) {
	t := time.Now()
	n, err := c.c.Publish(ctx, channel, message).Result()
	c.mtr.OpDuration.WithLabelValues("publish").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("publish").Inc()
		return 0, err
	}
	c.mtr.OpsTotal.WithLabelValues("publish", "ok").Inc()
	return n, nil
}

// SetNX atomically sets a key only if it doesn't exist.
// Returns true if the key was set.
func (c *Client) SetNX(ctx context.Context, key, val string, ttl time.Duration) (bool, error) {
	t := time.Now()
	ok, err := c.c.SetNX(ctx, key, val, ttl).Result()
	c.mtr.OpDuration.WithLabelValues("setnx").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("setnx").Inc()
		return false, err
	}
	c.mtr.OpsTotal.WithLabelValues("setnx", "ok").Inc()
	return ok, nil
}

// SetNXInt sets a numeric key only if it doesn't exist.
func (c *Client) SetNXInt(ctx context.Context, key string, val int64, ttl time.Duration) (bool, error) {
	return c.SetNX(ctx, key, strconv.FormatInt(val, 10), ttl)
}

// EvalRO runs a read-only Lua script in a single round trip.
func (c *Client) EvalRO(ctx context.Context, script string, keys []string, args ...any) (any, error) {
	t := time.Now()
	r, err := c.c.EvalRO(ctx, script, keys, args...).Result()
	c.mtr.OpDuration.WithLabelValues("evalro").Observe(time.Since(t).Seconds())
	if err != nil {
		c.mtr.Errors.WithLabelValues("evalro").Inc()
		return nil, err
	}
	c.mtr.OpsTotal.WithLabelValues("evalro", "ok").Inc()
	return r, nil
}

// collectPoolStats updates pool gauges every 5 seconds.
func (c *Client) collectPoolStats(ctx context.Context) {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			stats := c.c.PoolStats()
			c.mtr.PoolActive.Set(float64(stats.TotalConns - stats.IdleConns))
			c.mtr.PoolIdle.Set(float64(stats.IdleConns))
			if err := c.c.Ping(ctx).Err(); err == nil {
				c.mtr.Connected.Set(1)
			} else {
				c.mtr.Connected.Set(0)
			}
		}
	}
}

// FlushDB wipes all keys. Dev only — guarded by IsDevelopment.
func (c *Client) FlushDB(ctx context.Context) error {
	if !c.cfg.IsDevelopment() {
		return errors.New("redis: FlushDB is dev-only")
	}
	return c.c.FlushDB(ctx).Err()
}
