---
"otto": patch
---

Bot computers no longer outlive their bots. A deleted bot's computer, the one a bot left when its sandbox or key changed, and an unclaimed old one a week after it is found are deleted by a sweep that runs at startup and every 10 minutes. Boat computers stop by themselves 30 minutes after Otto last used them, even when Otto is down, a failed Boat stop is retried, and creating one is safe to retry. A failed session start no longer deletes the bot's computer, and a Railway or E2B computer the provider removed is replaced instead of failing every start.
