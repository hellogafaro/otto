# Signed macOS releases and auto-updates

The Mac app is signed with a Developer ID Application certificate, notarized by Apple, and
published as a GitHub release of
[hellogafaro/otto](https://github.com/hellogafaro/otto/releases), the way t3code and bb ship. Installed signed
builds read the latest release and update themselves. Builds without credentials stay ad-hoc
signed, exactly as before, and never update themselves.

## What you need to provide

| Item                                   | Used as                                 | Where it comes from                          |
| -------------------------------------- | --------------------------------------- | -------------------------------------------- |
| Developer ID Application certificate   | Signing identity in your login keychain | Apple Developer account (Account Holder)     |
| App Store Connect API key (`.p8` file) | `APPLE_API_KEY` (file path)             | App Store Connect, Team Keys                 |
| API key ID                             | `APPLE_API_KEY_ID`                      | Shown next to the key                        |
| Issuer ID                              | `APPLE_API_ISSUER`                      | Shown above the Team Keys list               |
| GitHub token that can write releases   | `GH_TOKEN`                              | GitHub fine-grained token or `gh auth token` |

Instead of the three `APPLE_API_*` values, you can store them once with
`xcrun notarytool store-credentials otto-notary --key <p8> --key-id <id> --issuer <issuer>` and set
`APPLE_KEYCHAIN_PROFILE=otto-notary`.

Never commit any of these values. Keep the `.p8` file outside the repository with mode `600`.

## One-time setup

1. **Create the Developer ID Application certificate.** Only the Account Holder of the Apple
   Developer team can create it. In Xcode, open Settings, then Accounts, select the team, choose
   Manage Certificates, click +, and choose Developer ID Application. Xcode stores the
   certificate and its private key in the login keychain. Check it with
   `security find-identity -v -p codesigning`; it must list
   `Developer ID Application: <name> (<team ID>)`. Your Apple Development certificate belongs to
   team `8CRR232C42`. Export a `.p12` backup with Keychain Access, because Apple cannot
   re-download the private key.
2. **Create the App Store Connect API key.** In App Store Connect, open Users and Access, then
   Integrations, then App Store Connect API, then Team Keys. Generate a key with the Developer
   role, download `AuthKey_<KEYID>.p8` (you can download it only once), and note the Key ID and
   the Issuer ID. Store it as `~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` and run
   `chmod 600` on it.
3. **Get a GitHub token.** `gh auth token` works, or a fine-grained personal access token with
   access to `hellogafaro/otto` and the Contents permission set to read and write.
4. **Publish the first signed release**, as described below.
5. **Install the first signed build by hand.** The app you run today is ad-hoc signed. It has no
   update feed, and macOS (Squirrel.Mac) installs an update only when the new app satisfies the
   running app's code requirement, which for an ad-hoc app is one exact build hash. So it can never
   update itself to a signed build. Quit Otto, download `Otto-Bot-<version>-arm64.dmg` from the
   release, drag Otto (Alpha) into Applications to replace the old app, and open it. Every later
   release reaches you through the in-app update.

## Publishing a release

Every release needs a higher version than the installed app, because the updater only offers
newer versions. All product packages are `0.1.0` today. Bump them together, commit, then
release:

```sh
node scripts/update-release-package-versions.ts 0.1.1
git commit -s -am "chore: release 0.1.1"

GH_TOKEN=<token> \
APPLE_API_KEY=~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 \
APPLE_API_KEY_ID=<KEYID> \
APPLE_API_ISSUER=<issuer ID> \
scripts/release-desktop-mac.sh
```

`scripts/release-desktop-mac.sh` does the following:

1. It stops before building when `GH_TOKEN`, the notarization credentials or a Developer ID
   identity is missing, when the server and desktop versions differ, or when
   `hellogafaro/otto` already published `v<version>`.
2. It builds with Xcode's own macOS SDK through `scripts/build-desktop-artifact.ts --signed`.
   Electron-builder signs every binary with the hardened runtime and the entitlements Electron
   needs (JIT, unsigned executable memory, library validation off for native modules, microphone),
   notarizes and staples the app, and packs it into a DMG and a zip. The build script then
   notarizes and staples the DMG and refreshes its hash in `latest-mac.yml`.
3. It verifies the signature, Gatekeeper acceptance and both notarization tickets, and checks
   that the app's `app-update.yml` points at `hellogafaro/otto`.
4. It uploads `Otto-Bot-<version>-arm64.dmg`, `Otto-Bot-<version>-arm64.zip`, the zip blockmap
   and `latest-mac.yml` to a draft release `v<version>`, tagged at the commit you built, then publishes it as the latest
   release. Installed apps see the update only after that last step. A failed run leaves at most a
   draft, and rerunning the script reuses it.

The artifacts are in `release/v<version>/`.

## How the app updates

Packaged builds read `Contents/Resources/app-update.yml`. Signed builds carry:

```yaml
owner: hellogafaro
repo: otto
provider: github
releaseType: release
```

The repository is a constant in `scripts/lib/desktop-build/config.ts`, so no environment variable
can point a build at another repository. With that file present, the app turns
updates on, checks 15 seconds after launch and then every 4 minutes. When a newer release
exists, the sidebar update button downloads the zip, and installing restarts Otto into the new
version. Ad-hoc builds have no `app-update.yml` and report that no update feed is configured.

## Building locally

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
SDKROOT=$(xcrun --sdk macosx --show-sdk-path) \
node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64
```

The build decides how to sign before it starts and repeats the decision at the end:

| Credentials found                                                                   | Result                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| None                                                                                | Ad-hoc build without update feed. The log says `UNSIGNED BUILD`.      |
| Developer ID in the keychain, `CSC_NAME` or `CSC_LINK`, no notarization credentials | Signed, not notarized, with the release feed. For local testing only. |
| Identity plus `APPLE_API_*` or `APPLE_KEYCHAIN_PROFILE`                             | Signed, notarized and stapled app and DMG, with the release feed.     |

`--signed` makes a missing identity an error, and `--signed=false` forces an ad-hoc build. A
partial `APPLE_API_*` set, notarization credentials without an identity, or several Developer
ID identities without `CSC_NAME` stop the build with the reason.

## Data that survives the switch to a signed app

- Otto keeps its window data in `~/Library/Application Support/otto` and its local state in
  `~/.otto`. Both paths come from the app name, not the signature, so they carry over. Cookie
  encryption is off (no Electron fuse turns it on), so the web session does not depend on the
  keychain.
- Electron safe storage encrypts saved environment tokens and the connection catalog with a key
  in the keychain item `otto Safe Storage`. Its access list trusts the app that created it, so
  the first launch of the signed app asks once for keychain access. Choose Always Allow. If you
  deny it, Otto cannot decrypt those secrets and you have to enter them again. On 17 October 2026
  your login keychain had no `otto Safe Storage` item, so nothing needs migrating today.
- macOS ties the microphone permission to the signature and asks for it again once.
- Later signed updates keep the same code requirement, so none of these prompts repeat.

## Testing updates locally with the mock server

The mock feed proves download, install and restart without GitHub. Both builds must be signed
with the same identity; an Apple Development certificate is enough for this local test.

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
export CSC_NAME="Apple Development: <name> (<id>)"
for version in 0.1.0 0.1.1; do
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 \
    --build-version $version --mock-updates --mock-update-server-port 4781 \
    --output-dir release-mock/$version
done
OTTO_LEGACY_DESKTOP_MOCK_UPDATE_SERVER_PORT=4781 \
OTTO_LEGACY_DESKTOP_MOCK_UPDATE_SERVER_ROOT=../release-mock/0.1.1 \
node scripts/mock-update-server.ts
```

Install the `0.1.0` app from its DMG into a scratch folder, open it, wait for the update, then
download and install it. Otto quits, Squirrel.Mac replaces the app, and Otto restarts as
`0.1.1`. Squirrel.Mac relaunches the new app through launchd with your real `HOME`, so the
restarted app opens your normal `~/.otto` state and `~/Library/Application Support/otto` even
when you started the old one with another `HOME`. Run this test in a separate macOS user.

## Optional GitHub Actions release

`deploy/desktop-mac/release-mac.yml` runs the same release script on a GitHub macOS runner. It
is not active. To enable it, copy it to `.github/workflows/release-mac.yml`, confirm that the
runner image has `/Applications/Xcode_26.5.app`, and add these repository secrets to
`hellogafaro/otto`:

- `MACOS_CERTIFICATE_P12`: base64 of the `.p12` export of the Developer ID Application certificate
  and its private key.
- `MACOS_CERTIFICATE_PASSWORD`: the `.p12` export password.
- `APPSTORE_API_KEY_P8`: the text of the `.p8` key.
- `APPSTORE_API_KEY_ID` and `APPSTORE_ISSUER_ID`.

Then run Actions, Release macOS app, Run workflow, after the version bump is on `main`.
