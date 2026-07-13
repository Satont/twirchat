package bridge

import (
	"context"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

// AvatarResolver is the narrow boundary the request bridge needs from the
// process-local avatar cache.
type AvatarResolver interface {
	Resolve(context.Context, contracts.ResolveAvatarParams) (contracts.AvatarResolution, error)
}

// RegisterAvatarHandlers exposes background avatar resolution to the shared
// Vue cache. The request contains author metadata only.
func RegisterAvatarHandlers(registry *HandlerRegistry, resolver AvatarResolver) {
	registry.Register(contracts.RequestResolveAvatar, func(ctx context.Context, params any) (any, error) {
		var input contracts.ResolveAvatarParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return resolver.Resolve(ctx, input)
	})
}
