package update

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

type recordingStartup struct{ called bool }

func (s *recordingStartup) RunAutoApply() { s.called = true }

func TestRunStartupDelegatesToVelopackAdapter(t *testing.T) {
	runner := &recordingStartup{}
	RunStartup(runner)
	if !runner.called {
		t.Fatal("RunStartup() did not enable Velopack auto-apply")
	}
}

func TestRunProductionStartupSkipsVelopackForDevelopmentBuild(t *testing.T) {
	runner := &recordingStartup{}
	runProductionStartup("dev", runner)
	if runner.called {
		t.Fatal("runProductionStartup() called Velopack for a development build")
	}
}

func TestRunProductionStartupRunsVelopackForReleaseBuild(t *testing.T) {
	runner := &recordingStartup{}
	runProductionStartup("0.8.1", runner)
	if !runner.called {
		t.Fatal("runProductionStartup() did not call Velopack for a release build")
	}
}

func TestVelopackAppMapsNativeLogsToGlobalSlog(t *testing.T) {
	previousDefault := slog.Default()
	var output bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&output, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previousDefault)
	})

	config := newVelopackApp()
	if !config.AutoApplyOnStartup {
		t.Fatal("AutoApplyOnStartup = false, want true")
	}
	if config.Logger == nil {
		t.Fatal("Velopack Logger = nil")
	}
	config.Logger("trace", "prepare delta")
	config.Logger("info", "download release")
	config.Logger("warning", "retry package")
	config.Logger("error", "apply failed")

	for _, want := range []string{
		"level=DEBUG msg=\"prepare delta\" component=velopack",
		"level=INFO msg=\"download release\" component=velopack",
		"level=WARN msg=\"retry package\" component=velopack",
		"level=ERROR msg=\"apply failed\" component=velopack",
	} {
		if !strings.Contains(output.String(), want) {
			t.Fatalf("Velopack output = %q, want %q", output.String(), want)
		}
	}
}

func TestManagerForVersionSkipsVelopackForDevelopmentBuild(t *testing.T) {
	called := false
	manager, updates, err := ManagerForVersion("dev", "https://updates.test", func(string) (Manager, error) {
		called = true
		return nil, nil
	})
	if err != nil {
		t.Fatalf("ManagerForVersion() error = %v", err)
	}
	if called {
		t.Fatal("ManagerForVersion() created a Velopack manager for a development build")
	}
	if updates {
		t.Fatal("updates = true, want false for a development build")
	}
	result, available, err := manager.Check()
	if err != nil || result != "" || available {
		t.Fatalf("disabled manager Check() = (%q, %t, %v), want (\"\", false, nil)", result, available, err)
	}
}

func TestManagerForVersionCreatesVelopackManagerForReleaseBuild(t *testing.T) {
	called := false
	want := &recordingManager{}
	manager, updates, err := ManagerForVersion("0.8.1", "https://updates.test", func(feed string) (Manager, error) {
		called = true
		if feed != "https://updates.test" {
			t.Errorf("feed = %q", feed)
		}
		return want, nil
	})
	if err != nil {
		t.Fatalf("ManagerForVersion() error = %v", err)
	}
	if !called || !updates || manager != want {
		t.Fatalf("ManagerForVersion() = (%T, %t), want supplied release manager and updates=true", manager, updates)
	}
}

type recordingManager struct{}

func (recordingManager) Check() (string, bool, error) { return "", false, nil }
func (recordingManager) Download(func(uint)) error    { return nil }
func (recordingManager) Apply() error                 { return nil }

func TestVersionReturnsDevelopmentFallback(t *testing.T) {
	if got, want := Version(""), "dev"; got != want {
		t.Errorf("Version(\"\") = %q, want %q", got, want)
	}
	if got, want := Version("1.0.0"), "1.0.0"; got != want {
		t.Errorf("Version() = %q, want %q", got, want)
	}
}

type fakeManager struct {
	available  bool
	downloaded bool
	applied    bool
}

func (m *fakeManager) Check() (string, bool, error) { return "1.0.1", m.available, nil }
func (m *fakeManager) Download(func(uint)) error    { m.downloaded = true; return nil }
func (m *fakeManager) Apply() error                 { m.applied = true; return nil }

func TestServiceChecksDownloadsAndAppliesAvailableUpdate(t *testing.T) {
	manager := &fakeManager{available: true}
	service := NewService("1.0.0", manager)
	result, err := service.Check()
	if err != nil || !result.UpdateAvailable || result.Version != "1.0.1" {
		t.Fatalf("Check() = %#v, %v", result, err)
	}
	if err := service.Download(nil); err != nil || !manager.downloaded {
		t.Fatalf("Download() = %v", err)
	}
	if err := service.Apply(); err != nil || !manager.applied {
		t.Fatalf("Apply() = %v", err)
	}
}
