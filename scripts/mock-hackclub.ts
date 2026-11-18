/**
 * A pretend Hack Club Auth for local development, so sign-in can be tried without a real app.
 * It is never part of a build; `pnpm dev:mock` points a local Telecast at it.
 */
import http from "node:http";

export const MOCK_HACKCLUB_PORT = 8089;
export const MOCK_ADMIN_EMAIL = "ada@example.com";

const users = [
  { id: "ident!ada", first_name: "Ada", last_name: "Admin", primary_email: MOCK_ADMIN_EMAIL, note: "admin" },
  { id: "ident!bo", first_name: "Bo", last_name: "Organiser", primary_email: "bo@example.com", note: "gets in once Ada adds bo@example.com" },
  { id: "ident!cy", first_name: "Cy", last_name: "Outsider", primary_email: "cy@example.com", note: "not on the list" },
];

const json = (res: http.ServerResponse, status: number, body: object) =>
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

async function formBody(req: http.IncomingMessage): Promise<URLSearchParams> {
  let text = "";
  for await (const chunk of req) text += chunk;
  return new URLSearchParams(text);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${MOCK_HACKCLUB_PORT}`);

    // Stands in for the consent screen: pick who to be.
    if (url.pathname === "/oauth/authorize") {
      const back = (id: string) => {
        const to = new URL(url.searchParams.get("redirect_uri") ?? "");
        to.searchParams.set("code", id);
        to.searchParams.set("state", url.searchParams.get("state") ?? "");
        return to.href;
      };
      const links = users
        .map((u) => `<li><a href="${back(u.id)}">${u.first_name} ${u.last_name}</a> (${u.note})</li>`)
        .join("");
      return res
        .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        .end(`<!doctype html><title>Pretend Hack Club Auth</title><h1>Pretend Hack Club Auth</h1><p>Sign in as:</p><ul>${links}</ul>`);
    }

    if (url.pathname === "/oauth/token") {
      const params = await formBody(req);
      return json(res, 200, { access_token: params.get("code"), token_type: "Bearer" });
    }

    if (url.pathname === "/api/v1/me") {
      const token = (req.headers.authorization ?? "").replace("Bearer ", "");
      const user = users.find((u) => u.id === token);
      if (!user) return json(res, 401, { error: "invalid_token" });
      const { note: _note, ...identity } = user;
      return json(res, 200, { identity, scopes: ["openid", "email", "name"] });
    }

    return json(res, 404, { error: "not_found" });
  })
  .listen(MOCK_HACKCLUB_PORT, () => console.log(`Pretend Hack Club Auth on http://localhost:${MOCK_HACKCLUB_PORT}`));
