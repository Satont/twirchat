package bridge

import (
	"context"
	"testing"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

type recordingAvatarResolver struct {
	input contracts.ResolveAvatarParams
}

func (r *recordingAvatarResolver) Resolve(
	_ context.Context,
	input contracts.ResolveAvatarParams,
) (contracts.AvatarResolution, error) {
	r.input = input
	return contracts.AvatarResolution{AvatarURL: "https://cdn.test/viewer.png"}, nil
}

func TestRegisterAvatarHandlersResolvesPublicAuthorData(t *testing.T) {
	registry := NewHandlerRegistry()
	resolver := &recordingAvatarResolver{}
	RegisterAvatarHandlers(registry, resolver)

	result, err := NewDesktopService(registry).Call(contracts.GatewayRequest{
		Method: contracts.RequestResolveAvatar,
		Params: map[string]any{
			"platform": "twitch", "authorId": "7", "username": "viewer",
		},
	})
	if err != nil {
		t.Fatalf("resolveAvatar error = %v", err)
	}
	if got, want := result.(contracts.AvatarResolution).AvatarURL, "https://cdn.test/viewer.png"; got != want {
		t.Errorf("AvatarURL = %q, want %q", got, want)
	}
	if got, want := resolver.input.AuthorID, "7"; got != want {
		t.Errorf("resolver author ID = %q, want %q", got, want)
	}
}
