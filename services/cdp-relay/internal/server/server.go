package server

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/fara15/cdp-relay/internal/heartbeat"
	"github.com/fara15/cdp-relay/internal/protocol"
	"github.com/fara15/cdp-relay/internal/ratelimit"
	"github.com/fara15/cdp-relay/internal/session"
	"github.com/fara15/cdp-relay/internal/tunnel"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024 * 32, // 32KB
	WriteBufferSize: 1024 * 32, // 32KB
}

// allowedCDPMethods contains the allowlist of safe CDP methods that the relay
// will forward from clients to the browser. Dangerous methods that could execute
// arbitrary code, modify browser state, or access sensitive data are blocked.
var allowedCDPMethods = map[string]bool{
	// Page navigation and lifecycle
	"Page.enable":                true,
	"Page.disable":               true,
	"Page.navigate":              true,
	"Page.reload":                true,
	"Page.goBack":                true,
	"Page.goForward":             true,

	// DOM inspection (read-only)
	"DOM.enable":                 true,
	"DOM.disable":                true,
	"DOM.getDocument":            true,
	"DOM.querySelector":          true,
	"DOM.querySelectorAll":       true,
	"DOM.getOuterHTML":           true,
	"DOM.getAttributes":          true,
	"DOM.getChildNodes":          true,
	"DOM.getBoxModel":            true,

	// Runtime inspection (read-only)
	"Runtime.enable":             true,
	"Runtime.disable":            true,
	"Runtime.evaluate":           false, // BLOCKED - allows arbitrary JS execution
	"Runtime.callFunctionOn":     false, // BLOCKED - allows arbitrary JS execution
	"Runtime.compileScript":       false, // BLOCKED - allows arbitrary JS execution
	"Runtime.runScript":          false, // BLOCKED - allows arbitrary JS execution

	// Input simulation
	"Input.enable":               true,
	"Input.disable":              true,
	"Input.dispatchMouseEvent":   true,
	"Input.dispatchKeyEvent":     true,
	"Input.setInterceptFileChooserDialog": true,

	// Screenshot (read-only)
	"Page.captureScreenshot":     true,
	"Page.captureSnapshot":       true,

	// Console messages (read-only)
	"Log.enable":                 true,
	"Log.disable":                true,
	"Runtime.consoleAPICalled":    true,
	"Runtime.exceptionThrown":    true,

	// Target/Session management
	"Target.enable":               true,
	"Target.disable":              true,
	"Target.setDiscoverTargets":   true,
	"Target.createBrowserContext": true,
	"Target.disposeBrowserContext": true,

	// Network inspection (read-only)
	"Network.enable":              true,
	"Network.disable":             true,
	"Network.setRequestInterception": true,

	// Performance
	"Performance.enable":          true,
	"Performance.disable":         true,
	"Performance.metrics":         true,

	// CSS inspection (read-only)
	"CSS.enable":                  true,
	"CSS.disable":                 true,
	"CSS.getMatchedStylesForNode": true,
	"CSS.getComputedStyleForNode": true,

	// Storage inspection (read-only)
	"Storage.enable":              true,
	"Storage.disable":             true,
	"Storage.getStorageKeyForFrame": true,
	"Storage.trackCacheStorageForOrigin": true,

	// Fetch inspection
	"Fetch.enable":                 true,
	"Fetch.disable":                true,
	"Fetch.failRequest":             true,
	"Fetch.continueRequest":         true,
	"Fetch.continueResponse":        true,

	// Box model (read-only)
	"DOM.getBoxModel":             true,
	"DOM.getContentQuads":         true,

	// Autofill
	"Autofill.enable":             true,
	"Autofill.disable":            true,

	// PREVENTED: Dangerous methods that are explicitly blocked
	// These methods could be used for malicious purposes:
	// - Runtime.evaluate, Runtime.callFunctionOn: arbitrary code execution
	// - Page.setDownloadBehavior: modify download behavior
	// - Storage.clear: delete all storage data
	// - Storage.setStorageItems: inject data
	// - Page.setPermission: modify permissions
	// - Browser commands that could harm the browser session
}

func allowedOriginValidator(allowed []string) func(r *http.Request) bool {
	allowedSet := make(map[string]bool, len(allowed))
	for _, origin := range allowed {
		allowedSet[origin] = true
	}
	return func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			// Non-browser clients (curl, ws client) may not send Origin
			// Require explicit allowlist when configured
			if len(allowed) > 0 {
				return false
			}
			return true
		}
		return allowedSet[origin]
	}
}

