package protocol

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Protocol constants
const (
	ProtocolVersion           = "1.0.0"
	MinProtocolVersion        = "1.0.0"
	MaxSequenceWindow         = 1000
	DefaultHeartbeatInterval  = 30000 * time.Millisecond
	DefaultSessionLease       = 300000 * time.Millisecond
	MaxMessageSizeBytes       = 10 * 1024 * 1024 // 10MB
	MaxPayloadSizeBytes       = 9 * 1024 * 1024  // 9MB
)

// MessageType represents the type of relay message
type MessageType string

const (
	// Control messages
	MessageTypeHello        MessageType = "HELLO"
	MessageTypeHelloAck     MessageType = "HELLO_ACK"
	MessageTypeHeartbeat    MessageType = "HEARTBEAT"
	MessageTypeHeartbeatAck MessageType = "HEARTBEAT_ACK"
	MessageTypeGoodbye      MessageType = "GOODBYE"
	MessageTypeError        MessageType = "ERROR"

	// Session messages
	MessageTypeSessionCreate      MessageType = "SESSION_CREATE"
	MessageTypeSessionCreateAck  MessageType = "SESSION_CREATE_ACK"
	MessageTypeSessionCreateError MessageType = "SESSION_CREATE_ERROR"
	MessageTypeSessionRenew       MessageType = "SESSION_RENEW"
	MessageTypeSessionRenewAck    MessageType = "SESSION_RENEW_ACK"
	MessageTypeSessionRevoke      MessageType = "SESSION_REVOKE"
	MessageTypeSessionRevoked     MessageType = "SESSION_REVOKED"

	// Channel messages
	MessageTypeChannelOpen     MessageType = "CHANNEL_OPEN"
	MessageTypeChannelOpenAck  MessageType = "CHANNEL_OPEN_ACK"
	MessageTypeChannelOpenError MessageType = "CHANNEL_OPEN_ERROR"
	MessageTypeChannelClose    MessageType = "CHANNEL_CLOSE"
	MessageTypeChannelClosed   MessageType = "CHANNEL_CLOSED"

	// CDP frames
	MessageTypeCDPFrame    MessageType = "CDP_FRAME"
	MessageTypeCDPFrameAck MessageType = "CDP_FRAME_ACK"

	// Backpressure signals
	MessageTypeBackpressureBegin MessageType = "BACKPRESSURE_BEGIN"
	MessageTypeBackpressureEnd  MessageType = "BACKPRESSURE_END"
	MessageTypeRateLimitUpdate  MessageType = "RATE_LIMIT_UPDATE"
)

// ProtocolErrorCode represents protocol-level error codes
type ProtocolErrorCode string

const (
	ErrorProtocolVersionMismatch  ProtocolErrorCode = "PROTOCOL_VERSION_MISMATCH"
	ErrorSequenceNumberInvalid    ProtocolErrorCode = "SEQUENCE_NUMBER_INVALID"
	ErrorSequenceNumberReplay     ProtocolErrorCode = "SEQUENCE_NUMBER_REPLAY"
	ErrorSessionExpired           ProtocolErrorCode = "SESSION_EXPIRED"
	ErrorSessionRevoked          ProtocolErrorCode = "SESSION_REVOKED"
	ErrorChannelNotFound          ProtocolErrorCode = "CHANNEL_NOT_FOUND"
	ErrorChannelAlreadyOpen       ProtocolErrorCode = "CHANNEL_ALREADY_OPEN"
	ErrorPayloadTooLarge          ProtocolErrorCode = "PAYLOAD_TOO_LARGE"
	ErrorMessageTypeInvalid       ProtocolErrorCode = "MESSAGE_TYPE_INVALID"
	ErrorSignatureInvalid         ProtocolErrorCode = "SIGNATURE_INVALID"
	ErrorAuthenticationFailed     ProtocolErrorCode = "AUTHENTICATION_FAILED"
	ErrorRateLimitExceeded        ProtocolErrorCode = "RATE_LIMIT_EXCEEDED"
	ErrorInternalError            ProtocolErrorCode = "INTERNAL_ERROR"
)

// RelayMessage represents a message in the relay protocol
type RelayMessage struct {
	ProtocolVersion string      `json:"protocolVersion"`
	TenantID        string     `json:"tenantId"`
	SessionID       string     `json:"sessionId"`
	DeviceID        string     `json:"deviceId"`
	ChannelID       string     `json:"channelId"`
	SequenceNumber  int64      `json:"sequenceNumber"`
	MessageType     MessageType `json:"messageType"`
	Expiry          int64      `json:"expiry"`
	Payload         any        `json:"payload"`
	Signature       string     `json:"signature,omitempty"`
}

