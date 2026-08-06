"""Tests for brotto_sdk.auth"""
import pytest
import base64
import json
import time
from brotto_sdk.auth import (
    generate_state,
    generate_code_verifier,
    TokenManager,
)


class TestGenerateState:
    """Tests for generate_state function."""

    def test_generate_state_random(self):
        """Test that generated states are random."""
        state1 = generate_state()
        state2 = generate_state()

        assert state1 != state2
        assert len(state1) == 64  # 32 bytes = 64 hex chars

    def test_generate_state_hex(self):
        """Test that state is valid hex."""
        state = generate_state()
        int(state, 16)  # Should not raise


class TestGenerateCodeVerifier:
    """Tests for generate_code_verifier function."""

    def test_generate_code_verifier_length(self):
        """Test code verifier length is valid."""
        verifier = generate_code_verifier()

        # PKCE code verifier must be 43-128 characters
        assert 43 <= len(verifier) <= 128

    def test_generate_code_verifier_url_safe(self):
        """Test code verifier is URL-safe."""
        verifier = generate_code_verifier()

        # Should not contain + / =
        assert "+" not in verifier
        assert "/" not in verifier
        assert "=" not in verifier


class TestTokenManager:
    """Tests for TokenManager class."""

    def test_parse_jwt_valid(self):
        """Test parsing a valid JWT."""
        # Create a simple JWT
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "123", "exp": 9999999999}).encode()).decode()
        signature = "fake"
        token = f"{header}.{payload}.{signature}"

        parsed = TokenManager.parse_jwt(token)

        assert parsed is not None
        assert parsed["sub"] == "123"
        assert parsed["exp"] == 9999999999

    def test_parse_jwt_invalid(self):
        """Test parsing invalid JWTs."""
        assert TokenManager.parse_jwt("invalid") is None
        assert TokenManager.parse_jwt("only.two") is None
        assert TokenManager.parse_jwt("") is None

    def test_get_token_expiration(self):
        """Test extracting expiration from JWT."""
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        exp = int(time.time()) + 3600
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "123", "exp": exp}).encode()).decode()
        signature = "fake"
        token = f"{header}.{payload}.{signature}"

        expiration = TokenManager.get_token_expiration(token)

        assert expiration is not None
        assert abs(expiration - exp) < 1  # Within 1 second

    def test_get_token_expiration_missing(self):
        """Test extracting expiration from JWT without exp."""
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "123"}).encode()).decode()
        signature = "fake"
        token = f"{header}.{payload}.{signature}"

        assert TokenManager.get_token_expiration(token) is None

    def test_is_token_expired_true(self):
        """Test expired token detection."""
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        exp = int(time.time()) - 3600  # 1 hour ago
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "123", "exp": exp}).encode()).decode()
        signature = "fake"
        token = f"{header}.{payload}.{signature}"

        assert TokenManager.is_token_expired(token) is True

    def test_is_token_expired_false(self):
        """Test valid token detection."""
        header = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode()
        exp = int(time.time()) + 3600  # 1 hour from now
        payload = base64.urlsafe_b64encode(json.dumps({"sub": "123", "exp": exp}).encode()).decode()
        signature = "fake"
        token = f"{header}.{payload}.{signature}"

        assert TokenManager.is_token_expired(token) is False

    def test_token_manager_initial_state(self):
        """Test TokenManager initial state."""
        manager = TokenManager("https://issuer", "client-id")

        assert manager.get_access_token() is None
        assert manager.get_refresh_token() is None
        assert manager.is_expired() is True
        assert manager.has_refresh_token() is False

    def test_token_manager_set_tokens(self):
        """Test setting tokens on TokenManager."""
        from brotto_sdk.auth import OIDCTokens

        manager = TokenManager("https://issuer", "client-id")
        tokens = OIDCTokens(
            access_token="access-123",
            refresh_token="refresh-456",
            expires_at=time.time() + 3600,
        )

        manager.set_tokens(tokens)

        assert manager.get_access_token() == "access-123"
        assert manager.get_refresh_token() == "refresh-456"
        assert manager.is_expired() is False
        assert manager.has_refresh_token() is True

    def test_token_manager_clear(self):
        """Test clearing tokens."""
        from brotto_sdk.auth import OIDCTokens

        manager = TokenManager("https://issuer", "client-id")
        tokens = OIDCTokens(
            access_token="access-123",
            refresh_token="refresh-456",
            expires_at=time.time() + 3600,
        )

        manager.set_tokens(tokens)
        manager.clear()

        assert manager.get_access_token() is None
        assert manager.get_refresh_token() is None
