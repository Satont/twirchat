package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	defaultReconnectInitial = 3 * time.Second
	defaultReconnectMaximum = 30 * time.Second
	// 7TV emote-set snapshots can exceed coder/websocket's 32 KiB default.
	// Keep a finite limit because this is still an untrusted network boundary.
	maxBackendMessageBytes = 4 << 20
)

// Message is a validated backend WebSocket envelope. Data preserves payloads
// owned by later 7TV/auth services without lossy decoding in the transport.
type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"-"`
}

// WSConfig configures the authenticated, reconnecting desktop WebSocket.
type WSConfig struct {
	URL              string
	ClientSecret     string
	OnConnected      func(context.Context)
	OnMessage        func(Message)
	ReconnectInitial time.Duration
	ReconnectMaximum time.Duration
}

// WSClient owns exactly one reconnect loop and stops it when its context ends.
type WSClient struct {
	config WSConfig

	mu         sync.RWMutex
	connection *websocket.Conn
	cancel     context.CancelFunc
	done       chan struct{}
}

func NewWSClient(config WSConfig) (*WSClient, error) {
	if config.URL == "" {
		return nil, errors.New("create backend WebSocket client: URL is required")
	}
	if config.ClientSecret == "" {
		return nil, errors.New("create backend WebSocket client: client secret is required")
	}
	if config.ReconnectInitial <= 0 {
		config.ReconnectInitial = defaultReconnectInitial
	}
	if config.ReconnectMaximum <= 0 {
		config.ReconnectMaximum = defaultReconnectMaximum
	}
	if config.ReconnectMaximum < config.ReconnectInitial {
		config.ReconnectMaximum = config.ReconnectInitial
	}
	return &WSClient{config: config}, nil
}

// Start begins the reconnect loop and returns once the worker is owned by ctx.
func (c *WSClient) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start backend WebSocket: %w", err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.cancel != nil {
		return errors.New("start backend WebSocket: client already started")
	}
	workerContext, cancel := context.WithCancel(ctx)
	c.cancel = cancel
	c.done = make(chan struct{})
	go c.run(workerContext, c.done)
	return nil
}

// Stop closes the active connection and waits for the reconnect loop to exit.
func (c *WSClient) Stop(ctx context.Context) error {
	c.mu.Lock()
	cancel := c.cancel
	done := c.done
	connection := c.connection
	c.cancel = nil
	c.done = nil
	c.connection = nil
	c.mu.Unlock()
	if cancel == nil {
		return nil
	}
	cancel()
	if connection != nil {
		_ = connection.Close(websocket.StatusGoingAway, "desktop shutdown")
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("stop backend WebSocket: %w", ctx.Err())
	}
}

// Send encodes one desktop-to-backend command on the active connection.
func (c *WSClient) Send(ctx context.Context, message any) error {
	c.mu.RLock()
	connection := c.connection
	c.mu.RUnlock()
	if connection == nil {
		return errors.New("send backend WebSocket message: not connected")
	}
	data, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("send backend WebSocket message: encode JSON: %w", err)
	}
	if err := connection.Write(ctx, websocket.MessageText, data); err != nil {
		return fmt.Errorf("send backend WebSocket message: %w", err)
	}
	return nil
}

func (c *WSClient) run(ctx context.Context, done chan struct{}) {
	defer func() {
		c.mu.Lock()
		c.connection = nil
		c.mu.Unlock()
		close(done)
	}()

	delay := c.config.ReconnectInitial
	for ctx.Err() == nil {
		connection, _, err := websocket.Dial(ctx, c.config.URL, &websocket.DialOptions{
			HTTPHeader: http.Header{"X-Client-Secret": []string{c.config.ClientSecret}},
		})
		if err == nil {
			connection.SetReadLimit(maxBackendMessageBytes)
			c.mu.Lock()
			c.connection = connection
			c.mu.Unlock()
			delay = c.config.ReconnectInitial
			if c.config.OnConnected != nil {
				c.config.OnConnected(ctx)
			}
			err = c.readUntilClosed(ctx, connection)
			if err != nil {
				log.Printf(
					"backend websocket: read ended close_status=%d error=%v context_error=%v",
					websocket.CloseStatus(err), err, ctx.Err(),
				)
			}
			_ = connection.Close(websocket.StatusGoingAway, "reconnect")
			c.mu.Lock()
			if c.connection == connection {
				c.connection = nil
			}
			c.mu.Unlock()
		}
		if ctx.Err() != nil {
			return
		}
		_ = err // Connection errors are transient; callers receive status via later services.
		if !wait(ctx, delay) {
			return
		}
		delay = minDuration(delay*2, c.config.ReconnectMaximum)
	}
}

func (c *WSClient) readUntilClosed(ctx context.Context, connection *websocket.Conn) error {
	for {
		_, data, err := connection.Read(ctx)
		if err != nil {
			return err
		}
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil || envelope.Type == "" {
			continue
		}
		if c.config.OnMessage != nil {
			c.config.OnMessage(Message{Type: envelope.Type, Data: append(json.RawMessage(nil), data...)})
		}
	}
}

func wait(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func minDuration(left, right time.Duration) time.Duration {
	if left < right {
		return left
	}
	return right
}
