package bridge

import (
	"context"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

type recordingAuthenticator struct{ platform contracts.Platform }

func (a *recordingAuthenticator) Begin(_ context.Context, platform contracts.Platform) error {
	a.platform = platform
	return nil
}

type recordingAccountRemover struct{ platform contracts.Platform }

func (s *recordingAccountRemover) DeleteAccountsByPlatform(_ context.Context, platform contracts.Platform) error {
	s.platform = platform
	return nil
}

func TestRegisterAuthHandlersDispatchesStartAndLogout(t *testing.T) {
	registry := NewHandlerRegistry()
	authenticator := &recordingAuthenticator{}
	accounts := &recordingAccountRemover{}
	RegisterAuthHandlers(registry, authenticator, accounts)
	service := NewDesktopService(registry)

	if _, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestAuthStart,
		Params: map[string]any{"platform": "twitch"},
	}); err != nil {
		t.Fatalf("authStart error = %v", err)
	}
	if got, want := authenticator.platform, contracts.PlatformTwitch; got != want {
		t.Errorf("auth start platform = %q, want %q", got, want)
	}
	if _, err := service.Call(contracts.GatewayRequest{
		Method: contracts.RequestAuthLogout,
		Params: map[string]any{"platform": "kick"},
	}); err != nil {
		t.Fatalf("authLogout error = %v", err)
	}
	if got, want := accounts.platform, contracts.PlatformKick; got != want {
		t.Errorf("logout platform = %q, want %q", got, want)
	}
}
