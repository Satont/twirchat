package logging

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	slogmulti "github.com/samber/slog-multi"
)

const (
	logDirectoryName = "logs"
	logDayLayout     = "2006-01-02"
	logFileName      = "twirchat.log"
)

// SetupLogger configures the process-wide logger to write readable text records
// to both stderr and one file per UTC day within the profile directory.
func SetupLogger(profileDir string) (func() error, error) {
	now := time.Now().UTC()
	logDir := filepath.Join(profileDir, logDirectoryName, now.Format(logDayLayout))
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, fmt.Errorf("create log directory: %w", err)
	}

	file, err := os.OpenFile(filepath.Join(logDir, logFileName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open log file: %w", err)
	}

	handler := slogmulti.Fanout(
		slog.NewTextHandler(os.Stderr, nil),
		slog.NewTextHandler(file, nil),
	)
	slog.SetDefault(slog.New(handler))

	var closeOnce sync.Once
	var closeErr error
	return func() error {
		closeOnce.Do(func() {
			closeErr = errors.Join(file.Sync(), file.Close())
		})
		return closeErr
	}, nil
}
