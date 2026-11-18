/**
 * Telecast itself: the state, the API and the sign-in flow. It only uses web-standard Request and
 * Response, and reaches storage, sockets and timers through a small Host interface, so the same
 * code runs under Node (Docker) and in a Cloudflare Durable Object.
 */
import config from "../../telecast.config.ts";
import type { Me, PublicConfig, Role, ServerMessage, State, User } from "../shared/types.ts";
import { cookie, randomToken, readCookie, seal, unseal } from "./session.ts";
import { HackClubAuth, HackClubError, type HackClubEnv } from "./hackclub.ts";
import { applyPatch, freshState, newAlert, restoreState } from "./state.ts";

export interface Env extends HackClubEnv {
  /** Comma-separated emails of the people who can always sign in and who choose the other organisers. */
  TELECAST_ADMINS?: string;
  /** The address people use, e.g. https://telecast.haven.london. Needed when a proxy hides it. */
  PUBLIC_URL?: string;
}

/** What gets written to disk or Durable Object storage. */
export interface Saved {
  state: unknown;
  /** Emails of the organisers the admins have let in. */
  organisers?: string[];
  /** Signs session cookies. Made once on first run, so there's no secret to configure. */
  secret: string;
}

export interface Host {
  read(): Promise<Saved | undefined>;
  write(saved: Saved): Promise<void>;
  /** Sends a message to connected pages: every one, or only control panels. */
  send(message: string, to: "all" | Role): void;
  /** How many venue screens are connected. */
  displays(): number;
  /** Asks for `alarm()` to be called at this time; null cancels. */
  wake(at: number | null): void | Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_COOKIE = "telecast_session";
const LOGIN_COOKIE = "telecast_login";
const SESSION_DAYS = 7;
const MAX_ORGANISERS = 200;

const cleanEmail = (value: unknown) => (typeof value === "string" ? value.trim().toLowerCase() : "");
const isEmail = (value: string) => value.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value);

const publicConfig: PublicConfig = {
  eventName: config.eventName,
  timeZone: config.timeZone,
  stickers: config.stickers,
  mascot: config.mascot,
};

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 100_000) throw new HttpError(413, "That's too much to save at once");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

export class Telecast {
  private state: State = freshState(config.defaults);
  private organisers: string[] = [];
  private secret = "";
  private loading?: Promise<void>;
  private readonly hackClub: HackClubAuth;
  private readonly admins: Set<string>;

  constructor(
    private readonly host: Host,
    private readonly env: Env,
    /** Changes with each deploy; screens reload themselves when they see a new one. */
    private readonly build: string,
  ) {
    this.hackClub = new HackClubAuth(env);
    this.admins = new Set((env.TELECAST_ADMINS ?? "").split(",").map(cleanEmail).filter(Boolean));
  }

  /** Loads saved state once. Everything public awaits this first. */
  ready(): Promise<void> {
    return (this.loading ??= this.load());
  }

  private async load(): Promise<void> {
    const saved = await this.host.read();
    if (saved) {
      this.state = restoreState(config.defaults, saved.state);
      this.organisers = Array.isArray(saved.organisers) ? saved.organisers.map(cleanEmail).filter(isEmail) : [];
      this.secret = saved.secret ?? "";
    }
    if (!this.secret) {
      this.secret = randomToken();
      await this.persist();
    }
    await this.armAlert();
  }

  private persist(): Promise<void> {
    return this.host.write({ state: this.state, organisers: this.organisers, secret: this.secret });
  }

  /* ---------- live connections ---------- */

  private stateMessage(): string {
    const message: ServerMessage = {
      type: "state",
      state: this.state,
      config: publicConfig,
      now: Date.now(),
      build: this.build,
    };
    return JSON.stringify(message);
  }

  /** The first thing a newly connected page is sent. */
  async greeting(): Promise<string> {
    await this.ready();
    return this.stateMessage();
  }

  /** Call when a page connects or disconnects, so control panels can show how many screens are live. */
  connectionsChanged(): void {
    const message: ServerMessage = { type: "stats", displays: this.host.displays() };
    this.host.send(JSON.stringify(message), "control");
  }

  private async commit(): Promise<void> {
    this.state.rev += 1;
    this.host.send(this.stateMessage(), "all");
    await this.persist();
  }

  /* ---------- flash announcements ---------- */

  private async armAlert(): Promise<void> {
    await this.host.wake(this.state.alert?.expiresAt ?? null);
  }

  /** Called by the host at the time last given to `wake`. */
  async alarm(): Promise<void> {
    await this.ready();
    const expiresAt = this.state.alert?.expiresAt;
    if (!expiresAt) return;
    if (expiresAt > Date.now()) return void (await this.armAlert());
    this.state.alert = null;
    await this.commit();
  }

  /* ---------- who is asking ---------- */

