package kick

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type chattersFixture struct {
	service *Service
	backend *httptest.Server
	active  *httptest.Server
}

func newChattersFixture(t *testing.T, backendHandler, activeHandler http.HandlerFunc) *chattersFixture {
	t.Helper()
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("kick-chatters-test"))
	if err != nil {
		t.Fatalf("storage.Open() error = %v", err)
	}
	backendServer := httptest.NewServer(backendHandler)
	activeServer := httptest.NewServer(activeHandler)
	backendClient, err := backend.NewHTTPClient(backendServer.URL, "secret", backendServer.Client())
	if err != nil {
		t.Fatalf("backend.NewHTTPClient() error = %v", err)
	}
	service, err := NewService(Config{
		Storage:           store,
		Events:            &recordingEvents{},
		Backend:           backendClient,
		ActiveChattersURL: activeServer.URL,
	})
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	service.client = activeServer.Client()
	t.Cleanup(func() {
		_ = service.Stop(context.Background())
		_ = store.Close()
		activeServer.Close()
		backendServer.Close()
	})
	return &chattersFixture{service: service, backend: backendServer, active: activeServer}
}

func notFoundChattersHandler(writer http.ResponseWriter, request *http.Request) {
	http.NotFound(writer, request)
}

func cacheChannel(service *Service, slug string, broadcasterID, chatroomID int64) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.channels[slug] = broadcasterID
	service.chatrooms[slug] = chatroomID
}

func writeChattersResponse(writer http.ResponseWriter, body string) {
	writer.Header().Set("Content-Type", "application/json")
	_, _ = writer.Write([]byte(body))
}

func TestChattersCacheHitSkipsBackendResolution(t *testing.T) {
	var backendRequests atomic.Int32
	fixture := newChattersFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		backendRequests.Add(1)
		http.Error(writer, "unexpected backend request", http.StatusInternalServerError)
	}, func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/555/chat/active-chatters" {
			t.Errorf("active chatters path = %q", request.URL.Path)
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept = %q", request.Header.Get("Accept"))
		}
		if request.Header.Get("Origin") != "https://kick.com" {
			t.Errorf("Origin = %q", request.Header.Get("Origin"))
		}
		if request.Header.Get("Referer") != "https://kick.com/channel" {
			t.Errorf("Referer = %q", request.Header.Get("Referer"))
		}
		writeChattersResponse(writer, `{"data":{"bots":[],"chatters":[],"moderators":[],"ogs":[],"vips":[]}}`)
	})
	cacheChannel(fixture.service, "channel", 555, 777)

	result, err := fixture.service.Chatters(context.Background(), " #Channel ")
	if err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	if backendRequests.Load() != 0 {
		t.Fatalf("backend requests = %d, want 0", backendRequests.Load())
	}
	if result.ChannelSlug != "channel" || result.Total != 0 {
		t.Fatalf("result = %#v", result)
	}
}

func TestChattersCacheMissResolvesAndCachesChannel(t *testing.T) {
	var backendRequests atomic.Int32
	fixture := newChattersFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		backendRequests.Add(1)
		if request.URL.Query().Get("slug") != "channel" {
			t.Errorf("slug query = %q", request.URL.Query().Get("slug"))
		}
		writeChattersResponse(writer, `{"chatroomId":777,"broadcasterUserId":555}`)
	}, func(writer http.ResponseWriter, request *http.Request) {
		writeChattersResponse(writer, `{"data":{"bots":[],"chatters":[],"moderators":[],"ogs":[],"vips":[]}}`)
	})

	for range 2 {
		if _, err := fixture.service.Chatters(context.Background(), "CHANNEL"); err != nil {
			t.Fatalf("Chatters() error = %v", err)
		}
	}
	if backendRequests.Load() != 1 {
		t.Fatalf("backend requests = %d, want 1", backendRequests.Load())
	}
	fixture.service.mu.Lock()
	defer fixture.service.mu.Unlock()
	if fixture.service.channels["channel"] != 555 || fixture.service.chatrooms["channel"] != 777 {
		t.Fatalf("cached IDs = channels %#v, chatrooms %#v", fixture.service.channels, fixture.service.chatrooms)
	}
}

