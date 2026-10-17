---
"otto": patch
---

Daily database backups open each database read-only, so a backup no longer breaks the bot memory store until the next restart ("no such table: mastra_messages" on a fresh install).
