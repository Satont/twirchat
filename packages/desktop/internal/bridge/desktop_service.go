package bridge

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/Satont/twirchat/packages/desktop/internal/contracts"
	"github.com/wailsapp/wails/v3/pkg/application"
)

var ErrRequestUnavailable = errors.New("desktop request unavailable")

type requestUnavailableError struct {
	method contracts.RequestMethod
}

func (e requestUnavailableError) Error() string {
	return fmt.Sprintf(`desktop request %q is unavailable: service has not been ported`, e.method)
}

func (e requestUnavailableError) Unwrap() error {
	return ErrRequestUnavailable
}

// RequestHandler is registered by a later service port for one legacy request.
type RequestHandler func(context.Context, any) (any, error)

// HandlerRegistry is supplied to later service ports without becoming a Wails
// binding itself. It keeps the public Wails surface limited to Call.
type HandlerRegistry struct {
	handlers map[contracts.RequestMethod]RequestHandler
	mu       sync.RWMutex
}

func NewHandlerRegistry() *HandlerRegistry {
	return &HandlerRegistry{handlers: make(map[contracts.RequestMethod]RequestHandler)}
}

func (r *HandlerRegistry) Register(method contracts.RequestMethod, handler RequestHandler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.handlers[method] = handler
}

func (r *HandlerRegistry) get(method contracts.RequestMethod) (RequestHandler, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	handler, ok := r.handlers[method]
	return handler, ok
}

// DesktopService is the sole Wails binding surface for the restored Vue app.
type DesktopService struct {
	context  context.Context
	registry *HandlerRegistry
	mu       sync.RWMutex
}

func NewDesktopService(registry *HandlerRegistry) *DesktopService {
	return &DesktopService{
		context:  context.Background(),
		registry: registry,
	}
}

// ServiceStartup receives the Wails lifecycle context when the service is bound.
func (s *DesktopService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.context = ctx
	return nil
}

// Call dispatches the historical request envelope to a registered Go service.
func (s *DesktopService) Call(request contracts.GatewayRequest) (any, error) {
	s.mu.RLock()
	ctx := s.context
	s.mu.RUnlock()
	handler, ok := s.registry.get(request.Method)
	if !ok {
		return nil, requestUnavailableError{method: request.Method}
	}

	return handler(ctx, request.Params)
}

func (s *DesktopService) Capabilities() contracts.ApplicationCapabilities {
	return contracts.ApplicationCapabilities{Updates: false}
}