func TestChattersMapsNativeGroupsInPriorityOrderAndDeduplicates(t *testing.T) {
	fixture := newChattersFixture(t, notFoundChattersHandler, func(writer http.ResponseWriter, request *http.Request) {
		writeChattersResponse(writer, `{"data":{
			"moderators":[{"profile_picture":"https://avatar/mod","slug":"Alpha","username":"Alpha Display"}],
			"vips":[{"slug":"vip","username":"Vip Display"}],
			"ogs":[{"username":"OldGuy"}],
			"bots":[{"slug":"alpha","username":"Duplicate"}],
			"chatters":[{"slug":"alpha","username":"Duplicate Again"},{"username":"Chatter"}]
		}}`)
	})
	cacheChannel(fixture.service, "channel", 555, 777)

	result, err := fixture.service.Chatters(context.Background(), "channel")
	if err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	want := contracts.WatchedChannelChatters{
		Platform:    contracts.PlatformKick,
		ChannelSlug: "channel",
		Total:       4,
		Groups: []contracts.ChatterGroup{
			{Role: contracts.ChatterRoleModerators, Users: []contracts.ChatterUser{{Username: "Alpha", DisplayName: "Alpha Display", AvatarURL: "https://avatar/mod"}}},
			{Role: contracts.ChatterRoleVips, Users: []contracts.ChatterUser{{Username: "vip", DisplayName: "Vip Display"}}},
			{Role: contracts.ChatterRoleOgs, Users: []contracts.ChatterUser{{Username: "OldGuy", DisplayName: "OldGuy"}}},
			{Role: contracts.ChatterRoleBots, Users: []contracts.ChatterUser{}},
			{Role: contracts.ChatterRoleChatters, Users: []contracts.ChatterUser{{Username: "Chatter", DisplayName: "Chatter"}}},
		},
	}
	if !reflect.DeepEqual(result, want) {
		t.Fatalf("result = %#v, want %#v", result, want)
	}
}

func TestChattersAcceptsLegitimatelyEmptyResult(t *testing.T) {
	fixture := newChattersFixture(t, notFoundChattersHandler, func(writer http.ResponseWriter, request *http.Request) {
		writeChattersResponse(writer, `{"data":{"bots":[],"chatters":[],"moderators":[],"ogs":[],"vips":[]},"message":"success"}`)
	})
	cacheChannel(fixture.service, "channel", 555, 777)

	result, err := fixture.service.Chatters(context.Background(), "channel")
	if err != nil {
		t.Fatalf("Chatters() error = %v", err)
	}
	if result.Total != 0 || len(result.Groups) != 5 {
		t.Fatalf("result = %#v", result)
	}
}

func TestChattersDoesNotCacheResolutionFailures(t *testing.T) {
	var backendRequests atomic.Int32
	fixture := newChattersFixture(t, func(writer http.ResponseWriter, request *http.Request) {
		if backendRequests.Add(1) == 1 {
			http.Error(writer, "temporary failure", http.StatusBadGateway)
			return
		}
		writeChattersResponse(writer, `{"chatroomId":777,"broadcasterUserId":555}`)
	}, func(writer http.ResponseWriter, request *http.Request) {
		writeChattersResponse(writer, `{"data":{"bots":[],"chatters":[],"moderators":[],"ogs":[],"vips":[]}}`)
	})

	if _, err := fixture.service.Chatters(context.Background(), "channel"); err == nil {
		t.Fatal("first Chatters() unexpectedly succeeded")
	}
	if _, err := fixture.service.Chatters(context.Background(), "channel"); err != nil {
		t.Fatalf("second Chatters() error = %v", err)
	}
	if backendRequests.Load() != 2 {
		t.Fatalf("backend requests = %d, want 2", backendRequests.Load())
	}
}

func TestChattersRejectsHTTPFailuresMalformedJSONAndHTMLChallenge(t *testing.T) {
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "forbidden", status: http.StatusForbidden, body: `{"message":"forbidden"}`},
		{name: "server error", status: http.StatusInternalServerError, body: `{"message":"failed"}`},
		{name: "malformed JSON", status: http.StatusOK, body: `{"data":`},
		{name: "HTML challenge", status: http.StatusOK, body: `<html><title>Just a moment...</title></html>`},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newChattersFixture(t, notFoundChattersHandler, func(writer http.ResponseWriter, request *http.Request) {
				writer.WriteHeader(testCase.status)
				_, _ = writer.Write([]byte(testCase.body))
			})
			cacheChannel(fixture.service, "channel", 555, 777)

			_, err := fixture.service.Chatters(context.Background(), "channel")
			if err == nil || !strings.Contains(err.Error(), "Kick chatters are currently unavailable.") {
				t.Fatalf("Chatters() error = %v", err)
			}
		})
	}
}

func TestChattersRejectsTimeoutAndOversizedResponses(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		fixture := newChattersFixture(t, notFoundChattersHandler, func(writer http.ResponseWriter, request *http.Request) {
			<-request.Context().Done()
		})
		cacheChannel(fixture.service, "channel", 555, 777)
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		defer cancel()

		_, err := fixture.service.Chatters(ctx, "channel")
		if err == nil || !strings.Contains(err.Error(), "Kick chatters are currently unavailable.") {
			t.Fatalf("Chatters() error = %v", err)
		}
	})

	t.Run("response size limit", func(t *testing.T) {
		fixture := newChattersFixture(t, notFoundChattersHandler, func(writer http.ResponseWriter, request *http.Request) {
			_, _ = writer.Write([]byte(strings.Repeat("x", 4<<20+1)))
		})
		cacheChannel(fixture.service, "channel", 555, 777)

		_, err := fixture.service.Chatters(context.Background(), "channel")
		if err == nil || !strings.Contains(err.Error(), "Kick chatters are currently unavailable.") {
			t.Fatalf("Chatters() error = %v", err)
		}
	})
}
