# Privacy and outbound data

Otto stores environment data under `~/.otto` by default. This includes projects, chats, bot
profiles, settings, secrets, logs, local memory, and cached provider data. A worktree development
server uses that worktree's `.otto` directory instead.

Bot memory is stored in the Otto database on the environment server. It is sent only as context to
the provider running the bot. What bots learn in your private chats is yours and is used only in
your private chats; groups that only some people can read teach nothing. See [Bot memory](memory.md).

## Data that can leave the environment

- Provider requests send the prompt, selected files, tool results, and conversation context to the
  provider that you select. That provider controls its processing and retention.
- Voice calls send microphone audio and call state to the ChatGPT Realtime service while a call is
  active.
- Dictation records microphone audio on the device you dictate from and sends it through the
  environment server to the transcription provider selected in **Settings > Providers > Voice**. Otto does not
  keep the recording after transcription finishes or is canceled. The text stays in your draft until
  you send it.
- Reading a stored reply aloud will send the spoken form of that reply to the selected speech
  service when stored-reply speech is connected. Temporary audio stays on this device for the
  current playback only. See [Voice and spoken replies](voice.md).
- Provider update checks contact the release source for configured providers. Signed desktop builds
  contact the configured Otto release host.
- The environment server downloads the public model list from models.dev about once an hour, so new
  provider models appear without an app update. The request sends no account or chat data. Turning
  off provider update checks also stops this download.

## Subscription credentials

The environment server stores subscription credentials in its private secrets directory. OAuth
tokens do not pass through the WebSocket contract and do not enter projects, checkpoints, sandboxes,
or client storage. A run receives only the short-lived access that it needs.

## Privacy controls

Open **Settings > Privacy & data** to control voice calls.
You can also export or import environment data under **Backup and
transfer**.

Turning a control off stops new transfers for that feature. Provider requests still leave the
environment when you run a connected online model.
