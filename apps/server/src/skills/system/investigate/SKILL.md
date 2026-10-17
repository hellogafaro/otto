---
name: investigate
description: Use when asked how or why an existing system behaves as it does, to explain it, diagnose a failure or trace a past decision before changing anything.
---

- Look at the real thing: run it, query it, read the live value. Code shape and reports are leads.
- Cite every claim (file and line, commit, task, message, log line). Label inference.
- Keep competing explanations alive until evidence rules them out. Show contradictions and what you couldn't find.

Diagnose:

1. Reproduce the symptom and capture the exact error before theorizing.
2. Rule out hypotheses with the check that eliminates the most. After a restart, update or settings change, suspect state and recent changes first.
3. Find the cause, not a guard that hides the symptom. Confirm it by predicting something and checking it.
4. Report symptom, reproduction, cause with evidence, what you ruled out, and the fix you recommend. Fix it only when asked (implement).

Trace a decision: start from the exact thing and when it last changed (git log and blame, task history, messages near that date). Don't infer intent from shape.
