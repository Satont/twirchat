package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Satont/twirchat/packages/desktop/internal/backend"
	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/Satont/twirchat/packages/desktop/internal/storage"
)

const defaultSessionTTL = 10 * time.Minute

// Browser opens OAuth authorization URLs outside the desktop webview.
type Browser interface {
	OpenURL(string) error
}

// BrowserFunc adapts a function to Browser for the Wails composition root.
type BrowserFunc func(string) error

func (open BrowserFunc) OpenURL(url string) error { return open(url) }

// IdentityResolver obtains stable account metadata for exchanged provider tokens.
type IdentityResolver interface {
	Resolve(context.Context, contracts.Platform, string, []string) (contracts.Account, error)
}

// Config declares the OAuth dependencies owned by the desktop runtime.
type Config struct {
	Address          string
	CallbackHost     string
	Backend          *backend.HTTPClient
	Browser          Browser
	IdentityResolver IdentityResolver
	SessionTTL       time.Duration
	Storage          *storage.Storage
	Events           Events
}

// Events forwards OAuth state changes to the Wails bridge.
type Events struct {
	OnAuthURL     func(contracts.AuthURL)
	OnAuthSuccess func(contracts.AuthSuccess)
	OnAuthError   func(contracts.AuthError)
}

type session struct {
	platform     contracts.Platform
	codeVerifier string
	expiresAt    time.Time
}

// Service owns short-lived PKCE sessions and its local loopback callback HTTP server.
type Service struct {
	address          string
	callbackHost     string
	backend          *backend.HTTPClient
	browser          Browser
	identityResolver IdentityResolver
	sessionTTL       time.Duration
	storage          *storage.Storage
	events           Events

	mu       sync.Mutex
	listener net.Listener
	server   *http.Server
	sessions map[string]session
}

func NewService(config Config) (*Service, error) {
	if config.Address == "" {
		return nil, errors.New("create auth service: callback address is required")
	}
	if config.Backend == nil {
		return nil, errors.New("create auth service: backend client is required")
	}
	if config.Browser == nil {
		return nil, errors.New("create auth service: browser is required")
	}
	if config.IdentityResolver == nil {
		return nil, errors.New("create auth service: identity resolver is required")
	}
	if config.Storage == nil {
		return nil, errors.New("create auth service: storage is required")
	}
	if config.SessionTTL <= 0 {
		config.SessionTTL = defaultSessionTTL
	}
	return &Service{
		address:          config.Address,
		callbackHost:     config.CallbackHost,
		backend:          config.Backend,
		browser:          config.Browser,
		identityResolver: config.IdentityResolver,
		sessionTTL:       config.SessionTTL,
		storage:          config.Storage,
		events:           config.Events,
		sessions:         make(map[string]session),
	}, nil
}

// Start begins serving local callbacks. It is safe to call from an app service lifecycle.
func (s *Service) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("start auth callback server: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener != nil {
		return errors.New("start auth callback server: already started")
	}
	listener, err := net.Listen("tcp", s.address)
	if err != nil {
		return fmt.Errorf("start auth callback server: listen on %s: %w", s.address, err)
	}
	server := &http.Server{Handler: http.HandlerFunc(s.handleCallback)}
	s.listener = listener
	s.server = server
	go func() {
		_ = server.Serve(listener)
	}()
	return nil
}

// Stop closes the local callback server and clears one-time PKCE sessions.
func (s *Service) Stop(ctx context.Context) error {
	s.mu.Lock()
	server := s.server
	s.server = nil
	s.listener = nil
	s.sessions = make(map[string]session)
	s.mu.Unlock()
	if server == nil {
		return nil
	}
	if err := server.Shutdown(ctx); err != nil {
		return fmt.Errorf("stop auth callback server: %w", err)
	}
	return nil
}

