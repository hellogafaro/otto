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

Pi's bundled jiti 2.7.0 loader contains this guard in `prepareCacheDir`
(the `os.tmpdir` import alias is expanded below):

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

## Verification on the original surface

After the coordinating root explicitly released the runtime slot again, the
same focused command ran against signed commit
`e8193d7480e1c8c6feb185dfcadb91a7e954f4c3`, with temporary diagnostics removed.
The final fixture SHA-256 is
`590263467ecf3cd5013addbd85e6199df5df3501b94476bad14da85b78cc479e`.

| Observed production-seam assertion | Result |
| --- | --- |
| Focused smoke after correction | Passed in 9.75 s; 1 passed, 18 skipped; Vitest exit 0 |
| Saved Run state | `finished` |
| Controlled upstream model requests | Exactly 3 |
| Native coding tool | `controlled.txt` contains `written by managed Pi\n` |
| Scoped Otto tool | Model request includes `exact accepted content` from the accepted Document |
| Saved usage | Complete; 3 receipts, 30 input + 6 output = 36 tokens |
| Cost estimate | USD 0.00012; agrees with Pi's native price computation |
| Exact retry | Same Run id; model request count remains 3 |
| Runtime persistence health | 0 errors |
| Native/Go/PostgreSQL cleanup | afterAll passed, including Go helper exit 0; no remaining child of test PID 337631 |
| Formatting and whitespace | Biome and `git diff --check` pass |

Verification log:
`/home/g4f4r0/.bb/thread-storage/thr_wm9j5vr85d/native-verification-smoke.log`.
SHA-256: `2a3b0a2514b8e1876221325c932f509d9ee00f7cd89eed179a3c2da9170c57dc`.
The pass covers the existing assertions in `tests/pi-gateway-runtime.test.ts`
for admission, actual queue dispatch, packaged Pi, coding/scoped tools, exact
account routing, saved output/usage and joined cleanup. It confirms the
extension-cache correction resolves the original failure without changing
production runtime code.

Independent review belongs to the integrating root and is not claimed here.
Full suite, real provider authorization, billing, storage durability and physical
isolation are unverified by this bounded diagnosis.

## Later integrated-suite failure and focused boundary

The integrating root's later run completed in 1024.26 s: 47 files passed,
1 failed; 410 tests passed, 10 failed. The native Pi file had 9 passes and
10 failures. Its first failing case was `retains unconfirmed model I/O when
its transport ignores cancellation`: its `finally` Stop returned HTTP 503
with `{"error":"unavailable"}` instead of 200 at test line 1530. Suite closure
also reported `Runtime persistence/cleanup failed`. Later Runs remained queued
or produced no summary receipts; the controlled peer saw only 13 model requests.

The production runtime retains cleanup/persistence errors and refuses subsequent
dispatch when `errors.length > 0` (`packages/runs/src/runtime.ts:385`). This
explains the observed cascade after the first failed Stop. It does not identify
the underlying native cleanup error: the HTTP response intentionally exposes
only `unavailable`, and the suite's aggregate report did not expand its cause.

Integrated log:
`/home/g4f4r0/.bb/thread-storage/thr_ea3andz7st/integrated-suite-final.log`.
SHA-256: `75c9c0e2d43ac6bc12b609541eef38950c277a04739f2e636cf7270f512736e3`.

After explicit runtime-slot release, the unchanged minimal fixture ran the two
standalone cases in a fresh short private temporary base with a clean environment:

```sh
env -i PATH=/home/g4f4r0/.bun/bin:/usr/bin:/bin HOME=/home/g4f4r0 \
TMPDIR=/home/g4f4r0/.bb/nd-oLOCib \
OTTO_GATEWAY_FIXTURE_BINARY=/home/g4f4r0/.bb/thread-storage/thr_ea3andz7st/otto-gateway-fixture \
/home/g4f4r0/.bun/bin/bun --bun vitest run tests/pi-gateway-runtime.test.ts \
  -t 'retains unconfirmed model I/O|joins the actual native stream'
```

| Boundary check | Observed result |
| --- | --- |
| Both focused cases | Passed; 2 passed, 17 skipped; 21.77 s; exit 0 |
| Unconfirmed transport case | Passed in 14.013 s, including both expected cleanup refusals, successful final Stop, zero active Runs and zero persistence errors |
| Participant revocation case | Passed in 4.063 s, including joined native cleanup, no unauthorized output, healthy gateway and successful sibling script |
| Controlled model requests | 2 |
| Process completion | Suite cleanup passed; no remaining child of test PID 349327 |
| Fixture bytes | Unchanged SHA-256 `590263467ecf3cd5013addbd85e6199df5df3501b94476bad14da85b78cc479e` |

Boundary log:
`/home/g4f4r0/.bb/thread-storage/thr_wm9j5vr85d/native-clean-boundary.log`.
SHA-256: `1c1ad6284a5d18c23643c30f2e3f8cd52291ea52b9fa3708226bfe34781a87ce`.

This boundary pass rules out an unconditional failure of these two cases with
the corrected fixture. It changes both inherited environment and prior test
history, so it cannot by itself assign the integrated failure to either one.
No additional production correction is justified by the evidence collected here.
