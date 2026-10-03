# Native gateway SSE framing correction

Revision-2 archive `654f208153b05fde6220064855a9d9f7f8f38cd165e88103ef835255e991c064`
remains immutable. Independent review reported G1–G5 and Session/cache/reasoning
passing on that artifact, with actual-socket SSE framing G6 still blocking.
The integrator's published Pi1.0.0 composition reached exact A but received
`event: response.createddata: {...}event: ...` without line/event delimiters.

Pinned CLIProxyAPI v8.0.12 `internal/runtime/executor/codex_executor_stream.go`
uses `scanner.Bytes()` (lines without terminators); its native Responses
translator returns those lines and the SDK base stream handler discards empty
chunks. The upstream stock Responses HTTP handler supplies its own private
framer. Otto's bounded route wrote base-channel chunks directly.

The correction restores one newline on metadata/event lines and two on data
lines. The pinned route emits one JSON data line per native event; event/data
association stays intact. Restored bytes count toward the existing frame and
total-output limits. Account/model/refresh/current-authority checks, native-work
join, write-error handling and cancellation retain their existing behavior.
There is no API, TS, provider pin or login change.

| Executed actual native listener check | Frozen output | Corrected output |
| --- | --- | --- |
| Data-only terminal frame | Unfinished SSE frame | One completed event, exact model and usage10 |
| LF event/data frames with comment, created, function-call item, argument delta, text delta, completed | Zero dispatched events, concatenated wire | Five parsed events in order, exact deltas/model/usage, A1/B0 |
| Same upstream events with CRLF | Zero dispatched events, concatenated wire | Same five parsed events, A1/B0 |

The regression scans the response from the actual SDK server socket using SSE
line/blank-line dispatch, parses JSON and checks event/data type agreement. It
is not a contains-string assertion. Raw red/green/full-check logs and the frozen
source hashes are in worker storage `gateway/revision-3/handoff.json`.
The full published Pi→Otto composition is independently owned by the integrator;
these loopback fixture checks do not prove real OAuth/provider eligibility.
