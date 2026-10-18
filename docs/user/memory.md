# Bot memory

Bots remember what matters from earlier chats without you managing it. A couple of minutes after a
chat goes quiet, the bot reads what was said and keeps a few short lines up to date: who people are
and how they like to work, settled decisions and preferences, how things are done, and lessons
learned the hard way. Lines that stop coming up are forgotten after 60 days.

## Yours and the team's

Memory has two parts:

- **Team** is shared by everyone in the workspace and every bot. Bots learn it in chats everyone can
  read and use it in every chat.
- **Yours** is only yours. Bots learn it in your private chats with them and use it only there, so
  nothing you say in private shows up where other people can read it.

A group that only some people can read teaches nothing, so what is said there stays there. Bots
still use the team's memory in it. Work a bot hands to a helper bot uses no memory.

Each line applies to **all projects** or to **one project**. A line tagged to a project, such as a
client's invoice terms, is only used in that project's chats. Who someone is or how the team works
applies everywhere. The bot picks this when it learns a line, and you can change it.

Bots tell you where something will be remembered. Ask one to remember something and it says it will;
in a group that teaches nothing it tells you to add it in Memory instead. Ask it to forget something
and the line is removed after the chat goes quiet. A team line can only be removed from a private
chat in Memory.

A bot does not save tasks, plans, progress or secrets; tasks hold work, and the chats themselves
hold the details. When a bot needs a detail from an earlier chat, it searches past chats instead.
Habits for one bot belong in that bot's instructions.

Each turn the bot also sees what is happening right now: its open tasks, helpers still working for
the chat, routines that post there and anything waiting for your approval. That is read fresh every
time and never saved.

## Seeing and changing memory

Open **Memory** from a chat's details or from **Settings → Memory**. It shows two cards, Yours and
Team, each with its count and a plus to add a line. Each line shows where it applies (All projects or
a project's name), the month it was last confirmed and the chat it came from. Click a line to edit its
text or where it applies, or delete it from the same dialog. A new line applies to the chat's project
when you open Memory from a chat in one.

A line you write or edit keeps your wording: bots can still confirm or delete it later, but never
rewrite it. Deleting a line does not remove it from past chats, so a bot may learn it again if it
comes up. Each part keeps up to 40 lines everywhere and 40 per project; past that, the line confirmed
longest ago goes first.

## Turning memory off

**Settings → Memory** turns memory on or off for everyone. While it is off, bots get no memory and
no new lines are saved; what is already saved stays and appears again when you turn it back on.

## Keeping your data

Memory stays in the Otto database on your environment server and is sent only as context to the
model provider running the bot. The bot reviews a chat with the same model and account it answers
with. Otto rejects lines that look like passwords, tokens or keys, but these checks are limited, so
avoid putting secrets in chats you want remembered.
