#!/bin/bash
# Cloud sessions ship an older Node than `.nvmrc` pins, and `.npmrc` sets engine-strict, so
# `npm ci` refuses to run until the pinned major is on PATH.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
	exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

major="$(tr -d '[:space:]v' < .nvmrc)"
case "$(uname -m)" in
	x86_64) arch=x64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) echo "unsupported arch $(uname -m)" >&2; exit 1 ;;
esac
prefix="$HOME/.local/node-v$major"

if ! "$prefix/bin/node" --version 2>/dev/null | grep -q "^v$major\."; then
	base="https://nodejs.org/dist/latest-v$major.x"
	tarball="$(curl -fsSL "$base/SHASUMS256.txt" | grep " node-v[0-9.]*-linux-$arch.tar.xz$")"
	name="${tarball##* }"
	tmp="$(mktemp -d)"
	curl -fsSL "$base/$name" -o "$tmp/$name"
	(cd "$tmp" && echo "$tarball" | sha256sum -c --quiet -)
	rm -rf "$prefix"
	mkdir -p "$prefix"
	tar -xJf "$tmp/$name" -C "$prefix" --strip-components=1
	rm -rf "$tmp"
fi

export PATH="$prefix/bin:$PATH"
echo "export PATH=\"$prefix/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"

npm install --no-audit --no-fund
