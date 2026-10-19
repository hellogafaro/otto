# When a bot goes quiet

Sometimes a provider stops sending anything while a bot is still working. After 90 seconds with no sign of life, the chat shows a card, "Bot stopped responding". It names the provider, for example "No response from Grok". Otto does not stop the turn, and the working line stays up.

Thinking does not count as silence, and neither does a tool or task that is still running. Time spent waiting for your approval or your answer does not count either.

The card shows only in the chat that went quiet, and its close button clears it. A deploy closes a card left open when the turn was interrupted.

- If the provider starts responding again, the notice goes away and the inbox item resolves on its own.
- If you would rather not wait, stop the turn from the composer and send your message again.
- If the same turn goes quiet more than once, the same inbox item comes back instead of a new one.
- When the turn finishes or you stop it, the inbox item resolves.

The card is not a connection failure. It means the provider sent nothing at all for 90 seconds: no text, no thinking, and no tool or task in progress. If that keeps happening, check the provider's status page.
