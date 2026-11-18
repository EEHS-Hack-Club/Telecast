# Telecast

Live screens for an event venue, with a control panel for the organisers. Built for
[Haven London](https://haven.london); made so other events can run their own. This copy is set up
for [EEHS Hack Club](https://eehshack.club).

Telecast was created by Jupiter for Haven London. Thank you for making it something other events
can pick up and run!

- `/` is the screen. Open it on each TV or projector and click once (or press F) to go full screen.
- `/control` is the organisers' panel. Sign in with Hack Club; it works on a phone, and every change
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

People sign in with [Hack Club Auth](https://auth.hackclub.com). Admins (listed by email in
`TELECAST_ADMINS`) can always sign in, and add the other organisers' emails in the control panel
under "Who can use this panel". Taking someone off the list takes their access away straight away.

### Setting up Hack Club Auth

1. Create an app at [auth.hackclub.com/developer/apps](https://auth.hackclub.com/developer/apps)
   with the redirect URI `https://<your address>/auth/callback` and the scopes `openid`, `email`
   and `name`.
2. Copy the **client ID** and **client secret**.
3. Set the variables below, with your own Hack Club Auth email in `TELECAST_ADMINS`.
4. Open `/control`, sign in, and add the other organisers.

| Variable | Purpose |
| --- | --- |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | The Hack Club Auth app, for "Sign in with Hack Club". |
| `TELECAST_ADMINS` | Comma-separated emails, as used for Hack Club Auth. |
| `PUBLIC_URL` | Optional. The public address, if a proxy in front doesn't pass it along. |

## Hosting

### Docker

```bash
docker build -t telecast .
```

```bash
docker run -p 8080:8080 --env-file .env -v telecast:/data telecast
```

The volume at `/data` keeps what's on screen, the organisers' list and the cookie-signing key across
redeploys. `PORT` and `DATA_DIR` can be changed if needed. A proxy in front must allow WebSockets on
`/ws` and pass `X-Forwarded-Proto` and `X-Forwarded-Host` (or set `PUBLIC_URL`).

### Cloudflare Workers

Runs as a Worker with static assets and one Durable Object (works on the free plan).

```bash
pnpm exec wrangler secret put HACKCLUB_CLIENT_ID
```

Repeat for `HACKCLUB_CLIENT_SECRET` and `TELECAST_ADMINS`, then:

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
  `background.svg` and `stickers/`. Replace the files and adjust the CSS variables. Add a
  `mascot.webp` and set `mascot: true` in the config to have one peek over the idle screen.

The stickers are from [hackclub/site](https://github.com/hackclub/site/tree/main/public/assets).

## Developing

Needs Node 22.18 or newer and pnpm.

```bash
pnpm install
```

```bash
pnpm dev:mock
```

`dev:mock` runs Telecast on port 8080 against a pretend Hack Club Auth, so you can sign in as an
admin, an organiser or an outsider without a real app. `pnpm dev` uses real credentials from
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
