package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestWSClientSendsClientSecretAndDeliversMessages(t *testing.T) {
	receivedHeader := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		receivedHeader <- request.Header.Get("X-Client-Secret")
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			t.Errorf("Accept() error = %v", err)
			return
		}
		defer connection.CloseNow()
		if err := wsjson.Write(request.Context(), connection, map[string]any{"type": "pong"}); err != nil {
			t.Errorf("Write() error = %v", err)
		}
		<-request.Context().Done()
	}))
	t.Cleanup(server.Close)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	messages := make(chan Message, 1)
	client, err := NewWSClient(WSConfig{
		URL:          "ws" + strings.TrimPrefix(server.URL, "http"),
		ClientSecret: "desktop-secret",
		OnMessage: func(message Message) {
			messages <- message
		},
		ReconnectInitial: time.Millisecond,
		ReconnectMaximum: time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewWSClient() error = %v", err)
	}
	if err := client.Start(ctx); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	t.Cleanup(func() { _ = client.Stop(context.Background()) })

	select {
	case got := <-receivedHeader:
		if got != "desktop-secret" {
			t.Errorf("X-Client-Secret = %q, want desktop-secret", got)
		}
	case <-time.After(time.Second):
		t.Fatal("websocket server did not receive dial request")
	}
	select {
	case message := <-messages:
		if got, want := message.Type, "pong"; got != want {
			t.Errorf("message type = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("client did not deliver backend message")
	}
}

func TestWSClientDoesNotReconnectAfterStop(t *testing.T) {
	var mu sync.Mutex
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		mu.Lock()
		attempts++
		mu.Unlock()
		connection, err := websocket.Accept(writer, request, nil)
		if err != nil {
			return
		}
		_ = connection.Close(websocket.StatusGoingAway, "test disconnect")
	}))
	t.Cleanup(server.Close)

	client, err := NewWSClient(WSConfig{
		URL:              "ws" + strings.TrimPrefix(server.URL, "http"),
		ClientSecret:     "desktop-secret",
		ReconnectInitial: 5 * time.Millisecond,
		ReconnectMaximum: 5 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewWSClient() error = %v", err)
	}
	if err := client.Start(context.Background()); err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	time.Sleep(25 * time.Millisecond)
	if err := client.Stop(context.Background()); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	mu.Lock()
	stoppedAt := attempts
	mu.Unlock()
	time.Sleep(25 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if attempts != stoppedAt {
		t.Errorf("dial attempts after Stop() = %d, want %d", attempts, stoppedAt)
	}
}
