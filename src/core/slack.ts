/**
 * The few Slack calls Telecast needs: "Sign in with Slack" (OpenID Connect) to learn who someone is,
 * and a bot token to see who is in the organisers' private channel.
 */
import type { Channel, User } from "../shared/types.ts";

export interface SlackEnv {
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  /** Bot token (xoxb-…) with the groups:read scope. The bot must be invited to the organisers' channel. */
  SLACK_BOT_TOKEN?: string;
  /** Only for development against a fake Slack. Defaults to https://slack.com. */
  SLACK_BASE_URL?: string;
}

/** How long a channel's member list is trusted before asking Slack again. */
const MEMBERS_TTL = 60_000;

export class SlackError extends Error {}

export class Slack {
  private readonly base: string;
  private members = new Map<string, { at: number; ids: Set<string> }>();

  constructor(private readonly env: SlackEnv) {
    this.base = (env.SLACK_BASE_URL || "https://slack.com").replace(/\/$/, "");
  }

  get configured(): boolean {
    return Boolean(this.env.SLACK_CLIENT_ID && this.env.SLACK_CLIENT_SECRET && this.env.SLACK_BOT_TOKEN);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.base}/openid/connect/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      scope: "openid profile",
      client_id: this.env.SLACK_CLIENT_ID ?? "",
      redirect_uri: redirectUri,
      state,
    }).toString();
    return url.href;
  }

  /** Swaps the code Slack sent back for the identity of the person who signed in. */
  async identify(code: string, redirectUri: string): Promise<User> {
    const token = await this.call("openid.connect.token", {
      client_id: this.env.SLACK_CLIENT_ID ?? "",
      client_secret: this.env.SLACK_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
    // Asking Slack directly over TLS, rather than trusting the ID token, avoids verifying a JWT here.
    const info = await this.call("openid.connect.userInfo", {}, String(token.access_token));
    const id = String(info["https://slack.com/user_id"] ?? info.sub ?? "");
    if (!id) throw new SlackError("Slack didn't say who signed in");
    return { id, name: String(info.name ?? "Organiser"), picture: String(info.picture ?? "") };
  }

  /**
   * Whether someone is in a channel right now. If Slack can't be reached, the last known member list
   * is used, so an outage at Slack doesn't lock organisers out in the middle of an event.
   */
  async isMember(channelId: string, userId: string): Promise<boolean> {
    const cached = this.members.get(channelId);
    if (cached && Date.now() - cached.at < MEMBERS_TTL) return cached.ids.has(userId);
    try {
      const ids = new Set<string>();
      let cursor = "";
      do {
        const page = await this.bot("conversations.members", { channel: channelId, limit: "1000", cursor });
        for (const id of page.members as string[]) ids.add(id);
        cursor = nextCursor(page);
      } while (cursor);
      this.members.set(channelId, { at: Date.now(), ids });
      return ids.has(userId);
    } catch (err) {
      if (cached) return cached.ids.has(userId);
      throw err;
    }
  }

  /** Private channels the bot has been invited to: the ones that can be chosen as the organisers' channel. */
  async privateChannels(): Promise<Channel[]> {
    const channels: Channel[] = [];
    let cursor = "";
    do {
      const page = await this.bot("users.conversations", {
        types: "private_channel",
        exclude_archived: "true",
        limit: "200",
        cursor,
      });
      for (const c of page.channels as { id: string; name: string }[]) channels.push({ id: c.id, name: c.name });
      cursor = nextCursor(page);
    } while (cursor);
    return channels.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Looks a channel up, which also proves the bot can see it. */
  async channel(id: string): Promise<Channel> {
    const info = await this.bot("conversations.info", { channel: id });
    const c = info.channel as { id: string; name: string; is_private?: boolean; is_member?: boolean };
    if (!c.is_private) throw new SlackError("That channel isn't private");
    if (c.is_member === false) throw new SlackError("Invite the Telecast bot to that channel first");
    return { id: c.id, name: c.name };
  }

  private bot(method: string, params: Record<string, string>) {
    return this.call(method, params, this.env.SLACK_BOT_TOKEN);
  }

  private async call(
    method: string,
    params: Record<string, string>,
    token?: string,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/api/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: new URLSearchParams(params),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !data.ok) throw new SlackError(`Slack ${method} failed: ${String(data.error ?? res.status)}`);
    return data;
  }
}

function nextCursor(page: Record<string, unknown>): string {
  return (page.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? "";
}
