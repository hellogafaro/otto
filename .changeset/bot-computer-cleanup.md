---
"otto": patch
---

Each chat gets its own Local or Boat computer. Deleted sandboxes (E2B, Daytona, Vercel, Railway) are gone; leftover settings and identity files fall back to Local or are swept. A later turn in the same chat resumes its Boat VM instead of creating a new one. A deleted bot's computers, the one a bot left when its sandbox changed, a leftover per-bot computer, and an unclaimed remote a week after it is found are deleted by a sweep at startup and every 10 minutes.
