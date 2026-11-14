/**
 * A pretend Slack for local development, so sign-in and channel checks can be tried without a real
 * Slack app. It is never part of a build; `pnpm dev:mock` points a local Telecast at it.
 */
import http from "node:http";

export const MOCK_SLACK_PORT = 8089;

const users = [
  { id: "U_ADA", name: "Ada (admin)" },
  { id: "U_BO", name: "Bo (in the organisers' channel)" },
  { id: "U_CY", name: "Cy (not in the channel)" },
];

const channels = [
  { id: "C_ORGANISERS", name: "haven-london-organisers", members: ["U_ADA", "U_BO"] },
  { id: "C_VOLUNTEERS", name: "haven-london-volunteers", members: ["U_ADA", "U_BO", "U_CY"] },
];

const json = (res: http.ServerResponse, body: object) =>
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));

async function formBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return new URLSearchParams(text);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${MOCK_SLACK_PORT}`);

    // Stands in for Slack's consent screen: pick who to be.
    if (url.pathname === "/openid/connect/authorize") {
      const back = (id: string) => {
        const to = new URL(url.searchParams.get("redirect_uri") ?? "");
        to.searchParams.set("code", id);
        to.searchParams.set("state", url.searchParams.get("state") ?? "");
        return to.href;
      };
      const links = users.map((u) => `<li><a href="${back(u.id)}">${u.name}</a></li>`).join("");
      return res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<!doctype html><title>Pretend Slack</title><h1>Pretend Slack</h1><p>Sign in as:</p><ul>${links}</ul>`);
    }

    const params = await formBody(req);
    const token = (req.headers.authorization ?? "").replace("Bearer ", "");

    switch (url.pathname) {
      case "/api/openid.connect.token":
        return json(res, { ok: true, access_token: params.get("code") });
      case "/api/openid.connect.userInfo": {
        const user = users.find((u) => u.id === token);
        return json(res, user ? { ok: true, sub: user.id, "https://slack.com/user_id": user.id, name: user.name } : { ok: false, error: "invalid_auth" });
      }
      case "/api/users.conversations":
        return json(res, { ok: true, channels: channels.map(({ id, name }) => ({ id, name })) });
      case "/api/conversations.members": {
        const channel = channels.find((c) => c.id === params.get("channel"));
        return json(res, channel ? { ok: true, members: channel.members } : { ok: false, error: "channel_not_found" });
      }
      case "/api/conversations.info": {
        const channel = channels.find((c) => c.id === params.get("channel"));
        return json(res, channel ? { ok: true, channel: { id: channel.id, name: channel.name, is_private: true, is_member: true } } : { ok: false, error: "channel_not_found" });
      }
      default:
        return json(res, { ok: false, error: "unknown_method" });
    }
  })
  .listen(MOCK_SLACK_PORT, () => console.log(`Pretend Slack on http://localhost:${MOCK_SLACK_PORT}`));
