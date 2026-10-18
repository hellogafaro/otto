# CI

> For Otto maintainers.

GitHub Actions runs one workflow, [Release macOS app](../../.github/workflows/release-mac.yml), and
only when someone starts it from `main`. Pull requests and pushes run no checks, so run `vp check`,
`vp run typecheck` and `vp test` locally before merging.

See the [release runbook](../operations/release.md).
