# Organize chats

## Chat activity and replies

While a bot works, its status names the current step when the provider reports it, such as thinking,
running a command, or adding a routine. When a provider stops sending output, the status says so and
shows how long it has been quiet.

To reply to a specific message, use **Reply** on that message. The sent reply keeps a short reference
above your text. Select the referenced person's name to jump back to the original message when it
can be identified.

## Message a person

Pick one person, and no bot, in **New chat** to message them directly. If you already have a DM with
them, it opens instead of starting a new one. Only the two of you see it, no bot answers in it, and
the other person gets a notification for each message. Your DMs with people are listed under **DMs**
after your bots.

## Chat actions

On web and desktop, the roster keeps one row per bot or group, and each of a bot's chats is listed under it, including when there is only one. Open a chat row to open that chat. The bot row itself does not open a chat. Hover it for a plus that starts a new chat with that bot, and, when it has a chat, a chevron that folds the list. Right-click the bot to open its settings, move it, or archive it.

Open the **⋯** menu at the top right of the open chat, or right-click a chat in the sidebar, to act on it. Both menus are the same:

- **Rename chat** and **Regenerate title** change the chat's title.
- **Snooze** until a preset time, such as **In 1 hour** or **Tomorrow**, and **Wake chat** to end the snooze early.
- **Copy link** and **Copy ID**.
- **Archive chat**. A chat cannot be archived while the bot is replying. Delete stays on **Settings > Archived**.

The chat header shows **Snoozed until** with the wake time while the chat is snoozed. The same actions are in the command palette under **This chat** while the chat is open. The palette lists each snooze choice as its own entry, such as **Snooze chat: Tomorrow**, with its wake time. Search in the chat sidebar opens that palette on the Chats tab.

On mobile, the chat list keeps its own menu for each chat, and you can swipe left on a chat for
archive and delete.
Date labels in bot and group chats follow your device's local day and update when the day changes.

## Older chats

On web and desktop, a bot's chats are listed under its row in the sidebar, newest first, up to eight, with how long ago each one was active. The chat you are looking at is highlighted. Select a chat to open it. The bot row does not open a chat. Hover the bot and select the plus to start a new chat with that bot. Archived chats stay in **Settings > Archived**.

Reloading the page, or archiving the open chat, leaves the bot in the sidebar. Open another of its chats, or start a new one, from there.

On mobile, the chat list shows every chat, so older chats are already one tap away.

## Find a chat

On web and desktop, open the command palette and type. Below the matching actions, **Chats** lists
up to eight chats whose title or messages contain what you typed, with the bot's name and, for a
message match, the matching text. Selecting a bot's chat opens it in that bot's view, as selecting it
from the bot's **Chats** list does. A group chat opens the group.

Search covers every environment this client is connected to. Chats in another environment are
listed after the ones you can open, with their bot or group and that environment's name, but cannot
be opened from here; open them from a client connected to that environment. Start your query with `>` to search actions only.

## Snoozed chats

Use **Snooze** to hide a chat until its wake time. Use **Wake chat** to return it early.

On web and desktop, snoozing a bot's open chat keeps it open. Archiving or deleting it
does not: the bot then opens its next newest chat, or an empty chat if it has none.

## Archived chats

**Settings > Archived** lists the chats you archived on this environment, grouped by bot or
group, newest first. Select **Unarchive** to bring a chat back, or the delete button to remove it
for good. An unarchived chat becomes the bot's open chat again when it is the bot's newest chat.
Work one bot handed to another does not appear here, because it never shows as a chat of its own.
The command palette's **Archived chats** action opens the same page.

## Pinned order

On mobile, pinned chats appear above active bot work across projects and environments. Open a
pinned chat's menu and select **Move up** or **Move down** to reorder it.

The environment server stores the order. An older server can still pin a chat but keeps its default
newest-first order until it is updated.

## Group chats

A group is a chat with two or more bots. Open the **+** menu at the top of the roster and select
**New group**. Name the group, pick a **Boss**, and add at least one more bot.

Open a group and use its group sidebar to manage it:

- Change the **Name** and save it.
- Pick a new **Boss**. The previous boss stays in the group as a regular member.
- Add a bot with **Add bot**. When every bot is already in the group, the sidebar says so.
- Remove a bot with its remove button. A group always keeps at least two bots, and you cannot
  remove the boss until another bot is the boss. The sidebar explains which rule applies.
- **Delete group** asks for confirmation. Its bots stay in your roster.

The boss answers every message by default. Type `@` and a bot's name, such as `@Mori`, to send that
message to that bot instead. It answers with its own provider and model. If a message mentions
several bots, the last mention wins. If two bots in the group share a name, Otto cannot tell them
apart, so it holds the message and asks you to rename one of them. Mentions of people, such as
`@Leo`, stay plain text and the boss answers. On mobile, a reply shows the bot's avatar and name
whenever a different bot starts speaking.

Groups hold bots only. You cannot add people to a group yet.

## Work sent to other bots

A bot can hand part of a request to another bot. The bot does not wait for that work. It replies
first, and a work card in the chat shows the other bot, the task, and its state: queued, running,
blocked, completed, failed, or canceled. On mobile the same card appears inline in the chat and
stays visible when that turn's work log is collapsed. Its **Let it finish**, **Cancel**, and **Try again**
buttons work the same as on web and desktop.

On web and desktop, each card sits right after the exchange that started the work, and it stays
there when you reload or come back later. Work started in three different replies shows up as
three cards at three points in the chat. The card also shows how long the work has taken and the
tokens it used. A card labelled **Scheduled** came from a routine, and **Retried** means it
replaces an earlier attempt. In a group chat the card names both bots, such as "Otto asked
Mori", because any bot in the group can hand off work.

