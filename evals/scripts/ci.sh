#!/usr/bin/env bash
# CI test runner for GitHub Actions / CI systems

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "CI Test Runner - Fara1.5 Evals"
echo "=========================================="
echo ""

cd "$EVALS_DIR"

# Track failures
failed=0

run_and_report() {
    local name=$1
    local dir=$2
    local cmd=$3

    echo ""
    echo "----------------------------------------"
    echo "Running: $name"
    echo "----------------------------------------"

    if [ -d "$dir" ]; then
        cd "$dir"
        if eval "$cmd"; then
            echo "✓ $name passed"
        else
            echo "✗ $name failed"
            failed=1
        fi
        cd "$EVALS_DIR"
    else
        echo "! $name directory not found"
        failed=1
    fi
}

# Install dependencies
echo "Installing dependencies..."
cd "$EVALS_DIR/.."
if [ -f "npm install-all.sh" ]; then
    ./npm install-all.sh || npm install
else
    npm install
fi

# Run unit tests
run_and_report "Unit Tests" "$EVALS_DIR/unit" "npm test"

# Run contract tests
run_and_report "Contract Tests" "$EVALS_DIR/contract" "npm test"

# Run security tests
run_and_report "Security Tests" "$EVALS_DIR/security" "npm test"

# Run integration tests (headless)
run_and_report "Integration Tests" "$EVALS_DIR/integration" "npx playwright test --reporter=line"

# Run agent evaluation
run_and_report "Agent Evaluation" "$EVALS_DIR/agent" "npx playwright test --reporter=line"

echo ""
echo "=========================================="
echo "CI Test Results"
echo "=========================================="

if [ $failed -eq 0 ]; then
    echo "✓ All tests passed"
    exit 0
else
    echo "✗ Some tests failed"
    exit 1
fi
