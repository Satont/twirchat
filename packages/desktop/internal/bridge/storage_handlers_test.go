package bridge

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

type recordingWatchedRuntime struct {
	added    []contracts.AddWatchedChannelParams
	statuses []contracts.WatchedChannelStatus
}

func TestGetSettingsBackfillsNewChatAppearanceDefaults(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("bridge-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.SaveSettings(context.Background(), json.RawMessage(`{"theme":"light"}`)); err != nil {
		t.Fatalf("SaveSettings() error = %v", err)
	}

	registry := NewHandlerRegistry()
	RegisterStorageHandlers(registry, store)
	settings, err := NewDesktopService(registry).Call(contracts.GatewayRequest{Method: contracts.RequestGetSettings})
	if err != nil {
		t.Fatalf("getSettings error = %v", err)
	}
	got := settings.(map[string]any)
	if got["showChannelLabel"] != true || got["emoteSessionCache"] != true {
		t.Errorf("getSettings = %#v, want new appearance defaults", got)
	}
	if got["autoCheckUpdates"] != true {
		t.Errorf("getSettings autoCheckUpdates = %#v, want true (startup update checks enabled by default)", got["autoCheckUpdates"])
	}
}

func (r *recordingWatchedRuntime) Add(
	_ context.Context,
	platform contracts.Platform,
	channelSlug string,
) (contracts.WatchedChannel, error) {
	r.added = append(r.added, contracts.AddWatchedChannelParams{Platform: platform, ChannelSlug: channelSlug})
	return contracts.WatchedChannel{ID: "watched-1", Platform: platform, ChannelSlug: channelSlug}, nil
}

func (*recordingWatchedRuntime) Remove(context.Context, string) error { return nil }
func (*recordingWatchedRuntime) Send(context.Context, string, string, string) error {
	return nil
}
func (*recordingWatchedRuntime) Messages(context.Context, string) ([]contracts.NormalizedChatMessage, error) {
	return nil, nil
}
func (r *recordingWatchedRuntime) Statuses() []contracts.WatchedChannelStatus {
	return r.statuses
}

func TestRegisterWatchedChannelHandlersStartsRuntimeForAddedChannel(t *testing.T) {
	registry := NewHandlerRegistry()
	runtime := &recordingWatchedRuntime{}
	RegisterWatchedChannelHandlers(registry, runtime)
	service := NewDesktopService(registry)

	result, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestAddWatchedChannel,
		Params: map[string]any{"platform": "twitch", "channelSlug": "stray228"},
	})
	if err != nil {
		t.Fatalf("addWatchedChannel error = %v", err)
	}
	if got, want := runtime.added, []contracts.AddWatchedChannelParams{{Platform: contracts.PlatformTwitch, ChannelSlug: "stray228"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("runtime added = %#v, want %#v", got, want)
	}
	if channel := result.(contracts.WatchedChannel); channel.ID != "watched-1" {
		t.Fatalf("addWatchedChannel result = %#v", channel)
	}
}

func TestRegisterStorageHandlersServesVueBootstrapRequests(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("bridge-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	registry := NewHandlerRegistry()
	RegisterStorageHandlers(registry, store)
	service := NewDesktopService(registry)

	accounts, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetAccounts})
	if err != nil {
		t.Fatalf("getAccounts error = %v", err)
	}
	if got := accounts.([]contracts.Account); len(got) != 0 {
		t.Errorf("getAccounts = %#v, want empty account list", got)
	}
	catalog, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetChannelEmotes})
	if err != nil {
		t.Fatalf("getChannelEmotes error = %v", err)
	}
	if got := catalog.([]contracts.EmoteCatalogEntry); len(got) != 0 {
		t.Errorf("getChannelEmotes = %#v, want empty catalog", got)
	}
	settings, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetSettings})
	if err != nil {
		t.Fatalf("getSettings error = %v", err)
	}
	settingsObject, ok := settings.(map[string]any)
	if !ok || settingsObject["theme"] != "dark" {
		t.Errorf("getSettings = %#v, want default dark settings", settings)
	}
	channels, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetChannels})
	if err != nil {
		t.Fatalf("getChannels error = %v", err)
	}
	if got := channels.(map[contracts.Platform][]string); len(got) != 0 {
		t.Errorf("getChannels = %#v, want no saved channels", got)
	}
	watched, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetWatchedChannels})
	if err != nil {
		t.Fatalf("getWatchedChannels error = %v", err)
	}
	if got := watched.([]contracts.WatchedChannel); len(got) != 0 {
		t.Errorf("getWatchedChannels = %#v, want no watched channels", got)
	}
	if _, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestSetTabChannelIDs,
		Params: map[string]any{"ids": []string{"watched-1", "watched-2"}},
	}); err != nil {
		t.Fatalf("setTabChannelIds error = %v", err)
	}
	tabIDs, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetTabChannelIDs})
	if err != nil {
		t.Fatalf("getTabChannelIds error = %v", err)
	}
	if got, want := tabIDs.([]string), []string{"watched-1", "watched-2"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("getTabChannelIds = %#v, want %#v", got, want)
	}
	color, err := service.Call(contracts.GatewayRequest{Method: contracts.RequestGetUsernameColor, Params: map[string]any{"platform": "twitch", "username": "unknown"}})
	if err != nil {
		t.Fatalf("getUsernameColor error = %v", err)
	}
	if color != nil {
		t.Errorf("getUsernameColor = %#v, want nil", color)
	}
}

func TestGetWatchedChannelsLayoutCreatesDefaultLayoutForNewTab(t *testing.T) {
	store, err := storage.Open(context.Background(), t.TempDir(), storage.WithMachineID("bridge-test"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	registry := NewHandlerRegistry()
	RegisterStorageHandlers(registry, store)
	service := NewDesktopService(registry)

	created, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestAddWatchedChannel,
		Params: map[string]any{"platform": "twitch", "channelSlug": "stray228"},
	})
	if err != nil {
		t.Fatalf("addWatchedChannel error = %v", err)
	}
	channel := created.(contracts.WatchedChannel)

	value, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestGetWatchedChannelsLayout,
		Params: map[string]any{"tabId": channel.ID},
	})
	if err != nil {
		t.Fatalf("getWatchedChannelsLayout error = %v", err)
	}
	layout, ok := value.(contracts.WatchedChannelsLayout)
	if !ok {
		t.Fatalf("getWatchedChannelsLayout = %#v, want a default layout", value)
	}
	if layout.Version != 2 || layout.Root.Type != "panel" || layout.Root.Content == nil ||
		layout.Root.Content.Type != "watched" || layout.Root.Content.ChannelID != channel.ID {
		t.Errorf("default watched layout = %#v, want a panel for %q", layout, channel.ID)
	}
}
