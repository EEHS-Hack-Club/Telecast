/**
 * The screen itself. It holds no state of its own: the server streams the current state and this
 * file draws it, so a change in the control panel shows up on every screen straight away.
 */
const $ = (sel) => document.querySelector(sel);
const stage = $("#stage");

const STICKERS = [
  ...Array.from({ length: 11 }, (_, i) => `/assets/stickers/sticker${i + 1}.webp`),
  "/assets/stickers/flag.svg",
];

/** Where stickers may sit on the idle screen: around the edges, clear of the clock in the middle. */
const STICKER_SLOTS = [
  { x: 4, y: 6, w: 13 },
  { x: 9, y: 39, w: 12 },
  { x: 3, y: 71, w: 13 },
  { x: 22, y: 9, w: 9 },
  { x: 85, y: 6, w: 13 },
  { x: 80, y: 40, w: 12 },
  { x: 86, y: 71, w: 13 },
  { x: 70, y: 10, w: 9 },
];

let state = null;
let timeZone = "Europe/London";
/** Screens' own clocks are often wrong, so everything is timed against the server's. */
let clockOffset = 0;
let bootId = null;
let lastEvent = Date.now();

const now = () => Date.now() + clockOffset;
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/* ---------- time ---------- */

let timeFormat, dateFormat;
function setTimeZone(zone) {
  timeZone = zone;
  timeFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" });
}
setTimeZone(timeZone);

const clockText = (ms) => timeFormat.format(ms);
function minutesOfDay(ms) {
  const [h, m] = clockText(ms).split(":").map(Number);
  return h * 60 + m;
}

function parseTime(text) {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(text || "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

/** Draws "12:34" as fixed-width cells, and only touches the page when the text changes. */
function drawDigits(el, text, blink = false) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.replaceChildren(
    ...[...text].map((ch) => {
      const span = document.createElement("span");
      span.className = ch === ":" ? (blink ? "c blink" : "c") : "d";
      span.textContent = ch;
      return span;
    }),
  );
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/* ---------- scenes ---------- */

function currentScene() {
  if (!state) return "idle";
  if (state.scene !== "rotate") return state.scene;
  const { scenes, seconds } = state.rotate;
  // Derived from the shared clock rather than a local timer, so every screen flips together.
  return scenes[Math.floor(now() / (seconds * 1000)) % scenes.length] || "idle";
}

function showScene(name) {
  if (stage.dataset.scene === name && $(".scene.active")) return;
  stage.dataset.scene = name;
  for (const el of document.querySelectorAll(".scene")) {
    el.classList.toggle("active", el.dataset.scene === name);
  }
}

function fillCard(card, { kicker, title, body, tone }) {
  card.className = `card tone-${tone}`;
  setText(card.querySelector(".card-kicker"), kicker || "");
  const titleEl = card.querySelector(".card-title");
  setText(titleEl, title || "");
  titleEl.classList.toggle("medium", title.length > 18 && title.length <= 45);
  titleEl.classList.toggle("small", title.length > 45);
  const bodyEl = card.querySelector(".card-body");
  setText(bodyEl, body || "");
  bodyEl.classList.toggle("small", body.length > 220);
}

function renderSchedule() {
  const { items, title, platform } = state.schedule;
  setText($("#boardTitle"), title);
  setText($("#boardPlatform"), platform);

  const rows = $("#rows");
  rows.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement("li");
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = item.time;
      const dest = document.createElement("span");
      dest.className = "dest";
      dest.textContent = item.title;
      if (item.detail) {
        const small = document.createElement("small");
        small.textContent = item.detail;
        dest.append(small);
      }
      const status = document.createElement("span");
      status.className = "status";
      li.append(time, dest, status);
      return li;
    }),
  );
  // Shrink the type as rows are added so the whole day always fits on one screen.
  const size = Math.min(2.9, Math.max(1.1, 42 / (1.85 * Math.max(items.length, 1))));
  rows.parentElement.style.setProperty("--fs", `${size}rem`);
  scheduleMinute = -1;
}

