package main

import "testing"

func TestRuntimeConfigReadsEnvironmentOverrides(t *testing.T) {
	t.Setenv("TWIRCHAT_BACKEND_URL", "http://backend.test:9000")
	t.Setenv("TWIRCHAT_AUTH_ADDRESS", "127.0.0.1:4999")
	t.Setenv("TWIRCHAT_AUTH_CALLBACK_HOST", "auth.test")
	config := loadRuntimeConfig()
	if config.BackendURL != "http://backend.test:9000" || config.AuthAddress != "127.0.0.1:4999" || config.AuthCallbackHost != "auth.test" {
		t.Fatalf("config = %#v", config)
	}
}
