"""
MVP Browser Agent using Fara via Ollama

A simple implementation demonstrating the core loop:
1. Take screenshot
2. Send to Fara (Ollama)
3. Parse action
4. Execute in browser
"""

import base64
import json
import re
import httpx
from io import BytesIO
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
from PIL import Image

# Playwright imports
try:
    from playwright.sync_api import sync_playwright, Browser, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("Warning: Playwright not installed. Run: uv pip install playwright && playwright install chromium")


@dataclass
class AgentConfig:
    ollama_url: str = "http://localhost:11434"
    model: str = "maternion/fara"
    headless: bool = True
    viewport_width: int = 1280
    viewport_height: int = 720


@dataclass
class Action:
    action_type: str
    params: dict = field(default_factory=dict)
    reasoning: str = ""


class MVPAgent:
    """MVP Browser Agent using Fara + Playwright"""

    def __init__(self, config: AgentConfig = None):
        self.config = config or AgentConfig()
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None

    def start(self):
        """Start the browser"""
        if not PLAYWRIGHT_AVAILABLE:
            raise RuntimeError("Playwright not available")

        p = sync_playwright().start()
        self.browser = p.chromium.launch(headless=self.config.headless)
        context = self.browser.new_context(
            viewport={"width": self.config.viewport_width, "height": self.config.viewport_height}
        )
        self.page = context.new_page()
        print(f"Browser started (headless={self.config.headless})")

    def stop(self):
        """Stop the browser"""
        if self.browser:
            self.browser.close()

    def take_screenshot(self) -> bytes:
        """Take a screenshot of the current page"""
        if not self.page:
            raise RuntimeError("Browser not started")

        screenshot_bytes = self.page.screenshot()
        return screenshot_bytes

    def get_base64_screenshot(self) -> str:
        """Get screenshot as base64 for LLM"""
        screenshot = self.take_screenshot()
        return base64.b64encode(screenshot).decode()

    def encode_image(self, screenshot_bytes: bytes) -> str:
        """Encode screenshot as base64"""
        return base64.b64encode(screenshot_bytes).decode()

    def query_fara(self, goal: str, screenshot_base64: str, history: list[dict] = None) -> dict:
        """Query Fara model via Ollama API"""
        history = history or []

        # Build messages
        messages = [
            {
                "role": "system",
                "content": """You are Fara, a browser automation agent. You see screenshots and decide actions.

Actions available:
- visit_url(url): Navigate to URL
- left_click(x, y): Click at coordinates
- right_click(x, y): Right click at coordinates
- double_click(x, y): Double click at coordinates
- mouse_move(x, y): Move mouse to coordinates
- scroll(delta_x, delta_y): Scroll
- type_text(text): Type text
- press_key(key): Press keyboard key (Enter, Escape, Tab, etc.)
- wait(seconds): Wait for seconds
- screenshot(): Take screenshot
- done(message): Task completed

Respond ONLY with a JSON object:
{"action": "action_name", "params": {"param": "value"}, "reasoning": "why I chose this"}"""
            },
            {
                "role": "user",
                "content": f"Goal: {goal}\n\nCurrent screenshot (base64):\n{screenshot_base64[:1000]}..."
            }
        ]

        # Add history
        for h in history[-5:]:  # Last 5 actions
            messages.append({
                "role": "assistant",
                "content": json.dumps({"action": h.get("action"), "params": h.get("params")})
            })

        payload = {
            "model": self.config.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 500
            }
        }

        try:
            response = httpx.post(
                f"{self.config.ollama_url}/api/chat",
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            result = response.json()

            # Parse the response
            content = result.get("message", {}).get("content", "")

            # Try to extract JSON - handle multiple formats
            try:
                # Check for tool_call format first
                if "tool_call" in content or '"name"' in content:
                    # Try to find tool_call block
                    import re
                    tool_match = re.search(r'tool_call["\s]*:?\s*\{[^}]*"name"\s*:\s*"(\w+)"[^}]*"arguments"\s*:\s*(\{.*?\})\s*\}', content, re.DOTALL)
                    if tool_match:
                        action_name = tool_match.group(1)
                        args_str = tool_match.group(2)
                        args = json.loads(args_str.replace("'", '"'))
                        return {"action": action_name, "params": args}

                    # Alternative: find "action" field
                    action_match = re.search(r'"action"\s*:\s*"(\w+)"', content)
                    if action_match:
                        action = action_match.group(1)
                        params_match = re.search(r'"params"\s*:\s*(\{.*?\})\s*[,}]', content, re.DOTALL)
                        params = json.loads(params_match.group(1).replace("'", '"')) if params_match else {}
                        return {"action": action, "params": params}

                # Find JSON in response
                start = content.find("{")
                end = content.rfind("}") + 1
                if start >= 0 and end > start:
                    json_str = content[start:end]
                    return json.loads(json_str)

                return {"action": "done", "params": {"message": content}, "reasoning": content}
            except (json.JSONDecodeError, re.Error) as e:
                return {"action": "done", "params": {"message": content}, "reasoning": f"Parse error: {e}"}

        except Exception as e:
            return {"action": "error", "params": {"error": str(e)}, "reasoning": "API call failed"}

    def execute_action(self, action: dict) -> bool:
        """Execute an action in the browser"""
        if not self.page:
            return False

        action_type = action.get("action", "")
        params = action.get("params", {})

        try:
            if action_type == "visit_url":
                url = params.get("url")
                if url:
                    self.page.goto(url, wait_until="networkidle")
                    print(f"  → Navigated to {url}")
                return True

            elif action_type == "left_click":
                x, y = params.get("x", 0), params.get("y", 0)
                self.page.mouse.click(x, y)
                print(f"  → Left clicked at ({x}, {y})")
                return True

            elif action_type == "right_click":
                x, y = params.get("x", 0), params.get("y", 0)
                self.page.mouse.click(x, y, button="right")
                print(f"  → Right clicked at ({x}, {y})")
                return True

            elif action_type == "double_click":
                x, y = params.get("x", 0), params.get("y", 0)
                self.page.mouse.dblclick(x, y)
                print(f"  → Double clicked at ({x}, {y})")
                return True

            elif action_type == "mouse_move":
                x, y = params.get("x", 0), params.get("y", 0)
                self.page.mouse.move(x, y)
                print(f"  → Moved mouse to ({x}, {y})")
                return True

            elif action_type == "scroll":
                dx = params.get("delta_x", 0)
                dy = params.get("delta_y", 0)
                self.page.mouse.wheel(dx, dy)
                print(f"  → Scrolled ({dx}, {dy})")
                return True

            elif action_type == "type_text":
                text = params.get("text", "")
                self.page.keyboard.type(text)
                print(f"  → Typed: {text[:50]}...")
                return True

            elif action_type == "press_key":
                key = params.get("key", "Enter")
                self.page.keyboard.press(key)
                print(f"  → Pressed key: {key}")
                return True

            elif action_type == "wait":
                import time
                seconds = params.get("seconds", 1)
                time.sleep(seconds)
                print(f"  → Waited {seconds}s")
                return True

            elif action_type == "screenshot":
                # Already done by query_fara
                print(f"  → Screenshot taken")
                return True

            elif action_type == "done":
                print(f"  → Done: {params.get('message', '')}")
                return False

            elif action_type == "error":
                print(f"  → Error: {params.get('error', 'unknown')}")
                return False

            else:
                print(f"  → Unknown action: {action_type}")
                return True

        except Exception as e:
            print(f"  → Action failed: {e}")
            return False

    def run(self, goal: str, max_steps: int = 10):
        """Run the agent loop"""
        if not PLAYWRIGHT_AVAILABLE:
            print("Cannot run: Playwright not available")
            return

        print(f"\n{'='*60}")
        print(f"Starting MVP Agent")
        print(f"Goal: {goal}")
        print(f"Model: {self.config.model}")
        print(f"{'='*60}\n")

        self.start()
        history = []

        try:
            for step in range(max_steps):
                print(f"\n--- Step {step + 1}/{max_steps} ---")

                # Take screenshot
                screenshot = self.take_screenshot()
                screenshot_b64 = self.encode_image(screenshot)

                # Query Fara
                print(f"Querying Fara...")
                response = self.query_fara(goal, screenshot_b64, history)

                action_type = response.get("action", "done")
                reasoning = response.get("reasoning", "")
                print(f"Action: {action_type}")
                print(f"Reasoning: {reasoning[:100]}..." if reasoning else "")

                # Record in history
                history.append(response)

                # Execute action
                if action_type == "done":
                    print(f"\n{'='*60}")
                    print(f"Task completed!")
                    print(f"Final message: {response.get('params', {}).get('message', '')}")
                    print(f"{'='*60}")
                    break

                success = self.execute_action(response)
                if not success:
                    print(f"Action failed, stopping")
                    break

        finally:
            self.stop()


def main():
    """Main entry point"""
    import sys

    config = AgentConfig(
        ollama_url="http://localhost:11434",
        model="maternion/fara",
        headless=False  # Show browser for MVP demo
    )

    # Get goal from args or use default
    if len(sys.argv) > 1:
        goal = " ".join(sys.argv[1:])
    else:
        goal = "Go to google.com and search for 'browser automation'"

    agent = MVPAgent(config)
    agent.run(goal)


if __name__ == "__main__":
    main()
