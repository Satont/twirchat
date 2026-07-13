package bridge

import (
	"context"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/update"
)

type Updater interface {
	Check() (update.CheckResult, error)
	Download(func(uint)) error
	Apply() error
}

func RegisterUpdateHandlers(registry *HandlerRegistry, updater Updater, events *EventPublisher) {
	registry.Register(contracts.RequestCheckForUpdate, func(context.Context, any) (any, error) { return updater.Check() })
	registry.Register(contracts.RequestDownloadUpdate, func(context.Context, any) (any, error) {
		err := updater.Download(func(value uint) { events.EmitUpdateStatus("downloading", "Downloading update", &value) })
		if err != nil {
			return map[string]any{"success": false, "error": err.Error()}, nil
		}
		events.EmitUpdateStatus("download-complete", "Update downloaded", nil)
		return map[string]any{"success": true}, nil
	})
	registry.Register(contracts.RequestApplyUpdate, func(context.Context, any) (any, error) {
		events.EmitUpdateStatus("applying", "Restarting to apply update", nil)
		return nil, updater.Apply()
	})
	registry.Register(contracts.RequestSkipUpdate, func(context.Context, any) (any, error) { return nil, nil })
}
