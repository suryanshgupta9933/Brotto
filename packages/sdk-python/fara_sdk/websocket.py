"""
WebSocket session client for real-time events
"""
import asyncio
import json
from typing import Any, Callable, Optional
from dataclasses import dataclass, field
from .types import SessionEvent, SessionEventType, SessionState, ApprovalRequest
from .errors import WebSocketError, WebSocketClosedError, AuthenticationError
from .auth import TokenManager


@dataclass
class WebSocketClientConfig:
    """Configuration for WebSocketClient."""
    url: str
    session_id: str
    auth_token: Optional[str] = None
    token_manager: Optional[TokenManager] = None
    on_open: Optional[Callable[[], None]] = None
    on_close: Optional[Callable[[int, Optional[str]], None]] = None
    on_error: Optional[Callable[[Exception], None]] = None
    on_event: Optional[Callable[[SessionEvent], None]] = None
    on_state_change: Optional[Callable[[SessionState, SessionState], None]] = None
    on_action_requested: Optional[Callable[[dict], None]] = None
    on_action_executed: Optional[Callable[[str, bool, Optional[str]], None]] = None
    on_approval_required: Optional[Callable[[ApprovalRequest], None]] = None
    on_approval_decided: Optional[Callable[[str, str, str], None]] = None
    on_session_error: Optional[Callable[[str], None]] = None
    on_heartbeat: Optional[Callable[[int], None]] = None
    reconnect: bool = True
    reconnect_delay: float = 1.0
    max_reconnect_attempts: int = 5


class WebSocketClient:
    """WebSocket client for subscribing to session events."""

    def __init__(self, config: WebSocketClientConfig):
        self.config = config
        self._ws: Optional[Any] = None
        self._reconnect_attempts = 0
        self._reconnect_task: Optional[asyncio.Task] = None
        self._should_reconnect = True
        self._is_intentionally_closed = False
        self._lock = asyncio.Lock()

        # Validate auth
        if not config.auth_token and not config.token_manager:
            raise AuthenticationError("WebSocket requires authentication token or token manager")

    async def connect(self) -> None:
        """Connect to the WebSocket server."""
        async with self._lock:
            if self._ws is not None:
                return

            # Get auth token
            token = None
            if self.config.token_manager:
                token = self.config.token_manager.get_access_token()
            token = token or self.config.auth_token

            if not token:
                raise AuthenticationError("No authentication token available")

            # Build WebSocket URL with auth token
            from urllib.parse import urlencode
            params = urlencode({"token": token, "sessionId": self.config.session_id})
            ws_url = f"{self.config.url}?{params}" if "?" not in self.config.url else f"{self.config.url}&{params}"

            try:
                self._ws = await self._create_websocket_connection(ws_url)
                self._reconnect_attempts = 0
                self._should_reconnect = True
                self._is_intentionally_closed = False

                if self.config.on_open:
                    self.config.on_open()

                # Subscribe to session
                await self.send({"type": "subscribe", "sessionId": self.config.session_id})

                # Start listening task
                asyncio.create_task(self._listen())

            except Exception as error:
                self._ws = None
                if self.config.on_error:
                    self.config.on_error(error)
                raise

    async def _create_websocket_connection(self, url: str) -> Any:
        """Create a WebSocket connection."""
        import websockets
        return await websockets.connect(url)

    async def _listen(self) -> None:
        """Listen for messages from the WebSocket."""
        try:
            while self._ws is not None:
                try:
                    message = await self._ws.recv()
                    await self._handle_message(json.loads(message))
                except websockets.ConnectionClosed:
                    break
                except Exception as error:
                    if self.config.on_error:
                        self.config.on_error(error)
                    break
        finally:
            if self._ws is not None and self._should_reconnect and not self._is_intentionally_closed:
                await self._attempt_reconnect()

    async def _handle_message(self, message: dict) -> None:
        """Handle incoming WebSocket message."""
        event = SessionEvent(
            type=SessionEventType(message["type"]),
            payload=message["payload"],
            timestamp=message["timestamp"],
        )

        # Emit general event
        if self.config.on_event:
            self.config.on_event(event)

        # Emit typed events
        payload = message["payload"]

        if event.type == SessionEventType.STATE_CHANGED:
            if self.config.on_state_change:
                self.config.on_state_change(
                    SessionState(payload["previousState"]),
                    SessionState(payload["newState"]),
                )
        elif event.type == SessionEventType.ACTION_REQUESTED:
            if self.config.on_action_requested:
                self.config.on_action_requested(payload["action"])
        elif event.type == SessionEventType.ACTION_EXECUTED:
            if self.config.on_action_executed:
                self.config.on_action_executed(
                    payload["actionId"],
                    payload["success"],
                    payload.get("error"),
                )
        elif event.type == SessionEventType.APPROVAL_REQUIRED:
            if self.config.on_approval_required:
                self.config.on_approval_required(payload["approvalRequest"])
        elif event.type == SessionEventType.APPROVAL_DECIDED:
            if self.config.on_approval_decided:
                self.config.on_approval_decided(
                    payload["approvalId"],
                    payload["decision"],
                    payload["decidedBy"],
                )
        elif event.type == SessionEventType.ERROR:
            if self.config.on_session_error:
                self.config.on_session_error(payload["error"])
        elif event.type == SessionEventType.HEARTBEAT:
            if self.config.on_heartbeat:
                self.config.on_heartbeat(payload["leaseExpiresAt"])

    async def send(self, message: dict) -> None:
        """Send a message to the WebSocket server."""
        if self._ws is None:
            raise WebSocketError("WebSocket is not connected")
        await self._ws.send(json.dumps(message))

    async def _attempt_reconnect(self) -> None:
        """Attempt to reconnect with exponential backoff."""
        if self._reconnect_attempts >= self.config.max_reconnect_attempts:
            if self.config.on_error:
                self.config.on_error(WebSocketError("Maximum reconnection attempts reached"))
            return

        delay = self.config.reconnect_delay * (2**self._reconnect_attempts)
        self._reconnect_attempts += 1

        if self.config.on_error:
            self.config.on_error(
                WebSocketError(f"Attempting to reconnect ({self._reconnect_attempts}/{self.config.max_reconnect_attempts})")
            )

        await asyncio.sleep(delay)

        if self._should_reconnect and not self._is_intentionally_closed:
            try:
                await self.connect()
            except Exception as error:
                if self.config.on_error:
                    self.config.on_error(error)

    async def disconnect(self) -> None:
        """Disconnect from the WebSocket server."""
        self._should_reconnect = False
        self._is_intentionally_closed = True

        if self._reconnect_task:
            self._reconnect_task.cancel()
            self._reconnect_task = None

        if self._ws:
            try:
                # Unsubscribe before closing
                await self.send({
                    "type": "unsubscribe",
                    "sessionId": self.config.session_id,
                })
            except Exception:
                pass

            await self._ws.close()
            self._ws = None

        if self.config.on_close:
            self.config.on_close(1000, "Client disconnecting")

    def is_connected(self) -> bool:
        """Check if connected."""
        return self._ws is not None

    def get_session_id(self) -> str:
        """Get the session ID."""
        return self.config.session_id