// Begin creates a short-lived PKCE session, requests the backend authorization URL, and opens it.
func (s *Service) Begin(ctx context.Context, platform contracts.Platform) error {
	endpoint, err := authEndpoint(platform, "start")
	if err != nil {
		return err
	}
	codeVerifier, err := newPKCEVerifier()
	if err != nil {
		return err
	}
	state, err := newState()
	if err != nil {
		return err
	}
	redirectURI := s.CallbackURL(platform)
	if redirectURI == "" {
		return errors.New("begin OAuth: callback server is not started")
	}
	s.mu.Lock()
	s.removeExpiredLocked(time.Now())
	s.sessions[state] = session{platform: platform, codeVerifier: codeVerifier, expiresAt: time.Now().Add(s.sessionTTL)}
	s.mu.Unlock()

	var response struct {
		URL string `json:"url"`
	}
	request := struct {
		CodeChallenge string `json:"codeChallenge"`
		State         string `json:"state"`
		RedirectURI   string `json:"redirectUri"`
	}{CodeChallenge: pkceChallenge(codeVerifier), State: state, RedirectURI: redirectURI}
	if err := s.backend.PostJSON(ctx, endpoint, request, &response); err != nil {
		s.consumeSession(state)
		return fmt.Errorf("begin OAuth for %s: %w", platform, err)
	}
	if response.URL == "" {
		s.consumeSession(state)
		return fmt.Errorf("begin OAuth for %s: backend returned an empty authorization URL", platform)
	}
	if s.events.OnAuthURL != nil {
		s.events.OnAuthURL(contracts.AuthURL{Platform: platform, URL: response.URL})
	}
	if err := s.browser.OpenURL(response.URL); err != nil {
		s.consumeSession(state)
		return fmt.Errorf("begin OAuth for %s: open authorization URL: %w", platform, err)
	}
	return nil
}

// Refresh exchanges a persisted refresh token through the backend and atomically
// replaces the account credentials while retaining its metadata.
func (s *Service) Refresh(ctx context.Context, accountID string) error {
	if accountID == "" {
		return errors.New("refresh OAuth token: account ID is required")
	}
	account, err := s.storage.AccountByID(ctx, accountID)
	if err != nil {
		return fmt.Errorf("refresh OAuth token: %w", err)
	}
	if account == nil {
		return fmt.Errorf("refresh OAuth token: account %q was not found", accountID)
	}
	current, found, err := s.storage.AccountTokens(ctx, accountID)
	if err != nil {
		return fmt.Errorf("refresh OAuth token: %w", err)
	}
	if !found || current.RefreshToken == nil || *current.RefreshToken == "" {
		return fmt.Errorf("refresh OAuth token: account %q has no refresh token", accountID)
	}
	endpoint, err := authEndpoint(account.Platform, "refresh")
	if err != nil {
		return err
	}
	var response tokenResponse
	if err := s.backend.PostJSON(ctx, endpoint, struct {
		RefreshToken string `json:"refreshToken"`
	}{RefreshToken: *current.RefreshToken}, &response); err != nil {
		return fmt.Errorf("refresh OAuth token: %w", err)
	}
	if response.AccessToken == "" {
		return errors.New("refresh OAuth token: backend returned an empty access token")
	}
	updated := storage.AccountTokens{AccessToken: response.AccessToken, RefreshToken: current.RefreshToken}
	if response.RefreshToken != "" {
		updated.RefreshToken = &response.RefreshToken
	}
	if response.ExpiresIn > 0 {
		expiresAt := time.Now().Add(time.Duration(response.ExpiresIn) * time.Second).Unix()
		updated.ExpiresAt = &expiresAt
	}
	if err := s.storage.UpdateAccountTokens(ctx, accountID, updated); err != nil {
		return fmt.Errorf("refresh OAuth token: persist credentials: %w", err)
	}
	return nil
}

// CallbackURL returns the active local callback endpoint for one platform.
func (s *Service) CallbackURL(platform contracts.Platform) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener == nil || !validPlatform(platform) {
		return ""
	}
	_, port, err := net.SplitHostPort(s.listener.Addr().String())
	if err != nil {
		return ""
	}
	host := s.callbackHost
	if host == "" {
		host, _, err = net.SplitHostPort(s.listener.Addr().String())
		if err != nil {
			return ""
		}
	}
	return "http://" + net.JoinHostPort(host, port) + "/auth/" + string(platform) + "/callback"
}

