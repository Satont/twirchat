package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type trackingService struct {
	starts int
}

func (s *trackingService) Start(context.Context) error {
	s.starts++
	return nil
}

func (s *trackingService) Stop(context.Context) error {
	return nil
}

type stoppingService struct {
	name    string
	stopped *[]string
}

type boundService struct{}

type failingService struct{}

func (s *stoppingService) Start(context.Context) error {
	return nil
}

func (s *stoppingService) Stop(context.Context) error {
	*s.stopped = append(*s.stopped, s.name)
	return nil
}

func (failingService) Start(context.Context) error {
	return errors.New("service startup failed")
}

func (failingService) Stop(context.Context) error {
	return nil
}

func TestNewConfiguresHostWithoutStartingServices(t *testing.T) {
	rootContext, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)

	service := &trackingService{}
	profileDir := t.TempDir()
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    rootContext,
		Name:       "TwirChat",
		ProfileDir: profileDir,
		Services:   []Service{service},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if got, want := host.Name(), "TwirChat"; got != want {
		t.Errorf("Name() = %q, want %q", got, want)
	}
	if got, want := host.ProfileDir(), profileDir; got != want {
		t.Errorf("ProfileDir() = %q, want %q", got, want)
	}
	if got := host.WindowOptions(); got.Title != "TwirChat" || got.Width != 1200 || got.Height != 800 {
		t.Errorf("WindowOptions() = %+v, want title TwirChat and size 1200x800", got)
	}
	if service.starts != 0 {
		t.Errorf("service starts = %d, want 0 before Start", service.starts)
	}

	cancel()
	select {
	case <-host.Context().Done():
	default:
		t.Error("Context() was not cancelled with the injected root context")
	}
}

func TestMainWindowOptionsUsesFramelessWindowsWithSystemDecorations(t *testing.T) {
	options := mainWindowOptions("TwirChat", "windows")

	if !options.Frameless {
		t.Fatal("Frameless = false, want true")
	}
	if options.Windows.DisableFramelessWindowDecorations {
		t.Fatal("DisableFramelessWindowDecorations = true, want false")
	}
}

func TestMainWindowOptionsKeepsNativeMacFrameForTrafficLights(t *testing.T) {
	options := mainWindowOptions("TwirChat", "darwin")

	if options.Frameless {
		t.Fatal("Frameless = true, want false so macOS retains native traffic-light controls")
	}
	if !options.Mac.TitleBar.AppearsTransparent || !options.Mac.TitleBar.FullSizeContent {
		t.Fatalf("Mac title bar = %+v, want transparent full-size content", options.Mac.TitleBar)
	}
	if options.Mac.TitleBar.Hide {
		t.Fatal("Mac title bar is hidden, want native traffic-light controls")
	}
	if options.Mac.InvisibleTitleBarHeight != compactTitleBarHeight {
		t.Fatalf(
			"InvisibleTitleBarHeight = %d, want %d",
			options.Mac.InvisibleTitleBarHeight,
			compactTitleBarHeight,
		)
	}
}

func TestMainWindowOptionsKeepsLinuxNativeFrame(t *testing.T) {
	options := mainWindowOptions("TwirChat", "linux")

	if options.Frameless {
		t.Fatal("Frameless = true, want false")
	}
}

func TestNewKeepsWailsServicesForBinding(t *testing.T) {
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: t.TempDir(),
		WailsServices: []application.Service{
			application.NewService(&boundService{}),
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	if got, want := len(host.wailsServices), 1; got != want {
		t.Errorf("bound Wails services = %d, want %d", got, want)
	}
}

func TestAddServiceRegistersLifecycleServiceBeforeStart(t *testing.T) {
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}
	t.Cleanup(host.Shutdown)
	service := &trackingService{}
	if err := host.AddService(service); err != nil {
		t.Fatalf("AddService() error = %v", err)
	}
	if got, want := len(host.services), 1; got != want {
		t.Errorf("service count = %d, want %d", got, want)
	}
}

func TestShutdownCancelsContextAndStopsServicesInReverseOrder(t *testing.T) {
	var stopped []string
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: t.TempDir(),
		Services: []Service{
			&stoppingService{name: "first", stopped: &stopped},
			&stoppingService{name: "second", stopped: &stopped},
			&stoppingService{name: "third", stopped: &stopped},
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	host.Shutdown()

	select {
	case <-host.Context().Done():
	default:
		t.Error("Context() is not cancelled by Shutdown()")
	}
	if got, want := strings.Join(stopped, ","), "third,second,first"; got != want {
		t.Errorf("stopped services = %q, want %q", got, want)
	}
}

func TestNewInitializesProfileStorageAndShutdownClosesIt(t *testing.T) {
	profileDir := t.TempDir()
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: profileDir,
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if got, want := host.Storage().Path(), filepath.Join(profileDir, "twirchat.sqlite"); got != want {
		t.Errorf("Storage().Path() = %q, want %q", got, want)
	}
	if _, err := os.Stat(host.Storage().Path()); err != nil {
		t.Fatalf("storage database does not exist: %v", err)
	}

	host.Shutdown()
	if _, err := host.Storage().ListAccounts(context.Background()); err == nil {
		t.Error("storage remains usable after application shutdown")
	}
}

func TestNewCreatesAndReusesPersistentClientSecret(t *testing.T) {
	profileDir := t.TempDir()
	config := Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: profileDir,
	}
	first, err := New(config)
	if err != nil {
		t.Fatalf("New() first error = %v", err)
	}
	secret := first.ClientSecret()
	if secret == "" {
		t.Fatal("ClientSecret() returned an empty value")
	}
	first.Shutdown()

	second, err := New(config)
	if err != nil {
		t.Fatalf("New() second error = %v", err)
	}
	t.Cleanup(second.Shutdown)
	if got := second.ClientSecret(); got != secret {
		t.Errorf("ClientSecret() after reopening profile = %q, want %q", got, secret)
	}
}

func TestStartServicesClosesStorageAfterServiceFailure(t *testing.T) {
	var stopped []string
	host, err := New(Config{
		Assets:     fstest.MapFS{"index.html": {Data: []byte("<html></html>")}},
		Context:    context.Background(),
		Name:       "TwirChat",
		ProfileDir: t.TempDir(),
		Services: []Service{
			&stoppingService{name: "started", stopped: &stopped},
			failingService{},
		},
	})
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if err := host.startServices(); err == nil {
		t.Fatal("startServices() succeeded despite service startup failure")
	}
	if got, want := strings.Join(stopped, ","), "started"; got != want {
		t.Errorf("stopped services = %q, want %q", got, want)
	}
	if _, err := host.Storage().ListAccounts(context.Background()); err == nil {
		t.Error("storage remains usable after service startup failure")
	}
}
