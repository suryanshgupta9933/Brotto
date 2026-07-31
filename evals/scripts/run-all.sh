#!/usr/bin/env bash
# Test runner script for all evaluation suites

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Fara1.5 Evaluation Suite Runner"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

run_suite() {
    local name=$1
    local dir=$2
    local command=$3

    echo -e "${YELLOW}Running $name...${NC}"

    if [ -d "$dir" ]; then
        cd "$dir"
        if eval "$command"; then
            echo -e "${GREEN}✓ $name passed${NC}"
        else
            echo -e "${RED}✗ $name failed${NC}"
            return 1
        fi
        cd "$EVALS_DIR"
    else
        echo -e "${RED}! $name directory not found, skipping${NC}"
    fi
    echo ""
}

# Run unit tests
run_suite "Unit Tests" "$EVALS_DIR/unit" "npm test"

# Run contract tests
run_suite "Contract Tests" "$EVALS_DIR/contract" "npm test"

# Run security tests
run_suite "Security Tests" "$EVALS_DIR/security" "npm test"

# Run integration tests
run_suite "Integration Tests" "$EVALS_DIR/integration" "npm test"

# Run agent evaluation
run_suite "Agent Evaluation" "$EVALS_DIR/agent" "npm test"

echo "=========================================="
echo -e "${GREEN}All evaluation suites completed${NC}"
echo "=========================================="
