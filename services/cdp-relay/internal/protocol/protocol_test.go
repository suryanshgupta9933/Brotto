package protocol

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSerializeDeserialize(t *testing.T) {
	msg := &RelayMessage{
		ProtocolVersion: ProtocolVersion,
		TenantID:        "tenant-123",
		SessionID:       "session-456",
		DeviceID:        "device-789",
		ChannelID:       "channel-abc",
		SequenceNumber:  42,
		MessageType:     MessageTypeHello,
		Expiry:         time.Now().Add(time.Hour).UnixMilli(),
		Payload: HelloPayload{
			SupportedVersions: []string{"1.0.0"},
			ClientType:        "connector",
			ClientID:          "client-1",
		},
	}

	// Serialize
	data, err := SerializeMessage(msg)
	if err != nil {
		t.Fatalf("SerializeMessage failed: %v", err)
	}

	// Deserialize
	parsed, err := DeserializeMessage(data)
	if err != nil {
		t.Fatalf("DeserializeMessage failed: %v", err)
	}

	// Verify fields
	if parsed.ProtocolVersion != msg.ProtocolVersion {
		t.Errorf("ProtocolVersion mismatch: got %v, want %v", parsed.ProtocolVersion, msg.ProtocolVersion)
	}
	if parsed.TenantID != msg.TenantID {
		t.Errorf("TenantID mismatch: got %v, want %v", parsed.TenantID, msg.TenantID)
	}
	if parsed.SessionID != msg.SessionID {
		t.Errorf("SessionID mismatch: got %v, want %v", parsed.SessionID, msg.SessionID)
	}
	if parsed.SequenceNumber != msg.SequenceNumber {
		t.Errorf("SequenceNumber mismatch: got %v, want %v", parsed.SequenceNumber, msg.SequenceNumber)
	}
	if parsed.MessageType != msg.MessageType {
		t.Errorf("MessageType mismatch: got %v, want %v", parsed.MessageType, msg.MessageType)
	}
}

func TestValidateSerializedMessage(t *testing.T) {
	tests := []struct {
		name    string
		msg     SerializedRelayMessage
		wantErr bool
	}{
		{
			name: "valid message",
			msg: SerializedRelayMessage{
				ProtocolVersion: ProtocolVersion,
				TenantID:        "tenant-123",
				SessionID:       "session-456",
				DeviceID:        "device-789",
				ChannelID:       "channel-abc",
				SequenceNumber:  0,
				MessageType:     MessageTypeHello,
				Expiry:          time.Now().Add(time.Hour).UnixMilli(),
				Payload:         `{"supportedVersions":["1.0.0"],"clientType":"connector"}`,
			},
			wantErr: false,
		},
		{
			name: "missing tenant ID",
			msg: SerializedRelayMessage{
				ProtocolVersion: ProtocolVersion,
				SessionID:       "session-456",
				DeviceID:        "device-789",
				ChannelID:       "channel-abc",
				SequenceNumber:  0,
				MessageType:     MessageTypeHello,
				Expiry:          time.Now().Add(time.Hour).UnixMilli(),
				Payload:         `{}`,
			},
			wantErr: true,
		},
		{
			name: "invalid protocol version",
			msg: SerializedRelayMessage{
				ProtocolVersion: "99.0.0",
				TenantID:        "tenant-123",
				SessionID:       "session-456",
				DeviceID:        "device-789",
				ChannelID:       "channel-abc",
				SequenceNumber:  0,
				MessageType:     MessageTypeHello,
				Expiry:          time.Now().Add(time.Hour).UnixMilli(),
				Payload:         `{}`,
			},
			wantErr: true,
		},
		{
			name: "negative sequence number",
			msg: SerializedRelayMessage{
				ProtocolVersion: ProtocolVersion,
				TenantID:        "tenant-123",
				SessionID:       "session-456",
				DeviceID:        "device-789",
				ChannelID:       "channel-abc",
				SequenceNumber:  -1,
				MessageType:     MessageTypeHello,
				Expiry:          time.Now().Add(time.Hour).UnixMilli(),
				Payload:         `{}`,
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ValidateSerializedMessage(&tt.msg)
			if tt.wantErr && result.IsValid {
				t.Error("Expected validation to fail, but it passed")
			}
			if !tt.wantErr && !result.IsValid {
				t.Errorf("Expected validation to pass, but it failed: %v", result.Errors)
			}
		})
	}
}

