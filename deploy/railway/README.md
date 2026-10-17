# Otto on Railway

Railway builds the same image as Docker Compose (`deploy/docker/Dockerfile`) from this repository
and keeps Otto's state on a volume at `/data`. There is no `railway.json`: Railway's config-as-code
files are deprecated, so the template is set up once in Railway's template composer.

## Make the template

1. In Railway, open **Workspace → Templates → New Template** and add a service from GitHub
   repository `hellogafaro/otto`, branch `main`. People deploying it need Railway access to the
   repository while it is private.
2. **Settings → Build:** builder Dockerfile; the variable `RAILWAY_DOCKERFILE_PATH` below points at it.
3. **Volume:** attach one volume mounted at `/data`. The Dockerfile declares no `VOLUME` because
   Railway refuses to build one that does; Compose mounts its own named volume.
4. **Networking:** public HTTP domain, target port `3773`.
5. **Deploy:** healthcheck path `/` (Railway rejects paths with dots or capitals), timeout 300 seconds; restart
   policy On failure; one replica (a volume allows only one).
6. **Variables** (give each a description in the composer):

   | Variable                                                                                                         | Value                                                                                  |
   | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
   | `RAILWAY_DOCKERFILE_PATH`                                                                                        | `deploy/docker/Dockerfile`                                                             |
   | `PORT`                                                                                                           | `3773`                                                                                 |
   | `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`                                                                            | `30`                                                                                   |
   | `OTTO_PUBLIC_ORIGIN`                                                                                             | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (change it after adding a custom domain)          |
   | `OTTO_SECRETS_KEY`                                                                                               | `${{secret(43, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")}}=` |
   | `OTTO_SETUP_TOKEN`                                                                                               | `${{secret(32)}}`                                                                      |
   | `OTTO_TRUST_PROXY`                                                                                               | `1` (Railway's edge proxy forwards the client address for sign-in rate limits)         |
   | `BOAT_API_KEY`                                                                                                   | optional input: the Boat key bots use for their computers                              |
   | `OTTO_SMTP_HOST`, `OTTO_SMTP_PORT`, `OTTO_SMTP_SECURE`, `OTTO_SMTP_USER`, `OTTO_SMTP_PASSWORD`, `OTTO_MAIL_FROM` | optional inputs: any SMTP provider                                                     |

7. Publish the template and add its Deploy on Railway button here.

Railway allows outbound SMTP only on paid plans; without mail, people sign in with their password and
cannot be invited by email.

## After deploying

1. Copy `OTTO_SECRETS_KEY` into a password manager: it seals every credential Otto saves.
2. Open the public domain, fill in the setup form and enter `OTTO_SETUP_TOKEN` (service → Variables)
   as the setup code.
3. In the service's **Backups** tab, turn on daily and weekly volume backups. Otto also keeps seven
   daily database copies in `/data/backups`; `railway ssh` then `otto backup` takes one by hand.