  private origin(request: Request): string {
    return (this.env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
  }

  private isAdmin(user: User): boolean {
    return this.admins.has(user.email);
  }

  /** Admins always get in; everyone else must be on the organisers' list right now. */
  private allowed(user: User): boolean {
    return this.isAdmin(user) || this.organisers.includes(user.email);
  }

  private async user(request: Request): Promise<User> {
    const user = await unseal<User>(readCookie(request, SESSION_COOKIE), this.secret);
    if (!user || typeof user.email !== "string") throw new HttpError(401, "Sign in to make changes");
    // Checked on every request, so being taken off the list takes access away straight away.
    if (!this.allowed(user)) throw new HttpError(401, "You're no longer on the organisers' list");
    return user;
  }

  private async admin(request: Request): Promise<User> {
    const user = await this.user(request);
    if (!this.isAdmin(user)) throw new HttpError(403, "Only an admin can change this");
    return user;
  }

  /* ---------- http ---------- */

  /** Answers /api/* and /auth/*. The host serves static files and sockets itself. */
  async fetch(request: Request): Promise<Response> {
    try {
      await this.ready();
      const url = new URL(request.url);

      // Session cookies are SameSite=Lax; this also refuses cross-site writes from older browsers.
      const from = request.headers.get("Origin");
      if (request.method !== "GET" && from && from !== this.origin(request)) {
        throw new HttpError(403, "Cross-site request refused");
      }

      if (url.pathname.startsWith("/auth/")) return await this.auth(request, url);
      return await this.api(request, url);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof HackClubError) {
        console.error(err.message);
        return json(502, { error: "Couldn't reach Hack Club Auth. Try again in a moment." });
      }
      console.error(err);
      return json(500, { error: "Something went wrong on the server" });
    }
  }

  private async auth(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;
    const origin = this.origin(request);
    const secure = origin.startsWith("https:");
    const callback = `${origin}/auth/callback`;
    const fail = (reason: string) => redirect(`/control?error=${reason}`, [cookie(LOGIN_COOKIE, "", 0, secure)]);

    if (route === "GET /auth/login") {
      if (!this.hackClub.configured) return fail("setup");
      // The state value ties Hack Club Auth's answer to this browser, so a sign-in can't be started by another site.
      const state = randomToken(16);
      const sealed = await seal({ state }, Date.now() + 600_000, this.secret);
      return redirect(this.hackClub.authorizeUrl(callback, state), [cookie(LOGIN_COOKIE, sealed, 600, secure)]);
    }

    if (route === "GET /auth/callback") {
      const pending = await unseal<{ state: string }>(readCookie(request, LOGIN_COOKIE), this.secret);
      const code = url.searchParams.get("code");
      if (url.searchParams.get("error")) return fail("cancelled");
      if (!code || !pending || pending.state !== url.searchParams.get("state")) return fail("expired");

      let user: User;
      try {
        user = await this.hackClub.identify(code, callback);
      } catch (err) {
        console.error(err);
        return fail("hackclub");
      }
      if (!this.allowed(user)) return fail(this.admins.size ? "not-organiser" : "setup");
      const maxAge = SESSION_DAYS * 86_400;
      const session = await seal(user, Date.now() + maxAge * 1000, this.secret);
      return redirect("/control", [
        cookie(SESSION_COOKIE, session, maxAge, secure),
        cookie(LOGIN_COOKIE, "", 0, secure),
      ]);
    }

    if (route === "POST /auth/logout") {
      return json(200, { ok: true }, { "Set-Cookie": cookie(SESSION_COOKIE, "", 0, secure) });
    }

    throw new HttpError(404, "Not found");
  }

  private async api(request: Request, url: URL): Promise<Response> {
    const route = `${request.method} ${url.pathname}`;

    // What's on screen is public by nature, so reading it needs no sign-in.
    if (route === "GET /api/state") return new Response(this.stateMessage(), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (route === "GET /api/health") return json(200, { ok: true, displays: this.host.displays() });

    if (route === "GET /api/me") {
      const user = await this.user(request);
      const me: Me = { user: { ...user, admin: this.isAdmin(user) }, organisers: this.organisers };
      return json(200, me);
    }

    if (route === "PUT /api/organisers") {
      await this.admin(request);
      const { emails } = (await readJson(request)) as { emails?: unknown };
      if (!Array.isArray(emails)) throw new HttpError(400, "Send a list of emails");
      const cleaned = [...new Set(emails.map(cleanEmail).filter(Boolean))].sort();
      const bad = cleaned.find((email) => !isEmail(email));
      if (bad) throw new HttpError(400, `"${bad.slice(0, 80)}" doesn't look like an email address`);
      if (cleaned.length > MAX_ORGANISERS) throw new HttpError(400, `That's more than ${MAX_ORGANISERS} organisers`);
      this.organisers = cleaned;
      await this.persist();
      return json(200, { organisers: this.organisers });
    }

    await this.user(request);

    if (route === "PATCH /api/state") {
      applyPatch(this.state, await readJson(request));
      await this.commit();
      return json(200, { ok: true, rev: this.state.rev });
    }

    if (route === "POST /api/alert") {
      const alert = newAlert(await readJson(request), randomToken(6), Date.now());
      if (!alert) throw new HttpError(400, "An announcement needs a title or a message");
      this.state.alert = alert;
      await this.armAlert();
      await this.commit();
      return json(200, { ok: true });
    }

    if (route === "DELETE /api/alert") {
      this.state.alert = null;
      await this.armAlert();
      await this.commit();
      return json(200, { ok: true });
    }

    if (route === "POST /api/reset") {
      this.state = freshState(config.defaults, this.state.rev);
      await this.armAlert();
      await this.commit();
      return json(200, { ok: true });
    }

    if (route === "POST /api/reload") {
      const message: ServerMessage = { type: "reload" };
      this.host.send(JSON.stringify(message), "all");
      return json(200, { ok: true });
    }

    throw new HttpError(404, "Not found");
  }
}
