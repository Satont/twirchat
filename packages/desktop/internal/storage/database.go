package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const databaseFilename = "twirchat.sqlite"

// Storage owns the fresh Wails-profile SQLite database and its repositories.
type Storage struct {
	db        *sql.DB
	machineID string
	path      string
}

type openConfig struct {
	machineID string
}

// Option configures Storage construction.
type Option func(*openConfig)

// WithMachineID makes credential encryption deterministic in tests. Production
// callers should use the host-derived default.
func WithMachineID(machineID string) Option {
	return func(config *openConfig) {
		config.machineID = machineID
	}
}

// Open creates a fresh SQLite database within the injected Wails profile directory.
func Open(ctx context.Context, profileDir string, options ...Option) (*Storage, error) {
	if ctx == nil {
		return nil, errors.New("open storage: context is required")
	}
	if profileDir == "" {
		return nil, errors.New("open storage: profile directory is required")
	}

	config := openConfig{}
	for _, option := range options {
		option(&config)
	}
	if config.machineID == "" {
		machineID, err := os.Hostname()
		if err != nil {
			return nil, fmt.Errorf("open storage: determine machine identity: %w", err)
		}
		config.machineID = machineID
	}

	if err := os.MkdirAll(profileDir, 0o700); err != nil {
		return nil, fmt.Errorf("open storage: create profile directory: %w", err)
	}

	path := filepath.Join(profileDir, databaseFilename)
	db, err := sql.Open("sqlite", sqliteDSN(path))
	if err != nil {
		return nil, fmt.Errorf("open storage: open database: %w", err)
	}
	db.SetMaxOpenConns(1)

	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("open storage: connect database: %w", err)
	}
	if err := createSchema(ctx, db); err != nil {
		db.Close()
		return nil, err
	}

	return &Storage{db: db, machineID: config.machineID, path: path}, nil
}

func sqliteDSN(path string) string {
	parameters := url.Values{}
	parameters.Add("_pragma", "journal_mode(WAL)")
	parameters.Add("_pragma", "foreign_keys(1)")

	return (&url.URL{Scheme: "file", Path: path, RawQuery: parameters.Encode()}).String()
}

// Path returns the SQLite path under the Wails profile directory.
func (s *Storage) Path() string {
	return s.path
}

// Close releases the SQLite database connection.
func (s *Storage) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	if err := s.db.Close(); err != nil {
		return fmt.Errorf("close storage: %w", err)
	}
	return nil
}
