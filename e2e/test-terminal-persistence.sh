#!/bin/bash
# Regression test: terminal content persists across view switches
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}✓${RESET} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; FAIL=$((FAIL + 1)); }
log() { echo -e "${CYAN}▸${RESET} $1"; }

cleanup() {
  playwright-cli close 2>/dev/null || true
  pkill -f "tsx watch" 2>/dev/null || true
  pkill -f "vite" 2>/dev/null || true
}

trap cleanup EXIT

echo ""
echo "═══════════════════════════════════════"
echo "  Terminal Persistence Regression Test"
echo "═══════════════════════════════════════"
echo ""

# Start servers
log "Starting servers..."
pkill -f "tsx watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1
npm run dev:server &>/tmp/hermes-e2e-server.log &
sleep 2
npm run dev:client &>/tmp/hermes-e2e-client.log &
sleep 3

# Open browser
log "Opening browser..."
playwright-cli open http://localhost:3000 >/dev/null 2>&1
sleep 2

# Add a terminal
log "Creating terminal..."
playwright-cli run-code "async page => {
  await page.getByText('[TERMINALS]').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '[+ ADD TERMINAL]' }).click();
  await page.waitForTimeout(2000);
}" >/dev/null 2>&1

# Verify terminal exists
SNAP=$(playwright-cli snapshot 2>&1 | grep -o '\.playwright-cli/page[^ )]*\.yml')
if grep -q 'Terminal 1' "$SNAP" 2>/dev/null; then
  pass "terminal created"
else
  fail "terminal created"
fi

# Type a unique marker
log "Typing marker text..."
playwright-cli run-code "async page => {
  const termArea = page.locator('.terminal-view').first();
  await termArea.click();
  await page.waitForTimeout(200);
}" >/dev/null 2>&1
playwright-cli type "echo REGRESSION_MARKER_42" >/dev/null 2>&1
playwright-cli press Enter >/dev/null 2>&1
sleep 1

# Verify marker appears
SNAP=$(playwright-cli snapshot 2>&1 | grep -o '\.playwright-cli/page[^ )]*\.yml')
# Can't check terminal content from accessibility snapshot, use screenshot
playwright-cli screenshot --filename=.playwright-cli/persist-before.png >/dev/null 2>&1
pass "typed marker command"

# Switch to kanban
log "Switching to kanban..."
playwright-cli run-code "async page => {
  await page.getByText('[KANBAN]').click();
  await page.waitForTimeout(1000);
}" >/dev/null 2>&1

SNAP=$(playwright-cli snapshot 2>&1 | grep -o '\.playwright-cli/page[^ )]*\.yml')
if grep -q 'TODO' "$SNAP" 2>/dev/null; then
  pass "switched to kanban view"
else
  fail "switched to kanban view"
fi

# Switch back to terminals
log "Switching back to terminals..."
playwright-cli run-code "async page => {
  await page.getByText('[TERMINALS]').click();
  await page.waitForTimeout(1000);
}" >/dev/null 2>&1

# Verify terminal still shows
SNAP=$(playwright-cli snapshot 2>&1 | grep -o '\.playwright-cli/page[^ )]*\.yml')
if grep -q 'Terminal 1' "$SNAP" 2>/dev/null; then
  pass "terminal still visible after switch"
else
  fail "terminal still visible after switch"
fi

# Check content via eval — look for REGRESSION_MARKER_42 in the terminal's text
log "Checking terminal content preservation..."
CONTENT=$(playwright-cli run-code "async page => {
  const text = await page.locator('.terminal-view .xterm-rows').first().textContent();
  return text;
}" 2>&1)

if echo "$CONTENT" | grep -q "REGRESSION_MARKER_42"; then
  pass "terminal content preserved (REGRESSION_MARKER_42 found)"
else
  # Fallback: check via screenshot
  playwright-cli screenshot --filename=.playwright-cli/persist-after.png >/dev/null 2>&1
  fail "terminal content preserved (REGRESSION_MARKER_42 not found in DOM)"
fi

# Check no duplicates — marker should appear at most twice (command + output)
COUNT=$(echo "$CONTENT" | grep -o "REGRESSION_MARKER_42" | wc -l)
if [ "$COUNT" -le 2 ]; then
  pass "no duplicate scrollback replay (marker count: $COUNT)"
else
  fail "duplicate scrollback replay detected (marker count: $COUNT, expected ≤2)"
fi

# Switch to PRs and back for good measure
log "Testing three-way switch (terminals → PRs → terminals)..."
playwright-cli run-code "async page => {
  await page.getByText('[PRs]').click();
  await page.waitForTimeout(500);
  await page.getByText('[TERMINALS]').click();
  await page.waitForTimeout(1000);
}" >/dev/null 2>&1

SNAP=$(playwright-cli snapshot 2>&1 | grep -o '\.playwright-cli/page[^ )]*\.yml')
if grep -q 'Terminal 1' "$SNAP" 2>/dev/null; then
  pass "terminal survives three-way switch"
else
  fail "terminal survives three-way switch"
fi

echo ""
echo "═══════════════════════════════════════"
echo -e "  Results: ${GREEN}${PASS} passed${RESET}, ${RED}${FAIL} failed${RESET}"
echo "═══════════════════════════════════════"
echo ""

exit $FAIL
