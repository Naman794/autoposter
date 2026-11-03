# Threadpilot — Reddit posting panel for Render

Plan and publish Reddit text/link posts from one dashboard. The public page offers a temporary sample workspace. Owner sign-in unlocks MongoDB-backed drafts, saved communities, calendar planning, Reddit authorization, delivery records, and immediate or scheduled publishing.

This is the standalone Render port. It does not require ChatGPT hosting, Cloudflare bindings, or ChatGPT sign-in. The earlier hosted demo is a separate deployment; changes to this repository do not update it. Existing cloud data and Reddit authorizations are not automatically migrated; reconnect Reddit on the new deployment.

## Deploy the panel

1. In [Render](https://dashboard.render.com/), choose **New → Blueprint**, connect `Naman794/autoposter`, and select `render.yaml` from `main`.
2. Enter `MONGODB_URI` and an `ADMIN_PASSWORD` of at least 12 characters. Render generates `TOKEN_ENCRYPTION_KEY` for you. The Blueprint creates one free Node web service; it does **not** create a billed cron job.
3. In MongoDB Atlas, create a database user scoped to the `threadpilot` database and permit the Render service's outbound IP ranges in Network Access. URL-encode special characters in the password portion of the connection URI. Use the **Drivers → Node.js** URI.
4. Open the web service's actual `https://…onrender.com` URL. The public demo needs no login. Use **Sign in to save** and your `ADMIN_PASSWORD` to access the real owner workspace. This is not your Reddit password.
5. The web service derives its public origin from Render's `RENDER_EXTERNAL_URL`. If you use a custom domain, set `APP_URL` to that exact HTTPS origin and update your Reddit callback accordingly.

Manual web-service setup, if preferred:

| Render setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Root directory | Repository root (leave blank) |
| Build command | `npm ci --omit=dev && npm run check` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Node version | 24 |

The server binds to `0.0.0.0` and Render's `PORT`. Sessions and all saved content are in MongoDB, so web-service sleep/restarts do not erase them. No local files or SQLite database are used for durable state.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB Atlas driver connection string. Never commit it. |
| `MONGODB_DB` | Default: `threadpilot` | Same database name on web and cron. |
| `ADMIN_PASSWORD` | Web only | Private owner login, minimum 12 characters. |
| `TOKEN_ENCRYPTION_KEY` | Yes | Random secret of at least 32 characters. Same value on web and cron. Encrypts Reddit refresh tokens with AES-256-GCM. |
| `APP_URL` | Local/custom domain/cron | Exact public web origin. On a Render web service, defaults to `RENDER_EXTERNAL_URL`. |
| `REDDIT_CLIENT_ID` | For Reddit connection | Approved external Reddit web application's client ID. |
| `REDDIT_CLIENT_SECRET` | For Reddit connection | That application's secret. |
| `REDDIT_USER_AGENT` | For Reddit connection | Example: `web:threadpilot:v1.0 (by /u/YOUR_REDDIT_USERNAME)`. |
| `ENABLE_AUTOPUBLISH` | Default: `false` | Set to `true` on web for immediate publishing and on cron for scheduled publishing, only when ready for real submissions. |
| `PORT` | Provided by Render | HTTP listener port. Local default: 3000. |
| `NODE_ENV` | Provided by Blueprint | `production` on Render; HTTPS and Secure cookies are required. |

Generate a token encryption key for a manual/local setup:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep the encryption key stable. If it is lost or changed, the existing saved Reddit authorization cannot be decrypted; disconnect and reconnect Reddit. Changing the owner password does not revoke already active sessions: they expire after eight hours, or can be removed from MongoDB's `sessions` collection by the operator. Normal **Sign out** revokes the current session immediately.

The public preview holds changes only in browser memory and never posts or writes them to MongoDB. This version is a single-owner workspace, not a multi-tenant SaaS or a public signup system.

## Get Reddit credentials and connect

1. Follow [Reddit's Data API access guide](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data) and request approval for the actual use case. Business/agency use requires Reddit's commercial permission. Choosing a Devvit template does not issue external web-app credentials.
2. Follow Reddit's approved external-app registration instructions. If available to your account, [Reddit Apps](https://www.reddit.com/prefs/apps) offers **Create app → Web app**.
3. Sign into Threadpilot, open **API & settings**, and copy the callback URL. It is your actual Render web origin followed by `/api/reddit/callback`. Register that exact URL on Reddit. Do not use the earlier demo's callback.
4. Add `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, and `REDDIT_USER_AGENT` in **Render → web service → Environment**. Redeploy/restart after changing environment variables.
5. In Threadpilot, click **Authorize on Reddit**. Reddit handles the login. The panel requests `identity submit read` and permanent authorization for a refresh token. OAuth state is single use and tied to your signed-in owner session. The refresh token is encrypted on the server and never returned to browser code.

No Reddit password goes into this panel. There is no need to manually obtain or paste a refresh token. API approval is not guaranteed, and creating an application by itself does not guarantee posting access.

## Publish immediately

Save a text or link post in your signed-in workspace. Read the destination community's rules, and use **Load community flair** when applicable. Configure approved Reddit credentials, connect the account, and set `ENABLE_AUTOPUBLISH=true` on the web service. Click **Publish now** on a saved row and confirm the exact destination/title.

Only the authenticated owner can publish. The server checks account/community access and required flair before submission. A durable atomic claim prevents two tabs or workers from sending the same post ID twice. The queue pause control blocks both scheduled and immediate claims; resume it before publishing. Pausing cannot cancel a request already in flight.

## Enable scheduled posting

Render's free web service sleeps when idle. The scheduler is a **separate, finite cron process** that reads MongoDB directly; it does not depend on a browser timer, a public HTTP trigger, or the web service staying awake.

Create a Render **Cron Job** connected to this repository:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Command | `npm run publish:due` |
| Schedule | `*/15 * * * *` |
| Environment | Copy `MONGODB_URI`, `MONGODB_DB`, `TOKEN_ENCRYPTION_KEY`, and the three `REDDIT_*` values from the web service. Set `APP_URL` to the web service's HTTPS origin. |
| Publishing switch | Start with `ENABLE_AUTOPUBLISH=false`; enable after checking the queue. |

Alternatively, create a second Blueprint using `render-cron.yaml`. It asks for those values and creates the cron resource separately. It defaults to publishing disabled. Do not create both a manual cron job and the optional cron Blueprint for the same deployment.

Cron services have separate Render charges; review the current [Render cron pricing](https://render.com/docs/cronjobs#compute-plans-and-billing). No paid resource has been provisioned by adding this repository configuration.

Before enabling real submissions, change the cron command temporarily to `npm run publish:check` and trigger a run. This dry run reports due counts and configuration flags, without contacting Reddit, claiming posts, or publishing. It also does not update the last delivery-check heartbeat. Restore `npm run publish:due` before enabling.

Schedule a post in the panel using **IST**, and tick **Approve automatic publishing of this exact post**. Unapproved calendar plans and drafts stay untouched. The cron checks due approved posts every 15 minutes, up to 20 per run. All database timestamps are UTC; the interface displays IST. Render cron expressions use UTC; an every-15-minutes schedule is unaffected by that difference. Delivery is at the next check after the selected time, not guaranteed at the exact minute.

**Reconnect does not clear approved plans.** Review old due posts before enabling the publisher or reconnecting an account. The worker uses whichever Reddit account is currently connected at execution time.

## Delivery states and recovery

- `published`: Reddit returned a confirmed URL. Open **View on Reddit** from the queue.
- `failed`: A preflight check or structured Reddit rejection stopped the post. Review the error, correct the issue and create a fresh draft to retry intentionally.
- `unknown`: The submit request may have succeeded, but confirmation was lost. Check Reddit manually before taking any action.
- `sending`: The post has been durably claimed. A crashed process can leave this state. Check Reddit manually before considering another submission.

No failed, uncertain or previously claimed post is automatically retried. Attempted records cannot be edited or deleted through the panel. This prevents editing approved content into something different while the worker is publishing, and preserves delivery evidence. Workspace changes use revision checks, so an outdated tab cannot overwrite a new delivery receipt; use **Refresh** after a conflict.

The worker stops a run when it sees Reddit's rate-limit response. Rate-limited posts are held as failed for review. It does not evade limits or automatically fan the same content into multiple communities. Only text and link posts are included; image/video uploads, analytics syncing, repeat campaigns and multi-owner accounts are not implemented.

Disconnect attempts to revoke the Reddit refresh token and removes the locally saved authorization. You can also revoke access in your Reddit account settings.

## Run locally

```bash
npm ci
cp .env.example .env
# Fill in MongoDB, the owner password and encryption key in .env.
npm start
```

Open `http://localhost:3000`. Keep `NODE_ENV=development` locally. For a custom local port, update both `PORT` and `APP_URL`. An actual MongoDB connection is required for saved content and login. No credentials or account data are committed in this repository.

```bash
npm run check
npm test
npm run publish:check
```

`npm run check` checks JavaScript syntax and standalone frontend references. Tests use fake storage and mocked Reddit responses: authentication, CSRF, session revocation, OAuth replay protection, validation, revision conflicts, encryption, approval gates, duplicate claims, delivery uncertainty and rate-limit handling. They never submit real Reddit posts. A live Atlas connection, Render deployment, and live Reddit authorization/submission still require runtime verification after configuration.

The MongoDB driver is reused once per process with its default pool settings. Monitor Atlas connection count and request latency before tuning pools. Each cron process closes its client before exiting; the web service closes it on shutdown.

## Project files

- `public/`: responsive UI, editor, calendar and API guide.
- `src/app.js`: owner login and authenticated API.
- `src/store.js`: MongoDB persistence, revision checks and atomic claims.
- `src/reddit.js`: Reddit OAuth and posting API calls.
- `src/publisher.js`: immediate and scheduled delivery logic.
- `scripts/publish-due.js`: unattended scheduler command and dry run.
- `render.yaml`: web-service Blueprint.
- `render-cron.yaml`: optional cron-service Blueprint.

## Release notes

### 1.0.0 — Render port

- Preserved the Threadpilot UI and public sample workspace.
- Replaced hosted identity and object storage with owner-password sessions and MongoDB Atlas.
- Added encrypted Reddit authorizations, flair loading and confirmed immediate publishing.
- Added an independent Render cron command, approval gates, atomic delivery claims and permanent delivery records.
- Added environment templates, Render Blueprints, deployment instructions and automated checks.
