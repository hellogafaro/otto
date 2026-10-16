# Otto with Docker

One image runs the server and the built web app on port 3773. Everything Otto keeps (databases,
attachments, settings, backups) lives in the `otto-data` volume at `/data`.

## Run

Export the settings in your shell (or a secrets manager such as `infisical run -- …`), then start:

```sh
export OTTO_PUBLIC_ORIGIN=https://otto.example.com   # the address people open
export OTTO_SECRETS_KEY="$(openssl rand -base64 32)"  # keep it in a password manager
export OTTO_SETUP_TOKEN="$(openssl rand -hex 16)"     # the first person enters it on the setup form
export BOAT_API_KEY=…                                 # optional: bots' Boat computers
export OTTO_SMTP_HOST=… OTTO_SMTP_USER=… OTTO_SMTP_PASSWORD=… OTTO_MAIL_FROM=…  # optional
docker compose -f deploy/docker/compose.yaml up -d --build --wait
```

`--wait` returns once the image health check (`/.well-known/ottoLegacy/environment`) passes. Otto
listens on `127.0.0.1:3773`; change `OTTO_HTTP_BIND`/`OTTO_HTTP_PORT` to expose it differently.

- **HTTPS:** point a DNS record at the host, open ports 80 and 443, and add the Caddy service, which
  gets a Let's Encrypt certificate: `OTTO_DOMAIN=otto.example.com OTTO_TRUST_PROXY=1 docker compose -f deploy/docker/compose.yaml --profile https up -d --wait`.
  `OTTO_TRUST_PROXY=1` lets sign-in rate limits use the client address Caddy forwards; leave it unset
  when people reach port 3773 directly, so nobody can fake that header.
- **First run:** open the origin, fill in the setup form and enter `OTTO_SETUP_TOKEN` as the setup
  code. The owner can sign in straight away; others join by invitation, which needs SMTP.
- **Sign-in:** with SMTP set, people sign in with a code sent to their email; without it, with their
  password.
- **Mail:** any SMTP provider works (`OTTO_SMTP_PORT` defaults to 587, `OTTO_SMTP_SECURE=true` for 465).

`OTTO_SECRETS_KEY` seals every credential saved in Otto. Losing it makes them unreadable, and a backup
is only useful with it.

## Backups

The server copies its SQLite databases into `/data/backups/<time>` once a day and keeps seven. Take
one by hand, for example before an update:

```sh
docker compose -f deploy/docker/compose.yaml exec otto otto backup
```

Copy `/data/backups` off the host with your usual backup tool (`docker compose cp otto:/data/backups ./`).

To restore, stop Otto, put the backup's `.sqlite` files into `/data/userdata/` (deleting any
`-wal`/`-shm` files beside them) and start it again with the same `OTTO_SECRETS_KEY`.

## Update

```sh
git pull
docker compose -f deploy/docker/compose.yaml exec otto otto backup
docker compose -f deploy/docker/compose.yaml up -d --build --wait
```

Releases do not publish an image; build it from the checkout. Image updates, rollback and removal
are Compose operations: `otto remote` admin commands inside the container explain this instead of
managing a host service.
