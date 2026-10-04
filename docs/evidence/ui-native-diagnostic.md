# Native Pi fixture diagnosis

4 October 2026. Isolated diagnosis checkout: `83a4aa7e7d05fc9405189294b5bd7dc947b97265`,
whose parent is the requested `465c693` pin. The newer commit changes web code;
the native fixture/runtime/test sources are unchanged between those revisions.
Frozen local installation resolves packaged Pi **1.0.0**. The supplied, already
built controlled Go helper was reused. No real credential reads or provider
calls, shared database, shared temporary cleanup, or production changes occurred.

## Reproduction and mechanism

The host `/tmp` tmpfs reports 7.9 GiB used, zero available, 100% usage.
The filesystem containing the owned private temporary base has 109 GiB available.
The focused test ran with `TMPDIR=/home/g4f4r0/.bb/nd-BVfqes`; the child fixture
also explicitly set `TMPDIR` to its own scratch directory after `input.env`.

```sh
OTTO_GATEWAY_FIXTURE_BINARY=/home/g4f4r0/.bb/thread-storage/thr_ea3andz7st/otto-gateway-fixture \
TMPDIR=/home/g4f4r0/.bb/nd-BVfqes \
bun --bun vitest run tests/pi-gateway-runtime.test.ts -t 'admission -> real queue'
```

| Observed check | Result |
| --- | --- |
| Focused smoke with private TMPDIR only | Failed in 20.66 s; 1 failed, 18 skipped |
| Sanitized native stderr | `ENOSPC`, `Failed to load extension` |
| Native Pi exit | Code 1 |
| Controlled upstream model requests | 0 |
| Saved Run state | `uncertain`, expected `finished` |
| Runtime cleanup | `AggregateError: Runtime persistence/cleanup failed` |
| Process completion | Vitest returned exit 1; no remaining child of test PID 334925 |

Temporary diagnostics emitted only fixed error names, allowlisted event/command
types, booleans, and exit codes. Raw native stderr and protocol content were
discarded. Failed-smoke log:
`/home/g4f4r0/.bb/thread-storage/thr_wm9j5vr85d/native-diagnostic-smoke.log`.
SHA-256: `8b324a5aa9b188211328ee2a06800d7f8329874c04827ffa208e45e197ea93bd`.

Pi's bundled jiti 2.7.0 loader contains this guard in `prepareCacheDir`:

```js
if (process.env.TMPDIR && n2 === process.cwd() && !process.env.JITI_RESPECT_TMPDIR_ENV) {
  let t5 = process.env.TMPDIR;
  delete process.env.TMPDIR;
  n2 = os.tmpdir();
  process.env.TMPDIR = t5;
}
```

Here `n2` initially equals `os.tmpdir()`. The fixture deliberately uses the same
directory for `cwd` and `TMPDIR`, so jiti ignores the private path and chooses
`/tmp/jiti`. Its existing writable cache directory passes the access check, but
writing transformed extension code fails on the full filesystem. The bundled
loader's `getCache` calls `writeFileSync` for that transformed code. This explains
why private child writes alone pass while Pi extension startup still fails.

Bundled source:
`node_modules/.bun/@earendil-works+pi-coding-agent@1.0.0+2ad3e2ead4942bdb/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/jiti-loader-C3NU2SDH.js`.
SHA-256: `aee404df8dd95be19248cacbaa1954c4bb8b8d13b1f02e6516a3f527f5dc1d05`.

## Narrow correction

The fixture sets both `TMPDIR: directory` and `JITI_RESPECT_TMPDIR_ENV: "1"`
after `input.env`. The existing pinned loader then keeps the cache inside the
owned scratch directory. No global cache deletion, production backend change,
or changed account/model route is needed.

Verification on the original surface awaits the coordinating root's explicit
runtime-slot authorization. Biome and `git diff --check` pass; the fix has not
yet passed the native smoke or independent review. Full suite, real provider
authorization, billing, storage durability and physical isolation are unverified.
