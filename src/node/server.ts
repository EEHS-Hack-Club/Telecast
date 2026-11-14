/**
 * One small server for the venue screens: serves the display and the control panel, keeps the
 * current state in a JSON file, and pushes every change to connected screens over server-sent events.
 * No dependencies, so the container is just Node and this folder.
 */
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config, defaults } from "./defaults.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const PORT = Number(process.env.PORT) || 8080;

/** Screens reload themselves when this changes, so a redeploy reaches them without anyone touching a TV. */
const BOOT_ID = crypto.randomBytes(6).toString("hex");

let PASSCODE = process.env.CANVAS_PASSCODE;
if (!PASSCODE) {
  PASSCODE = crypto.randomBytes(4).toString("hex");
  console.log(`CANVAS_PASSCODE is not set. Using a one-off passcode for this run: ${PASSCODE}`);
}

const SCENES = ["idle", "schedule", "countdown", "message", "embed", "rotate"];
const TONES = ["orange", "green", "teal", "yellow", "red"];

/* ---------- state ---------- */

const str = (v, max, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const num = (v, min, max, fallback) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const tone = (v, fallback) => (TONES.includes(v) ? v : fallback);

function httpUrl(v) {
  const s = str(v, 2000).trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

/** Each section is rebuilt field by field, so a bad request can never put unexpected data on a screen. */
const sanitise = {
  scene: (v, cur) => (SCENES.includes(v) ? v : cur),
  idle: (v = {}, cur) => ({
    message: str(v.message, 200, cur.message),
    showNext: bool(v.showNext, cur.showNext),
    stickers: bool(v.stickers, cur.stickers),
  }),
  message: (v = {}, cur) => ({
    kicker: str(v.kicker, 60, cur.kicker),
    title: str(v.title, 200, cur.title),
    body: str(v.body, 600, cur.body),
    tone: tone(v.tone, cur.tone),
  }),
  countdown: (v = {}, cur) => ({
    label: str(v.label, 120, cur.label),
    target: num(v.target, 0, 8.64e15, cur.target),
    doneText: str(v.doneText, 120, cur.doneText),
  }),
  embed: (v = {}, cur) => ({
    url: typeof v.url === "string" ? httpUrl(v.url) : cur.url,
    showClock: bool(v.showClock, cur.showClock),
  }),
  schedule: (v = {}, cur) => ({
    title: str(v.title, 60, cur.title),
    platform: str(v.platform, 60, cur.platform),
    items: Array.isArray(v.items)
      ? v.items
          .slice(0, 40)
          .map((i) => ({
            time: str(i?.time, 5).trim(),
            title: str(i?.title, 120).trim(),
            detail: str(i?.detail, 200).trim(),
          }))
          .filter((i) => i.title)
      : cur.items,
  }),
  rotate: (v = {}, cur) => {
    const scenes = Array.isArray(v.scenes)
      ? v.scenes.filter((s) => SCENES.includes(s) && s !== "rotate").slice(0, 10)
      : cur.scenes;
    return {
      seconds: num(v.seconds, 5, 3600, cur.seconds),
      scenes: scenes.length ? scenes : cur.scenes,
    };
  },
  ticker: (v = {}, cur) => ({
    enabled: bool(v.enabled, cur.enabled),
    text: str(v.text, 500, cur.text),
  }),
};

let state = structuredClone(defaults);
state.rev = 0;

function applyPatch(patch) {
  for (const key of Object.keys(sanitise)) {
    if (patch && key in patch) state[key] = sanitise[key](patch[key], state[key]);
  }
}

async function load() {
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8"));
    applyPatch(saved);
    state.rev = num(saved.rev, 0, Number.MAX_SAFE_INTEGER, 0);
    if (saved.alert && (!saved.alert.expiresAt || saved.alert.expiresAt > Date.now())) {
      state.alert = saved.alert;
    }
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Could not read saved state, starting from defaults:", err.message);
  }
}

let saving = Promise.resolve();
function save() {
  const json = JSON.stringify(state, null, 2);
  // Write-then-rename, queued, so a crash or two quick edits can't leave a half-written file.
  saving = saving
    .then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(`${STATE_FILE}.tmp`, json);
      await rename(`${STATE_FILE}.tmp`, STATE_FILE);
    })
    .catch((err) => console.error("Could not save state:", err.message));
}

