/**
 * The Cloudflare host: a Worker in front of static assets, and one Durable Object that holds the
 * event's state and every browser's WebSocket. Sockets use hibernation, so the object costs
 * nothing while screens are simply sitting connected.
 */
import { DurableObject } from "cloudflare:workers";
import { Telecast, type Env as CoreEnv, type Host, type Saved } from "../core/telecast.ts";
import type { Role } from "../shared/types.ts";

interface Env extends CoreEnv {
  ASSETS: Fetcher;
  ROOM: DurableObjectNamespace<TelecastRoom>;
  /** Identifies the deployed version; screens reload when it changes. */
  VERSION?: { id: string };
}

const isRole = (tag: string | undefined): tag is Role => tag === "display" || tag === "control";

export class TelecastRoom extends DurableObject<Env> {
  private readonly telecast: Telecast;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    const host: Host = {
      read: () => ctx.storage.get<Saved>("saved"),
      write: (saved) => ctx.storage.put("saved", saved),
      send: (message, to) => {
        for (const socket of to === "all" ? ctx.getWebSockets() : ctx.getWebSockets(to)) {
          try {
            socket.send(message);
          } catch {
            // The socket closed between being listed and being written to.
          }
        }
      },
      displays: () => ctx.getWebSockets("display").filter((s) => s.readyState === WebSocket.OPEN).length,
      wake: (at) => (at === null ? ctx.storage.deleteAlarm() : ctx.storage.setAlarm(at)),
    };

    this.telecast = new Telecast(host, env, env.VERSION?.id || "dev");
    // Answered by Cloudflare itself, so keep-alive pings don't wake the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/ws") return this.telecast.fetch(request);

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const role: Role = url.searchParams.get("role") === "control" ? "control" : "display";
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    server.send(await this.telecast.greeting());
    this.telecast.connectionsChanged();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    // 1005 and 1006 mean "no code was sent" and can't be echoed back.
    socket.close(code === 1005 || code === 1006 ? 1000 : code);
    if (isRole(this.ctx.getTags(socket)[0])) this.telecast.connectionsChanged();
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011);
    this.telecast.connectionsChanged();
  }

  override alarm(): Promise<void> {
    return this.telecast.alarm();
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ws" || pathname.startsWith("/api/") || pathname.startsWith("/auth/")) {
      // One deployment is one event, so everything goes to a single object.
      return env.ROOM.get(env.ROOM.idFromName("event")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