// SerializedRelayMessage is used for JSON serialization
type SerializedRelayMessage struct {
	ProtocolVersion string      `json:"protocolVersion"`
	TenantID        string     `json:"tenantId"`
	SessionID       string     `json:"sessionId"`
	DeviceID        string     `json:"deviceId"`
	ChannelID       string     `json:"channelId"`
	SequenceNumber  int64      `json:"sequenceNumber"`
	MessageType     MessageType `json:"messageType"`
	Expiry          int64      `json:"expiry"`
	Payload         string     `json:"payload"`
	Signature       string     `json:"signature,omitempty"`
}

// CDPFramePayload represents a CDP command or response
type CDPFramePayload struct {
	Method  string                 `json:"method,omitempty"`
	Params  map[string]any        `json:"params,omitempty"`
	Session string                `json:"sessionId,omitempty"`
	ID      float64               `json:"id,omitempty"`
	Result  map[string]any        `json:"result,omitempty"`
	Error   *CDPError             `json:"error,omitempty"`
}

// CDPError represents a CDP protocol error
type CDPError struct {
	Code    int64  `json:"code"`
	Message string `json:"message"`
}

// HelloPayload for protocol version negotiation
type HelloPayload struct {
	SupportedVersions []string `json:"supportedVersions"`
	ClientType        string   `json:"clientType"`
	ClientID          string   `json:"clientId,omitempty"`
}

// HelloACKPayload server response to Hello
type HelloACKPayload struct {
	NegotiatedVersion     string `json:"negotiatedVersion"`
	ServerTime            int64  `json:"serverTime"`
	SessionLeaseMs        int64  `json:"sessionLeaseMs"`
	HeartbeatIntervalMs   int64  `json:"heartbeatIntervalMs"`
	MaxMessageSizeBytes   int64  `json:"maxMessageSizeBytes"`
}

// SessionCreatePayload for creating a new session
type SessionCreatePayload struct {
	TenantID          string            `json:"tenantId"`
	DeviceID          string            `json:"deviceId"`
	RequestedLeaseMs  *int64            `json:"requestedLeaseMs,omitempty"`
	Metadata          map[string]string `json:"metadata,omitempty"`
}

// SessionCreateACKPayload server response to session creation
type SessionCreateACKPayload struct {
	SessionID   string `json:"sessionId"`
	SessionKey   string `json:"sessionKey"`
	LeaseExpiry  int64  `json:"leaseExpiry"`
	ChannelID    string `json:"channelId"`
}

// SessionRenewPayload for renewing a session lease
type SessionRenewPayload struct {
	SessionID string `json:"sessionId"`
}

// SessionRevokePayload for revoking a session
type SessionRevokePayload struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason,omitempty"`
}

// ChannelOpenPayload for opening a new channel
type ChannelOpenPayload struct {
	SessionID  string `json:"sessionId"`
	ChannelID  string `json:"channelId"`
	ChannelType string `json:"channelType"`
}

// BackpressurePayload indicates backpressure state
type BackpressurePayload struct {
	SessionID  string `json:"sessionId"`
	ChannelID  string `json:"channelId"`
	Reason     string `json:"reason"`
	WindowSize *int64 `json:"windowSize,omitempty"`
}

// RateLimitPayload for rate limit updates
type RateLimitPayload struct {
	SessionID      string  `json:"sessionId"`
	ChannelID      string  `json:"channelId,omitempty"`
	TokensPerSecond float64 `json:"tokensPerSecond"`
	BurstSize      int64   `json:"burstSize"`
	WindowSizeMs   int64   `json:"windowSizeMs"`
}

// ErrorPayload for error messages
type ErrorPayload struct {
	Code    ProtocolErrorCode   `json:"code"`
	Message string             `json:"message"`
	Details map[string]any     `json:"details,omitempty"`
}

// HeartbeatPayload for heartbeat messages
type HeartbeatPayload struct {
	Timestamp      int64  `json:"timestamp"`
	SequenceNumber int64  `json:"sequenceNumber"`
	Status         string `json:"status"`
}

