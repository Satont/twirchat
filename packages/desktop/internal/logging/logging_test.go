package logging

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSetupLoggerWritesReadableTextFile(t *testing.T) {
	previousDefault := slog.Default()
	t.Cleanup(func() {
		slog.SetDefault(previousDefault)
	})

	profileDir := t.TempDir()
	closeLogger, err := SetupLogger(profileDir)
	if err != nil {
		t.Fatalf("SetupLogger() error = %v", err)
	}
	t.Cleanup(func() {
		_ = closeLogger()
	})

	slog.Info("logger configured", "channel", "satont")
	if err := closeLogger(); err != nil {
		t.Fatalf("close logger: %v", err)
	}

	entries, err := os.ReadDir(filepath.Join(profileDir, "logs"))
	if err != nil {
		t.Fatalf("read logs directory: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("log directory count = %d, want 1", len(entries))
	}

	content, err := os.ReadFile(filepath.Join(profileDir, "logs", entries[0].Name(), "twirchat.log"))
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(content), "level=INFO msg=\"logger configured\" channel=satont") {
		t.Fatalf("unexpected text log: %s", content)
	}
}