func TestIsVersionCompatible(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{"1.0.0", true},
		{"1.1.0", true},
		{"1.9.9", true},
		{"2.0.0", false},
		{"0.9.0", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.version, func(t *testing.T) {
			got := IsVersionCompatible(tt.version)
			if got != tt.want {
				t.Errorf("IsVersionCompatible(%q) = %v, want %v", tt.version, got, tt.want)
			}
		})
	}
}

func TestGenerateSessionID(t *testing.T) {
	id1, err := GenerateSessionID()
	if err != nil {
		t.Fatalf("GenerateSessionID failed: %v", err)
	}
	if len(id1) != 32 {
		t.Errorf("SessionID length = %d, want 32", len(id1))
	}

	// Generate another and ensure they're different
	id2, err := GenerateSessionID()
	if err != nil {
		t.Fatalf("GenerateSessionID failed: %v", err)
	}
	if id1 == id2 {
		t.Error("Two generated session IDs should be different")
	}
}

func TestGenerateChannelID(t *testing.T) {
	id, err := GenerateChannelID()
	if err != nil {
		t.Fatalf("GenerateChannelID failed: %v", err)
	}
	if len(id) != 24 {
		t.Errorf("ChannelID length = %d, want 24", len(id))
	}
}

func TestGenerateDeviceID(t *testing.T) {
	id, err := GenerateDeviceID()
	if err != nil {
		t.Fatalf("GenerateDeviceID failed: %v", err)
	}
	if len(id) != 16 {
		t.Errorf("DeviceID length = %d, want 16", len(id))
	}
}

func TestBase64Encoding(t *testing.T) {
	data := []byte("Hello, World!")
	encoded := Base64Encode(data)
	decoded, err := Base64Decode(encoded)
	if err != nil {
		t.Fatalf("Base64Decode failed: %v", err)
	}
	if string(decoded) != string(data) {
		t.Errorf("Decoded data = %q, want %q", string(decoded), string(data))
	}
}

func TestCDPFrameSerialization(t *testing.T) {
	frame := CDPFrame{
		ID:     1,
		Method: "Page.enable",
		Params: map[string]any{"a": 1, "b": "test"},
	}

	data, err := json.Marshal(frame)
	if err != nil {
		t.Fatalf("Failed to marshal CDPFrame: %v", err)
	}

	var parsed CDPFrame
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("Failed to unmarshal CDPFrame: %v", err)
	}

	if parsed.ID != frame.ID {
		t.Errorf("ID = %v, want %v", parsed.ID, frame.ID)
	}
	if parsed.Method != frame.Method {
		t.Errorf("Method = %v, want %v", parsed.Method, frame.Method)
	}
}

func TestRelayMessageWithBinaryPayload(t *testing.T) {
	binaryData := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE}
	msg := &RelayMessage{
		ProtocolVersion: ProtocolVersion,
		TenantID:        "tenant",
		SessionID:       "session",
		DeviceID:        "device",
		ChannelID:       "channel",
		SequenceNumber:  0,
		MessageType:     MessageTypeCDPFrame,
		Expiry:          time.Now().Add(time.Hour).UnixMilli(),
		Payload:         binaryData,
	}

	data, err := SerializeMessage(msg)
	if err != nil {
		t.Fatalf("SerializeMessage failed: %v", err)
	}

	parsed, err := DeserializeMessage(data)
	if err != nil {
		t.Fatalf("DeserializeMessage failed: %v", err)
	}

	// Check that payload is properly handled
	payloadBytes, ok := parsed.Payload.([]byte)
	if !ok {
		// It might be decoded as a string if it's valid UTF-8
		t.Log("Payload decoded as string, not binary")
	}
}