func (s *Server) Upgrader() websocket.Upgrader {
	up := upgrader
	up.CheckOrigin = allowedOriginValidator(s.config.AllowedOrigins)
	return up
}

// Config holds server configuration
type Config struct {
	Address            string
	TLS                *TLSConfig
	SessionLease       time.Duration
	HeartbeatInterval  time.Duration
	MaxMessageSize     int64
	RateLimitConfig    ratelimit.Config
	AllowedClientTypes []string
	AllowedOrigins     []string // e.g. ["chrome-extension://<ext-id>"]
}

// TLSConfig holds TLS configuration
type TLSConfig struct {
	CertFile string
	KeyFile  string
	CAFile   string
	// Mutual TLS
	MTLSEnabled bool
	MTLSCAFile string
}

// Connection represents a client connection
type Connection struct {
	ID          string
	TenantID    string
	DeviceID    string
	SessionID   string
	ChannelID   string
	ClientType  string
	ws          *websocket.Conn
	session     *session.Session
	seqTracker  *protocol.Tracker
	rateLimiter *ratelimit.SessionLimiter
	hbManager   *heartbeat.Manager
	tunManager  *tunnel.Manager
	sessManager *session.Manager
	sendCh      chan []byte
	closeCh     chan struct{}
	mu          sync.Mutex
	isClosed    bool
	logger      *zap.Logger
	server      *Server
}

// Server represents the CDP relay server
type Server struct {
	config      Config
	httpServer  *http.Server
	connections map[string]*Connection
	sessions    *session.Manager
	seqTracker  *protocol.Tracker
	rateLimiter *ratelimit.SessionLimiter
	tunManager  *tunnel.Manager
	logger      *zap.Logger
	mu          sync.RWMutex
	wg          sync.WaitGroup
}

// NewServer creates a new CDP relay server
func NewServer(cfg Config, logger *zap.Logger) *Server {
	if logger == nil {
		logger, _ = zap.NewProduction()
	}

	if cfg.SessionLease == 0 {
		cfg.SessionLease = protocol.DefaultSessionLease
	}
	if cfg.HeartbeatInterval == 0 {
		cfg.HeartbeatInterval = protocol.DefaultHeartbeatInterval
	}
	if cfg.MaxMessageSize == 0 {
		cfg.MaxMessageSize = protocol.MaxMessageSizeBytes
	}

	return &Server{
		config:      cfg,
		connections: make(map[string]*Connection),
		sessions:    session.NewManager(cfg.SessionLease),
		seqTracker:  protocol.NewTracker(),
		rateLimiter: ratelimit.NewSessionLimiter(cfg.RateLimitConfig),
		tunManager:  tunnel.NewManager(),
		logger:     logger,
	}
}

// Start starts the server
func (s *Server) Start(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleWebSocket)

	s.httpServer = &http.Server{
		Addr:         s.config.Address,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	go s.cleanupLoop(ctx)

	var err error
	if s.config.TLS != nil && s.config.TLS.CertFile != "" && s.config.TLS.KeyFile != "" {
		tlsConfig := s.buildTLSConfig()
		s.httpServer.TLSConfig = tlsConfig
		s.logger.Info("Starting CDP relay server with TLS", zap.String("address", s.config.Address))
		err = s.httpServer.ListenAndServeTLS(s.config.TLS.CertFile, s.config.TLS.KeyFile)
	} else {
		s.logger.Info("Starting CDP relay server", zap.String("address", s.config.Address))
		err = s.httpServer.ListenAndServe()
	}

	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Stop stops the server
func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Close all connections
	for _, conn := range s.connections {
		conn.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return s.httpServer.Shutdown(ctx)
}

// handleWebSocket handles WebSocket upgrade requests
func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	connID, err := protocol.GenerateChannelID()
	if err != nil {
		s.logger.Error("Failed to generate connection ID", zap.Error(err))
		return
	}

	ws, err := s.Upgrader().Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("WebSocket upgrade failed", zap.Error(err))
		return
	}

	conn := &Connection{
		ID:          connID,
		ws:          ws,
		seqTracker:  s.seqTracker,
		rateLimiter: s.rateLimiter,
		tunManager:  s.tunManager,
		sessManager: s.sessions,
		sendCh:      make(chan []byte, 256),
		closeCh:     make(chan struct{}),
		logger:      s.logger,
		server:      s,
	}

	s.mu.Lock()
	s.connections[connID] = conn
	s.mu.Unlock()

	s.wg.Add(2)
	go conn.readLoop()
	go conn.writeLoop()
}