// SequenceState tracks sequence numbers for replay protection
type SequenceState struct {
	LastSequenceNumber int64
	ReceivedSequences  map[int64]bool
	WindowStart        int64
}

// ValidationError represents a single validation error
type ValidationError struct {
	Field   string            `json:"field"`
	Message string            `json:"message"`
	Code    ProtocolErrorCode `json:"code"`
}

// ValidationResult represents the result of message validation
type ValidationResult struct {
	IsValid bool             `json:"isValid"`
	Errors  []ValidationError `json:"errors,omitempty"`
}

// ProtocolValidationError represents a protocol validation failure
type ProtocolValidationError struct {
	Code    ProtocolErrorCode
	Message string
	Errors  []ValidationError
}

func (e *ProtocolValidationError) Error() string {
	return e.Message
}

// IsVersionCompatible checks if a protocol version is compatible
func IsVersionCompatible(version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) < 1 {
		return false
	}
	major := parts[0]
	minMajor := strings.Split(MinProtocolVersion, ".")[0]
	return major == minMajor
}

// SerializeMessage serializes a RelayMessage to JSON bytes
func SerializeMessage(msg *RelayMessage) ([]byte, error) {
	// Create serialized version with base64-encoded payload if binary
	serialized := SerializedRelayMessage{
		ProtocolVersion: msg.ProtocolVersion,
		TenantID:        msg.TenantID,
		SessionID:       msg.SessionID,
		DeviceID:        msg.DeviceID,
		ChannelID:       msg.ChannelID,
		SequenceNumber:  msg.SequenceNumber,
		MessageType:     msg.MessageType,
		Expiry:          msg.Expiry,
		Payload:         encodePayload(msg.Payload),
		Signature:       msg.Signature,
	}
	return json.Marshal(serialized)
}

// DeserializeMessage deserializes a RelayMessage from JSON bytes
func DeserializeMessage(data []byte) (*RelayMessage, error) {
	var serialized SerializedRelayMessage
	if err := json.Unmarshal(data, &serialized); err != nil {
		return nil, err
	}

	// Validate required fields
	result := ValidateSerializedMessage(&serialized)
	if !result.IsValid {
		if len(result.Errors) > 0 {
			return nil, &ProtocolValidationError{
				Code:    result.Errors[0].Code,
				Message: result.Errors[0].Message,
				Errors:  result.Errors,
			}
		}
		return nil, errors.New("invalid message")
	}

	payload, err := decodePayload(serialized.Payload)
	if err != nil {
		return nil, err
	}

	return &RelayMessage{
		ProtocolVersion: serialized.ProtocolVersion,
		TenantID:        serialized.TenantID,
		SessionID:       serialized.SessionID,
		DeviceID:        serialized.DeviceID,
		ChannelID:       serialized.ChannelID,
		SequenceNumber:  serialized.SequenceNumber,
		MessageType:     serialized.MessageType,
		Expiry:          serialized.Expiry,
		Payload:         payload,
		Signature:       serialized.Signature,
	}, nil
}

