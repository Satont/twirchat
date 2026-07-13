package avatar

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

func TestResolverDeduplicatesConcurrentTwitchRequests(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		if request.URL.Path != "/api/twitch/user" {
			http.NotFound(writer, request)
			return
		}
		close(started)
		<-release
		_, _ = writer.Write([]byte(`{"user":{"profile_image_url":"https://cdn.test/viewer.png"}}`))
	}))
	t.Cleanup(server.Close)
	resolver := newTestResolver(t, server)

	input := contracts.ResolveAvatarParams{Platform: contracts.PlatformTwitch, AuthorID: "7", Username: "viewer"}
	results := make(chan contracts.AvatarResolution, 2)
	errors := make(chan error, 2)
	var group sync.WaitGroup
	for range 2 {
		group.Go(func() {
			value, err := resolver.Resolve(context.Background(), input)
			results <- value
			errors <- err
		})
	}
	<-started
	close(release)
	group.Wait()

	for range 2 {
		if err := <-errors; err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		if got, want := (<-results).AvatarURL, "https://cdn.test/viewer.png"; got != want {
			t.Errorf("AvatarURL = %q, want %q", got, want)
		}
	}
	if got, want := calls.Load(), int32(1); got != want {
		t.Errorf("backend calls = %d, want %d", got, want)
	}
}

func TestResolverUsesNegativeCacheForEmptyAvatar(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls.Add(1)
		_, _ = writer.Write([]byte(`{"user":null}`))
	}))
	t.Cleanup(server.Close)
	resolver := newTestResolver(t, server)
	input := contracts.ResolveAvatarParams{Platform: contracts.PlatformTwitch, AuthorID: "7", Username: "viewer"}

	for range 2 {
		result, err := resolver.Resolve(context.Background(), input)
		if err != nil {
			t.Fatalf("Resolve() error = %v", err)
		}
		if result.AvatarURL != "" {
			t.Fatalf("AvatarURL = %q, want empty", result.AvatarURL)
		}
	}
	if got, want := calls.Load(), int32(1); got != want {
		t.Errorf("backend calls = %d, want %d", got, want)
	}
}

func TestResolverReadsKickAvatarFromBackend(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.URL.Path, "/api/kick/chatroom"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		if got, want := request.URL.Query().Get("slug"), "viewer"; got != want {
			t.Errorf("slug = %q, want %q", got, want)
		}
		_, _ = writer.Write([]byte(`{"avatarUrl":"https://cdn.test/kick-viewer.png"}`))
	}))
	t.Cleanup(server.Close)
	resolver := newTestResolver(t, server)

	result, err := resolver.Resolve(context.Background(), contracts.ResolveAvatarParams{
		Platform: contracts.PlatformKick, AuthorID: "9", Username: "viewer",
	})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if got, want := result.AvatarURL, "https://cdn.test/kick-viewer.png"; got != want {
		t.Errorf("AvatarURL = %q, want %q", got, want)
	}
}

func TestResolverRejectsIncompleteOrUnsupportedInput(t *testing.T) {
	resolver := &Resolver{}
	for _, input := range []contracts.ResolveAvatarParams{
		{Platform: contracts.PlatformTwitch},
		{Platform: contracts.PlatformYouTube, AuthorID: "7"},
	} {
		if _, err := resolver.Resolve(context.Background(), input); err == nil {
			t.Errorf("Resolve(%#v) error = nil, want error", input)
		}
	}
}

func newTestResolver(t *testing.T, server *httptest.Server) *Resolver {
	t.Helper()
	client, err := backend.NewHTTPClient(server.URL, "desktop-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	resolver, err := NewResolver(Config{
		Backend:     client,
		MaxEntries:  16,
		NegativeTTL: time.Minute,
		PositiveTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewResolver() error = %v", err)
	}
	return resolver
}