let scheduleMinute = -1;
function updateScheduleMarkers() {
  const minute = minutesOfDay(now());
  if (minute === scheduleMinute) return;
  scheduleMinute = minute;

  const items = state.schedule.items;
  const times = items.map((i) => parseTime(i.time));
  let current = -1;
  times.forEach((t, i) => {
    if (t <= minute) current = i;
  });
  const next = times.findIndex((t) => t > minute);

  [...$("#rows").children].forEach((li, i) => {
    const kind = i === current ? "now" : i < current ? "past" : i === next ? "next" : "";
    li.className = kind;
    li.querySelector(".status").textContent =
      { now: "Now", past: "Departed", next: "Next" }[kind] || "On time";
  });

  const nextItem = items[next];
  if (current >= 0) {
    setText($("#nowLabel"), "Now");
    setText($("#nowTitle"), items[current].title);
    setText($("#nowNext"), nextItem ? `Next at ${nextItem.time}: ${nextItem.title}` : "");
  } else if (nextItem) {
    setText($("#nowLabel"), `First up at ${nextItem.time}`);
    setText($("#nowTitle"), nextItem.title);
    setText($("#nowNext"), nextItem.detail || "");
  }
  $("#nowCard").hidden = current < 0 && !nextItem;

  $("#idleNext").hidden = !(state.idle.showNext && nextItem);
  if (nextItem) {
    setText($("#idleNextTime"), nextItem.time);
    setText($("#idleNextTitle"), nextItem.title);
  }
}

