package main

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"

	"github.com/Satont/twirchat/packages/desktop/internal/app"
	"github.com/Satont/twirchat/packages/desktop/internal/auth"
	"github.com/Satont/twirchat/packages/desktop/internal/avatar"
	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/bridge"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/logging"
	kickchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/kick"
	twitchchat "github.com/Satont/twirchat/packages/desktop/internal/platforms/twitch"
	"github.com/Satont/twirchat/packages/desktop/internal/seventv"
	"github.com/Satont/twirchat/packages/desktop/internal/update"
	"github.com/Satont/twirchat/packages/desktop/internal/watched"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist/main
var assets embed.FS

var version = "dev"

func main() {
	os.Exit(runMain())
}

func runMain() int {
	profileDir, err := profileDirectory()
	if err != nil {
		slog.Error("resolve profile directory", "error", err)
		return 1
	}
	closeLogger, err := logging.SetupLogger(profileDir)
	if err != nil {
		slog.Error("configure logging", "error", err)
		return 1
	}
	defer func() {
		if err := closeLogger(); err != nil {
			slog.Error("close log file", "error", err)
		}
	}()

	if err := run(profileDir); err != nil {
		slog.Error("application startup failed", "error", err)
		return 1
	}
	return 0
}

func run(profileDir string) error {
	if buildBackendURL == "" {
		if err := loadDotEnv(); err != nil {
			return fmt.Errorf("load environment: %w", err)
		}
	}
	slog.Info("start desktop application", "version", update.Version(version), "os", runtime.GOOS, "arch", runtime.GOARCH)
	slog.Info("start Velopack startup", "version", update.Version(version))
	update.RunProductionStartup(version)
	slog.Info("Velopack startup complete", "version", update.Version(version))
	version = update.Version(version)
	rootContext, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	requestHandlers := bridge.NewHandlerRegistry()
	config := loadRuntimeConfig()
	feed := updateFeedURL()
	updaterManager, updatesEnabled, err := update.ManagerForVersion(version, feed, update.NewVelopackManager)
	if err != nil {
		return fmt.Errorf("initialize update manager: %w", err)
	}
	updater := update.NewService(version, updaterManager)

	host, err := app.New(app.Config{
		Assets:     assets,
		Context:    rootContext,
		Name:       wailsApplicationNameFor(version),
		ProfileDir: profileDir,
		WailsServices: []application.Service{
			application.NewService(bridge.NewDesktopService(requestHandlers, updatesEnabled)),
		},
	})
	if err != nil {
		return fmt.Errorf("initialize application: %w", err)
	}
	defer host.Shutdown()

	events := bridge.NewEventPublisher(bridge.WailsEventEmitter{})
	watchedManager, err := watched.NewManager(watched.Config{Storage: host.Storage(), Events: events})
	if err != nil {
		return fmt.Errorf("initialize watched channels: %w", err)
	}
	bridge.RegisterStorageHandlers(requestHandlers, host.Storage())
	bridge.RegisterUpdateHandlers(requestHandlers, updater, events)

	backendClient, err := backend.NewHTTPClient(config.BackendURL, host.ClientSecret(), nil)
	if err != nil {
		return fmt.Errorf("initialize backend client: %w", err)
	}
	avatarResolver, err := avatar.NewResolver(avatar.Config{Backend: backendClient})
	if err != nil {
		return fmt.Errorf("initialize avatar resolver: %w", err)
	}
	sevenTVService, err := seventv.NewService(seventv.Config{
		BackendURL: config.BackendURL, ClientSecret: host.ClientSecret(), Events: events, Messages: watchedManager,
	})
	if err != nil {
		return fmt.Errorf("initialize 7TV service: %w", err)
	}
	if err := host.AddService(sevenTVService); err != nil {
		return fmt.Errorf("register 7TV service: %w", err)
	}
	twitchService, err := twitchchat.NewService(twitchchat.Config{
		Storage: host.Storage(),
		Events:  watchedManager,
		Backend: backendClient,
		Badges:  twitchchat.NewBackendBadgeResolver(backendClient),
		SevenTV: sevenTVService,
	})
	if err != nil {
		return fmt.Errorf("initialize Twitch service: %w", err)
	}
	if err := host.AddService(twitchService); err != nil {
		return fmt.Errorf("register Twitch service: %w", err)
	}
	kickService, err := kickchat.NewService(kickchat.Config{
		Storage: host.Storage(), Backend: backendClient, Events: watchedManager, SevenTV: sevenTVService,
	})
	if err != nil {
		return fmt.Errorf("initialize Kick service: %w", err)
	}
	if err := host.AddService(kickService); err != nil {
		return fmt.Errorf("register Kick service: %w", err)
	}
	if err := watchedManager.SetChat(contracts.PlatformTwitch, twitchService); err != nil {
		return fmt.Errorf("register Twitch watched chat: %w", err)
	}
	if err := watchedManager.SetChat(contracts.PlatformKick, kickService); err != nil {
		return fmt.Errorf("register Kick watched chat: %w", err)
	}
	if err := host.AddService(watchedManager); err != nil {
		return fmt.Errorf("register watched channels: %w", err)
	}
	bridge.RegisterTwitchHandlers(requestHandlers, twitchService, kickService)
	bridge.RegisterWatchedChannelHandlers(requestHandlers, watchedManager)
	bridge.RegisterChattersHandlers(requestHandlers, map[contracts.Platform]bridge.ChattersProvider{
		contracts.PlatformTwitch: twitchService,
		contracts.PlatformKick:   kickService,
	})
	bridge.RegisterSevenTVHandlers(requestHandlers, sevenTVService)
	bridge.RegisterBackendHandlers(requestHandlers, backendClient, host.Storage())
	bridge.RegisterAvatarHandlers(requestHandlers, avatarResolver)
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
						slog.Error("connect Twitch chat after OAuth", "error", err)
					}
				}
			},
			OnAuthError: func(payload contracts.AuthError) {
				events.EmitAuthError(payload)
			},
		},
	})
	if err != nil {
		return fmt.Errorf("initialize authentication service: %w", err)
	}
	if err := host.AddService(authService); err != nil {
		return fmt.Errorf("register authentication service: %w", err)
	}
	twitchService.SetTokenRefresher(authService)
	kickService.SetTokenRefresher(authService)
	bridge.RegisterAuthHandlers(requestHandlers, authService, host.Storage())
	bridge.RegisterModerationHandlers(requestHandlers, backendClient, host.Storage(), authService)

	if err := host.Start(); err != nil {
		return fmt.Errorf("start desktop application: %w", err)
	}
	return nil
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

	return profileDirectoryFor(configDir, version), nil
}

func profileDirectoryFor(configDir, buildVersion string) string {
	profileName := "TwirChat"
	if update.Version(buildVersion) == "dev" {
		profileName += "-dev"
	}

	return filepath.Join(configDir, profileName)
}

func wailsApplicationNameFor(buildVersion string) string {
	if update.Version(buildVersion) == "dev" {
		return "TwirChat-dev"
	}

	return "TwirChat"
}
