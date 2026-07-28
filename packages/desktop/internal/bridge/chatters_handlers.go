package bridge

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
)

type ChattersProvider interface {
	Chatters(context.Context, string) (contracts.ChannelChatters, error)
}

func RegisterChattersHandlers(
	registry *HandlerRegistry,
	providers map[contracts.Platform]ChattersProvider,
) {
	registry.Register(contracts.RequestGetChatters, func(ctx context.Context, params any) (any, error) {
		var input contracts.ChattersParams
		if err := decodeChattersParams(params, &input); err != nil {
			return nil, err
		}
		if len(input.Targets) == 0 {
			return nil, fmt.Errorf("get chatters: targets are required")
		}

		response := contracts.ChattersResponse{Results: make([]contracts.ChannelChatters, 0, len(input.Targets))}
		for _, target := range input.Targets {
			result := contracts.ChannelChatters{
				Platform:    target.Platform,
				ChannelSlug: target.ChannelSlug,
				Groups:      []contracts.ChatterGroup{},
			}
			switch target.Platform {
			case contracts.PlatformTwitch, contracts.PlatformKick:
				provider, ok := providers[target.Platform]
				if !ok || provider == nil {
					result.Error = fmt.Sprintf("get chatters: platform %q provider is unavailable", target.Platform)
					break
				}
				chatters, err := provider.Chatters(ctx, target.ChannelSlug)
				if err != nil {
					result.Error = err.Error()
					break
				}
				result.Total = chatters.Total
				result.Groups = chatters.Groups
			default:
				result.Error = fmt.Sprintf("get chatters: platform %q is not supported", target.Platform)
			}
			response.Results = append(response.Results, result)
		}
		return response, nil
	})
}

func decodeChattersParams(value any, target *contracts.ChattersParams) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("get chatters: encode params: %w", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		return fmt.Errorf("get chatters: params must be an object: %w", err)
	}
	if object == nil {
		return fmt.Errorf("get chatters: params must be an object")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("get chatters: decode params: %w", err)
	}
	return nil
}
