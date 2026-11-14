/**
 * The organisers' control panel. Each form edits one section of the shared state and saves it with
 * a PATCH; the server then pushes the result to every screen (and back here) at once.
 */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const KEY = "screens-passcode";
let passcode = localStorage.getItem(KEY) || "";
let state = null;

/* ---------- talking to the server ---------- */

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${passcode}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    askForPasscode();
    throw new Error("Enter the passcode to make changes");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "That didn't save. Try again.");
  return data;
}

let toastTimer;
function toast(text, bad = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 5000 : 1800);
}

/** Runs a change and reports how it went, so every button behaves the same way. */
async function run(action, done) {
  try {
    await action();
    if (done) toast(done);
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

/* ---------- passcode ---------- */

function askForPasscode() {
  $("#login").hidden = false;
  $("#login input").focus();
}

$("#login").addEventListener("submit", async (event) => {
  event.preventDefault();
  passcode = new FormData(event.target).get("passcode");
  const res = await fetch("/api/login", { method: "POST", headers: { Authorization: `Bearer ${passcode}` } });
  $("#loginError").hidden = res.ok;
  if (!res.ok) return;
  localStorage.setItem(KEY, passcode);
  event.target.reset();
  $("#login").hidden = true;
});

/* ---------- forms ---------- */

const sectionForms = $$("form[data-section]");

function fieldValue(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") return Number(el.value);
  return el.value;
}

function collect(form) {
  const section = form.dataset.section;
  const data = {};
  for (const el of $$("[data-field]", form)) {
    if (el.type === "radio" && !el.checked) continue;
    data[el.dataset.field] = fieldValue(el);
  }
  if (section === "countdown") {
    const target = new Date($("#countdownTarget").value).getTime();
    if (Number.isFinite(target)) data.target = target;
  }
  if (section === "schedule") {
    data.items = $$("#items li").map((li) => ({
      time: $(".time", li).value,
      title: $(".title", li).value,
      detail: $(".detail", li).value,
    }));
  }
  if (section === "rotate") {
    data.scenes = $$("#rotateScenes input:checked").map((el) => el.value);
    if (!data.scenes.length) throw new Error("Pick at least one scene to rotate through");
  }
  return data;
}

/** A timestamp as the value a datetime-local input expects, in this device's own time zone. */
function toLocalInput(ms) {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function addItem(item = { time: "", title: "", detail: "" }) {
  const li = $("#itemTemplate").content.firstElementChild.cloneNode(true);
  $(".time", li).value = item.time;
  $(".title", li).value = item.title;
  $(".detail", li).value = item.detail;
  $("#items").append(li);
  return li;
}

function fill(form) {
  const section = form.dataset.section;
  const data = state[section];
  for (const el of $$("[data-field]", form)) {
    const value = data[el.dataset.field];
    if (el.type === "checkbox") el.checked = Boolean(value);
    else if (el.type === "radio") el.checked = el.value === value;
    else el.value = value ?? "";
  }
  if (section === "countdown") $("#countdownTarget").value = toLocalInput(data.target);
  if (section === "schedule") {
    $("#items").replaceChildren();
    data.items.forEach(addItem);
  }
  if (section === "rotate") {
    for (const el of $$("#rotateScenes input")) el.checked = data.scenes.includes(el.value);
  }
}

for (const form of sectionForms) {
  // Once someone starts typing, incoming updates leave this form alone until it's saved.
  const markDirty = () => (form.dataset.dirty = "");
  form.addEventListener("input", markDirty);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const show = event.submitter?.dataset.show;
    await run(
      async () => {
        const patch = { [form.dataset.section]: collect(form) };
        if (show) patch.scene = show;
        await api("PATCH", "/api/state", patch);
        delete form.dataset.dirty;
        if (state) fill(form);
      },
      show ? "Saved and on screen" : "Saved",
    );
  });
}

$("#addItem").addEventListener("click", () => {
  $(".time", addItem()).focus();
  $("form[data-section='schedule']").dataset.dirty = "";
});

$("#items").addEventListener("click", (event) => {
  if (!event.target.matches(".remove")) return;
  event.target.closest("li").remove();
  $("form[data-section='schedule']").dataset.dirty = "";
});

$("#quick").addEventListener("click", (event) => {
  const minutes = Number(event.target.dataset.minutes);
  if (!minutes) return;
  const form = event.target.closest("form");
  run(async () => {
    const countdown = { ...collect(form), target: Date.now() + minutes * 60_000 };
    await api("PATCH", "/api/state", { countdown, scene: "countdown" });
    delete form.dataset.dirty;
  }, `Counting down ${minutes} minutes`);
});

/* ---------- scene switcher, flash announcement, housekeeping ---------- */

$("#scenes").addEventListener("click", (event) => {
  const scene = event.target.dataset.scene;
  if (scene) run(() => api("PATCH", "/api/state", { scene }));
});

$("#alertForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  data.seconds = Number(data.seconds);
  run(async () => {
    await api("POST", "/api/alert", data);
    form.title.value = "";
    form.body.value = "";
  }, "Announcement sent");
});

$("#clearAlert").addEventListener("click", () => run(() => api("DELETE", "/api/alert"), "Announcement cleared"));

$("#reloadScreens").addEventListener("click", () => run(() => api("POST", "/api/reload"), "Screens refreshed"));

$("#reset").addEventListener("click", () => {
  if (!confirm("Reset every scene to its starting content? This can't be undone.")) return;
  run(async () => {
    await api("POST", "/api/reset");
    for (const form of sectionForms) delete form.dataset.dirty;
    for (const form of sectionForms) fill(form);
  }, "Everything reset");
});

/* ---------- live updates ---------- */

let displays = 0;
function setStatus(kind) {
  const el = $("#status");
  el.dataset.state = kind;
  el.textContent =
    kind === "live"
      ? `Live · ${displays} ${displays === 1 ? "screen" : "screens"} connected`
      : kind === "offline"
        ? "Reconnecting…"
        : "Connecting…";
}

function render() {
  for (const form of sectionForms) {
    if (!("dirty" in form.dataset)) fill(form);
    const scene = form.dataset.section;
    form.classList.toggle(
      "live",
      state.scene === scene || (state.scene === "rotate" && state.rotate.scenes.includes(scene)),
    );
  }
  for (const button of $$("#scenes button")) {
    button.setAttribute("aria-pressed", String(button.dataset.scene === state.scene));
  }
  $("#clearAlert").hidden = !state.alert;
}

const source = new EventSource("/events?role=control");
source.addEventListener("state", (event) => {
  state = JSON.parse(event.data).state;
  setStatus("live");
  render();
});
source.addEventListener("stats", (event) => {
  displays = JSON.parse(event.data).displays;
  setStatus("live");
});
source.addEventListener("error", () => setStatus("offline"));

/* ---------- preview ---------- */

// The preview is the real display page at 1920×1080, shrunk to fit, so it matches the venue screens exactly.
const preview = $("#preview");
new ResizeObserver(([entry]) => {
  preview.firstElementChild.style.transform = `scale(${entry.contentRect.width / 1920})`;
}).observe(preview);

// Check the saved passcode up front, so a stale one is caught before someone tries to send something urgent.
fetch("/api/login", { method: "POST", headers: { Authorization: `Bearer ${passcode}` } }).then((res) => {
  if (!res.ok) askForPasscode();
});
