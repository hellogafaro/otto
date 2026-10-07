# Label Configuration

Labels are additive tags that can be applied to sessions. Unlike statuses (which are exclusive — one per session), labels are multi-select (many per session). They form a tree.

Labels live in the workspace database, not in files. Read and change them with the `otto labels` commands (see `otto.md` for all of them). Only workspace owners can change labels; members can list them.

| Command | Arguments |
|---------|-----------|
| `otto labels list` | none (returns the label tree) |
| `otto labels create <label>` | `{ name, color?, parentId?, valueType?, autoRules? }` |
| `otto labels update <id> <patch>` | any of `name`, `color`, `valueType` (`""` makes it a plain label again), `autoRules` (replaces the rules, `[]` clears them) |
| `otto labels delete <id>` | removes the label, its children, and every session's use of them |
| `otto labels move <id> [parentId]` | no parent = top level |
| `otto labels reorder <ids> [parentId]` | `ids`: the JSON list of the siblings in the new order; `parentId` = the level to reorder |

Example: `otto labels create '{"name":"Alpha","color":"info","parentId":"project"}'`.

## Hierarchy

```
Engineering
  ├─ Frontend
  │    └─ React
  └─ Backend
Bug
```

- `id` is a slug (lowercase alphanumeric + hyphens), globally unique across the tree. It never changes, even when the label is renamed.
- Maximum nesting depth: 5 levels
- Order is the position among siblings
- Filtering by a parent includes all descendants

Labels are color-only (colored circles in the UI); there are no icons. There are no built-in labels: a workspace starts with none.

## Label Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | The slug (see above). Used by `update`, `delete`, `move`, `parentId`, routines and session labels. |
| `name` | string | Display name |
| `color` | EntityColor? | System color string (e.g., `"accent"`, `"info/80"`) or custom object (`{ "light": "#hex", "dark": "#hex" }`) |
| `valueType` | `'string' \| 'number' \| 'date' \| 'link'`? | Makes it a valued label. Tells the UI what input to show and agents what format to write. `link` values render as a clickable chip that opens in the browser. Omit for boolean (presence-only) labels. |
| `autoRules` | rule[]? | Auto-apply rules (below) |

## Color Format

