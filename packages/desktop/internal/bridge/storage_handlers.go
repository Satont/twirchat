package bridge

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

var defaultSettings = json.RawMessage(`{
  "theme":"dark","chatTheme":"modern","fontFamily":"inter","fontSize":14,
  "showPlatformColorStripe":true,"showPlatformIcon":true,"showTimestamp":true,
  "showAvatars":true,"showBadges":true,"platformFilter":"all","autoCheckUpdates":false,
  "hotkeys":{"newTab":"ctrl+t","nextTab":"ctrl+tab","prevTab":"alt+arrowleft","tabSelector":"ctrl+l"},
  "overlay":{"background":"transparent","textColor":"#ffffff","fontSize":14,"fontFamily":"inter","maxMessages":20,"messageTimeout":0,"showPlatformIcon":true,"showAvatar":true,"showBadges":true,"animation":"slide","position":"bottom","port":45823},
  "chatLayout":{"version":1,"mode":"combined","splits":[{"id":"default","type":"combined","size":100}]},
  "selfPing":{"enabled":true,"color":"rgba(167, 139, 250, 0.15)"}
}`)

// RegisterStorageHandlers makes fresh-profile bootstrap and persistence calls
// available to Vue before chat-platform services are ported.
func RegisterStorageHandlers(registry *HandlerRegistry, store *storage.Storage) {
	registry.Register(contracts.RequestGetAccounts, func(ctx context.Context, _ any) (any, error) {
		return store.ListAccounts(ctx)
	})
	registry.Register(contracts.RequestGetSettings, func(ctx context.Context, _ any) (any, error) {
		data, found, err := store.LoadSettings(ctx)
		if err != nil {
			return nil, err
		}
		if !found {
			data = defaultSettings
		}
		return jsonObject(data)
	})
	registry.Register(contracts.RequestSaveSettings, func(ctx context.Context, params any) (any, error) {
		data, err := json.Marshal(params)
		if err != nil {
			return nil, fmt.Errorf("save settings: encode request: %w", err)
		}
		return nil, store.SaveSettings(ctx, data)
	})
	registry.Register(contracts.RequestGetUserAliases, func(ctx context.Context, _ any) (any, error) {
		return store.ListAliases(ctx)
	})
	registry.Register(contracts.RequestSetUserAlias, func(ctx context.Context, params any) (any, error) {
		var input contracts.UserAlias
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if input.Alias == "" {
			return nil, store.RemoveAlias(ctx, input.Platform, input.PlatformUserID)
		}
		return nil, store.UpsertAlias(ctx, input)
	})
	registry.Register(contracts.RequestRemoveUserAlias, func(ctx context.Context, params any) (any, error) {
		var input contracts.UserAliasIDParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, store.RemoveAlias(ctx, input.Platform, input.PlatformUserID)
	})
	registry.Register(contracts.RequestGetChannels, func(ctx context.Context, _ any) (any, error) {
		return store.AllChannels(ctx)
	})
	registry.Register(contracts.RequestGetRecentMessages, func(ctx context.Context, params any) (any, error) {
		var input contracts.RecentMessagesParams
		if params != nil {
			if err := decodeParams(params, &input); err != nil {
				return nil, err
			}
		}
		limit := 0
		if input.Limit != nil {
			limit = *input.Limit
		}
		return store.RecentMessages(ctx, limit)
	})
	registry.Register(contracts.RequestGetUserChatHistory, func(ctx context.Context, params any) (any, error) {
		var input contracts.GetUserChatHistoryParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return store.UserChatHistory(ctx, input.Platform, input.PlatformUserID, input.Limit, input.Cursor)
	})
	registry.Register(contracts.RequestGetWatchedChannels, func(ctx context.Context, _ any) (any, error) {
		return store.ListWatchedChannels(ctx)
	})
	registry.Register(contracts.RequestAddWatchedChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.AddWatchedChannelParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return store.UpsertWatchedChannel(ctx, input.Platform, input.ChannelSlug, input.ChannelSlug)
	})
	registry.Register(contracts.RequestRemoveWatchedChannel, func(ctx context.Context, params any) (any, error) {
		var input contracts.WatchedChannelIDParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		if err := store.DeleteWatchedChannel(ctx, input.ID); err != nil {
			return nil, err
		}
		return nil, store.DeleteWatchedLayout(ctx, input.ID)
	})
	registry.Register(contracts.RequestGetWatchedChannelsLayout, func(ctx context.Context, params any) (any, error) {
		var input contracts.WatchedChannelsLayoutParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		layout, found, err := store.LoadWatchedLayout(ctx, input.TabID)
		if err != nil || !found {
			return nil, err
		}
		return layout, nil
	})
	registry.Register(contracts.RequestSetWatchedChannelsLayout, func(ctx context.Context, params any) (any, error) {
		var input contracts.SetWatchedChannelsLayoutParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		return nil, store.SaveWatchedLayout(ctx, input.TabID, input.Layout)
	})
	registry.Register(contracts.RequestGetTabChannelIDs, func(ctx context.Context, _ any) (any, error) {
		data, found, err := store.LoadJSONSetting(ctx, "tab_channel_ids")
		if err != nil || !found {
			return nil, err
		}
		var ids []string
		if err := json.Unmarshal(data, &ids); err != nil {
			return nil, fmt.Errorf("decode tab channel IDs: %w", err)
		}
		return ids, nil
	})
	registry.Register(contracts.RequestSetTabChannelIDs, func(ctx context.Context, params any) (any, error) {
		var input contracts.TabChannelIDsParams
		if err := decodeParams(params, &input); err != nil {
			return nil, err
		}
		data, err := json.Marshal(input.IDs)
		if err != nil {
			return nil, fmt.Errorf("encode tab channel IDs: %w", err)
		}
		return nil, store.SaveJSONSetting(ctx, "tab_channel_ids", data)
	})

	// These queries are meaningful on a fresh profile before adapters/watched
	// managers start. Returning empty snapshots avoids retry loops in the Vue shell.
	registry.Register(contracts.RequestGetStatuses, func(context.Context, any) (any, error) {
		return []contracts.PlatformStatusInfo{}, nil
	})
	registry.Register(contracts.RequestGetWatchedChannelStatuses, func(context.Context, any) (any, error) {
		return []contracts.WatchedChannelStatus{}, nil
	})
	registry.Register(contracts.RequestGetWatchedChannelMessages, func(context.Context, any) (any, error) {
		return []contracts.NormalizedChatMessage{}, nil
	})
	// A channel without a loaded 7TV set has no extra emotes. The dedicated 7TV
	// service replaces this snapshot handler when it is started; returning the
	// real empty state keeps the Vue emote store from retrying a missing RPC.
	registry.Register(contracts.RequestGetChannelEmotes, func(context.Context, any) (any, error) {
		return []contracts.SevenTVEmote{}, nil
	})
}

func decodeParams(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("decode desktop request parameters: encode input: %w", err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return fmt.Errorf("decode desktop request parameters: %w", err)
	}
	return nil
}

func jsonObject(data json.RawMessage) (map[string]any, error) {
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, fmt.Errorf("decode stored settings: %w", err)
	}
	return value, nil
}
