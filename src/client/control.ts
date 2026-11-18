/**
 * The organisers' control panel. Each form edits one section of the shared state and saves it with
 * a PATCH; the server then pushes the result to every screen (and back here) at once.
 */
import type { Content, Me, ScheduleItem, Scene, State } from "../shared/types.ts";
import { $, $$, connect } from "./live.ts";

type Section = Exclude<keyof Content, "scene">;
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

let state: State | null = null;
let me: Me | null = null;

/* ---------- talking to the server ---------- */

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    showSignIn(data.error);
    throw new Error(data.error ?? "Sign in to make changes");
  }
  if (!res.ok) throw new Error(data.error ?? "That didn't save. Try again.");
  return data as T;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, bad = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("bad", bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), bad ? 5000 : 1800);
}

/** Runs a change and reports how it went, so every button behaves the same way. */
async function run(action: () => Promise<unknown>, done?: string): Promise<boolean> {
  try {
    await action();
    if (done) toast(done);
    return true;
  } catch (err) {
    toast((err as Error).message, true);
    return false;
  }
}

/* ---------- signing in ---------- */

const SIGN_IN_PROBLEMS: Record<string, string> = {
  "not-organiser": "You're not on the organisers' list, so you can't use this panel. Ask an admin to add your Hack Club email, then sign in again.",
  setup: "Sign-in isn't set up yet. Whoever runs this Telecast needs to add its Hack Club Auth details and an admin.",
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in took too long. Try again.",
  hackclub: "Couldn't reach Hack Club Auth. Try again in a moment.",
};

function showSignIn(reason?: string) {
  $("#loginReason").textContent = reason ?? "Sign in with Hack Club to change what's on the screens.";
  $("#login").hidden = false;
}

async function loadMe() {
  const problem = new URLSearchParams(location.search).get("error");
  if (problem) history.replaceState(null, "", location.pathname);
  const res = await fetch("/api/me");
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return showSignIn(problem ? SIGN_IN_PROBLEMS[problem] : res.status === 401 ? undefined : data.error);
  }
  me = (await res.json()) as Me;
  $("#login").hidden = true;

  const who = $("#who");
  who.hidden = false;
  $("#whoName").textContent = me.user.name;

  renderAccess();
}

$("#signOut").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.reload();
});

/* ---------- who can use the panel ---------- */

function renderAccess() {
  if (!me) return;
  const { organisers, user } = me;
  const count = organisers.length;
  $("#accessSummary").textContent = count
    ? `Admins and ${count} other ${count === 1 ? "organiser" : "organisers"} can sign in here.`
    : "Nobody has been added yet, so only admins can sign in.";
  $("#accessForm").hidden = !user.admin;
  if (user.admin) $<HTMLTextAreaElement>("#organisers").value = organisers.join("\n");
}

$("#accessForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const emails = $<HTMLTextAreaElement>("#organisers").value.split(/[\s,;]+/).filter(Boolean);
  void run(async () => {
    const { organisers } = await api<{ organisers: string[] }>("PUT", "/api/organisers", { emails });
    if (me) me.organisers = organisers;
    renderAccess();
  }, "Organisers saved");
});

/* ---------- forms ---------- */

const sectionForms = $$<HTMLFormElement>("form[data-section]");
const sectionOf = (form: HTMLFormElement) => form.dataset.section as Section;
const formFor = (section: Section) => $<HTMLFormElement>(`form[data-section='${section}']`);

function collect(form: HTMLFormElement): Record<string, unknown> {
  const section = sectionOf(form);
  const data: Record<string, unknown> = {};
  for (const el of $$<Field>("[data-field]", form)) {
    const input = el as HTMLInputElement;
    if (input.type === "radio" && !input.checked) continue;
    data[el.dataset.field!] =
      input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : el.value;
  }
  if (section === "countdown") {
    const target = new Date($<HTMLInputElement>("#countdownTarget").value).getTime();
    if (Number.isFinite(target)) data.target = target;
  }
  if (section === "schedule") {
    data.items = $$("#items li").map(
      (li): ScheduleItem => ({
        time: $<HTMLInputElement>(".time", li).value,
        title: $<HTMLInputElement>(".title", li).value,
        detail: $<HTMLInputElement>(".detail", li).value,
      }),
    );
  }
  if (section === "rotate") {
    const scenes = $$<HTMLInputElement>("#rotateScenes input:checked").map((el) => el.value);
    if (!scenes.length) throw new Error("Pick at least one scene to rotate through");
    data.scenes = scenes;
  }
  return data;
}