Same as statuses — see [statuses documentation](./statuses.md#color-format) for supported formats and common mistakes.

**System colors:** `"accent"`, `"info"`, `"success"`, `"destructive"`, `"foreground"` (with optional `/opacity` 0–100)

**Custom colors:** `{ "light": "#EF4444", "dark": "#F87171" }` — supports hex, OKLCH, RGB, HSL formats

## Session Labels

Sessions store labels as an array of strings. Boolean labels are bare ids; valued labels use the `::` separator:

```json
["bug", "priority::3", "due::2026-01-30", "linear::https://linear.app/issue/ENG-456"]
```

- A session can have zero or many labels
- The `::` split happens on the first occurrence only (values may contain `::`)
- Invalid label ids are silently filtered out at read time
- Hierarchical filtering: clicking a parent label shows sessions tagged with it or any descendant

### Value Types

Values are inferred from the raw string at parse time (ISO date check, then number, then string):

| Type | Format | Example |
|------|--------|---------|
| `number` | Finite number | `"priority::3"`, `"effort::0.5"` |
| `date` | ISO date (YYYY-MM-DD) | `"due::2026-01-30"` |
| `link` | URL (opens in browser on click; scheme optional) | `"docs::https://example.com"` |
| `string` | Anything else | `"team::platform"` |

The `valueType` field is a hint only — the parser always infers from the raw value. `link` is a display hint (clickable chip); a link value still stores as a plain string.

## Color Conventions

When creating or modifying labels, follow these unless the user asks otherwise:

1. **Always add colors.** Every label should have a `color`.
2. **Use complementary colors within a category.** Siblings should use colors from the same family, e.g. "Backend" children in greens/teals, "Frontend" children in indigos/blues.
3. **Use semantic colors for semantic meanings:**
   - Bugs/errors → `"destructive"` or red tones
   - Features/enhancements → `"accent"` or blue/indigo tones
   - Success/done → `"success"` or green tones
   - Info/metadata → `"info"` or sky/cyan tones
   - Neutral/misc → `"foreground/60"` or gray tones

Use custom `{ "light": "#hex", "dark": "#hex" }` objects for sub-labels; reserve system colors for top-level categories.

## Validation

The tool validates what it writes: unique slug ids, nesting depth, colors and `autoRules`. An invalid change is rejected with the reason, so there is nothing to run afterwards.

## Auto-Label Rules

Auto-label rules scan user messages and apply the label with an extracted value. Pass `autoRules` to `create` or `update`:

```json
{
  "action": "update",
  "id": "linear-issue",
  "autoRules": [
    { "pattern": "linear\\.app/[\\w-]+/issue/([A-Z]+-\\d+)", "valueTemplate": "$1", "description": "Matches Linear issue URLs" },
    { "pattern": "\\b([A-Z]{2,5}-\\d+)\\b", "valueTemplate": "$1", "description": "Matches bare issue keys like CRA-123" }
  ]
}
```

Each rule is **either** a regex rule or a semantic rule, never both. Rules are checked when the label is written: invalid regex and ReDoS patterns are rejected.

### Regex rule

| Property | Type | Description |
|----------|------|-------------|
| `pattern` | string | **Required.** JavaScript regex with capture groups. |
| `flags` | string | Regex flags (default `gi`). `g` is always enforced. |
| `valueTemplate` | string | Uses `$1`, `$2` for capture groups. If omitted, the first capture group. |
| `description` | string | Human-readable note. |

- All occurrences in a message are found; "CRA-1 and CRA-2" produces two entries on the same label
- Content inside fenced code blocks and inline code is ignored

Extracted values are normalized by the label's `valueType`:

| valueType | Raw capture | Normalized |
|-----------|-------------|------------|
| `string` | `CRA-123` | `CRA-123` |
| `number` | `$45,000` | `45000` (strip symbol + commas) |
| `number` | `1.5M` / `50k` | `1500000` / `50000` (expand suffix) |
| `date` | `2026-01-30` | `2026-01-30` |

Evaluation: rules run when a user message is sent (fresh and queued); assistant output and tool results are not scanned; the same label+value is never added twice; at most 10 matches per message.

### Semantic rule (requires the Decision Model)

A semantic rule is a yes/no question instead of a regex. The decision model (Jev, Settings > AI > Decision model) answers it for every user message, and the label is applied when the "yes" probability reaches the threshold.

```json
{ "semantic": "Is the user asking about billing, invoices or charges?", "threshold": 0.9 }
```

| Property | Type | Description |
|----------|------|-------------|
| `semantic` | string | **Required.** The yes/no question, in English. Keep it specific. |
| `threshold` | number | "Yes" probability needed, `0 < threshold <= 1`. Default `0.9`. |
| `value` | string | Fixed value for valued labels (`area::mobile-app`). Omitted → the plain label id. |
| `description` | string | Human-readable note. |

- **Inert without the decision model**: when the user has not enabled it (or disabled the `semanticLabels` feature toggle), semantic rules are stored but never evaluated.
- **Off the critical path**: semantic rules run in the background and their labels appear a moment later. Messages shorter than 20 characters are skipped, and so are rules whose label the session already has. System-generated messages are never evaluated.
- **Routines**: a semantic match fires `LabelAdd` routines like any other label change, which is why the default threshold is high.
- **Privacy**: the message (code blocks stripped, cut to 8k characters) is sent to the configured decision provider; every call is recorded in `~/.otto/logs/decisions.jsonl` without the text.

### Example

Auto-tag deadlines and budgets:

```bash
otto labels create '{"name":"Deadline","color":"orange","valueType":"date",
  "autoRules":[{"pattern":"(\\d{4}-\\d{2}-\\d{2})","valueTemplate":"$1","description":"ISO dates"}]}'
otto labels create '{"name":"Budget","color":"green","valueType":"number",
  "autoRules":[{"pattern":"\\$([\\d,.]+[kKmMbB]?)","valueTemplate":"$1","description":"Dollar amounts"}]}'
```

## Sidebar Behavior

Labels appear in the left sidebar as an expandable tree. Clicking a label filters the session list; clicking a parent includes sessions tagged with any descendant.

## Design Decisions

- **No categories**: labels don't affect inbox/archive filtering (that's what statuses are for)
- **All labels are user-controlled**: deletable and renameable; the slug id stays
- **Delete cascade**: deleting a label removes it and all descendants from sessions
- **Values via `::` separator**: flat string storage; `valueType` is only a UI hint
- **Date-only format**: ISO `YYYY-MM-DD`, no time component