def create_websocket_url(base_url: str, session_id: str) -> str:
    """Create a WebSocket URL from a base URL."""
    # Convert http/https to ws/wss
    ws_url = base_url.replace("http://", "ws://").replace("https://", "wss://").rstrip("/")
    return f"{ws_url}/ws/sessions/{session_id}"


class SessionEventIterator:
    """Async iterator for session events."""

    def __init__(self, client: WebSocketClient):
        self.client = client
        self._event_queue: list[SessionEvent] = []
        self._resolve_queue: Optional[Callable[[SessionEvent], None]] = None
        self._done = False

        self.client.on_event = lambda event: self._on_event(event)

    def _on_event(self, event: SessionEvent) -> None:
        """Handle incoming event."""
        if self._resolve_queue:
            self._resolve_queue(event)
            self._resolve_queue = None
        else:
            self._event_queue.append(event)

    async def __anext__(self) -> SessionEvent:
        """Get next event."""
        if self._done:
            raise StopAsyncIteration

        if self._event_queue:
            return self._event_queue.pop(0)

        if not self.client.is_connected():
            self._done = True
            raise StopAsyncIteration

        return await asyncio.get_event_loop().create_future()

    def __aiter__(self) -> "SessionEventIterator":
        return self

    def stop(self) -> None:
        """Stop iterating."""
        self._done = True
        asyncio.create_task(self.client.disconnect())


async def watch_session(config: WebSocketClientConfig) -> SessionEventIterator:
    """Watch a session for events as an async iterator."""
    client = WebSocketClient(config)
    await client.connect()
    return SessionEventIterator(client)
