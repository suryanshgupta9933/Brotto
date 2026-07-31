# Fara1.5 MVP - Browser Agent

Simple MVP demonstrating Fara-based browser automation.

## Prerequisites

1. **Ollama** - Install from https://ollama.ai
2. **Fara Model** - Pull with: `ollama pull maternion/fara`

## Quick Start

```bash
# 1. Install dependencies
uv venv .venv
source .venv/bin/activate
uv pip install playwright httpx openai python-dotenv pillow
playwright install chromium

# 2. Start Ollama (if not running)
ollama serve

# 3. Run the agent
python agent.py "Go to example.com"
```

## Usage

```bash
python agent.py "Your task here"

# Examples:
python agent.py "Go to github.com and search for playwright"
python agent.py "Search Google for weather in NYC"
python agent.py "Go to wikipedia.org and find the article about AI"
```

## How it Works

1. **Screenshot** - Takes a screenshot of the current browser page
2. **Fara Query** - Sends the screenshot + goal to Fara (Ollama)
3. **Parse Action** - Extracts the action from Fara's response
4. **Execute** - Runs the action in the browser
5. **Loop** - Repeats until task is done

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Playwright  │────▶│    Fara     │◀────│   Ollama    │
│  (Browser)  │     │  (LLM)      │     │  (Local)    │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    ▲
      │                    │
      └────────────────────┘
           Action Loop
```

## Available Actions

- `visit_url(url)` - Navigate to URL
- `left_click(x, y)` - Left click
- `right_click(x, y)` - Right click
- `double_click(x, y)` - Double click
- `mouse_move(x, y)` - Move mouse
- `scroll(delta_x, delta_y)` - Scroll
- `type_text(text)` - Type text
- `press_key(key)` - Press key (Enter, Escape, etc.)
- `wait(seconds)` - Wait
- `screenshot()` - Take screenshot
- `done(message)` - Task complete
