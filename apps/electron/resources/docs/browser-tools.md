# Browser Tools

Use `browser_tool` to browse the web. Your browser is **Fortress**, a Chromium that looks like an ordinary person's browser to the sites you visit. It runs on your computer (your own Linux box when you have one, else the server), keeps your site logins between chats, and gives every chat its own private window: its own tabs and cookies, so chats never get in each other's way.

> **Quick start:** `browser_tool --help` lists every command.

## Browser or a source?

Use the browser for one-off tasks, UI-only workflows and sites without a usable API. Prefer a source (MCP or API) when the work repeats, needs reporting, or the whole team reuses it.

## The flow

1. `navigate <url>`: open a page in this chat's window.
2. `snapshot`: list the page's elements with refs (`@e1`, `@e2`, ...). `find <text>` shows only the matching ones.
3. Act on refs: `click @e3`, `fill @e5 ana@example.com`, `select @e7 Large`, `key Enter`.
4. `snapshot` again after anything that changes the page: refs come from the last snapshot.
5. `screenshot` when you need to see the page: it saves a PNG in your working folder and gives you its path. Read that file to look at it; the person you work for sees it in the chat.

## Commands

| Command | What it does |
|---|---|
| `navigate <url>` (or `open <url>`) | Opens the page and waits for it to load (a bare domain gets `https://`) |
| `snapshot` | Elements with refs, roles, names, values and states (focused, checked, disabled) |
| `find <text>` | The snapshot lines whose role, name or value contains the text |
| `click <@ref>` | Scrolls the element into view and clicks its center |
| `click-at <x> <y>` | Clicks viewport coordinates (canvas apps; take them from a screenshot) |
| `fill <@ref> <text>` | Replaces an input's value and fires input and change |
| `type <text>` | Types into the focused element |
| `select <@ref> <option>` | Picks an option of a native `<select>` by value or label (for custom dropdowns: click, then click the option) |
| `key <name> [modifiers...]` | `key Enter`, `key Tab`, `key a control`; modifiers: shift, control, alt, meta |
| `scroll <up\|down\|left\|right> [px]` | Scrolls the page (600 px by default) |
| `back` / `forward` | Moves through this window's history |
| `wait <ms>` | Waits (at most 60 s) |
| `wait text <text> [ms]` / `wait selector <css> [ms]` | Waits until the text or the element is there (10 s by default) |
| `evaluate <javascript>` | Runs JavaScript in the page and returns the value |
| `screenshot [--full]` | Saves a PNG of the viewport (or the whole page) and returns its path |
| `close` | Closes this chat's window, with its tabs and cookies |

Quoting: in the string form, quotes group words (`fill @e2 "Ana Lima"`). The array form takes each argument as it is: `["evaluate", "const a = 1; a + 1"]`.

## Notes

- On your own computer, the window is on its screen. A person may watch it live, and while they do, they have the screen; you keep working in the background.
- If your computer restarts in the middle of a command, the result says "computer restarted; the action may have run": check the page (`snapshot`) before you repeat an action that sends or buys something.
- "Fortress is not installed" means the server has no browser for agents yet; tell the person you work for, the message says how to install it.
