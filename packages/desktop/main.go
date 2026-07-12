package main

import (
	"context"
	"embed"
	"log"
	"os"
	"os/signal"
	"path/filepath"

	"github.com/Satont/twirchat/packages/desktop/internal/app"
	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/bridge"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	kickchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/kick"
	twitchchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/twitch"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist/main
var assets embed.FS

func main() {
	rootContext, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	profileDir, err := profileDirectory()
	if err != nil {
		log.Fatal(err)
	}
	requestHandlers := bridge.NewHandlerRegistry()

	host, err := app.New(app.Config{
		Assets:     assets,
		Context:    rootContext,
		Name:       "TwirChat",
		ProfileDir: profileDir,
		WailsServices: []application.Service{
			application.NewService(bridge.NewDesktopService(requestHandlers)),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	bridge.RegisterStorageHandlers(requestHandlers, host.Storage())
	events := bridge.NewEventPublisher(bridge.WailsEventEmitter{})
	backendClient, err := backend.NewHTTPClient(backendURL(), host.ClientSecret(), nil)
	if err != nil {
		log.Fatal(err)
	}
	twitchService, err := twitchchat.NewService(twitchchat.Config{
		Storage: host.Storage(),
		Events:  bridge.NewTwitchEvents(events),
		Badges:  twitchchat.NewBackendBadgeResolver(backendClient),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(twitchService); err != nil {
		log.Fatal(err)
	}
	kickService, err := kickchat.NewService(kickchat.Config{
		Storage: host.Storage(), Backend: backendClient, Events: bridge.NewTwitchEvents(events),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := host.AddService(kickService); err != nil {
		log.Fatal(err)
	}
	bridge.RegisterTwitchHandlers(requestHandlers, twitchService, kickService)
	bridge.RegisterBackendHandlers(requestHandlers, backendClient, host.Storage())
	authService, err := auth.NewService(auth.Config{
		Address:          "127.0.0.1:45821",
		CallbackHost:     "localhost",
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

func backendURL() string {
	if value := os.Getenv("TWIRCHAT_BACKEND_URL"); value != "" {
		return value
	}
	return "http://127.0.0.1:3000"
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
