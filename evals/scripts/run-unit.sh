#!/usr/bin/env bash
# Run unit tests for core packages

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Unit Test Suite"
echo "=========================================="
echo ""

# Unit test directories
UNIT_DIR="$EVALS_DIR/unit"
PACKAGES_DIR="$EVALS_DIR/../packages"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

failed=0

run_package_tests() {
    local package=$1
    local dir=$2

    echo "Testing $package..."

    if [ -d "$dir" ]; then
        cd "$dir"
        if npm test 2>&1; then
            echo -e "${GREEN}✓ $package passed${NC}"
        else
            echo -e "${RED}✗ $package failed${NC}"
            failed=1
        fi
        cd "$UNIT_DIR"
    else
        echo -e "${RED}! $package not found${NC}"
        failed=1
    fi
    echo ""
}

# Run tests for each package
run_package_tests "coordinate-transform" "$PACKAGES_DIR/coordinate-transform"
run_package_tests "fara-action-schema" "$PACKAGES_DIR/fara-action-schema"
run_package_tests "policy-engine" "$PACKAGES_DIR/policy-engine"
run_package_tests "relay-protocol" "$PACKAGES_DIR/relay-protocol"

# Run additional unit tests from evals/unit
echo "Running additional unit tests..."
cd "$UNIT_DIR"
if npm test 2>&1; then
    echo -e "${GREEN}✓ Additional unit tests passed${NC}"
else
    echo -e "${RED}✗ Additional unit tests failed${NC}"
    failed=1
fi

echo ""
echo "=========================================="
if [ $failed -eq 0 ]; then
    echo -e "${GREEN}All unit tests passed${NC}"
else
    echo -e "${RED}Some unit tests failed${NC}"
fi
echo "=========================================="

exit $failed