func (s *Service) handleCallback(writer http.ResponseWriter, request *http.Request) {
	platform, ok := callbackPlatform(request.URL.Path)
	if !ok {
		http.NotFound(writer, request)
		return
	}
	if request.Method != http.MethodGet {
		writer.Header().Set("Allow", http.MethodGet)
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if providerError := request.URL.Query().Get("error"); providerError != "" {
		http.Error(writer, "OAuth provider returned: "+providerError, http.StatusBadRequest)
		return
	}
	code, state := request.URL.Query().Get("code"), request.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(writer, "OAuth callback requires code and state", http.StatusBadRequest)
		return
	}
	session, err := s.takeSession(state, platform)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusBadRequest)
		return
	}
	account, err := s.complete(request.Context(), platform, code, session.codeVerifier)
	if err != nil {
		if s.events.OnAuthError != nil {
			s.events.OnAuthError(contracts.AuthError{Platform: platform, Error: err.Error()})
		}
		http.Error(writer, "OAuth callback failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if s.events.OnAuthSuccess != nil {
		s.events.OnAuthSuccess(contracts.AuthSuccess{
			Platform:    platform,
			Username:    account.Username,
			DisplayName: account.DisplayName,
		})
	}
	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = writer.Write([]byte(successPage(platform)))
}

func (s *Service) complete(
	ctx context.Context,
	platform contracts.Platform,
	code, codeVerifier string,
) (contracts.Account, error) {
	endpoint, err := authEndpoint(platform, "exchange")
	if err != nil {
		return contracts.Account{}, err
	}
	var response tokenResponse
	if err := s.backend.PostJSON(ctx, endpoint, struct {
		Code         string `json:"code"`
		CodeVerifier string `json:"codeVerifier"`
		RedirectURI  string `json:"redirectUri"`
	}{Code: code, CodeVerifier: codeVerifier, RedirectURI: s.CallbackURL(platform)}, &response); err != nil {
		return contracts.Account{}, fmt.Errorf("exchange OAuth code: %w", err)
	}
	if response.AccessToken == "" {
		return contracts.Account{}, errors.New("exchange OAuth code: backend returned an empty access token")
	}
	account, err := s.identityResolver.Resolve(ctx, platform, response.AccessToken, response.Scope)
	if err != nil {
		return contracts.Account{}, fmt.Errorf("resolve authenticated account: %w", err)
	}
	if account.Platform != platform || account.ID == "" || account.PlatformUserID == "" {
		return contracts.Account{}, errors.New("resolve authenticated account: returned an invalid account")
	}
	tokens := storage.AccountTokens{AccessToken: response.AccessToken}
	if response.RefreshToken != "" {
		tokens.RefreshToken = &response.RefreshToken
	}
	if response.ExpiresIn > 0 {
		expiresAt := time.Now().Add(time.Duration(response.ExpiresIn) * time.Second).Unix()
		tokens.ExpiresAt = &expiresAt
	}
	if err := s.storage.UpsertAccount(ctx, account, tokens); err != nil {
		return contracts.Account{}, fmt.Errorf("persist authenticated account: %w", err)
	}
	if err := s.storage.SaveChannel(ctx, platform, account.Username); err != nil {
		return contracts.Account{}, fmt.Errorf("persist authenticated channel: %w", err)
	}
	return account, nil
}

type tokenResponse struct {
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresIn    int64    `json:"expiresIn"`
	Scope        []string `json:"scope"`
}

func (s *Service) takeSession(state string, platform contracts.Platform) (session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	value, found := s.sessions[state]
	if !found || value.platform != platform {
		return session{}, errors.New("OAuth state is unknown or does not match the callback platform")
	}
	delete(s.sessions, state)
	if time.Now().After(value.expiresAt) {
		return session{}, errors.New("OAuth state has expired")
	}
	return value, nil
}

func (s *Service) consumeSession(state string) {
	s.mu.Lock()
	delete(s.sessions, state)
	s.mu.Unlock()
}

func (s *Service) removeExpiredLocked(now time.Time) {
	for state, value := range s.sessions {
		if now.After(value.expiresAt) {
			delete(s.sessions, state)
		}
	}
}

func authEndpoint(platform contracts.Platform, action string) (string, error) {
	if !validPlatform(platform) {
		return "", fmt.Errorf("OAuth %s: unsupported platform %q", action, platform)
	}
	return "/api/auth/" + string(platform) + "/" + action, nil
}

func callbackPlatform(path string) (contracts.Platform, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 3 || parts[0] != "auth" || parts[2] != "callback" {
		return "", false
	}
	platform := contracts.Platform(parts[1])
	return platform, validPlatform(platform)
}

func validPlatform(platform contracts.Platform) bool {
	return platform == contracts.PlatformTwitch || platform == contracts.PlatformKick || platform == contracts.PlatformYouTube
}

func successPage(platform contracts.Platform) string {
	return "<!doctype html><html><body><h1>Connected to " + string(platform) + "</h1><p>You can close this window and return to TwirChat.</p></body></html>"
}

