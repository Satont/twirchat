package twitch

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

func TestBackendBadgeResolverAddsRegistryImageURLsAndCachesByChannel(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		if got, want := request.URL.Path, "/api/twitch/badges"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		if got, want := request.URL.Query().Get("broadcasterLogin"), "streamer"; got != want {
			t.Errorf("broadcasterLogin = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"badges":{"broadcaster/1":"https://cdn.test/broadcaster.png","bits-charity/1":"https://cdn.test/bits.png"}}`))
	}))
	t.Cleanup(server.Close)
	client, err := backend.NewHTTPClient(server.URL, "client-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	resolver := NewBackendBadgeResolver(client)
	badges := []contracts.Badge{{ID: "broadcaster/1", Type: "broadcaster", Text: "broadcaster"}, {ID: "bits-charity/1", Type: "bits-charity", Text: "bits-charity"}}

	resolved, err := resolver.Resolve(context.Background(), "streamer", badges)
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if got, want := resolved[0].ImageURL, "https://cdn.test/broadcaster.png"; got != want {
		t.Errorf("broadcaster image URL = %q, want %q", got, want)
	}
	if got, want := resolved[1].ImageURL, "https://cdn.test/bits.png"; got != want {
		t.Errorf("bits image URL = %q, want %q", got, want)
	}
	if _, err := resolver.Resolve(context.Background(), "streamer", badges); err != nil {
		t.Fatalf("cached Resolve() error = %v", err)
	}
	if got, want := calls, 1; got != want {
		t.Errorf("backend calls = %d, want %d", got, want)
	}
}