/* ---------- live connections ---------- */

/** @type {Map<http.ServerResponse, "display" | "control">} */
const clients = new Map();

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const statePayload = () => ({ state, config, now: Date.now(), boot: BOOT_ID });
const statsPayload = () => ({
  displays: [...clients.values()].filter((r) => r === "display").length,
});

function broadcast(event, data) {
  const msg = frame(event, data);
  for (const res of clients.keys()) res.write(msg);
}

function commit() {
  state.rev += 1;
  save();
  broadcast("state", statePayload());
}

setInterval(() => broadcast("ping", { now: Date.now() }), 15_000).unref();

let alertTimer;
function scheduleAlertExpiry() {
  clearTimeout(alertTimer);
  if (!state.alert?.expiresAt) return;
  const id = state.alert.id;
  alertTimer = setTimeout(
    () => {
      if (state.alert?.id !== id) return;
      state.alert = null;
      commit();
    },
    Math.max(0, state.alert.expiresAt - Date.now()),
  );
}

/* ---------- http ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
function authorised(req) {
  const given = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  return crypto.timingSafeEqual(digest(given), digest(PASSCODE));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  if (rel === "/control" || rel === "/control/") rel = "/control.html";
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 404, { error: "Not found" });
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": info.size,
      // Pages and scripts always revalidate so a deploy shows up at once; artwork can be cached.
      "Cache-Control": rel.startsWith("/assets/") ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

function openStream(req, res, role) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Stops nginx-style proxies holding events back in a buffer.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 1500\n\n");
  res.write(frame("state", statePayload()));
  clients.set(res, role);
  broadcast("stats", statsPayload());
  res.on("close", () => {
    clients.delete(res);
    broadcast("stats", statsPayload());
  });
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/state") return json(res, 200, statePayload());
  if (route === "GET /api/health") return json(res, 200, { ok: true, ...statsPayload() });

  if (!authorised(req)) {
    // A short pause makes guessing the passcode slow without getting in an organiser's way.
    await new Promise((r) => setTimeout(r, 400));
    return json(res, 401, { error: "Wrong passcode" });
  }

  if (route === "POST /api/login") return json(res, 200, { ok: true });

  if (route === "PATCH /api/state") {
    applyPatch(await readBody(req));
    commit();
    return json(res, 200, { ok: true, rev: state.rev });
  }

  if (route === "POST /api/alert") {
    const body = await readBody(req);
    const title = str(body.title, 200).trim();
    const text = str(body.body, 600).trim();
    if (!title && !text) return json(res, 400, { error: "An announcement needs a title or a message" });
    const seconds = num(body.seconds, 0, 86_400, 30);
    state.alert = {
      id: crypto.randomBytes(4).toString("hex"),
      kicker: str(body.kicker, 60, "Announcement"),
      title,
      body: text,
      tone: tone(body.tone, "orange"),
      startedAt: Date.now(),
      expiresAt: seconds ? Date.now() + seconds * 1000 : null,
    };
    scheduleAlertExpiry();
    commit();
    return json(res, 200, { ok: true });
  }

  if (route === "DELETE /api/alert") {
    state.alert = null;
    scheduleAlertExpiry();
    commit();
    return json(res, 200, { ok: true });
  }

  if (route === "POST /api/reset") {
    const rev = state.rev;
    state = structuredClone(defaults);
    state.rev = rev;
    scheduleAlertExpiry();
    commit();
    return json(res, 200, { ok: true });
  }

  if (route === "POST /api/reload") {
    broadcast("reload", {});
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/events") {
      return openStream(req, res, url.searchParams.get("role") === "control" ? "control" : "display");
    }
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed" });
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 500, { error: err.status ? err.message : "Server error" });
    else res.end();
    if (!err.status) console.error(err);
  }
});

await load();
scheduleAlertExpiry();
server.listen(PORT, () => console.log(`Screens on http://localhost:${PORT}  ·  control panel on /control`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => saving.finally(() => process.exit(0)));
}
