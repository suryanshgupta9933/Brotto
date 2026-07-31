#!/usr/bin/env bash
# Run browser integration tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Browser Integration Test Suite"
echo "=========================================="
echo ""

cd "$EVALS_DIR/integration"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
headed=false
browser=""
platform=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --headed)
            headed=true
            shift
            ;;
        --browser)
            browser="$2"
            shift 2
            ;;
        --platform)
            platform="$2"
            shift 2
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

if [ -n "$browser" ]; then
    cmd="$cmd --project=$browser"
fi

if [ -n "$platform" ]; then
    cmd="$cmd --platform=$platform"
fi

echo -e "${YELLOW}Running integration tests...${NC}"
echo "Command: $cmd"
echo ""

if eval "$cmd" 2>&1; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Integration tests failed${NC}"
    exit 1
fi
