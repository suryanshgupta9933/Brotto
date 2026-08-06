"""
Authentication helpers for the Brotto Platform SDK
"""
import base64
import hashlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Optional
import httpx


@dataclass
class AuthConfig:
    """OIDC authentication configuration."""
    oidc_issuer: str
    oidc_client_id: str
    oidc_audience: Optional[str] = None


@dataclass
class TokenResponse:
    """Token response from OIDC provider."""
    access_token: str
    expires_in: int
    token_type: str
    refresh_token: Optional[str] = None


@dataclass
class OIDCTokens:
    """OIDC tokens container."""
    access_token: str
    refresh_token: Optional[str] = None
    id_token: Optional[str] = None
    expires_at: Optional[time.time] = None


@dataclass
class OIDCDiscoveryDocument:
    """OIDC discovery document."""
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str
    userinfo_endpoint: Optional[str] = None
    end_session_endpoint: Optional[str] = None
    grant_types_supported: list = field(default_factory=list)
    response_types_supported: list = field(default_factory=list)
    subject_types_supported: list = field(default_factory=list)
    id_token_signing_alg_values_supported: list = field(default_factory=list)
    token_endpoint_auth_methods_supported: list = field(default_factory=list)
    code_challenge_methods_supported: Optional[list] = None


class TokenManager:
    """Token manager for handling token refresh and storage."""

    def __init__(
        self,
        oidc_issuer: str,
        oidc_client_id: str,
        oidc_audience: Optional[str] = None,
    ):
        self.oidc_issuer = oidc_issuer
        self.oidc_client_id = oidc_client_id
        self.oidc_audience = oidc_audience
        self._access_token: Optional[str] = None
        self._refresh_token: Optional[str] = None
        self._expires_at: Optional[float] = None
        self._refresh_promise: Optional[any] = None

    def set_tokens(self, tokens: OIDCTokens) -> None:
        """Set tokens from an OIDC token response."""
        self._access_token = tokens.access_token
        self._refresh_token = tokens.refresh_token
        self._expires_at = tokens.expires_at

    def get_access_token(self) -> Optional[str]:
        """Get the current access token."""
        return self._access_token

    def get_refresh_token(self) -> Optional[str]:
        """Get the current refresh token."""
        return self._refresh_token

    def is_expired(self) -> bool:
        """Check if the current token is expired."""
        if self._expires_at is None:
            return True
        # Add 30 second buffer
        return time.time() >= self._expires_at - 30

    def has_refresh_token(self) -> bool:
        """Check if a refresh token is available."""
        return self._refresh_token is not None

    async def refresh(self, refresh_token: Optional[str] = None) -> str:
        """Refresh the access token using the refresh token."""
        token = refresh_token or self._refresh_token
        if not token:
            raise ValueError("No refresh token available")

        token_endpoint = f"{self.oidc_issuer}/oauth/token"

        data = {
            "grant_type": "refresh_token",
            "refresh_token": token,
            "client_id": self.oidc_client_id,
        }

        if self.oidc_audience:
            data["audience"] = self.oidc_audience

        async with httpx.AsyncClient() as client:
            response = await client.post(
                token_endpoint,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

            if not response.is_success:
                raise FaraSDKError(f"Token refresh failed: {response.status_code}")

            token_response = TokenResponse(**response.json())

            self._access_token = token_response.access_token
            if token_response.refresh_token:
                self._refresh_token = token_response.refresh_token
            self._expires_at = time.time() + token_response.expires_in

            return token_response.access_token

    def clear(self) -> None:
        """Clear all tokens."""
        self._access_token = None
        self._refresh_token = None
        self._expires_at = None
        self._refresh_promise = None

    @staticmethod
    def parse_jwt(token: str) -> Optional[dict[str, Any]]:
        """Parse a JWT token without verification (for debugging/logging)."""
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            payload = parts[1]
            # Add padding if needed
            padding = 4 - len(payload) % 4
            if padding != 4:
                payload += "=" * padding
            decoded = base64.urlsafe_b64decode(payload).decode("utf-8")
            import json
            return json.loads(decoded)
        except Exception:
            return None

    @staticmethod
    def get_token_expiration(token: str) -> Optional[float]:
        """Get the expiration time from a JWT token."""
        payload = TokenManager.parse_jwt(token)
        if not payload or "exp" not in payload:
            return None
        return payload["exp"]

    @staticmethod
    def is_token_expired(token: str) -> bool:
        """Check if a JWT token is expired."""
        exp = TokenManager.get_token_expiration(token)
        if exp is None:
            return True
        return time.time() >= exp


async def fetch_oidc_discovery(issuer: str) -> OIDCDiscoveryDocument:
    """Fetch the OIDC discovery document."""
    discovery_url = f"{issuer}/.well-known/openid-configuration"

    async with httpx.AsyncClient() as client:
        response = await client.get(discovery_url)
        if not response.is_success:
            raise FaraSDKError(f"Failed to fetch OIDC discovery: {response.status_code}")

        data = response.json()
        return OIDCDiscoveryDocument(**data)


def build_authorization_url(
    authorization_endpoint: str,
    client_id: str,
    redirect_uri: str,
    state: str,
    nonce: Optional[str] = None,
    scope: Optional[str] = None,
    code_challenge: Optional[str] = None,
    code_challenge_method: str = "S256",
) -> str:
    """Build the authorization URL for OIDC flow."""
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": scope or "openid profile email",
    }

    if nonce:
        params["nonce"] = nonce

    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = code_challenge_method

    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{authorization_endpoint}?{query}"


async def exchange_code_for_tokens(
    token_endpoint: str,
    client_id: str,
    code: str,
    redirect_uri: str,
    code_verifier: Optional[str] = None,
    scopes: Optional[list[str]] = None,
) -> TokenResponse:
    """Exchange an authorization code for tokens."""
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
    }

    if code_verifier:
        data["code_verifier"] = code_verifier

    if scopes:
        data["scope"] = " ".join(scopes)

    async with httpx.AsyncClient() as client:
        response = await client.post(
            token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if not response.is_success:
            raise FaraSDKError(f"Code exchange failed: {response.status_code}")

        return TokenResponse(**response.json())


async def revoke_token(
    revocation_endpoint: str,
    client_id: str,
    token: str,
    token_type_hint: Optional[str] = None,
) -> None:
    """Revoke a token."""
    data = {
        "client_id": client_id,
        "token": token,
    }

    if token_type_hint:
        data["token_type_hint"] = token_type_hint

    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                revocation_endpoint,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception:
        # Ignore errors - revocation endpoint may not be available
        pass


def generate_state() -> str:
    """Generate a random state parameter for OIDC flow."""
    return secrets.token_hex(32)


def generate_code_verifier() -> str:
    """Generate a code verifier for PKCE."""
    # 32 bytes = 43 characters base64url
    code_verifier = secrets.token_bytes(32)
    return base64.urlsafe_b64encode(code_verifier).rstrip(b"=").decode("utf-8")


async def generate_code_challenge(verifier: str) -> str:
    """Generate a code challenge from a code verifier."""
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("utf-8")


class FaraSDKError(Exception):
    """Base SDK error for auth module."""
    pass
