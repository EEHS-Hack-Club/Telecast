# Venue screens

What the big screens at Haven London show, served at `canvas.haven.london`.

- `/` is the screen. Open it on each TV or projector and click once (or press F) to go full screen.
- `/control` is the organisers' panel. It asks for the passcode, works on a phone, and every change
  reaches every screen straight away.

## What it can show

| Scene | What it is |
| --- | --- |
| Clock | The default. The time, a welcome line, what's next, and stickers drifting about. |
| Schedule | The departure board from the main site. Marks what's on now and next by itself. |
| Countdown | Counts down to a time, then shows a closing line. |
| Message | A full-screen card that stays up until the scene changes. |
| Website | Any web page, embedded full screen. |
| Rotation | Cycles through a chosen set of the scenes above. |

On top of any scene: a **flash announcement** (takes over for a set time, then goes away) and a
scrolling **ticker** along the bottom.

## Running it

```bash
node server.mjs
```

No dependencies to install. It listens on port 8080.

| Variable | Purpose |
| --- | --- |
| `CANVAS_PASSCODE` | The passcode for `/control`. If unset, a random one is printed in the log at start-up. |
| `PORT` | Port to listen on. Defaults to 8080. |
| `DATA_DIR` | Where the current state is saved. Defaults to `./data` (`/data` in Docker). |

## Deploying

Build the image from this folder and give it a volume so what's on screen survives a redeploy:

```bash
docker build -t haven-screens canvas
docker run -p 8080:8080 -e CANVAS_PASSCODE=... -v haven-screens:/data haven-screens
```

Updates travel over a long-lived connection to `/events`. If there's a proxy in front, it must not
buffer that path or cut idle connections off in under 15 seconds. Screens reconnect by themselves,
and reload by themselves after a redeploy.

## Customising

- **Starting content and time zone:** `defaults.mjs`.
- **Colours and fonts:** `public/brand.css` (kept in step with the main site's `global.css`).
- **Stickers:** drop images into `public/assets/stickers/` and list them in `STICKERS` at the top of
  `public/display.js`. Where they sit is `STICKER_SLOTS`, just below.
- **A new scene:** add a `<section class="scene" data-scene="…">` to `public/index.html`, a matching
  entry in `sanitise` and `SCENES` in `server.mjs`, and a form in `public/control.html`.

Stickers are from [hackclub/site](https://github.com/hackclub/site/tree/main/public/assets).
