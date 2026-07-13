package backend

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientPostJSONAddsClientSecretAndDecodesResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got, want := request.Header.Get("X-Client-Secret"), "desktop-secret"; got != want {
			t.Errorf("X-Client-Secret = %q, want %q", got, want)
		}
		if got, want := request.Method, http.MethodPost; got != want {
			t.Errorf("method = %q, want %q", got, want)
		}
		if got, want := request.URL.Path, "/api/example"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if got, want := body["name"], "TwirChat"; got != want {
			t.Errorf("body name = %q, want %q", got, want)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(server.Close)

	client, err := NewHTTPClient(server.URL, "desktop-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	var response struct {
		OK bool `json:"ok"`
	}
	if err := client.PostJSON(context.Background(), "/api/example", map[string]string{"name": "TwirChat"}, &response); err != nil {
		t.Fatalf("PostJSON() error = %v", err)
	}
	if !response.OK {
		t.Error("PostJSON() did not decode response")
	}
}

func TestClientReturnsStatusAndBoundedResponseBodyForFailedRequests(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		http.Error(writer, "backend rejected request", http.StatusUnauthorized)
	}))
	t.Cleanup(server.Close)

	client, err := NewHTTPClient(server.URL, "desktop-secret", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient() error = %v", err)
	}
	err = client.GetJSON(context.Background(), "/api/example", nil)
	if err == nil {
		t.Fatal("GetJSON() error = nil, want HTTP status error")
	}
	statusError, ok := err.(*HTTPStatusError)
	if !ok {
		t.Fatalf("GetJSON() error = %T, want *HTTPStatusError", err)
	}
	if got, want := statusError.StatusCode, http.StatusUnauthorized; got != want {
		t.Errorf("StatusCode = %d, want %d", got, want)
	}
	if got, want := statusError.Body, "backend rejected request"; got != want {
		t.Errorf("Body = %q, want %q", got, want)
	}
}
