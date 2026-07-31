#!/bin/bash
# Setup script for Fara1.5 MVP

set -e

echo "=========================================="
echo "Fara1.5 MVP Setup"
echo "=========================================="

# Check for uv
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    source ~/.cargo/env
fi

# Create virtual environment
echo "Creating virtual environment..."
uv venv .venv --python 3.12
source .venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
uv pip install playwright httpx openai python-dotenv pillow

# Install Playwright browsers
echo "Installing Playwright browsers..."
playwright install chromium

# Check Ollama
echo ""
echo "Checking Ollama..."
if ! command -v ollama &> /dev/null; then
    echo "ERROR: Ollama not found. Install from https://ollama.ai"
    exit 1
fi

echo "Checking for Fara model..."
if ! ollama list | grep -q "maternion/fara"; then
    echo "Pulling Fara model (6GB, first time only)..."
    ollama pull maternion/fara
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "To start:"
echo "  1. Ensure Ollama is running: ollama serve"
echo "  2. Activate venv: source .venv/bin/activate"
echo "  3. Run agent: python agent.py \"your task\""
echo ""
