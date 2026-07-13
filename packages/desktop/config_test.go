package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeConfigReadsEnvironmentOverrides(t *testing.T) {
	t.Setenv("TWIRCHAT_BACKEND_URL", "http://backend.test:9000")
	t.Setenv("TWIRCHAT_AUTH_ADDRESS", "127.0.0.1:4999")
	t.Setenv("TWIRCHAT_AUTH_CALLBACK_HOST", "auth.test")
	config := loadRuntimeConfig()
	if config.BackendURL != "http://backend.test:9000" || config.AuthAddress != "127.0.0.1:4999" || config.AuthCallbackHost != "auth.test" {
		t.Fatalf("config = %#v", config)
	}
}

func TestRuntimeConfigReadsLegacyAuthServerPort(t *testing.T) {
	t.Setenv("TWIRCHAT_AUTH_ADDRESS", "")
	t.Setenv("AUTH_SERVER_PORT", "4998")

	if config := loadRuntimeConfig(); config.AuthAddress != "127.0.0.1:4998" {
		t.Fatalf("AuthAddress = %q, want legacy AUTH_SERVER_PORT value", config.AuthAddress)
	}
}

func TestRuntimeConfigUsesBuildBackendURLWhenRuntimeEnvironmentIsMissing(t *testing.T) {
	t.Setenv("TWIRCHAT_BACKEND_URL", "")
	previousBuildBackendURL := buildBackendURL
	buildBackendURL = "https://chat.release.test"
	t.Cleanup(func() { buildBackendURL = previousBuildBackendURL })

	if config := loadRuntimeConfig(); config.BackendURL != "https://chat.release.test" {
		t.Fatalf("BackendURL = %q, want embedded release URL", config.BackendURL)
	}
}

func TestRuntimeConfigPrefersRuntimeEnvironmentOverBuildBackendURL(t *testing.T) {
	t.Setenv("TWIRCHAT_BACKEND_URL", "https://chat.override.test")
	previousBuildBackendURL := buildBackendURL
	buildBackendURL = "https://chat.release.test"
	t.Cleanup(func() { buildBackendURL = previousBuildBackendURL })

	if config := loadRuntimeConfig(); config.BackendURL != "https://chat.override.test" {
		t.Fatalf("BackendURL = %q, want process environment URL", config.BackendURL)
	}
}

func TestLoadDotEnvUsesFileWithoutOverridingProcessEnvironment(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile(filepath.Join(".env"), []byte("TWIRCHAT_BACKEND_URL=https://chat.file.test\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	t.Setenv("TWIRCHAT_BACKEND_URL", "https://chat.process.test")

	if err := loadDotEnv(); err != nil {
		t.Fatalf("load .env: %v", err)
	}
	if value := os.Getenv("TWIRCHAT_BACKEND_URL"); value != "https://chat.process.test" {
		t.Fatalf("TWIRCHAT_BACKEND_URL = %q, want process value", value)
	}
}

func TestLoadDotEnvReadsFileWhenRuntimeEnvironmentIsMissing(t *testing.T) {
	t.Chdir(t.TempDir())
	if err := os.WriteFile(filepath.Join(".env"), []byte("TWIRCHAT_BACKEND_URL=https://chat.file.test\n"), 0o600); err != nil {
		t.Fatalf("write .env: %v", err)
	}
	previous, wasSet := os.LookupEnv("TWIRCHAT_BACKEND_URL")
	if err := os.Unsetenv("TWIRCHAT_BACKEND_URL"); err != nil {
		t.Fatalf("unset TWIRCHAT_BACKEND_URL: %v", err)
	}
	t.Cleanup(func() {
		if wasSet {
			_ = os.Setenv("TWIRCHAT_BACKEND_URL", previous)
			return
		}
		_ = os.Unsetenv("TWIRCHAT_BACKEND_URL")
	})

	if err := loadDotEnv(); err != nil {
		t.Fatalf("load .env: %v", err)
	}
	if value := os.Getenv("TWIRCHAT_BACKEND_URL"); value != "https://chat.file.test" {
		t.Fatalf("TWIRCHAT_BACKEND_URL = %q, want file value", value)
	}
}