function updateCountdown() {
  const { target, doneText } = state.countdown;
  const left = Math.ceil((target - now()) / 1000);
  const digits = $("#countdownDigits");
  const done = $("#countdownDone");
  const finished = left <= 0;

  digits.hidden = finished;
  $("#countdownLabel").hidden = finished && Boolean(doneText);
  done.hidden = !finished;
  $("#countdownUntil").hidden = finished;
  if (finished) return setText(done, doneText || "00:00");

  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pad = (n) => String(n).padStart(2, "0");
  drawDigits(digits, h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`);
  digits.classList.toggle("long", h > 0 && h < 100);
  digits.classList.toggle("xlong", h >= 100);
  digits.classList.toggle("final", left <= 60);
  setText($("#countdownUntil"), `until ${clockText(target)}`);
}

function updateAlert() {
  const alert = state.alert;
  const el = $("#alert");
  // Hide on our own clock too, so an announcement still ends on time if the connection drops.
  const live = alert && (!alert.expiresAt || alert.expiresAt > now());
  if (!live) {
    el.hidden = true;
    el.dataset.id = "";
    return;
  }
  if (el.dataset.id !== alert.id) {
    el.dataset.id = alert.id;
    fillCard($("#alertCard"), alert);
    el.hidden = true;
    void el.offsetWidth; // restart the entrance animation for a new announcement
    el.hidden = false;
  }
  const bar = $("#alertProgress");
  bar.hidden = !alert.expiresAt;
  if (alert.expiresAt) {
    const fraction = (alert.expiresAt - now()) / (alert.expiresAt - alert.startedAt);
    bar.firstElementChild.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
  }
}

/* ---------- ticker ---------- */

let tickerAnimation;
function renderTicker() {
  const { enabled, text } = state.ticker;
  const on = enabled && text.trim() !== "";
  const el = $("#ticker");
  const span = $("#tickerText");
  const changed = span.textContent !== text || el.hidden === on;
  el.hidden = !on;
  stage.classList.toggle("has-ticker", on);
  if (!changed && tickerAnimation) return;
  tickerAnimation?.cancel();
  tickerAnimation = null;
  if (!on) return;
  span.textContent = text;
  const from = el.clientWidth;
  const to = -span.offsetWidth;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  tickerAnimation = span.animate(
    [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
    { duration: ((from - to) / (11 * rem)) * 1000, iterations: Infinity },
  );
}

/* ---------- render ---------- */

function render() {
  setText($("#idleMessage"), state.idle.message);
  $("#stickers").classList.toggle("off", !state.idle.stickers);
  $("#hedgehog").hidden = !state.idle.stickers;

  fillCard($("#messageCard"), state.message);
  setText($("#countdownLabel"), state.countdown.label);
  renderSchedule();
  renderTicker();

  // Only keep a website loaded while it can actually appear, so it isn't running behind other scenes.
  const reachable =
    state.scene === "embed" || (state.scene === "rotate" && state.rotate.scenes.includes("embed"));
  const frame = $("#embedFrame");
  const url = reachable ? state.embed.url : "";
  if (frame.dataset.url !== url) {
    frame.dataset.url = url;
    if (url) frame.src = url;
    else frame.removeAttribute("src");
  }
  frame.hidden = !url;
  $("#embedEmpty").hidden = Boolean(url);
  stage.classList.toggle("embed-clock", state.embed.showClock);

  tick();
}

function tick() {
  if (!state) return;
  const t = now();
  const time = clockText(t);
  for (const el of document.querySelectorAll("[data-clock]")) {
    drawDigits(el, time, el.classList.contains("idle-clock"));
  }
  for (const el of document.querySelectorAll("[data-date]")) setText(el, dateFormat.format(t));
  showScene(currentScene());
  updateScheduleMarkers();
  updateCountdown();
  updateAlert();
  $("#offline").hidden = Date.now() - lastEvent < 40_000;
}

/* ---------- decoration ---------- */

function plantLeaves() {
  const colours = ["--haven-yellow", "--haven-orange-mid", "--haven-gold", "--haven-orange-bright", "--haven-butter"];
  const layer = $("#leaves");
  for (let i = 0; i < 18; i++) {
    const leaf = document.createElement("i");
    leaf.className = "leaf";
    leaf.style.cssText = `
      --x: ${rand(0, 100)}%;
      --size: ${rand(1.2, 2.6)}rem;
      --colour: var(${pick(colours)});
      --dur: ${rand(11, 22)}s;
      --delay: ${-rand(0, 22)}s;
      --sway: ${rand(2, 7)}rem;
      --spin: ${rand(-540, 540)}deg;`;
    layer.append(leaf);
  }
}

function placeStickers() {
  const layer = $("#stickers");
  const deck = [...STICKERS].sort(() => Math.random() - 0.5);
  const slots = STICKER_SLOTS.map((slot) => {
    const el = document.createElement("div");
    el.className = "sticker";
    el.style.cssText = `
      --x: ${slot.x}%; --y: ${slot.y}%; --w: ${slot.w}rem;
      --tilt: ${rand(-14, 14)}deg; --dur: ${rand(5, 9)}s; --delay: ${-rand(0, 9)}s;`;
    const img = document.createElement("img");
    img.alt = "";
    img.src = deck.pop();
    el.append(img);
    layer.append(el);
    return el;
  });

  // Every so often one sticker pops away and a different one takes its place.
  setInterval(() => {
    if (stage.dataset.scene !== "idle") return;
    const el = pick(slots);
    const img = el.firstElementChild;
    const showing = new Set(slots.map((s) => new URL(s.firstElementChild.src).pathname));
    const fresh = STICKERS.filter((src) => !showing.has(src));
    if (!fresh.length) return;
    el.classList.add("out");
    setTimeout(() => {
      img.src = pick(fresh);
      el.style.setProperty("--tilt", `${rand(-14, 14)}deg`);
      img.decode?.().catch(() => {}).finally(() => el.classList.remove("out"));
    }, 350);
  }, 7000);

  // The hedgehog pops up somewhere new each time.
  const hedgehog = $("#hedgehog");
  hedgehog.addEventListener("animationiteration", () => {
    hedgehog.style.left = `${pick([rand(18, 30), rand(58, 68)])}%`;
  });
}

/* ---------- connection ---------- */

let source;
function connect() {
  source?.close();
  // The control panel's preview is this same page; it shouldn't be counted as a venue screen.
  const role = new URLSearchParams(location.search).has("preview") ? "control" : "display";
  source = new EventSource(`/events?role=${role}`);

  source.addEventListener("state", (event) => {
    const data = JSON.parse(event.data);
    lastEvent = Date.now();
    // A new server build means new display code, so pick it up.
    if (bootId && data.boot !== bootId) return location.reload();
    bootId = data.boot;
    clockOffset = data.now - Date.now();
    if (data.config.timeZone !== timeZone) setTimeZone(data.config.timeZone);
    state = data.state;
    render();
  });

  source.addEventListener("ping", (event) => {
    lastEvent = Date.now();
    clockOffset = JSON.parse(event.data).now - Date.now();
  });

  source.addEventListener("reload", () => location.reload());
}

// EventSource reconnects by itself; this covers the case where a connection goes silent without closing.
setInterval(() => {
  if (Date.now() - lastEvent > 45_000) {
    lastEvent = Date.now() - 30_000;
    connect();
  }
}, 5000);

// A page kept in the browser's back/forward cache shouldn't go on counting as a connected screen.
addEventListener("pagehide", () => source?.close());
addEventListener("pageshow", (event) => event.persisted && connect());

plantLeaves();
placeStickers();
connect();
setInterval(tick, 200);
addEventListener("resize", () => {
  tickerAnimation?.cancel();
  tickerAnimation = null;
  if (state) renderTicker();
});

// One click on the screen (or pressing F) goes full screen and keeps the panel awake.
async function goFullScreen() {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => {});
  await navigator.wakeLock?.request("screen").catch(() => {});
}
addEventListener("click", goFullScreen);
addEventListener("keydown", (event) => event.key.toLowerCase() === "f" && goFullScreen());
