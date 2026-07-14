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

const logFileName = "twirchat.log"

// SetupLogger configures the process-wide logger to write readable text records
// to both stderr and a timestamped file within the profile directory.
func SetupLogger(profileDir string) (func() error, error) {
	logDir := filepath.Join(
		profileDir,
		"logs",
		time.Now().UTC().Format("20060102T150405.000000000Z"),
	)
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
