# Otto with Docker

One image runs the server and the built web app on port 3773. Everything Otto keeps (databases,
attachments, settings, backups) lives in the `otto-data` volume at `/data`.

## Run

Export the settings in your shell (or a secrets manager such as `infisical run -- …`), then start:

```sh
export OTTO_PUBLIC_URL=https://otto.example.com   # the address people open
export OTTO_ENCRYPTION_KEY="$(openssl rand -base64 32)"  # keep it in a password manager
export COMPOSIO_API_KEY=…                             # optional: Connect an app for everyone
export OTTO_SMTP_HOST=… OTTO_SMTP_USER=… OTTO_SMTP_PASSWORD=… OTTO_MAIL_FROM=…  # optional
docker compose -f deploy/docker/compose.yaml up -d --build --wait
```

`--wait` returns once the image health check (`/.well-known/ottoLegacy/environment`) passes. Otto
listens on `127.0.0.1:3773`; change `OTTO_HTTP_BIND`/`OTTO_HTTP_PORT` to expose it differently.

- **HTTPS:** point a DNS record at the host, open ports 80 and 443, and add the Caddy service, which
  gets a Let's Encrypt certificate: `OTTO_DOMAIN=otto.example.com docker compose -f deploy/docker/compose.yaml --profile https up -d --wait`.
  An https `OTTO_PUBLIC_URL` tells Otto it sits behind a proxy, so sign-in rate limits use the client
  address Caddy forwards; keep port 3773 on 127.0.0.1 so nobody can reach it directly and fake that header.
- **First run:** open the origin straight away and fill in the setup form: the first person to do it
  becomes the owner. Others join by invitation.
- **Sign-in:** with SMTP set, people sign in with a code sent to their email; without it, with their
  password.
- **Mail:** any SMTP provider works (`OTTO_SMTP_PORT` defaults to 587, `OTTO_SMTP_SECURE=true` for 465).

`OTTO_ENCRYPTION_KEY` seals every credential saved in Otto. Losing it makes them unreadable, and a backup
is only useful with it.

## Backups

The server copies its SQLite databases into `/data/backups/<time>` once a day and keeps seven. Take
one by hand, for example before an update:

```sh
docker compose -f deploy/docker/compose.yaml exec otto otto backup
```

Copy `/data/backups` off the host with your usual backup tool (`docker compose cp otto:/data/backups ./`).

To restore, stop Otto, put the backup's `.sqlite` files into `/data/userdata/` (deleting any
`-wal`/`-shm` files beside them) and start it again with the same `OTTO_ENCRYPTION_KEY`.

## Update

```sh
git pull
docker compose -f deploy/docker/compose.yaml exec otto otto backup
docker compose -f deploy/docker/compose.yaml up -d --build --wait
```

Releases do not publish an image; build it from the checkout. Image updates, rollback and removal
are Compose operations: `otto remote` admin commands inside the container explain this instead of
managing a host service.