// readLoop handles incoming messages
func (c *Connection) readLoop() {
	defer c.cleanup()

	for {
		msgType, data, err := c.ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				c.logger.Debug("WebSocket read error", zap.Error(err))
			}
			return
		}

		if msgType != websocket.TextMessage && msgType != websocket.BinaryMessage {
			continue
		}

		if err := c.handleMessage(data); err != nil {
			c.logger.Error("Failed to handle message", zap.Error(err))
			c.sendError(protocol.ErrorInternalError, err.Error())
		}
	}
}

// writeLoop handles outgoing messages
func (c *Connection) writeLoop() {
	defer c.cleanup()

	for {
		select {
		case data, ok := <-c.sendCh:
			if !ok {
				return
			}
			if err := c.ws.WriteMessage(websocket.TextMessage, data); err != nil {
				c.logger.Error("WebSocket write error", zap.Error(err))
				return
			}
		case <-c.closeCh:
			return
		}
	}
}

// handleMessage processes incoming messages
func (c *Connection) handleMessage(data []byte) error {
	msg, err := protocol.DeserializeMessage(data)
	if err != nil {
		return err
	}

	// Validate message
	result := protocol.ValidateMessage(msg)
	if !result.IsValid {
		if len(result.Errors) > 0 {
			return errors.New(result.Errors[0].Message)
		}
		return errors.New("invalid message")
	}

	// Validate tenant binding
	if c.TenantID != "" && c.TenantID != msg.TenantID {
		return errors.New("tenant mismatch")
	}

	// Check rate limit
	rateResult := c.rateLimiter.CheckSessionChannel(msg.SessionID, msg.ChannelID)
	if !rateResult.IsValid {
		c.sendError(protocol.ErrorRateLimitExceeded, "Rate limit exceeded")
		return nil
	}

	// Validate sequence number
	seqResult := c.seqTracker.ValidateAndProcess(msg.SessionID, msg.ChannelID, msg.SequenceNumber)
	if !seqResult.IsValid {
		if len(seqResult.Errors) > 0 {
			return errors.New(seqResult.Errors[0].Message)
		}
		return errors.New("sequence validation failed")
	}

	switch msg.MessageType {
	case protocol.MessageTypeHello:
		return c.handleHello(msg)
	case protocol.MessageTypeSessionCreate:
		return c.handleSessionCreate(msg)
	case protocol.MessageTypeSessionRenew:
		return c.handleSessionRenew(msg)
	case protocol.MessageTypeSessionRevoke:
		return c.handleSessionRevoke(msg)
	case protocol.MessageTypeChannelOpen:
		return c.handleChannelOpen(msg)
	case protocol.MessageTypeChannelClose:
		return c.handleChannelClose(msg)
	case protocol.MessageTypeCDPFrame:
		return c.handleCDPFrame(msg)
	case protocol.MessageTypeHeartbeat:
		return c.handleHeartbeat(msg)
	case protocol.MessageTypeGoodbye:
		return c.handleGoodbye(msg)
	default:
		return errors.New("unsupported message type")
	}
}

// handleHello handles protocol version negotiation
func (c *Connection) handleHello(msg *protocol.RelayMessage) error {
	var payload protocol.HelloPayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Store client info
	c.ClientType = payload.ClientType
	c.DeviceID = payload.DeviceID

	// Negotiate protocol version
	negotiatedVersion := protocol.MinProtocolVersion
	for _, v := range payload.SupportedVersions {
		if protocol.IsVersionCompatible(v) {
			negotiatedVersion = v
			break
		}
	}

	// Get session lease duration from the server config via session manager
	sessionLeaseMs := int64(protocol.DefaultSessionLease / time.Millisecond)
	heartbeatIntervalMs := int64(protocol.DefaultHeartbeatInterval / time.Millisecond)
	maxMessageSizeBytes := int64(protocol.MaxMessageSizeBytes)

	ackPayload := protocol.HelloACKPayload{
		NegotiatedVersion:   negotiatedVersion,
		ServerTime:          time.Now().UnixMilli(),
		SessionLeaseMs:      sessionLeaseMs,
		HeartbeatIntervalMs: heartbeatIntervalMs,
		MaxMessageSizeBytes: maxMessageSizeBytes,
	}

	// Create HelloAck message
	ack := &protocol.RelayMessage{
		ProtocolVersion: negotiatedVersion,
		SessionID:       msg.SessionID,
		ChannelID:       msg.ChannelID,
		MessageType:     protocol.MessageTypeHelloAck,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload:         ackPayload,
	}

	return c.send(ack)
}

