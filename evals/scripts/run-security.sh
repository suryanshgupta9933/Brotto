#!/usr/bin/env bash
# Run security tests

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Security Test Suite"
echo "=========================================="
echo ""

cd "$EVALS_DIR/security"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

failed=0

run_security_test() {
    local name=$1
    local command=$2

    echo "Running $name..."

    if eval "$command" 2>&1; then
        echo -e "${GREEN}✓ $name passed${NC}"
    else
        echo -e "${RED}✗ $name failed${NC}"
        failed=1
    fi
    echo ""
}

# Run different security test categories
run_security_test "Prompt Injection Tests" "npm test -- --testPathPattern=prompt-injection"
run_security_test "SSRF Tests" "npm test -- --testPathPattern=ssrf"
run_security_test "Token Security Tests" "npm test -- --testPathPattern=token"

echo "=========================================="
if [ $failed -eq 0 ]; then
    echo -e "${GREEN}All security tests passed${NC}"
else
    echo -e "${RED}Some security tests failed${NC}"
fi
echo "=========================================="

exit $failed
