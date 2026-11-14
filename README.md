# Telecast

Live screens for an event venue, with a control panel for the organisers. Built for
[Haven London](https://haven.london); made so other events can run their own.

- `/` is the screen. Open it on each TV or projector and click once (or press F) to go full screen.
- `/control` is the organisers' panel. Sign in with Slack; it works on a phone, and every change
  reaches every screen straight away.

One deployment runs one event.

## What it can show

| Scene | What it is |
| --- | --- |
| Clock | The default. The time, a welcome line, what's next, and stickers drifting about. |
| Schedule | A departure board of the day. Marks what's on now and next by itself. |
| Countdown | Counts down to a time, then shows a closing line. |
| Message | A full-screen card that stays up until the scene changes. |
| Website | Any web page, embedded full screen. |
| Rotation | Cycles through a chosen set of the scenes above. |

On top of any scene: a **flash announcement** (takes over for a set time, then goes away) and a
scrolling **ticker** along the bottom.

## Who can use the control panel

Access follows a **private Slack channel**: anyone in it can sign in, and anyone removed from it
loses access within a minute. Admins (listed in `TELECAST_ADMINS`) can always sign in, and choose
the channel from the control panel under "Who can use this panel".

### Setting up Slack

1. Create a Slack app from [`slack-manifest.yml`](slack-manifest.yml), changing the redirect URL to
   `https://<your address>/auth/callback`.
2. Install it to the workspace. Copy the **client ID** and **client secret** (Basic Information) and
   the **bot token** (OAuth & Permissions).
3. Invite the bot to the organisers' private channel: `/invite @Telecast`.
4. Set the variables below, with your own Slack member ID in `TELECAST_ADMINS`.
5. Open `/control`, sign in, and pick the channel.

| Variable | Purpose |
| --- | --- |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | The Slack app, for "Sign in with Slack". |
| `SLACK_BOT_TOKEN` | The bot token (`xoxb-…`), for checking who is in the channel. |
| `TELECAST_ADMINS` | Comma-separated Slack member IDs. |
| `SLACK_CHANNEL_ID` | Optional. A starting channel, used until an admin picks one. |
| `PUBLIC_URL` | Optional. The public address, if a proxy in front doesn't pass it along. |

## Hosting

### Docker

```bash
docker build -t telecast .
```

```bash
docker run -p 8080:8080 --env-file .env -v telecast:/data telecast
```

The volume at `/data` keeps what's on screen, the chosen channel and the cookie-signing key across
redeploys. `PORT` and `DATA_DIR` can be changed if needed. A proxy in front must allow WebSockets on
`/ws` and pass `X-Forwarded-Proto` and `X-Forwarded-Host` (or set `PUBLIC_URL`).

### Cloudflare Workers

Runs as a Worker with static assets and one Durable Object (works on the free plan).

```bash
pnpm exec wrangler secret put SLACK_CLIENT_ID
```

Repeat for `SLACK_CLIENT_SECRET`, `SLACK_BOT_TOKEN` and `TELECAST_ADMINS`, then:

```bash
pnpm deploy:worker
```

Add your domain under the Worker's settings, or as a `routes` entry in `wrangler.jsonc`.

Either way, screens reconnect by themselves and reload by themselves after a redeploy.

## Making it yours

Everything specific to an event is in two places:

- **[`telecast.config.ts`](telecast.config.ts):** the event's name, time zone, sticker list and the
  content the screens start with (schedule, welcome line and so on).
- **[`public/theme/`](public/theme):** `theme.css` (fonts, colours, backdrop), `logo.webp`,
  `background.webp`, `mascot.webp` and `stickers/`. Replace the files and adjust the CSS variables.

The Haven London stickers are from [hackclub/site](https://github.com/hackclub/site/tree/main/public/assets).

## Developing

Needs Node 22.18 or newer and pnpm.

```bash
pnpm install
```

```bash
pnpm dev:mock
```

`dev:mock` runs Telecast on port 8080 against a pretend Slack, so you can sign in as an admin, a
channel member or an outsider without a real Slack app. `pnpm dev` uses real credentials from
`.env`; `pnpm dev:worker` runs the Cloudflare version locally (credentials in `.dev.vars`).

| Folder | What's in it |
| --- | --- |
| `src/core` | The state, API and sign-in, written against web standards so both hosts share it. |
| `src/node` | The Docker host: HTTP, WebSockets, a JSON file for storage. |
| `src/worker` | The Cloudflare host: a Worker and a Durable Object. |
| `src/client` | The screen (`display.ts`) and control panel (`control.ts`). |
| `src/shared` | Types used on both sides. |
| `public` | Pages, styles and the theme. |

To add a scene: a `<section class="scene" data-scene="…">` in `public/index.html`, its type in
`src/shared/types.ts`, its clean-up rule in `src/core/state.ts`, and a form in `public/control.html`.

`pnpm typecheck` checks all three targets.