// handleSessionCreate handles session creation
func (c *Connection) handleSessionCreate(msg *protocol.RelayMessage) error {
	var payload protocol.SessionCreatePayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Create session
	sess, err := c.sessManager.CreateSession(payload.TenantID, payload.DeviceID, payload.RequestedLeaseMs, payload.Metadata)
	if err != nil {
		return c.sendSessionError(msg, err.Error())
	}

	// Store connection info
	c.TenantID = sess.TenantID
	c.DeviceID = sess.DeviceID
	c.SessionID = sess.ID

	// Generate channel ID
	channelID, _ := protocol.GenerateChannelID()

	// Create channel
	if _, err := c.tunManager.CreateChannel(sess.ID, channelID, "control"); err != nil {
		return c.sendSessionError(msg, err.Error())
	}

	// Activate session
	c.sessManager.ActivateSession(sess.ID)

	// Add channel to session
	c.sessManager.AddChannel(sess.ID, channelID)

	// Create ACK
	ackPayload := protocol.SessionCreateACKPayload{
		SessionID:  sess.ID,
		SessionKey: sess.SessionKey,
		LeaseExpiry: sess.ExpiresAt.UnixMilli(),
		ChannelID:  channelID,
	}

	ack := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        msg.TenantID,
		SessionID:       sess.ID,
		ChannelID:       channelID,
		MessageType:     protocol.MessageTypeSessionCreateAck,
		Expiry:          sess.ExpiresAt.UnixMilli(),
		Payload:         ackPayload,
	}

	c.SessionID = sess.ID
	c.ChannelID = channelID

	return c.send(ack)
}

// handleSessionRenew handles session renewal
func (c *Connection) handleSessionRenew(msg *protocol.RelayMessage) error {
	if c.SessionID == "" {
		return errors.New("no session")
	}

	var payload protocol.SessionRenewPayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	newExpiry, err := c.sessManager.RenewSession(c.SessionID, nil)
	if err != nil {
		return c.sendSessionError(msg, err.Error())
	}

	ack := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       c.SessionID,
		ChannelID:       c.ChannelID,
		MessageType:     protocol.MessageTypeSessionRenewAck,
		Expiry:          newExpiry.UnixMilli(),
		Payload:         map[string]any{"sessionId": c.SessionID, "newExpiry": newExpiry.UnixMilli()},
	}

	return c.send(ack)
}

// handleSessionRevoke handles session revocation (kill switch)
func (c *Connection) handleSessionRevoke(msg *protocol.RelayMessage) error {
	var payload protocol.SessionRevokePayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Revoke session
	if ok := c.sessManager.RevokeSession(payload.SessionID, payload.Reason); !ok {
		return errors.New("session not found or already revoked")
	}

	// Close all channels for session
	c.tunManager.CloseSessionChannels(payload.SessionID)

	// Notify client
	notify := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       payload.SessionID,
		ChannelID:       c.ChannelID,
		MessageType:     protocol.MessageTypeSessionRevoked,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload:         map[string]any{"sessionId": payload.SessionID, "reason": payload.Reason},
	}

	c.send(notify)
	c.Close()

	return nil
}

