/**
 * Sign in with Hack Club Auth (auth.hackclub.com): a standard OAuth code flow that tells Telecast
 * who someone is. Who may use the control panel is decided by Telecast itself, from their email.
 */
import type { User } from "../shared/types.ts";

export interface HackClubEnv {
  /** From the app made at https://auth.hackclub.com/developer/apps. */
  HACKCLUB_CLIENT_ID?: string;
  HACKCLUB_CLIENT_SECRET?: string;
  /** Only for development against a fake Hack Club Auth. Defaults to https://auth.hackclub.com. */
  HACKCLUB_AUTH_URL?: string;
}

export class HackClubError extends Error {}

export class HackClubAuth {
  private readonly base: string;

  constructor(private readonly env: HackClubEnv) {
    this.base = (env.HACKCLUB_AUTH_URL || "https://auth.hackclub.com").replace(/\/$/, "");
  }

  get configured(): boolean {
    return Boolean(this.env.HACKCLUB_CLIENT_ID && this.env.HACKCLUB_CLIENT_SECRET);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.base}/oauth/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      scope: "openid email name",
      client_id: this.env.HACKCLUB_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      state,
    }).toString();
    return url.href;
  }

  /** Swaps the code Hack Club Auth sent back for the identity of the person who signed in. */
  async identify(code: string, redirectUri: string): Promise<User> {
    const token = await this.request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.env.HACKCLUB_CLIENT_ID ?? "",
        client_secret: this.env.HACKCLUB_CLIENT_SECRET ?? "",
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    // Asking Hack Club Auth directly over TLS, rather than trusting the ID token, avoids verifying a JWT here.
    const me = await this.request("/api/v1/me", {
      headers: { Authorization: `Bearer ${String(token.access_token)}` },
    });
    const identity = (me.identity ?? {}) as Record<string, unknown>;
    const id = String(identity.id ?? "");
    const email = String(identity.primary_email ?? "").trim().toLowerCase();
    if (!id || !email) throw new HackClubError("Hack Club Auth didn't say who signed in");
    const name = [identity.first_name, identity.last_name].filter(Boolean).join(" ");
    return { id, email, name: name || email };
  }

  private async request(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new HackClubError(`Hack Club Auth ${path} failed: ${String(data.error ?? res.status)}`);
    return data;
  }
}
