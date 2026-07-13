package main

import (
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"

	"github.com/joho/godotenv"
)

type runtimeConfig struct{ BackendURL, AuthAddress, AuthCallbackHost string }

// buildBackendURL is set for release artifacts with Go's -ldflags -X option.
// It deliberately remains empty for local development, where .env and process
// environment values must stay configurable without rebuilding the app.
var buildBackendURL string

func loadRuntimeConfig() runtimeConfig {
	return runtimeConfig{
		BackendURL:       envOr("TWIRCHAT_BACKEND_URL", envOr("CHATRIX_BACKEND_URL", valueOr(buildBackendURL, "http://127.0.0.1:3000"))),
		AuthAddress:      authAddress(),
		AuthCallbackHost: envOr("TWIRCHAT_AUTH_CALLBACK_HOST", "localhost"),
	}
}

func authAddress() string {
	if address := os.Getenv("TWIRCHAT_AUTH_ADDRESS"); address != "" {
		return address
	}
	if port := os.Getenv("AUTH_SERVER_PORT"); port != "" {
		return net.JoinHostPort("127.0.0.1", port)
	}
	return "127.0.0.1:45821"
}

func loadDotEnv() error {
	if err := godotenv.Load(); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("load .env: %w", err)
	}
	return nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func valueOr(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}
