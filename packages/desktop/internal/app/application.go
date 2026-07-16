package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"runtime"
	"sync"

	"github.com/Satont/twirchat/packages/desktop/internal/storage"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service is a background component whose lifecycle belongs to the application.
type Service interface {
	Start(context.Context) error
	Stop(context.Context) error
}

// Config contains dependencies that are provided by the composition root.
type Config struct {
	Assets        fs.FS
	Context       context.Context
	Name          string
	ProfileDir    string
	Services      []Service
	WailsServices []application.Service
}

// Application owns the Wails lifecycle and deferred background services.
type Application struct {
	assets        fs.FS
	context       context.Context
	cancel        context.CancelFunc
	name          string
	profileDir    string
	services      []Service
	storage       *storage.Storage
	clientSecret  string
	wailsServices []application.Service
	windowOptions application.WebviewWindowOptions

	started      bool
	shutdownOnce sync.Once
}

const compactTitleBarHeight = 32

// New configures an application without creating a native window or starting services.
func New(config Config) (*Application, error) {
	if config.Assets == nil {
		return nil, errors.New("application assets are required")
	}
	if config.Context == nil {
		return nil, errors.New("application context is required")
	}
	if config.Name == "" {
		return nil, errors.New("application name is required")
	}
	if config.ProfileDir == "" {
		return nil, errors.New("profile directory is required")
	}

	rootContext, cancel := context.WithCancel(config.Context)
	store, err := storage.Open(rootContext, config.ProfileDir)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("initialize profile storage: %w", err)
	}
	clientSecret, err := store.ClientSecret(rootContext)
	if err != nil {
		_ = store.Close()
		cancel()
		return nil, fmt.Errorf("initialize client secret: %w", err)
	}
	return &Application{
		assets:        config.Assets,
		context:       rootContext,
		cancel:        cancel,
		name:          config.Name,
		profileDir:    config.ProfileDir,
		services:      append([]Service(nil), config.Services...),
		storage:       store,
		clientSecret:  clientSecret,
		wailsServices: append([]application.Service(nil), config.WailsServices...),
		windowOptions: mainWindowOptions(config.Name, runtime.GOOS),
	}, nil
}

func mainWindowOptions(name, platform string) application.WebviewWindowOptions {
	options := application.WebviewWindowOptions{
		Name:   "main",
		Title:  name,
		URL:    "/",
		Width:  1200,
		Height: 800,
		MinWidth:  720,
		MinHeight: 520,
	}

	switch platform {
	case "windows":
		options.Frameless = true
		options.Windows = application.WindowsWindow{
			DisableFramelessWindowDecorations: false,
		}
	case "darwin":
		options.Mac = application.MacWindow{
			TitleBar:                application.MacTitleBarHidden,
			InvisibleTitleBarHeight: compactTitleBarHeight,
		}
	}

	return options
}

func (a *Application) Name() string {
	return a.name
}

func (a *Application) ProfileDir() string {
	return a.profileDir
}

func (a *Application) Context() context.Context {
	return a.context
}

// Storage returns the profile-scoped repository for internal Go services.
func (a *Application) Storage() *storage.Storage {
	return a.storage
}

// ClientSecret is generated once for a fresh profile and reused from SQLite
// for every subsequent application launch and backend transport instance.
func (a *Application) ClientSecret() string {
	return a.clientSecret
}

func (a *Application) WindowOptions() application.WebviewWindowOptions {
	return a.windowOptions
}

// AddService attaches a lifecycle service after profile storage has been
// initialized but before Wails starts the native application loop.
func (a *Application) AddService(service Service) error {
	if service == nil {
		return errors.New("add application service: service is required")
	}
	if a.started {
		return errors.New("add application service: application has already started")
	}
	a.services = append(a.services, service)
	return nil
}

// Start creates the native Wails application and starts its configured services.
func (a *Application) Start() error {
	if a.started {
		return errors.New("application has already started")
	}

	slog.Info("create Wails application", "component", "wails")
	nativeApp := application.New(a.wailsOptions())
	slog.Info("Wails application created", "component", "wails")
	slog.Info(
		"request main WebView2 window",
		"component", "wails",
		"name", a.windowOptions.Name,
		"width", a.windowOptions.Width,
		"height", a.windowOptions.Height,
		"frameless", a.windowOptions.Frameless,
	)
	nativeApp.Window.NewWithOptions(a.windowOptions)
	slog.Info("main WebView2 window requested", "component", "wails")

	if err := a.startServices(); err != nil {
		return err
	}

	a.started = true
	slog.Info("start Wails event loop", "component", "wails")
	if err := nativeApp.Run(); err != nil {
		slog.Error("Wails event loop failed", "component", "wails", "error", err)
		a.Shutdown()
		return err
	}
	slog.Info("Wails event loop stopped", "component", "wails")

	return nil
}

func (a *Application) wailsOptions() application.Options {
	return application.Options{
		Name:     a.name,
		Logger:   slog.Default().With("component", "wails"),
		LogLevel: slog.LevelDebug,
		Services: a.wailsServices,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(a.assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: a.Shutdown,
	}
}

func (a *Application) startServices() error {
	startedServices := make([]Service, 0, len(a.services))
	for _, service := range a.services {
		if err := service.Start(a.context); err != nil {
			a.stop(startedServices)
			a.closeStorage()
			return err
		}
		startedServices = append(startedServices, service)
	}
	return nil
}

// Shutdown cancels the application context and stops services in reverse order.
func (a *Application) Shutdown() {
	a.shutdownOnce.Do(func() {
		a.cancel()
		a.stop(a.services)
		a.closeStorage()
	})
}

func (a *Application) closeStorage() {
	if err := a.storage.Close(); err != nil {
		slog.Error("close profile storage", "error", err)
	}
}

func (a *Application) stop(services []Service) {
	for index := len(services) - 1; index >= 0; index-- {
		_ = services[index].Stop(context.Background())
	}
}
