#!/bin/bash
# The image's Node 22 is below the `engines` floor, which `.npmrc` makes strict; the suite runs on it.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund --engine-strict=false
