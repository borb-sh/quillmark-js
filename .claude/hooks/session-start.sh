#!/bin/bash
# Node 24 comes from the cloud environment's setup script; `.npmrc` sets engine-strict, so an older Node fails here.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund
