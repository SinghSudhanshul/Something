package tracking

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// LocationUpdate represents a GPS location update from a driver.
type LocationUpdate struct {
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float64 `json:"speed,omitempty"`     // km/h
	Heading   float64 `json:"heading,omitempty"`   // degrees
	Accuracy  float64 `json:"accuracy,omitempty"`  // meters
	Timestamp string  `json:"timestamp,omitempty"`
}

// LocationBroadcast is the message sent to all clients subscribed to a ride.
type LocationBroadcast struct {
	DriverID  string  `json:"driver_id"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	Speed     float64 `json:"speed,omitempty"`
	Heading   float64 `json:"heading,omitempty"`
	Timestamp string  `json:"timestamp"`
	Type      string  `json:"type"` // "location_update"
}

// ETAUpdate is sent to clients with estimated time of arrival.
type ETAUpdate struct {
	EstimatedMinutes int    `json:"estimated_minutes"`
	DistanceMeters   int    `json:"distance_meters"`
	Timestamp        string `json:"timestamp"`
	Type             string `json:"type"` // "eta_update"
}

// Client represents a WebSocket client.
type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan []byte
	rideID   string
	userID   string
	isDriver bool
	mu       sync.Mutex // protects conn writes
}

// Hub manages all active WebSocket connections for ride tracking.
type Hub struct {
	clients    map[string][]*Client // keyed by rideID
	mu         sync.RWMutex
	register   chan *Client
	unregister chan *Client
	pool       *pgxpool.Pool
	rdb        *redis.Client
	logger     *zap.Logger
	stats      *HubStats
}

// HubStats tracks real-time WebSocket statistics.
type HubStats struct {
	mu               sync.RWMutex
	ActiveRides      int64 `json:"active_rides"`
	ConnectedClients int64 `json:"connected_clients"`
	TotalMessages    int64 `json:"total_messages"`
}

// NewHub creates a new tracking hub with database and Redis connections.
func NewHub(pool *pgxpool.Pool, rdb *redis.Client, logger *zap.Logger) *Hub {
	return &Hub{
		clients:    make(map[string][]*Client),
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
		pool:       pool,
		rdb:        rdb,
		logger:     logger,
		stats:      &HubStats{},
	}
}

// NewHubSimple creates a hub without DB/Redis (for backwards compatibility).
func NewHubSimple(logger *zap.Logger) *Hub {
	return &Hub{
		clients:    make(map[string][]*Client),
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
		logger:     logger,
		stats:      &HubStats{},
	}
}

// Run starts the hub event loop. Must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.rideID] = append(h.clients[client.rideID], client)
			h.stats.mu.Lock()
			h.stats.ConnectedClients++
			if len(h.clients[client.rideID]) == 1 {
				h.stats.ActiveRides++
			}
			h.stats.mu.Unlock()
			h.mu.Unlock()
			h.logger.Debug("client registered",
				zap.String("rideID", client.rideID),
				zap.String("userID", client.userID),
				zap.Bool("isDriver", client.isDriver),
			)

		case client := <-h.unregister:
			h.mu.Lock()
			if clients, ok := h.clients[client.rideID]; ok {
				for i, c := range clients {
					if c == client {
						h.clients[client.rideID] = append(clients[:i], clients[i+1:]...)
						break
					}
				}
				if len(h.clients[client.rideID]) == 0 {
					delete(h.clients, client.rideID)
					h.stats.mu.Lock()
					h.stats.ActiveRides--
					h.stats.mu.Unlock()
				}
			}
			h.stats.mu.Lock()
			h.stats.ConnectedClients--
			h.stats.mu.Unlock()
			close(client.send)
			h.mu.Unlock()
			h.logger.Debug("client unregistered",
				zap.String("rideID", client.rideID),
				zap.String("userID", client.userID),
			)
		}
	}
}

// Broadcast sends a message to all clients subscribed to a ride.
func (h *Hub) Broadcast(rideID string, message []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if clients, ok := h.clients[rideID]; ok {
		for _, client := range clients {
			select {
			case client.send <- message:
				h.stats.mu.Lock()
				h.stats.TotalMessages++
				h.stats.mu.Unlock()
			default:
				// Channel full — client is too slow
				h.logger.Warn("dropping message for slow client",
					zap.String("rideID", rideID),
					zap.String("userID", client.userID),
				)
			}
		}
	}
}

// GetStats returns current hub statistics.
func (h *Hub) GetStats() HubStats {
	h.stats.mu.RLock()
	defer h.stats.mu.RUnlock()
	return HubStats{
		ActiveRides:      h.stats.ActiveRides,
		ConnectedClients: h.stats.ConnectedClients,
		TotalMessages:    h.stats.TotalMessages,
	}
}

// GetActiveClientCount returns the number of clients for a ride.
func (h *Hub) GetActiveClientCount(rideID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients[rideID])
}

// HandleWebSocket handles the WebSocket upgrade for ride tracking.
// Query params: ride_id, user_id, role (driver|passenger), token (auth)
func (h *Hub) HandleWebSocket(c *gin.Context) {
	rideID := c.Query("ride_id")
	userID := c.Query("user_id")
	role := c.Query("role")
	token := c.Query("token")

	if rideID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"code":    "BAD_REQUEST",
			"message": "ride_id and user_id are required query parameters",
		})
		return
	}

	// Validate token (simplified — in production, verify JWT)
	if token == "" {
		// Check Authorization header as fallback
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"code":    "UNAUTHORIZED",
				"message": "Authentication token is required (query param 'token' or Authorization header)",
			})
			return
		}
		token = strings.TrimPrefix(authHeader, "Bearer ")
	}

	isDriver := role == "driver"

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.Error("websocket upgrade failed", zap.Error(err))
		return
	}

	client := &Client{
		hub:      h,
		conn:     conn,
		send:     make(chan []byte, 256),
		rideID:   rideID,
		userID:   userID,
		isDriver: isDriver,
	}

	h.register <- client

	// Send welcome message
	welcome, _ := json.Marshal(map[string]interface{}{
		"type":     "connected",
		"ride_id":  rideID,
		"user_id":  userID,
		"role":     role,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	client.send <- welcome

	go client.writePump()
	go client.readPump()
}

// readPump reads messages from the WebSocket connection.
// For drivers: processes GPS location updates and persists to route log.
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(4096) // 4KB max message
	c.conn.SetReadDeadline(time.Now().Add(35 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(35 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.hub.logger.Warn("unexpected websocket close",
					zap.String("rideID", c.rideID),
					zap.String("userID", c.userID),
					zap.Error(err),
				)
			}
			break
		}

		// Only process messages from drivers (GPS updates)
		if c.isDriver {
			c.processDriverMessage(message)
		}
	}
}

// processDriverMessage handles a GPS update from a driver.
func (c *Client) processDriverMessage(message []byte) {
	var loc LocationUpdate
	if err := json.Unmarshal(message, &loc); err != nil {
		c.hub.logger.Warn("invalid location update format",
			zap.String("rideID", c.rideID),
			zap.String("userID", c.userID),
			zap.Error(err),
		)
		return
	}

	// Validate coordinates
	if loc.Lat < -90 || loc.Lat > 90 || loc.Lng < -180 || loc.Lng > 180 {
		c.hub.logger.Warn("invalid coordinates",
			zap.Float64("lat", loc.Lat),
			zap.Float64("lng", loc.Lng),
		)
		return
	}

	now := time.Now().UTC()
	timestamp := now.Format(time.RFC3339)

	// Persist to route log (non-blocking)
	if c.hub.pool != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			rideID, _ := uuid.Parse(c.rideID)
			driverID, _ := uuid.Parse(c.userID)
			_, err := c.hub.pool.Exec(ctx, `
				INSERT INTO ride_route_log (ride_request_id, driver_id, location, recorded_at)
				VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5)
			`, rideID, driverID, loc.Lat, loc.Lng, now)
			if err != nil {
				c.hub.logger.Error("failed to persist route point",
					zap.String("rideID", c.rideID),
					zap.Error(err),
				)
			}
		}()
	}

	// Cache in Redis for other services to read
	if c.hub.rdb != nil {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			defer cancel()
			locData, _ := json.Marshal(map[string]interface{}{
				"lat": loc.Lat, "lng": loc.Lng,
				"speed": loc.Speed, "heading": loc.Heading,
				"ts": timestamp,
			})
			key := fmt.Sprintf("driver:loc:%s", c.userID)
			c.hub.rdb.SetEx(ctx, key, string(locData), 30*time.Second)

			// Publish to Redis channel for cross-service consumption
			channel := fmt.Sprintf("rides:driver:%s:location", c.userID)
			c.hub.rdb.Publish(ctx, channel, string(locData))
		}()
	}

	// Broadcast to all clients subscribed to this ride
	broadcast := LocationBroadcast{
		DriverID:  c.userID,
		Lat:       loc.Lat,
		Lng:       loc.Lng,
		Speed:     loc.Speed,
		Heading:   loc.Heading,
		Timestamp: timestamp,
		Type:      "location_update",
	}
	broadcastMsg, _ := json.Marshal(broadcast)
	c.hub.Broadcast(c.rideID, broadcastMsg)
}

// writePump writes messages to the WebSocket connection.
// Sends periodic pings to detect dead connections.
func (c *Client) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				// Hub closed the channel
				c.mu.Lock()
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				c.mu.Unlock()
				return
			}
			c.mu.Lock()
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			err := c.conn.WriteMessage(websocket.TextMessage, message)
			c.mu.Unlock()
			if err != nil {
				return
			}

		case <-ticker.C:
			c.mu.Lock()
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			err := c.conn.WriteMessage(websocket.PingMessage, nil)
			c.mu.Unlock()
			if err != nil {
				return
			}
		}
	}
}

// BroadcastRideEvent sends a ride lifecycle event to all connected clients.
func (h *Hub) BroadcastRideEvent(rideID string, eventType string, data map[string]interface{}) {
	event := map[string]interface{}{
		"type":      eventType,
		"ride_id":   rideID,
		"data":      data,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	msg, _ := json.Marshal(event)
	h.Broadcast(rideID, msg)
}

// BroadcastETA sends an ETA update to passengers on a ride.
func (h *Hub) BroadcastETA(rideID string, estimatedMinutes int, distanceMeters int) {
	eta := ETAUpdate{
		EstimatedMinutes: estimatedMinutes,
		DistanceMeters:   distanceMeters,
		Timestamp:        time.Now().UTC().Format(time.RFC3339),
		Type:             "eta_update",
	}
	msg, _ := json.Marshal(eta)
	h.Broadcast(rideID, msg)
}

// NotifyRideStatusChange broadcasts a status change to all ride participants.
func (h *Hub) NotifyRideStatusChange(rideID, newStatus string) {
	h.BroadcastRideEvent(rideID, "ride_status_changed", map[string]interface{}{
		"status": newStatus,
	})
}

// DisconnectAllForRide forcefully disconnects all clients for a completed/cancelled ride.
func (h *Hub) DisconnectAllForRide(rideID string) {
	h.mu.Lock()
	clients := h.clients[rideID]
	delete(h.clients, rideID)
	h.mu.Unlock()

	for _, client := range clients {
		// Send close message
		closeMsg, _ := json.Marshal(map[string]interface{}{
			"type":    "ride_ended",
			"ride_id": rideID,
		})
		select {
		case client.send <- closeMsg:
		default:
		}
		// Close the connection after a brief delay to let the message send
		go func(c *Client) {
			time.Sleep(500 * time.Millisecond)
			c.conn.Close()
		}(client)
	}
}

// SubscribeToRedisLocation subscribes to driver location updates from Redis pub/sub.
// This allows other service instances to receive location updates.
func (h *Hub) SubscribeToRedisLocation(ctx context.Context, driverID, rideID string) {
	if h.rdb == nil {
		return
	}

	channel := fmt.Sprintf("rides:driver:%s:location", driverID)
	pubsub := h.rdb.Subscribe(ctx, channel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			// Re-broadcast to WebSocket clients
			var loc map[string]interface{}
			if err := json.Unmarshal([]byte(msg.Payload), &loc); err == nil {
				broadcast := LocationBroadcast{
					DriverID:  driverID,
					Lat:       loc["lat"].(float64),
					Lng:       loc["lng"].(float64),
					Timestamp: loc["ts"].(string),
					Type:      "location_update",
				}
				broadcastMsg, _ := json.Marshal(broadcast)
				h.Broadcast(rideID, broadcastMsg)
			}
		}
	}
}
