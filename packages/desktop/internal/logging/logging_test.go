package logging

import (
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
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
	if !entries[0].IsDir() || !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`).MatchString(entries[0].Name()) {
		t.Fatalf("daily log directory = %q, want YYYY-MM-DD", entries[0].Name())
	}

	logEntries, err := os.ReadDir(filepath.Join(profileDir, "logs", entries[0].Name()))
	if err != nil {
		t.Fatalf("read daily log directory: %v", err)
	}
	if len(logEntries) != 1 {
		t.Fatalf("log file count = %d, want 1", len(logEntries))
	}
	if logEntries[0].IsDir() ||
		!regexp.MustCompile(`^twirchat\d{8}T\d{6}\.\d{9}Z\.log$`).MatchString(logEntries[0].Name()) {
		t.Fatalf("log file name = %q, want twirchat<timestamp>.log", logEntries[0].Name())
	}

	content, err := os.ReadFile(filepath.Join(profileDir, "logs", entries[0].Name(), logEntries[0].Name()))
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}
	if !strings.Contains(string(content), "level=INFO msg=\"logger configured\" channel=satont") {
		t.Fatalf("unexpected text log: %s", content)
	}
}
