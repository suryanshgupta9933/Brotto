package protocol

import (
	"crypto/rand"
	"encoding/base64"
)

// Base64Encode encodes bytes to base64 string
func Base64Encode(data []byte) string {
	return base64.StdEncoding.EncodeToString(data)
}

// Base64Decode decodes base64 string to bytes
func Base64Decode(encoded string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(encoded)
}

// GenerateRandomBytes generates cryptographically random bytes
func GenerateRandomBytes(n int) ([]byte, error) {
	bytes := make([]byte, n)
	_, err := rand.Read(bytes)
	if err != nil {
		return nil, err
	}
	return bytes, nil
}

// GenerateSessionID generates a cryptographically random session ID (16 bytes = 32 hex chars)
func GenerateSessionID() (string, error) {
	bytes, err := GenerateRandomBytes(16)
	if err != nil {
		return "", err
	}
	return hexEncode(bytes), nil
}

// GenerateChannelID generates a cryptographically random channel ID (12 bytes = 24 hex chars)
func GenerateChannelID() (string, error) {
	bytes, err := GenerateRandomBytes(12)
	if err != nil {
		return "", err
	}
	return hexEncode(bytes), nil
}

// GenerateDeviceID generates a cryptographically random device ID (8 bytes = 16 hex chars)
func GenerateDeviceID() (string, error) {
	bytes, err := GenerateRandomBytes(8)
	if err != nil {
		return "", err
	}
	return hexEncode(bytes), nil
}

// hexEncode encodes bytes to hex string
func hexEncode(bytes []byte) string {
	const hexChars = "0123456789abcdef"
	result := make([]byte, len(bytes)*2)
	for i, b := range bytes {
		result[i*2] = hexChars[b>>4]
		result[i*2+1] = hexChars[b&0x0f]
	}
	return string(result)
}
