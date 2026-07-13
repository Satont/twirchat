package bridge

import (
	"context"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// Authenticator starts a platform OAuth flow.
type Authenticator interface {
	Begin(context.Context, contracts.Platform) error
}

// AccountRemover clears local credentials after the user logs out.
type AccountRemover interface {
	DeleteAccountsByPlatform(context.Context, contracts.Platform) error
}

// RegisterAuthHandlers connects the historical Vue auth requests to the Go OAuth service.
func RegisterAuthHandlers(
	registry *HandlerRegistry,
	authenticator Authenticator,
	accounts AccountRemover,
) {
	registry.Register(contracts.RequestAuthStart, func(ctx context.Context, params any) (any, error) {
		var input contracts.PlatformParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, authenticator.Begin(ctx, input.Platform)
	})
	registry.Register(contracts.RequestAuthLogout, func(ctx context.Context, params any) (any, error) {
		var input contracts.PlatformParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, accounts.DeleteAccountsByPlatform(ctx, input.Platform)
	})
}