// ProviderIdentityResolver calls the provider identity endpoint through its injected client.
// Platform-specific adapters can replace it with richer identity resolution later.
type ProviderIdentityResolver struct{ Client *http.Client }

func (r ProviderIdentityResolver) Resolve(
	ctx context.Context,
	platform contracts.Platform,
	accessToken string,
	scopes []string,
) (contracts.Account, error) {
	if r.Client == nil {
		r.Client = http.DefaultClient
	}
	switch platform {
	case contracts.PlatformTwitch:
		return r.resolveTwitch(ctx, accessToken, scopes)
	case contracts.PlatformKick:
		return r.resolveKick(ctx, accessToken, scopes)
	case contracts.PlatformYouTube:
		return r.resolveYouTube(ctx, accessToken, scopes)
	default:
		return contracts.Account{}, fmt.Errorf("resolve provider identity: unsupported platform %q", platform)
	}
}

func (r ProviderIdentityResolver) resolveTwitch(ctx context.Context, accessToken string, scopes []string) (contracts.Account, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://id.twitch.tv/oauth2/validate", nil)
	if err != nil {
		return contracts.Account{}, err
	}
	request.Header.Set("Authorization", "OAuth "+accessToken)
	response, err := r.Client.Do(request)
	if err != nil {
		return contracts.Account{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return contracts.Account{}, fmt.Errorf("validate Twitch token: HTTP %d", response.StatusCode)
	}
	var data struct {
		UserID string `json:"user_id"`
		Login  string `json:"login"`
	}
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return contracts.Account{}, err
	}
	if data.UserID == "" || data.Login == "" {
		return contracts.Account{}, errors.New("validate Twitch token: missing user identity")
	}
	return contracts.Account{ID: "twitch:" + data.UserID, Platform: contracts.PlatformTwitch, PlatformUserID: data.UserID, Username: data.Login, DisplayName: data.Login, Scopes: scopes}, nil
}

func (r ProviderIdentityResolver) resolveKick(ctx context.Context, accessToken string, scopes []string) (contracts.Account, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.kick.com/public/v1/users", nil)
	if err != nil {
		return contracts.Account{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := r.Client.Do(request)
	if err != nil {
		return contracts.Account{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return contracts.Account{}, fmt.Errorf("get Kick user: HTTP %d", response.StatusCode)
	}
	var data struct {
		Data []struct {
			UserID  int64  `json:"user_id"`
			Name    string `json:"name"`
			Picture string `json:"profile_picture"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return contracts.Account{}, err
	}
	if len(data.Data) != 1 || data.Data[0].Name == "" {
		return contracts.Account{}, errors.New("get Kick user: missing user identity")
	}
	user := data.Data[0]
	return contracts.Account{ID: fmt.Sprintf("kick:%d", user.UserID), Platform: contracts.PlatformKick, PlatformUserID: fmt.Sprint(user.UserID), Username: user.Name, DisplayName: user.Name, AvatarURL: user.Picture, Scopes: scopes}, nil
}

func (r ProviderIdentityResolver) resolveYouTube(ctx context.Context, accessToken string, scopes []string) (contracts.Account, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", nil)
	if err != nil {
		return contracts.Account{}, err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	response, err := r.Client.Do(request)
	if err != nil {
		return contracts.Account{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return contracts.Account{}, fmt.Errorf("get YouTube channel: HTTP %d", response.StatusCode)
	}
	var data struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title      string `json:"title"`
				CustomURL  string `json:"customUrl"`
				Thumbnails struct {
					Default struct {
						URL string `json:"url"`
					} `json:"default"`
				} `json:"thumbnails"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		return contracts.Account{}, err
	}
	if len(data.Items) != 1 || data.Items[0].ID == "" || data.Items[0].Snippet.Title == "" {
		return contracts.Account{}, errors.New("get YouTube channel: missing channel identity")
	}
	channel := data.Items[0]
	username := channel.Snippet.CustomURL
	if username == "" {
		username = channel.ID
	}
	return contracts.Account{ID: "youtube:" + channel.ID, Platform: contracts.PlatformYouTube, PlatformUserID: channel.ID, Username: username, DisplayName: channel.Snippet.Title, AvatarURL: channel.Snippet.Thumbnails.Default.URL, Scopes: scopes}, nil
}
