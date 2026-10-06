# Sharing and hosted services

Sharing a session to a read-only viewer is stubbed behind `OTTO_VIEWER_URL` (read by `getViewerUrl()` in
`packages/shared/src/branding.ts`). Unset, which is the default, hides every share entry point (session menus and the
chat header button) and makes no network call. There is no Otto-hosted viewer yet.

A viewer host serves the app in `apps/viewer` under `/s/` and implements these endpoints (all JSON unless noted):

- Sessions, called by `SessionManager`: `POST /s/api` with the stored session, answering `{ id, url }` (413 when
  too large); `PUT /s/api/{id}` to update; `DELETE /s/api/{id}` to revoke; `GET /s/api/{id}`, read by the viewer app
  (404 when unknown). The returned `url` is the public link, e.g. `{host}/s/{id}`.

Other hosted services are separate settings, each unset by default with its feature disabled:

- `OTTO_OAUTH_RELAY_URL`: relay serving `/auth/callback` (and `/auth/slack/callback`). Unset, source OAuth uses the
  local or server callback as the provider redirect URI.
- `OTTO_UPDATE_URL`: release feed (`/latest`, `/{version}/manifest.json`). Unset, auto-update is off and the
  "Check for updates" UI is hidden.
- `OTTO_DOWNLOAD_URL`: release host for `scripts/install-app.sh` and `install-app.ps1`, which exit when it is unset.
