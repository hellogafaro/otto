#!/usr/bin/env bash
# Builds, signs, notarizes and publishes the macOS arm64 app as a GitHub release of hellogafaro/otto.
# Usage: GH_TOKEN=... APPLE_API_KEY=... APPLE_API_KEY_ID=... APPLE_API_ISSUER=... \
#   scripts/release-desktop-mac.sh [--version X.Y.Z | --version X.Y.Z-beta.YYYYMMDD.N]
# A beta version publishes a prerelease with beta-mac.yml; any other release is the latest stable.
# See deploy/desktop-mac/README.md.
set -euo pipefail

releases_repo="hellogafaro/otto"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
  printf 'release-desktop-mac: %s\n' "$*" >&2
  exit 1
}

check_version() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-beta\.[0-9]{8}\.[0-9]+)?$ ]] ||
    fail "version $1 is neither a stable X.Y.Z nor a beta X.Y.Z-beta.YYYYMMDD.N version."
}

version_override=""
while (($# > 0)); do
  case "$1" in
    --version)
      [[ -n "${2:-}" ]] || fail "--version needs a value."
      version_override="$2"
      shift 2
      ;;
    *) fail "unknown argument $1. Usage: scripts/release-desktop-mac.sh [--version <version>]" ;;
  esac
done

[[ -z "$version_override" ]] || check_version "$version_override"

[[ -n "${GH_TOKEN:-}" ]] || fail "set GH_TOKEN to a token that can write releases in $releases_repo."

if [[ -n "${APPLE_API_KEY:-}${APPLE_API_KEY_ID:-}${APPLE_API_ISSUER:-}" ]]; then
  [[ -n "${APPLE_API_KEY:-}" && -n "${APPLE_API_KEY_ID:-}" && -n "${APPLE_API_ISSUER:-}" ]] ||
    fail "set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER together."
  [[ -f "$APPLE_API_KEY" ]] || fail "APPLE_API_KEY must be the path of the .p8 key file."
elif [[ -z "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  fail "set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_KEYCHAIN_PROFILE, so the build can be notarized."
fi

[[ "$(uname -s)" == Darwin ]] || fail "run this on a Mac."

if [[ -z "${CSC_LINK:-}${CSC_NAME:-}" ]] &&
  ! security find-identity -v -p codesigning | grep -q '"Developer ID Application: '; then
  fail "no Developer ID Application certificate in the keychain. Set CSC_NAME or CSC_LINK, or install one."
fi

command -v gh >/dev/null || fail "install the GitHub CLI (brew install gh)."

if [[ -n "$version_override" ]]; then
  node "$root/scripts/update-release-package-versions.ts" "$version_override" --root "$root"
fi

version="$(node -p "require('$root/apps/server/package.json').version")"
desktop_version="$(node -p "require('$root/apps/desktop/package.json').version")"
[[ "$version" == "$desktop_version" ]] ||
  fail "apps/server ($version) and apps/desktop ($desktop_version) versions differ. Run node scripts/update-release-package-versions.ts <version>."

check_version "$version"

if [[ "$version" == *-beta.* ]]; then
  channel=beta
  title="Otto Beta $version"
  prerelease=true
  latest=false
else
  channel=latest
  title="Otto $version"
  prerelease=false
  latest=true
fi

tag="v$version"
draft="$(gh release view "$tag" --repo "$releases_repo" --json isDraft --jq .isDraft 2>/dev/null || true)"
[[ "$draft" != "false" ]] ||
  fail "$releases_repo already published $tag. Bump the version: node scripts/update-release-package-versions.ts <next version>."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" || fail "Xcode with a macOS SDK is required."
export SDKROOT
export PATH="$root/node_modules/.bin:$PATH"

out="$root/release/$tag"
rm -rf "$out"
node "$root/scripts/build-desktop-artifact.ts" --platform mac --target dmg --arch arm64 \
  --build-version "$version" --signed --output-dir "$out"

dmg="$out/Otto-Bot-$version-arm64.dmg"
zip="$out/Otto-Bot-$version-arm64.zip"
feed="$out/$channel-mac.yml"
assets=("$dmg" "$zip" "$zip.blockmap" "$feed")

for asset in "${assets[@]}"; do
  [[ -f "$asset" ]] || fail "the build did not produce $asset."
done

grep -q "^version: $version$" "$feed" || fail "$(basename "$feed") does not describe $version."

check="$(mktemp -d)"
trap 'rm -rf "$check"' EXIT
ditto -x -k "$zip" "$check"
app="$(find "$check" -maxdepth 1 -name '*.app' -print -quit)"
codesign --verify --deep --strict "$app"
spctl --assess --type execute "$app"
xcrun stapler validate "$app"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature "$dmg"
grep -q "repo: ${releases_repo#*/}" "$app/Contents/Resources/app-update.yml" ||
  fail "the app's app-update.yml does not point at $releases_repo."

commit="$(git -C "$root" rev-parse HEAD)"

if [[ -z "$draft" ]]; then
  gh release create "$tag" --repo "$releases_repo" --draft --prerelease="$prerelease" \
    --target "$commit" --title "$title" \
    --notes "$title for Apple silicon Macs, built from ${commit:0:12}."
fi

gh release upload "$tag" "${assets[@]}" --repo "$releases_repo" --clobber
gh release edit "$tag" --repo "$releases_repo" --draft=false --prerelease="$prerelease" --latest="$latest"

printf 'Published %s: https://github.com/%s/releases/tag/%s\n' "$version" "$releases_repo" "$tag"