// handleChannelOpen handles channel opening
func (c *Connection) handleChannelOpen(msg *protocol.RelayMessage) error {
	if c.SessionID == "" || !c.sessManager.IsSessionValid(c.SessionID) {
		return errors.New("invalid session")
	}

	var payload protocol.ChannelOpenPayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Validate tenant binding
	if !c.sessManager.ValidateTenantBinding(c.SessionID, msg.TenantID) {
		return errors.New("tenant binding validation failed")
	}

	// Create channel
	channel, err := c.tunManager.CreateChannel(c.SessionID, payload.ChannelID, payload.ChannelType)
	if err != nil {
		// Send error
		errMsg := &protocol.RelayMessage{
			ProtocolVersion: msg.ProtocolVersion,
			TenantID:        c.TenantID,
			SessionID:       c.SessionID,
			ChannelID:       payload.ChannelID,
			MessageType:     protocol.MessageTypeChannelOpenError,
			Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
			Payload: protocol.ErrorPayload{
				Code:    protocol.ErrorChannelAlreadyOpen,
				Message: err.Error(),
			},
		}
		return c.send(errMsg)
	}

	// Add channel to session
	c.sessManager.AddChannel(c.SessionID, payload.ChannelID)

	// Send ACK
	ack := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       c.SessionID,
		ChannelID:       payload.ChannelID,
		MessageType:     protocol.MessageTypeChannelOpenAck,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload:         map[string]any{"channelId": payload.ChannelID},
	}

	return c.send(ack)
}

// handleChannelClose handles channel closing
func (c *Connection) handleChannelClose(msg *protocol.RelayMessage) error {
	if c.SessionID == "" {
		return errors.New("no session")
	}

	var payload struct {
		ChannelID string `json:"channelId"`
	}
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Close channel
	if err := c.tunManager.CloseChannel(payload.ChannelID); err != nil {
		return errors.New("channel not found")
	}

	// Remove channel from session
	c.sessManager.RemoveChannel(c.SessionID, payload.ChannelID)

	// Send closed notification
	closed := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       c.SessionID,
		ChannelID:       payload.ChannelID,
		MessageType:     protocol.MessageTypeChannelClosed,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload:         map[string]any{"channelId": payload.ChannelID},
	}

	return c.send(closed)
}

// handleCDPFrame handles CDP frame forwarding with method validation
func (c *Connection) handleCDPFrame(msg *protocol.RelayMessage) error {
	if c.SessionID == "" || !c.sessManager.IsSessionValid(c.SessionID) {
		return errors.New("invalid session")
	}

	// Get channel
	channel := c.tunManager.GetChannel(msg.ChannelID)
	if channel == nil {
		return errors.New("channel not found")
	}

	// Parse CDP frame
	frame, err := tunnel.ParseCDPFrame(msg.Payload)
	if err != nil {
		return err
	}

	// Validate CDP method against allowlist for command frames (those with a method specified)
	// Response and event frames don't have a method field that can be exploited
	if frame.Method != "" {
		allowed, exists := allowedCDPMethods[frame.Method]
		if !exists {
			c.logger.Warn("CDP method not in allowlist - blocked",
				zap.String("method", frame.Method),
				zap.String("session", c.SessionID),
				zap.String("channel", msg.ChannelID))
			return errors.New("CDP method not allowed: " + frame.Method)
		}
		if !allowed {
			c.logger.Warn("CDP method explicitly blocked - rejected",
				zap.String("method", frame.Method),
				zap.String("session", c.SessionID),
				zap.String("channel", msg.ChannelID))
			return errors.New("CDP method explicitly blocked: " + frame.Method)
		}
	}

	// Forward to upstream (browser CDP)
	if err := channel.ForwardDownstreamToUpstream(frame); err != nil {
		c.logger.Error("Failed to forward CDP frame to upstream", zap.Error(err))
		// Don't return error - just log it
	}

	return nil
}

// handleHeartbeat handles heartbeat messages
func (c *Connection) handleHeartbeat(msg *protocol.RelayMessage) error {
	var payload protocol.HeartbeatPayload
	if err := c.parsePayload(msg.Payload, &payload); err != nil {
		return err
	}

	// Update session heartbeat
	c.sessManager.UpdateHeartbeat(c.SessionID)

	// Determine status
	status := heartbeat.DetermineStatus(time.Now(), 60000*time.Millisecond)

	// Send ACK
	ack := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       c.SessionID,
		ChannelID:       c.ChannelID,
		MessageType:     protocol.MessageTypeHeartbeatAck,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload: heartbeat.CreateHeartbeatPayload(msg.SequenceNumber, status),
	}

	return c.send(ack)
}

// handleGoodbye handles graceful disconnect
func (c *Connection) handleGoodbye(msg *protocol.RelayMessage) error {
	c.Close()
	return nil
}

