#!/bin/bash
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# The image puts node 22 ahead of nvm on PATH and reads no profile for a
# non-interactive shell, so every npm invocation fails this repo's `engines`
# floor until .nvmrc's version is reached first.
IFS=: read -r LEAD _ <<<"$PATH"
export NVM_DIR="${NVM_DIR:-/opt/nvm}"
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm install >/dev/null
BIN="$(dirname "$(nvm which "$(cat .nvmrc)")")"
export PATH="$BIN:$PATH"

# CLAUDE_ENV_FILE carries the PATH into the session's shells; without it, links
# in the leading PATH entry are what shadow node 22 there.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$BIN:\$PATH\"" >>"$CLAUDE_ENV_FILE"
else
    mkdir -p "$LEAD"
    ln -sfn "$BIN/node" "$BIN/npm" "$BIN/npx" "$LEAD/"
fi

npm install
