---
"otto": patch
---

bot_update shows models instructions as a plain string again; a field check behind a schema reference was imported as an empty schema, so models sent `instructions: {}`.
