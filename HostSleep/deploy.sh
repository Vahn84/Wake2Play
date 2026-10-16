#!/usr/bin/env bash
# Build dist/index.js (plain concatenation, no toolchain) and push to the Deck.
# The plugin dir's files are owned by `deck`, so no sudo is needed to update them;
# the Decky loader is then asked to reload the plugin through Steam's CEF debugger.
set -euo pipefail
cd "$(dirname "$0")"
DECK_HOST="${DECK_HOST:-deck@steamdeck.local}"
DEST=homebrew/plugins/HostSleep

mkdir -p dist
cat src/decky-runtime.js src/plugin.js > dist/index.js
python3 -I -m py_compile main.py

echo "→ copying to $DECK_HOST:$DEST"
scp -q main.py "$DECK_HOST:$DEST/main.py"
scp -q package.json "$DECK_HOST:$DEST/package.json"
scp -q dist/index.js "$DECK_HOST:$DEST/dist/index.js"
scp -q ../tools/cdp_eval.py "$DECK_HOST:/tmp/cdp_eval.py"

echo "→ reloading plugin"
ssh "$DECK_HOST" "python3 /tmp/cdp_eval.py SharedJSContext \
  'DeckyBackend.call(\"loader/reload_plugin\", \"HostSleep\").then(()=>\"reloaded\", e=>\"reload failed: \"+e)'"