/** A timestamp as the value a datetime-local input expects, in this device's own time zone. */
function toLocalInput(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

function addItem(item: ScheduleItem = { time: "", title: "", detail: "" }): HTMLElement {
  const template = $<HTMLTemplateElement>("#itemTemplate");
  const li = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
  $<HTMLInputElement>(".time", li).value = item.time;
  $<HTMLInputElement>(".title", li).value = item.title;
  $<HTMLInputElement>(".detail", li).value = item.detail;
  $("#items").append(li);
  return li;
}

function fill(form: HTMLFormElement, s: State) {
  const section = sectionOf(form);
  const data = s[section] as unknown as Record<string, unknown>;
  for (const el of $$<Field>("[data-field]", form)) {
    const value = data[el.dataset.field!];
    const input = el as HTMLInputElement;
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.type === "radio") input.checked = input.value === value;
    else el.value = String(value ?? "");
  }
  if (section === "countdown") $<HTMLInputElement>("#countdownTarget").value = toLocalInput(s.countdown.target);
  if (section === "schedule") {
    $("#items").replaceChildren();
    s.schedule.items.forEach(addItem);
  }
  if (section === "rotate") {
    for (const el of $$<HTMLInputElement>("#rotateScenes input")) {
      el.checked = s.rotate.scenes.includes(el.value as Scene);
    }
  }
}

for (const form of sectionForms) {
  // Once someone starts typing, incoming updates leave this form alone until it's saved.
  form.addEventListener("input", () => (form.dataset.dirty = ""));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const show = (event.submitter as HTMLElement | null)?.dataset.show;
    void run(
      async () => {
        const patch: Record<string, unknown> = { [sectionOf(form)]: collect(form) };
        if (show) patch.scene = show;
        await api("PATCH", "/api/state", patch);
        delete form.dataset.dirty;
        if (state) fill(form, state);
      },
      show ? "Saved and on screen" : "Saved",
    );
  });
}

$("#addItem").addEventListener("click", () => {
  $(".time", addItem()).focus();
  formFor("schedule").dataset.dirty = "";
});

$("#items").addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (!target.matches(".remove")) return;
  target.closest("li")?.remove();
  formFor("schedule").dataset.dirty = "";
});

$("#quick").addEventListener("click", (event) => {
  const minutes = Number((event.target as HTMLElement).dataset.minutes);
  if (!minutes) return;
  const form = formFor("countdown");
  void run(async () => {
    const countdown = { ...collect(form), target: Date.now() + minutes * 60_000 };
    await api("PATCH", "/api/state", { countdown, scene: "countdown" });
    delete form.dataset.dirty;
  }, `Counting down ${minutes} minutes`);
});

/* ---------- scene switcher, flash announcement, housekeeping ---------- */

$("#scenes").addEventListener("click", (event) => {
  const scene = (event.target as HTMLElement).dataset.scene;
  if (scene) void run(() => api("PATCH", "/api/state", { scene }));
});

$<HTMLFormElement>("#alertForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = Object.fromEntries(new FormData(form));
  void run(async () => {
    await api("POST", "/api/alert", { ...data, seconds: Number(data.seconds) });
    $<HTMLInputElement>("[name=title]", form).value = "";
    $<HTMLTextAreaElement>("[name=body]", form).value = "";
  }, "Announcement sent");
});

$("#clearAlert").addEventListener("click", () => void run(() => api("DELETE", "/api/alert"), "Announcement cleared"));
$("#reloadScreens").addEventListener("click", () => void run(() => api("POST", "/api/reload"), "Screens refreshed"));

$("#reset").addEventListener("click", () => {
  if (!confirm("Reset every scene to its starting content? This can't be undone.")) return;
  for (const form of sectionForms) delete form.dataset.dirty;
  void run(() => api("POST", "/api/reset"), "Everything reset");
});

/* ---------- live updates ---------- */

let displays = 0;
let online = false;

function renderStatus() {
  const el = $("#status");
  el.dataset.state = online ? "live" : "offline";
  el.textContent = online
    ? `Live · ${displays} ${displays === 1 ? "screen" : "screens"} connected`
    : "Reconnecting…";
}

function render(s: State) {
  for (const form of sectionForms) {
    if (!("dirty" in form.dataset)) fill(form, s);
    const scene = sectionOf(form) as Scene;
    form.classList.toggle("live", s.scene === scene || (s.scene === "rotate" && s.rotate.scenes.includes(scene)));
  }
  for (const button of $$("#scenes button")) {
    button.setAttribute("aria-pressed", String(button.dataset.scene === s.scene));
  }
  $("#clearAlert").hidden = !s.alert;
}

connect(
  "control",
  (message) => {
    if (message.type === "state") {
      state = message.state;
      $("#eventName").textContent = message.config.eventName;
      document.title = `Telecast · ${message.config.eventName}`;
      render(state);
    } else if (message.type === "stats") {
      displays = message.displays;
      renderStatus();
    }
  },
  (isOnline) => {
    online = isOnline;
    renderStatus();
  },
);

/* ---------- preview ---------- */

// The preview is the real display page at 1920×1080, shrunk to fit, so it matches the venue screens exactly.
const preview = $("#preview");
new ResizeObserver(([entry]) => {
  if (entry) $("iframe", preview).style.transform = `scale(${entry.contentRect.width / 1920})`;
}).observe(preview);

void loadMe();
