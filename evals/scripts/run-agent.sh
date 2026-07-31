#!/usr/bin/env bash
# Run agent evaluation suite

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Agent Evaluation Suite"
echo "=========================================="
echo ""

cd "$EVALS_DIR/agent"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
headed=false
tasks=""
metrics=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --headed)
            headed=true
            shift
            ;;
        --tasks)
            tasks="$2"
            shift 2
            ;;
        --metrics)
            metrics=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Build command
cmd="npx playwright test"

if [ "$headed" = true ]; then
    cmd="$cmd --headed"
fi

if [ -n "$tasks" ]; then
    cmd="$cmd --testNamePattern=$tasks"
fi

if [ "$metrics" = true ]; then
    cmd="$cmd --testNamePattern=metrics"
fi

echo -e "${YELLOW}Running agent evaluation...${NC}"
echo "Command: $cmd"
echo ""

if eval "$cmd" 2>&1; then
    echo -e "${GREEN}✓ Agent evaluation passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Agent evaluation failed${NC}"
    exit 1
fi
