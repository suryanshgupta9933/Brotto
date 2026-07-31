package tunnel

import (
	"encoding/json"
	"errors"
	"sync"

	"github.com/fara15/cdp-relay/internal/protocol"
	"github.com/fara15/cdp-relay/internal/ratelimit"
)

// FrameType represents the type of CDP frame
type FrameType string

const (
	FrameTypeCommand  FrameType = "command"
	FrameTypeResponse FrameType = "response"
	FrameTypeEvent    FrameType = "event"
)

// CDPFrame represents a Chrome DevTools Protocol frame
type CDPFrame struct {
	ID     float64            `json:"id,omitempty"`
	Method string             `json:"method,omitempty"`
	Params map[string]any     `json:"params,omitempty"`
	Result map[string]any     `json:"result,omitempty"`
	Error  *protocol.CDPError `json:"error,omitempty"`
	Session string            `json:"session,omitempty"`
}

// Channel represents a CDP tunnel channel
type Channel struct {
	ID            string
	SessionID     string
	Type          string // "cdp", "artifact", "control"
	upstream      UpstreamConn
	downstream    DownstreamConn
	seqTracker    *protocol.Tracker
	rateLimiter   *ratelimit.SessionLimiter
	mu            sync.RWMutex
	isOpen        bool
	isBackpressured bool
}

// UpstreamConn represents a connection to the browser/CDP endpoint
type UpstreamConn interface {
	SendFrame(frame *CDPFrame) error
	Close() error
	IsConnected() bool
}

// DownstreamConn represents a connection to the client
type DownstreamConn interface {
	SendMessage(msg *protocol.RelayMessage) error
	Close() error
	IsConnected() bool
}

// Manager manages tunnel channels
type Manager struct {
	channels       map[string]*Channel
	upstreamFactory UpstreamFactory
	seqTracker     *protocol.Tracker
	rateLimiter    *ratelimit.SessionLimiter
	mu             sync.RWMutex
}

// UpstreamFactory creates upstream connections
type UpstreamFactory interface {
	CreateConnection(sessionID, channelID string, target string) (UpstreamConn, error)
}

// DefaultUpstreamFactory is a simple factory for testing
type DefaultUpstreamFactory struct{}

// CreateConnection creates a connection (placeholder interface)
func (f *DefaultUpstreamFactory) CreateConnection(sessionID, channelID string, target string) (UpstreamConn, error) {
	return nil, errors.New("upstream factory not configured")
}

// NewManager creates a new tunnel manager
func NewManager() *Manager {
	return &Manager{
		channels:    make(map[string]*Channel),
		seqTracker:  protocol.NewTracker(),
		rateLimiter: ratelimit.NewSessionLimiter(ratelimit.DefaultConfig()),
	}
}

// SetUpstreamFactory sets the upstream connection factory
func (m *Manager) SetUpstreamFactory(factory UpstreamFactory) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.upstreamFactory = factory
}

// CreateChannel creates a new tunnel channel
func (m *Manager) CreateChannel(sessionID, channelID, channelType string) (*Channel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check if channel already exists
	if _, exists := m.channels[channelID]; exists {
		return nil, errors.New("channel already exists")
	}

	channel := &Channel{
		ID:          channelID,
		SessionID:   sessionID,
		Type:        channelType,
		seqTracker:  m.seqTracker,
		rateLimiter: m.rateLimiter,
		isOpen:      true,
	}

	m.channels[channelID] = channel
	return channel, nil
}

// GetChannel retrieves a channel by ID
func (m *Manager) GetChannel(channelID string) *Channel {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.channels[channelID]
}

// CloseChannel closes and removes a channel
func (m *Manager) CloseChannel(channelID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	channel, exists := m.channels[channelID]
	if !exists {
		return errors.New("channel not found")
	}

	channel.mu.Lock()
	channel.isOpen = false
	if channel.upstream != nil {
		channel.upstream.Close()
	}
	if channel.downstream != nil {
		channel.downstream.Close()
	}
	channel.mu.Unlock()

	delete(m.channels, channelID)
	return nil
}

// CloseSessionChannels closes all channels for a session
func (m *Manager) CloseSessionChannels(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for channelID, channel := range m.channels {
		if channel.SessionID == sessionID {
			channel.mu.Lock()
			channel.isOpen = false
			if channel.upstream != nil {
				channel.upstream.Close()
			}
			if channel.downstream != nil {
				channel.downstream.Close()
			}
			channel.mu.Unlock()
			delete(m.channels, channelID)
		}
	}
	return nil
}

// SetUpstream sets the upstream connection for a channel
func (c *Channel) SetUpstream(conn UpstreamConn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.upstream = conn
}

// SetDownstream sets the downstream connection for a channel
func (c *Channel) SetDownstream(conn DownstreamConn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.downstream = conn
}

// IsOpen returns whether the channel is open
func (c *Channel) IsOpen() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.isOpen
}

// IsBackpressured returns whether the channel is in backpressure state
func (c *Channel) IsBackpressured() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.isBackpressured
}

// SetBackpressure sets the backpressure state
func (c *Channel) SetBackpressure(backpressured bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.isBackpressured = backpressured
}

// ForwardUpstreamToDownstream forwards a frame from upstream to downstream
func (c *Channel) ForwardUpstreamToDownstream(frame *CDPFrame) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if !c.isOpen || c.downstream == nil {
		return errors.New("channel is not open")
	}

	// Create relay message from CDP frame
	msg := &protocol.RelayMessage{
		ProtocolVersion: protocol.ProtocolVersion,
		SessionID:       c.SessionID,
		ChannelID:       c.ID,
		MessageType:     protocol.MessageTypeCDPFrame,
		Expiry:          0, // Set by caller
		Payload:         frame,
	}

	return c.downstream.SendMessage(msg)
}

// ForwardDownstreamToUpstream forwards a frame from downstream to upstream
func (c *Channel) ForwardDownstreamToUpstream(frame *CDPFrame) error {
	c.mu.RLock()
	defer c.mu.RUnlock()

	if !c.isOpen || c.upstream == nil {
		return errors.New("channel is not open")
	}

	return c.upstream.SendFrame(frame)
}

// ParseCDPFrame parses a raw payload into a CDPFrame
func ParseCDPFrame(data any) (*CDPFrame, error) {
	switch v := data.(type) {
	case *CDPFrame:
		return v, nil
	case map[string]any:
		jsonData, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		var frame CDPFrame
		if err := json.Unmarshal(jsonData, &frame); err != nil {
			return nil, err
		}
		return &frame, nil
	case string:
		var frame CDPFrame
		if err := json.Unmarshal([]byte(v), &frame); err != nil {
			return nil, err
		}
		return &frame, nil
	default:
		return nil, errors.New("invalid CDP frame format")
	}
}

// DetermineFrameType determines the type of CDP frame
func DetermineFrameType(frame *CDPFrame) FrameType {
	if frame.ID != 0 {
		if frame.Result != nil || frame.Error != nil {
			return FrameTypeResponse
		}
		return FrameTypeCommand
	}
	return FrameTypeEvent
}