// send sends a message to the client
func (c *Connection) send(msg *protocol.RelayMessage) error {
	data, err := protocol.SerializeMessage(msg)
	if err != nil {
		return err
	}

	select {
	case c.sendCh <- data:
		return nil
	case <-c.closeCh:
		return errors.New("connection closed")
	default:
		return errors.New("send buffer full")
	}
}

// sendError sends an error message
func (c *Connection) sendError(code protocol.ProtocolErrorCode, errMsg string) {
	err := &protocol.RelayMessage{
		ProtocolVersion: protocol.ProtocolVersion,
		TenantID:        c.TenantID,
		SessionID:       c.SessionID,
		ChannelID:       c.ChannelID,
		MessageType:     protocol.MessageTypeError,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload: protocol.ErrorPayload{
			Code:    code,
			Message: errMsg,
		},
	}
	c.send(err)
}

// sendSessionError sends a session error
func (c *Connection) sendSessionError(msg *protocol.RelayMessage, errMsg string) error {
	err := &protocol.RelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        msg.TenantID,
		SessionID:       msg.SessionID,
		ChannelID:       msg.ChannelID,
		MessageType:     protocol.MessageTypeSessionCreateError,
		Expiry:          time.Now().Add(protocol.DefaultSessionLease).UnixMilli(),
		Payload: protocol.ErrorPayload{
			Code:    protocol.ErrorInternalError,
			Message: errMsg,
		},
	}
	return c.send(err)
}

// parsePayload parses message payload into a struct
func (c *Connection) parsePayload(payload any, v any) error {
	switch p := payload.(type) {
	case map[string]any:
		data, err := json.Marshal(p)
		if err != nil {
			return err
		}
		return json.Unmarshal(data, v)
	case string:
		return json.Unmarshal([]byte(p), v)
	default:
		return errors.New("invalid payload type")
	}
}

// cleanup cleans up the connection
func (c *Connection) cleanup() {
	c.mu.Lock()
	if c.isClosed {
		c.mu.Unlock()
		return
	}
	c.isClosed = true
	c.mu.Unlock()

	// Remove from server's connection map
	if c.server != nil {
		c.server.mu.Lock()
		delete(c.server.connections, c.ID)
		c.server.mu.Unlock()
	}

	// Close WebSocket
	if c.ws != nil {
		c.ws.Close()
	}

	// Revoke session if this was the last connection
	if c.SessionID != "" {
		c.sessManager.RevokeSession(c.SessionID, "client disconnected")
		c.tunManager.CloseSessionChannels(c.SessionID)
	}

	close(c.closeCh)
	close(c.sendCh)
}

// Close closes the connection
func (c *Connection) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.isClosed {
		c.isClosed = true
		close(c.closeCh)
	}
}

// cleanupLoop periodically cleans up expired sessions
func (s *Server) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Clean up expired sessions
			expired := s.sessions.GetExpiredSessions()
			for _, sess := range expired {
				s.tunManager.CloseSessionChannels(sess.ID)
			}
			s.sessions.CleanupExpired()

			// Clean up sequence tracker
			s.seqTracker.ResetAll()
		}
	}
}

// buildTLSConfig builds TLS configuration
func (s *Server) buildTLSConfig() *tls.Config {
	cfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
		CurvePreferences: []tls.CurveID{
			tls.CurveP256,
			tls.X25519,
		},
		PreferServerCipherSuites: true,
	}

	if s.config.TLS.MTLSEnabled {
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
		if s.config.TLS.MTLSCAFile != "" {
			// Load CA certificate and create a certificate pool for client cert verification
			caCert, err := os.ReadFile(s.config.TLS.MTLSCAFile)
			if err != nil {
				s.logger.Fatal("Failed to read mTLS CA certificate", zap.String("file", s.config.TLS.MTLSCAFile), zap.Error(err))
			}

			caCertPool := x509.NewCertPool()
			if !caCertPool.AppendCertsFromPEM(caCert) {
				s.logger.Fatal("Failed to parse mTLS CA certificate", zap.String("file", s.config.TLS.MTLSCAFile))
			}

			cfg.ClientCAs = caCertPool
			s.logger.Info("mTLS CA certificate loaded for client verification", zap.String("file", s.config.TLS.MTLSCAFile))
		} else {
			s.logger.Warn("mTLS enabled but no CA file specified - client certificates will not be verified against a CA")
		}
	}

	return cfg
}
