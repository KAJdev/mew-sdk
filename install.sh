#!/bin/sh
set -eu

repo="KAJdev/mew-sdk"
version="${MEW_VERSION:-latest}"
install_dir="${MEW_INSTALL_DIR:-$HOME/.mew/bin}"
if [ -n "${MEW_RELEASE_URL:-}" ]; then
  base="$MEW_RELEASE_URL"
elif [ "$version" = "latest" ]; then
  base="https://github.com/$repo/releases/latest/download"
else
  base="https://github.com/$repo/releases/download/$version"
fi

fail() { echo "mew install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported operating system $(uname -s); download a binary from https://github.com/$repo/releases" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac
if [ "$os" = darwin ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
asset="mew-$os-$arch"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --proto '=https,file' --tlsv1.2 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  fail "curl or wget is required"
fi
if command -v sha256sum >/dev/null 2>&1; then
  digest() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  digest() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "sha256sum or shasum is required"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "could not download $base/SHA256SUMS"
fetch "$base/$asset" "$tmp/$asset" || fail "could not download $base/$asset"
expected="$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "$asset is not listed in SHA256SUMS"
actual="$(digest "$tmp/$asset")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)"

mkdir -p "$install_dir"
chmod 755 "$tmp/$asset"
mv "$tmp/$asset" "$install_dir/mew"
echo "Installed mew $("$install_dir/mew" --version) to $install_dir/mew"
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) echo "Add $install_dir to your PATH, for example: export PATH=\"$install_dir:\$PATH\"" ;;
esac
