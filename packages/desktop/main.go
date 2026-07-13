package main

import (
	"context"
	"embed"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"

	"github.com/Satont/twirchat/packages/desktop/internal/app"
	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/bridge"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	kickchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/kick"
	twitchchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/twitch"
	"github.com/Satont/twirchat/packages/desktop/internal/update"
	"github.com/Satont/twirchat/packages/desktop/internal/watched"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist/main
var assets embed.FS

var version = "dev"

func main() {
	if buildBackendURL == "" {
		if err := loadDotEnv(); err != nil {
			log.Fatal(err)
		}
	}
	update.RunProductionStartup(version)
	version = update.Version(version)
	rootContext, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	profileDir, err := profileDirectory()
	if err != nil {
		log.Fatal(err)
	}
	requestHandlers := bridge.NewHandlerRegistry()
	config := loadRuntimeConfig()
	feed := updateFeedURL()
	updaterManager, updatesEnabled, err := update.ManagerForVersion(version, feed, update.NewVelopackManager)
	if err != nil {
		log.Fatal(err)
	}
	updater := update.NewService(version, updaterManager)

	host, err := app.New(app.Config{
		Assets:     assets,
		Context:    rootContext,
		Name:       "TwirChat",
		ProfileDir: profileDir,
		WailsServices: []application.Service{
			application.NewService(bridge.NewDesktopService(requestHandlers, updatesEnabled)),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	events := bridge.NewEventPublisher(bridge.WailsEventEmitter{})
	watchedManager, err := watched.NewManager(watched.Config{Storage: host.Storage(), Events: events})
	if err != nil {
		log.Fatal(err)
	}
	bridge.RegisterStorageHandlers(requestHandlers, host.Storage())
	bridge.RegisterUpdateHandlers(requestHandlers, updater, events)
	backendClient, err := backend.NewHTTPClient(config.BackendURL, host.ClientSecret(), nil)
	if err != nil {
		log.Fatal(err)
	}
	twitchService, err := twitchchat.NewService(twitchchat.Config{
		Storage: host.Storage(),
		Events:  watchedManager,
		Badges:  twitchchat.NewBackendBadgeResolver(backendClient),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(twitchService); err != nil {
		log.Fatal(err)
	}
	kickService, err := kickchat.NewService(kickchat.Config{
		Storage: host.Storage(), Backend: backendClient, Events: watchedManager,
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(kickService); err != nil {
		log.Fatal(err)
	}
	if err := watchedManager.SetChat(contracts.PlatformTwitch, twitchService); err != nil {
		log.Fatal(err)
	}
	if err := watchedManager.SetChat(contracts.PlatformKick, kickService); err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(watchedManager); err != nil {
		log.Fatal(err)
	}
	bridge.RegisterTwitchHandlers(requestHandlers, twitchService, kickService)
	bridge.RegisterWatchedChannelHandlers(requestHandlers, watchedManager)
	bridge.RegisterBackendHandlers(requestHandlers, backendClient, host.Storage())
	authService, err := auth.NewService(auth.Config{
		Address:          config.AuthAddress,
		CallbackHost:     config.AuthCallbackHost,
		Backend:          backendClient,
		Browser:          auth.BrowserFunc(openExternalURL),
		IdentityResolver: auth.ProviderIdentityResolver{},
		Storage:          host.Storage(),
		Events: auth.Events{
			OnAuthURL: func(payload contracts.AuthURL) {
				events.EmitAuthURL(payload)
			},
			OnAuthSuccess: func(payload contracts.AuthSuccess) {
				events.EmitAuthSuccess(payload)
				if payload.Platform == contracts.PlatformTwitch {
					if err := twitchService.RefreshCredentials(host.Context()); err != nil {
						log.Printf("connect Twitch chat after OAuth: %v", err)
					}
				}
			},
			OnAuthError: func(payload contracts.AuthError) {
				events.EmitAuthError(payload)
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(authService); err != nil {
		log.Fatal(err)
	}
	bridge.RegisterAuthHandlers(requestHandlers, authService, host.Storage())

	if err := host.Start(); err != nil {
		log.Fatal(err)
	}
}

func updateFeedURL() string {
	return updateFeedURLFor(runtime.GOOS)
}

// updateFeedURLFor returns the directory that Velopack uses as its HTTP update
// source. UpdateManager appends releases.<channel>.json itself; passing the
// JSON filename here makes it request a non-existent nested URL.
func updateFeedURLFor(_ string) string {
	return "https://github.com/Satont/twirchat/releases/latest/download"
}

func openExternalURL(url string) error {
	wailsApp := application.Get()
	if wailsApp == nil {
		return os.ErrNotExist
	}
	return wailsApp.Browser.OpenURL(url)
}

func profileDirectory() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(configDir, "TwirChat"), nil
}
