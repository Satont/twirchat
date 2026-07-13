package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

const maxErrorBodyBytes = 4 << 10

// HTTPStatusError preserves a backend failure without making callers parse text.
type HTTPStatusError struct {
	StatusCode int
	Body       string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("backend request failed with HTTP %d: %s", e.StatusCode, e.Body)
}

// HTTPClient is the authenticated desktop-to-backend REST transport.
type HTTPClient struct {
	baseURL      *url.URL
	clientSecret string
	httpClient   *http.Client
}

func NewHTTPClient(baseURL, clientSecret string, httpClient *http.Client) (*HTTPClient, error) {
	parsedURL, err := url.Parse(baseURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return nil, fmt.Errorf("create backend HTTP client: invalid base URL %q", baseURL)
	}
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &HTTPClient{baseURL: parsedURL, clientSecret: clientSecret, httpClient: httpClient}, nil
}

func (c *HTTPClient) GetJSON(ctx context.Context, path string, output any) error {
	return c.doJSON(ctx, http.MethodGet, path, nil, output)
}

func (c *HTTPClient) PostJSON(ctx context.Context, path string, input, output any) error {
	return c.doJSON(ctx, http.MethodPost, path, input, output)
}

func (c *HTTPClient) doJSON(ctx context.Context, method, path string, input, output any) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("backend %s %s: %w", method, path, err)
	}
	requestURL, err := c.resolve(path)
	if err != nil {
		return err
	}
	log.Printf("backend http: request method=%s path=%s", method, path)
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("backend %s %s: encode request: %w", method, path, err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return fmt.Errorf("backend %s %s: create request: %w", method, path, err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Secret", c.clientSecret)
	if input != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		log.Printf("backend http: request failed method=%s path=%s error=%v", method, path, err)
		return fmt.Errorf("backend %s %s: %w", method, path, err)
	}
	defer response.Body.Close()
	log.Printf("backend http: response method=%s path=%s status=%d", method, path, response.StatusCode)
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		data, readErr := io.ReadAll(io.LimitReader(response.Body, maxErrorBodyBytes))
		if readErr != nil {
			return fmt.Errorf("backend %s %s: read failure response: %w", method, path, readErr)
		}
		return &HTTPStatusError{StatusCode: response.StatusCode, Body: strings.TrimSpace(string(data))}
	}
	if output == nil || response.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(output); err != nil {
		return fmt.Errorf("backend %s %s: decode response: %w", method, path, err)
	}
	return nil
}

func (c *HTTPClient) resolve(path string) (string, error) {
	relative, err := url.Parse(path)
	if err != nil || relative.IsAbs() || !strings.HasPrefix(relative.Path, "/") {
		return "", fmt.Errorf("resolve backend path %q: path must be absolute and relative to backend", path)
	}
	return c.baseURL.ResolveReference(relative).String(), nil
}
