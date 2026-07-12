package update

import (
	"errors"
	"github.com/quaadgras/velopack-go/velopack"
)

// StartupRunner isolates Velopack process bootstrap from application tests.
type StartupRunner interface{ RunAutoApply() }

type velopackStartup struct{}

func (velopackStartup) RunAutoApply() { velopack.Run(velopack.App{AutoApplyOnStartup: true}) }

// RunStartup processes Velopack launch/update arguments before Wails starts.
func RunStartup(runner StartupRunner) { runner.RunAutoApply() }

func RunProductionStartup() { RunStartup(velopackStartup{}) }

// Version normalises the linker value used by both development and release builds.
func Version(value string) string {
	if value == "" {
		return "dev"
	}
	return value
}

type Manager interface {
	Check() (string, bool, error)
	Download(func(uint)) error
	Apply() error
}
type CheckResult struct {
	UpdateAvailable bool   `json:"updateAvailable"`
	Version         string `json:"version,omitempty"`
	CurrentVersion  string `json:"currentVersion"`
}
type Service struct {
	currentVersion string
	manager        Manager
}

func NewService(currentVersion string, manager Manager) *Service {
	return &Service{currentVersion: Version(currentVersion), manager: manager}
}
func (s *Service) Check() (CheckResult, error) {
	version, available, err := s.manager.Check()
	return CheckResult{UpdateAvailable: available, Version: version, CurrentVersion: s.currentVersion}, err
}
func (s *Service) Download(progress func(uint)) error { return s.manager.Download(progress) }
func (s *Service) Apply() error                       { return s.manager.Apply() }

type velopackManager struct {
	manager *velopack.UpdateManager
	pending *velopack.UpdateInfo
}

func NewVelopackManager(feed string) (Manager, error) {
	manager, err := velopack.NewUpdateManager(feed)
	if err != nil {
		return nil, err
	}
	return &velopackManager{manager: manager}, nil
}
func (m *velopackManager) Check() (string, bool, error) {
	info, status, err := m.manager.CheckForUpdates()
	if err != nil {
		return "", false, err
	}
	if status != velopack.UpdateAvailable || info == nil || info.TargetFullRelease == nil {
		return "", false, nil
	}
	m.pending = info
	return info.TargetFullRelease.Version, true, nil
}
func (m *velopackManager) Download(progress func(uint)) error {
	if m.pending == nil {
		return errors.New("no checked update is available")
	}
	return m.manager.DownloadUpdates(m.pending, progress)
}
func (m *velopackManager) Apply() error {
	if m.pending == nil {
		return errors.New("no downloaded update is available")
	}
	return m.manager.ApplyUpdatesAndRestart(m.pending)
}
