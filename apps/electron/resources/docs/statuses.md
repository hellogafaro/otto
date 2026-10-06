# Status Configuration

Session statuses represent workflow states. Each workspace has its own statuses.

Statuses live in the workspace database, not in files. Read and change them with the `statuses_edit` tool (this tool will be replaced by the Python `otto` CLI, `otto statuses`). Only workspace owners can change statuses; members can list them.

## The `statuses_edit` Tool

| Action | Arguments |
|--------|-----------|
| `list` | none |
| `create` | `label`, `category`, optional `color`, `icon` |
| `update` | `id`, any of `label`, `color`, `icon`, `category` |
| `delete` | `id` (its sessions move to `todo`) |
| `reorder` | `orderedIds` (status ids in the new order; any left out follow) |
| `set_default` | `id` (the status new chats get) |

Example: `statuses_edit({ action: "create", label: "Blocked", color: "destructive", icon: "🚫", category: "open" })`.

## Default Statuses

| ID | Label | Default Color | Category | Type |
|----|-------|---------------|----------|------|
| `backlog` | Backlog | foreground/50 | open | Seeded |
| `todo` | Todo | foreground/50 | open | Fixed |
| `needs-review` | Needs Review | info | open | Seeded |
| `done` | Done | accent | closed | Fixed |
| `cancelled` | Cancelled | foreground/50 | closed | Fixed |
| `archived` | Archived | foreground/50 | archived | Fixed |

**Note:** Color is optional. When omitted, the design system default is used.

- **Fixed** (`todo`, `done`, `cancelled`, `archived`): cannot be deleted, and their category cannot change. Label, color and icon can.
- **Default** (`isDefault`): the one status new chats get. It is `todo` until `set_default` picks another, and it cannot be deleted.
- **Custom**: everything else, fully editable and deletable. A status `id` is a slug and never changes.

## Category System

- **open**: Session appears in inbox/active list
- **closed**: Session appears in archive/completed list
- **archived**: only the fixed `archived` status; archiving a chat moves it there. You cannot create or set it.

## Color Format

Colors use the `EntityColor` type — either a system color string or a custom color object.

### System Colors

Auto-adapt to light/dark theme via CSS variables. No hex values needed.

| Name | Appearance | Example |
|------|-----------|---------|
| `"accent"` | Purple (brand) | `"accent"` |
| `"info"` | Amber | `"info"` |
| `"success"` | Green | `"success"` |
| `"destructive"` | Red | `"destructive"` |
| `"foreground"` | Text color | `"foreground"` |

Add `/opacity` (integer 0–100) for transparency: `"foreground/50"`, `"info/80"`.

### Custom Colors

Object with explicit CSS color values for light and dark themes:

```json
{ "light": "#EF4444", "dark": "#F87171" }
```

If `dark` is omitted, it's auto-derived from `light` (brightened ~30%).

**Supported CSS color formats for `light`/`dark` values:**

| Format | Example |
|--------|---------|
| Hex (3-digit) | `"#F00"` |
| Hex (6-digit) | `"#EF4444"` |
| Hex (8-digit, with alpha) | `"#EF444480"` |
| OKLCH | `"oklch(0.7 0.15 20)"` |
| RGB | `"rgb(239, 68, 68)"` |
| HSL | `"hsl(0, 84%, 60%)"` |

### Common Mistakes

- Bare color names (`"red"`, `"blue"`) are **not** supported — use hex or system colors
- Tailwind classes (`"text-red-500"`) are **not** valid — use system color names directly
- Hex without `#` prefix (`"EF4444"`) is invalid — always include `#`
- System color opacity must be an integer 0–100 (`"foreground/50"` not `"foreground/0.5"`)

## Status Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique slug (lowercase, hyphens), e.g. `"in-progress"` |
| `label` | string | Display name |
| `color` | EntityColor? | System color or custom object. Uses the design system default if omitted. |
| `icon` | string? | An emoji, or an image data URL of at most 16 KB. Web addresses are rejected. |
| `category` | `"open"` \| `"closed"` \| `"archived"` | Inbox vs archive (`archived` is the fixed archived status only; you set `open` or `closed`) |
| `isFixed` | boolean | `todo`, `done`, `cancelled`, `archived`; read-only |
| `isDefault` | boolean | The status new chats get; change it with `set_default` |
| `position` | number | Display order; change it with `reorder` |

## Icons

- **Emoji** (quick and universal): `"icon": "🔥"`
- **Image data URL** (at most 16 KB): generate an SVG and pass it as a `data:image/svg+xml` URL. An SVG that uses `currentColor` takes the status color.
- With no icon, a bullet is shown.

SVG guidelines: 24x24, `currentColor` for stroke/fill, stroke-width 2, round linecap and linejoin.

## Validation

The tool validates what it writes: the fixed statuses cannot be deleted or change category, the default cannot be deleted, and icons must be an emoji or a data URL within 16 KB. An invalid change is rejected with the reason, so there is nothing to run afterwards. A session whose status id no longer exists falls back to `todo`.
