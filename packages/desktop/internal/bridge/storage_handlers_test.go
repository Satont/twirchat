package bridge

import (
	"context"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

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
}