// ValidateSerializedMessage validates a serialized message
func ValidateSerializedMessage(msg *SerializedRelayMessage) ValidationResult {
	var errors []ValidationError

	// Required string fields
	if msg.ProtocolVersion == "" {
		errors = append(errors, ValidationError{Field: "protocolVersion", Message: "Protocol version is required", Code: ErrorMessageTypeInvalid})
	} else if !IsVersionCompatible(msg.ProtocolVersion) {
		errors = append(errors, ValidationError{Field: "protocolVersion", Message: "Protocol version not compatible", Code: ErrorProtocolVersionMismatch})
	}

	if msg.TenantID == "" {
		errors = append(errors, ValidationError{Field: "tenantId", Message: "Tenant ID is required", Code: ErrorAuthenticationFailed})
	}

	if msg.SessionID == "" {
		errors = append(errors, ValidationError{Field: "sessionId", Message: "Session ID is required", Code: ErrorSessionExpired})
	}

	if msg.DeviceID == "" {
		errors = append(errors, ValidationError{Field: "deviceId", Message: "Device ID is required", Code: ErrorAuthenticationFailed})
	}

	if msg.ChannelID == "" {
		errors = append(errors, ValidationError{Field: "channelId", Message: "Channel ID is required", Code: ErrorChannelNotFound})
	}

	// Validate sequence number
	if msg.SequenceNumber < 0 || msg.SequenceNumber != int64(int(msg.SequenceNumber)) {
		errors = append(errors, ValidationError{Field: "sequenceNumber", Message: "Sequence number must be a non-negative integer", Code: ErrorSequenceNumberInvalid})
	}

	// Validate message type
	validTypes := []MessageType{
		MessageTypeHello, MessageTypeHelloAck, MessageTypeHeartbeat, MessageTypeHeartbeatAck,
		MessageTypeGoodbye, MessageTypeError, MessageTypeSessionCreate, MessageTypeSessionCreateAck,
		MessageTypeSessionCreateError, MessageTypeSessionRenew, MessageTypeSessionRenewAck,
		MessageTypeSessionRevoke, MessageTypeSessionRevoked, MessageTypeChannelOpen,
		MessageTypeChannelOpenAck, MessageTypeChannelOpenError, MessageTypeChannelClose,
		MessageTypeChannelClosed, MessageTypeCDPFrame, MessageTypeCDPFrameAck,
		MessageTypeBackpressureBegin, MessageTypeBackpressureEnd, MessageTypeRateLimitUpdate,
	}
	validType := false
	for _, t := range validTypes {
		if msg.MessageType == t {
			validType = true
			break
		}
	}
	if !validType {
		errors = append(errors, ValidationError{Field: "messageType", Message: "Invalid message type", Code: ErrorMessageTypeInvalid})
	}

	// Validate expiry
	if msg.Expiry < 0 {
		errors = append(errors, ValidationError{Field: "expiry", Message: "Expiry must be non-negative", Code: ErrorMessageTypeInvalid})
	}

	// Validate payload
	if msg.Payload == "" {
		errors = append(errors, ValidationError{Field: "payload", Message: "Payload is required", Code: ErrorMessageTypeInvalid})
	}

	return ValidationResult{
		IsValid: len(errors) == 0,
		Errors:  errors,
	}
}

// ValidateMessage validates a deserialized RelayMessage
func ValidateMessage(msg *RelayMessage) ValidationResult {
	var errors []ValidationError

	if msg.ProtocolVersion == "" {
		errors = append(errors, ValidationError{Field: "protocolVersion", Message: "Protocol version is required", Code: ErrorProtocolVersionMismatch})
	}

	if msg.TenantID == "" {
		errors = append(errors, ValidationError{Field: "tenantId", Message: "Tenant ID is required", Code: ErrorAuthenticationFailed})
	}

	if msg.SessionID == "" {
		errors = append(errors, ValidationError{Field: "sessionId", Message: "Session ID is required", Code: ErrorSessionExpired})
	}

	if msg.DeviceID == "" {
		errors = append(errors, ValidationError{Field: "deviceId", Message: "Device ID is required", Code: ErrorAuthenticationFailed})
	}

	if msg.ChannelID == "" {
		errors = append(errors, ValidationError{Field: "channelId", Message: "Channel ID is required", Code: ErrorChannelNotFound})
	}

	// Check expiry
	if msg.Expiry < time.Now().UnixMilli() {
		errors = append(errors, ValidationError{Field: "expiry", Message: "Message has expired", Code: ErrorSessionExpired})
	}

	return ValidationResult{
		IsValid: len(errors) == 0,
		Errors:  errors,
	}
}

// encodePayload converts payload to string representation
func encodePayload(payload any) string {
	switch p := payload.(type) {
	case string:
		return p
	case []byte:
		return Base64Encode(p)
	default:
		// JSON serialize objects
		data, _ := json.Marshal(p)
		return string(data)
	}
}

// decodePayload decodes a payload from string representation
func decodePayload(encoded string) (any, error) {
	// Check if it looks like base64
	if isBase64(encoded) {
		decoded, err := Base64Decode(encoded)
		if err == nil {
			// Try to parse as JSON
			var jsonData any
			if json.Unmarshal(decoded, &jsonData) == nil {
				return jsonData, nil
			}
			// Return as string if not valid JSON
			return string(decoded), nil
		}
	}
	// Try to parse as JSON directly
	var jsonData any
	if json.Unmarshal([]byte(encoded), &jsonData) == nil {
		return jsonData, nil
	}
	return encoded, nil
}

// isBase64 checks if a string looks like base64 encoded data
func isBase64(s string) bool {
	if len(s) < 4 {
		return false
	}
	alphaCount := 0
	for _, c := range s {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=' {
			alphaCount++
		}
	}
	return alphaCount > len(s)*3/4
}
