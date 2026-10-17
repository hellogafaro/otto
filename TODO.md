# TODO

Known limits of the MVP, most important first.

- **Encrypt provider sign-in tokens.** ChatGPT, Claude and other subscription sign-ins are saved as
  plain JSON in `secrets/subscription-auth.json` under the Otto home. Seal them with the existing
  `OTTO_ENCRYPTION_KEY` like every other saved credential.
- **Stream message attachments.** `message_post` keeps the files it accepted in memory until it posts
  them. Uploads and downloads already stream; this path does not.
- **Approve group requests together.** A bot that asks several approvals in a group chat shows them one
  at a time.
- **macOS DMG build.** It builds, but only with Xcode's own SDK: the newer Command Line Tools SDK
  (macOS 27) breaks Xcode 26's linker. Run `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
SDKROOT=$(xcrun --sdk macosx --show-sdk-path) pnpm dist:desktop:dmg:arm64`. The app is ad-hoc
  signed, so a downloaded copy is blocked by Gatekeeper until it is signed and notarized.
- **Durable Garage profile.** `otto-v1-durable-garage` expects `ops/local-garage.toml`, which is not in
  the repository.
- **Railway template.** `deploy/railway/README.md` is the recipe; publish it as a one-click template in
  Railway's template composer. Without SMTP (paid Railway plans only) people sign in with a password
  and cannot be invited by email.
- **Workspace URL first, several workspaces.** The desktop app opens on "Enter your workspace URL";
  the server then shows setup, sign-in or join as it does today. Running a server on this computer
  becomes one option on that screen. The app keeps a list of servers, each with its own session, and
  a workspace switcher; today it stores one server address and one session. Any Otto app works with
  any Otto server through a stable, versioned API.
- **Watch drawer close button** sits 9px from the edge instead of 8px.

## Not verified yet

- Dictation with a real microphone.
- `ffmpeg` on bot cloud computers.
- Desktop tabs in fullscreen, and on Windows and Linux.
- Packaged desktop builds.
- Compaction near the 400k-token context limit.
