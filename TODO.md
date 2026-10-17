# TODO

Known limits of the MVP, most important first.

- **Encrypt provider sign-in tokens.** ChatGPT, Claude and other subscription sign-ins are saved as
  plain JSON in `secrets/subscription-auth.json` under the Otto home. Seal them with the existing
  `OTTO_SECRETS_KEY` like every other saved credential.
- **Stream message attachments.** `message_post` keeps the files it accepted in memory until it posts
  them. Uploads and downloads already stream; this path does not.
- **Approve group requests together.** A bot that asks several approvals in a group chat shows them one
  at a time.
- **macOS DMG build.** Packaging stops at the linker until Xcode's command line tools are installed
  (`xcode-select --install`).
- **Durable Garage profile.** `otto-v1-durable-garage` expects `ops/local-garage.toml`, which is not in
  the repository.
- **Railway template.** `deploy/railway/README.md` is the recipe; publish it as a one-click template in
  Railway's template composer. Without SMTP (paid Railway plans only) people sign in with a password
  and cannot be invited by email.
- **Watch drawer close button** sits 9px from the edge instead of 8px.

## Not verified yet

- Dictation with a real microphone.
- `ffmpeg` on bot cloud computers.
- Desktop tabs in fullscreen, and on Windows and Linux.
- Packaged desktop builds.
- Compaction near the 400k-token context limit.
