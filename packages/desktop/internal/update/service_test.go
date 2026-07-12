package update

import "testing"

type recordingStartup struct{ called bool }

func (s *recordingStartup) RunAutoApply() { s.called = true }

func TestRunStartupDelegatesToVelopackAdapter(t *testing.T) {
	runner := &recordingStartup{}
	RunStartup(runner)
	if !runner.called {
		t.Fatal("RunStartup() did not enable Velopack auto-apply")
	}
}

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
