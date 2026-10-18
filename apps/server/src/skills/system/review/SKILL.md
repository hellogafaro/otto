---
name: review
description: Use when heavy or long work is drafted (code, a document, research, a plan, a data change) before delivering it, or when asked to review someone else's work.
---

- Read what was asked first, then the whole result and the context it lands in: the code around a diff, the sources behind a document, the data a change touches.
- Judge the behaviour or content against the request, not only style: correctness, edge cases, security and privacy (secrets, access, personal data, untrusted input), missing pieces and leftovers (dead code, placeholders, drafts, temporary files).
- Run the checks yourself when you can and say what you ran. When unsure, say what to check instead of calling it wrong.
- Write each finding with its location, what is wrong, why it matters and a concrete fix, marked blocking, should fix or nit.
- Your own work: fix your findings, then verify again what the fixes touched before you deliver.
- Someone else's work: give it back to them as findings. Formal approval or merging is a separate action governed by the shared authorization rule; a review request alone does not authorize either.
- Not for testing that a result works (verify) or for a recap (summarize).

Answer review feedback

- Treat each comment as evidence, not an order. Check it against the current result, fix the valid ones at the cause and reply to every comment with what you changed or why not.
- If the same kind of fix keeps coming back, stop, rethink the approach and tell the person.
