#!/bin/bash
# UnboxCRM Pre-Deploy Build Gate
# Run from project root: bash .claude/skills/pre-deploy-qa/scripts/build-check.sh
# Exit code 0 = pass, 1 = fail

set -euo pipefail

PROJECT_ROOT="${1:-$(pwd)}"
cd "$PROJECT_ROOT"

echo "═══════════════════════════════════════════"
echo "  BUILD GATE — UnboxCRM"
echo "═══════════════════════════════════════════"
echo ""

# 1. Check node_modules exist
if [ ! -d "node_modules" ]; then
    echo "FAIL: node_modules not found. Run 'npm install' first."
    exit 1
fi

# 2. Run build
echo "Running: npx vite build ..."
BUILD_START=$(date +%s)

BUILD_OUTPUT=$(npx vite build 2>&1) || {
    echo "CRITICAL: Build failed!"
    echo ""
    echo "$BUILD_OUTPUT" | grep -iE 'error|ERROR|TS[0-9]' | head -20
    exit 1
}

BUILD_END=$(date +%s)
BUILD_TIME=$((BUILD_END - BUILD_START))

# 3. Check dist exists
if [ ! -f "dist/index.html" ]; then
    echo "FAIL: dist/index.html not found after build"
    exit 1
fi

# 4. Check for TS errors in output
TS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c 'TS[0-9]\{4\}' || true)
if [ "$TS_ERRORS" -gt 0 ]; then
    echo "WARNING: $TS_ERRORS TypeScript diagnostics in build output"
    echo "$BUILD_OUTPUT" | grep 'TS[0-9]\{4\}' | head -10
fi

# 5. Count and check chunk sizes
CHUNK_COUNT=$(echo "$BUILD_OUTPUT" | grep -c 'dist/assets/' || true)
LARGEST_CHUNK=$(echo "$BUILD_OUTPUT" | grep 'dist/assets/' | awk '{print $NF}' | sed 's/[^0-9.]//g' | sort -rn | head -1)

echo ""
echo "Build time:    ${BUILD_TIME}s"
echo "Chunks:        $CHUNK_COUNT"
echo "Largest chunk: ${LARGEST_CHUNK}kB"
echo ""

# 6. Check for oversized chunks (> 1500kB warning)
OVERSIZED=$(echo "$BUILD_OUTPUT" | grep 'dist/assets/' | awk '{
    size = $NF;
    gsub(/[^0-9.]/, "", size);
    if (size + 0 > 1500) print $0
}')

if [ -n "$OVERSIZED" ]; then
    echo "WARNING: Oversized chunks (>1.5MB):"
    echo "$OVERSIZED"
fi

echo "═══════════════════════════════════════════"
echo "  BUILD: PASS"
echo "═══════════════════════════════════════════"
exit 0