Open **Details** on a card to see the expected result and the access the other bot was given,
including its tools and MCP servers. **View work** opens a read-only view of the other bot's chat
for that work. **Open chat** takes you to that bot's own chat, where you can keep talking to it.
Handed-off work only appears as cards. It never becomes the bot's chat in the sidebar and does not
show up in chat search.

While work is still running, the chat shows **Waiting on delegated work**. When the work finishes,
the card shows the result or what went wrong, and one of these lines:

- **Result waiting for the next reply** means your bot has not seen the result yet. Send another
  message and the bot uses the result in that reply. If you send nothing, the result stays on the
  card.
- **Result delivered to {name}** means your bot has received the result, with {name} naming your
  bot that received it. It does not receive it again.

If the server restarts while work is still running, that work stops. Its card shows "The server
restarted before this work finished." and offers **Try again**. Work that is waiting on you keeps
its card as it was. If a routine started that work, the routine's run fails too, and the routine
waits for you to resume it.

A bot runs at most three pieces of work at a time from one chat. Asking the same bot twice starts
two separate pieces of work, each with its own card.

In a group chat, a bot can hand work only to bots in that group. The other bot does the work in
its own chat. When it finishes, it posts the result in the group as **Finished work for {name}**.

Bots on standard OpenCode cannot hand off work or take it from other bots. OpenCode Go bots can.
The bot's Tools sheet says so, the `@` menu in a group chat marks the bot with **Cannot take
handed-off work**, and on mobile the chat settings show the same note under Options. A bot that
tries to hand them work is told to pick a bot on another provider.

If the bot that did the work leaves the group before it finishes, its result stays on its card but
is not posted in the group.

Work that has a deadline stops at the deadline. Work without one stops after 4 hours if the other
bot has not reported back. Either way the card shows it as failed because it timed out.

On web, desktop, and mobile, a card's buttons change with the state of the work:

- **Let it finish** keeps running work going even if you stop the reply that started it. A bot can
  also mark its own work this way. Once work is kept, the button goes away.
- **Cancel** stops queued, running, or blocked work.
- **Try again** appears on failed or canceled work. It starts new work for the same bot with the
  same task and gets its own card; the original card keeps its result. Each card can be retried
  once: after you try again, the original card drops the button, and further retries start from
  the newer card. A retry is refused while three pieces of work from the chat are still running.

A retry sends the task and expected result again, but not the extra background your bot added when
it first handed off the work. If that background matters, ask your bot to send the work again
instead.

If an action fails, a message explains why and the card stays as it was.

## Tables, checklists, and other rich replies

Bot replies render richer Markdown directly in the chat. There is no separate dashboard.

- **Tables** keep their header row and scroll sideways when they are wider than the chat.
- **Checklists** show each task as done or open. You cannot tick them. A list with two or more
  tasks also shows a summary such as "2 of 3 done".
- **Diffs** in a `diff` or `patch` code block appear as a change card. Added and removed lines are
  tinted, and the card header shows the file name and how many lines changed.
- **File references** appear as code cards titled with the file path, or as file chips inside a
  sentence.
- **Links** open in your browser.
- **Settings chips** open a section of Settings for the same environment as the chat. Hover a chip
  to see which section it opens, for example **Open Settings > Providers > Voice**. A chip that points
  somewhere Otto does not recognize stays plain text and never opens outside the app.

While a reply is still streaming, Otto waits for a table's header to finish before it shows the
table, and it waits for a partial code fence, list marker, or heading underline to complete. The
reply looks the same after it finishes and after you reload the chat.

On mobile, tables, checklists, file references, and links look the same as on desktop. Diffs appear
as a plain code block without the tinted lines or counts, and checklists do not show the progress
summary. Settings chips open the matching mobile screen, or the main Settings screen when mobile
has no matching screen.

A reply can also include a chart, a row of stats, a task list, a timeline, a flow diagram, or a set
of choices. These blocks use your theme's colors in light and dark mode. Selecting a choice sends its
reply to the bot; when the bot cannot take a message yet, the choices stay visible but disabled. If a
block arrives malformed, the reply shows it as a plain code block. On mobile, these blocks appear as
plain code blocks.

## Answer a bot's questions

When a bot needs something from you before it continues, its questions appear in a card in the chat,
one question at a time. In a group chat, the card sits just above the message box. A bar at the top shows how many there are and which one you are on.

- A round mark means you pick one answer. Selecting it moves to the next question, and on the last
  question it sends your answers.
- A square mark means you can pick several. Select each one that applies, then select **Next**, or
  **Submit** on the last question.
- To answer in your own words, type in **Type your own answer** at the bottom of the card and press
  Enter. A reply typed in the message box answers the question on screen the same way.
- **Back** returns to an earlier question with your answers kept.

With a keyboard, number keys pick the options in order and Enter moves on. Typing anything else
starts your own answer.

After you send, the chat shows a summary of each question with what you picked. An answer you typed
yourself is marked with a pencil.

## When a bot goes quiet

A provider that stops sending output does not stall the chat silently. See
[When a bot goes quiet](silence-watchdog.md) for the notice, the inbox item,
and what you can do.

## Regenerate a title

Open the chat menu and select **Regenerate title**. The action changes to **Regenerating…** until the
new title is ready. Otto hides this action when the environment server is too old to support it.

## Read a reply aloud

Completed bot replies include **Read aloud**. That speaks the stored reply on this device. It does
not start a live call or generate another answer. See [Voice and spoken replies](voice.md).

## Environment identification

Development environments can show **Artwork**, a **Version pill**, or **None** at the top of the
sidebar and in the send button. Artwork follows built-in theme colors. Custom themes use the version
pill because Otto does not control their color palette.
