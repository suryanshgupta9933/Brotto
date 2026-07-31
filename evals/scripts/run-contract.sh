#!/usr/bin/env bash
# Run contract tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Contract Test Suite"
echo "=========================================="
echo ""

cd "$EVALS_DIR/contract"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if npm test 2>&1; then
    echo -e "${GREEN}✓ Contract tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ Contract tests failed${NC}"
    exit 1
fi
