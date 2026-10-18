# Release runbook

> Do not publish a signed Otto build until qualified legal counsel approves the current Terms
> of Use and Privacy Policy versions in `packages/contracts/src/settings.ts`.

> For Otto maintainers.

The macOS arm64 app is the only thing Otto releases.
[Release macOS app](../../.github/workflows/release-mac.yml) builds, signs, notarizes and publishes
it as a GitHub release of `hellogafaro/otto`. It only starts by hand, with Run workflow on `main`:

- Channel `beta` publishes the head of `main` as the prerelease `X.Y.Z-beta.YYYYMMDD.N`.
- Channel `stable` publishes the commit of the latest beta as the latest release.

[Signed macOS releases and auto-updates](../../deploy/desktop-mac/README.md) covers the repository
secrets, the update channels, publishing from a Mac and local builds.

Before a stable release, refresh the bundled model catalog with
`node apps/server/scripts/sync-model-catalog.ts` and commit any change. Running servers fetch
models.dev on their own; the bundle only covers first launch and offline environments.

Releases from before the catalog still read `apps/server/src/provider/model-manifest.json` from
`main` to decide which models are current. When a model release changes the current lineup, update
that file's `currentModels` lists to match the new catalog in the same commit.
