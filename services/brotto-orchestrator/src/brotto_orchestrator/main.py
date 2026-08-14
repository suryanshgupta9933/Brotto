"""FastAPI app for orchestrator server.

Handles extension WebSocket connections and agent orchestration.
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import json
import asyncio
import uuid

app = FastAPI(title="Brotto Orchestrator", version="1.0.0")

# CORS for extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session storage for bootstrap
sessions = {}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "brotto-orchestrator", "version": "1.0.0"}


@app.post("/v1/sessions")
async def create_session(request: Request):
    """Bootstrap endpoint for extension connection.

    Creates a new session and returns WebSocket URL.
    """
    try:
        body = await request.json()
    except:
        body = {}

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "created_at": asyncio.get_event_loop().time(),
        "device_id": body.get("device_id", "unknown"),
    }

    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "websocket_url": f"ws://localhost:8000/ws/{session_id}",
            "server_url": "http://localhost:8000",
        },
    )


@app.websocket("/ws")
async def websocket_generic(websocket: WebSocket):
    """Generic WebSocket endpoint for testing."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            msg_type = message.get("type")

            print(f"[WS] Received: {msg_type}")

            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "observation":
                print(f"[WS] Received observation")
                await websocket.send_text(json.dumps({
                    "type": "action",
                    "action_type": "wait",
                    "duration_ms": 500,
                }))
            else:
                print(f"[WS] Unknown: {msg_type}")

    except WebSocketDisconnect:
        print("[WS] Client disconnected")
    except Exception as e:
        print(f"[WS] Error: {e}")


@app.websocket("/ws/{session_id}")
async def websocket_session(websocket: WebSocket, session_id: str):
    """Session-specific WebSocket endpoint for extension communication.

    Extension sends observations, orchestrator sends actions.
    """
    if session_id not in sessions:
        await websocket.close(code=1008, reason="Invalid session")
        return

    await websocket.accept()
    print(f"[WS] Session {session_id} connected")

    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            msg_type = message.get("type")
            print(f"[WS:{session_id}] Received: {msg_type}")

            if msg_type == "observation":
                # Extension sent observation, would process here
                print(f"[WS:{session_id}] Processing observation")
                # In a full implementation, would run agent here
                response = {
                    "type": "action",
                    "action_type": "wait",
                    "duration_ms": 500,
                }
                await websocket.send_text(json.dumps(response))

            elif msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))

            else:
                print(f"[WS:{session_id}] Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        print(f"[WS:{session_id}] Client disconnected")
    except Exception as e:
        print(f"[WS:{session_id}] Error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
