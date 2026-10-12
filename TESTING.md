# Verification

Use the imported [verification guidance](docs/internals/verification.md) and [development scripts](docs/internals/scripts.md). Run `pnpm typecheck` and the applicable package tests through the scripts declared in each package. Native packaging, real provider accounts and confined-computer execution need separate acceptance; static checks and controlled fixtures do not certify them.

Use separate disposable application state. Never run this foundation against a former Otto/BB or Akeru saved database without a separately approved migration. Record source revisions, failed checks, reruns and qualification limits in `docs/native-acceptance.md`.
