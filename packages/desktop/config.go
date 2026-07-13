package main

import "os"

type runtimeConfig struct{ BackendURL, AuthAddress, AuthCallbackHost string }

func loadRuntimeConfig() runtimeConfig {
	return runtimeConfig{BackendURL: envOr("TWIRCHAT_BACKEND_URL", "http://127.0.0.1:3000"), AuthAddress: envOr("TWIRCHAT_AUTH_ADDRESS", "127.0.0.1:45821"), AuthCallbackHost: envOr("TWIRCHAT_AUTH_CALLBACK_HOST", "localhost")}
}
func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
