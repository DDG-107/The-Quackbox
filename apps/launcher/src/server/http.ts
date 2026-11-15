import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import type { ServerConfig } from "./config.js";
import { Hub } from "./hub.js";
import type { RoomHandlers } from "./room.js";

export interface HubServer {
  hub: Hub;
  port: number;
  localUrl: string;
  /** True when the built controller was found and is being served. */
  hasController: boolean;
  close(): Promise<void>;
}

export interface StartOptions {
  handlers?: RoomHandlers;
}

/**
 * Cartridges and the SDK are public LAN assets loaded by an opaque-origin frame
 * (`sandbox="allow-scripts"`), so their ES module imports need CORS.
 */
function allowAnyOrigin(response: { setHeader(name: string, value: string): void }): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
}

/** HTTP (controller, cartridges, SDK, health) and WebSocket, on one port. */
export async function startHubServer(
  config: ServerConfig,
  options: StartOptions = {},
): Promise<HubServer> {
  const app = Fastify({ logger: false });
  const hub = new Hub({
    roomCode: config.roomCode,
    graceMs: config.graceMs,
    maxPayloadBytes: config.maxPayloadBytes,
    handlers: options.handlers,
  });

  const hasController = existsSync(join(config.controllerDir, "index.html"));

  if (hasController) {
    await app.register(fastifyStatic, { root: config.controllerDir, index: ["index.html"] });
  } else {
    app.get("/", async (_request, reply) => {
      reply.type("text/html; charset=utf-8");
      return notBuiltPage(config.roomCode);
    });
  }

  // Cartridges are plain web pages; the launcher frame loads them from here.
  if (existsSync(config.gamesDir)) {
    await app.register(fastifyStatic, {
      root: config.gamesDir,
      prefix: "/games/",
      index: ["index.html"],
      decorateReply: false,
      setHeaders: allowAnyOrigin,
    });
  }

  if (existsSync(config.sdkDir)) {
    await app.register(fastifyStatic, {
      root: config.sdkDir,
      prefix: "/sdk/",
      index: ["index.js"],
      decorateReply: false,
      setHeaders: allowAnyOrigin,
    });
  }

  app.get("/health", async () => ({
    ok: true,
    room: config.roomCode,
    ...hub.stats,
  }));

  await app.listen({ port: config.port, host: config.host });

  const address = app.server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;

  const wss = new WebSocketServer({
    server: app.server,
    path: "/ws",
    maxPayload: config.maxPayloadBytes,
    perMessageDeflate: false,
  });

  const lastPong = new Map<WebSocket, number>();
  wss.on("connection", (socket) => {
    lastPong.set(socket, Date.now());
    socket.on("pong", () => lastPong.set(socket, Date.now()));
    socket.on("close", () => lastPong.delete(socket));
    hub.handleConnection(socket);
  });

  // Phones that sleep or switch apps stop answering pings; their slot is held
  // by the grace timer, so terminating the dead socket is safe.
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const socket of wss.clients) {
      const seen = lastPong.get(socket) ?? now;
      if (now - seen > config.dropAfterMs) {
        socket.terminate();
        continue;
      }
      socket.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();

  return {
    hub,
    port,
    localUrl: `http://localhost:${port}`,
    hasController,
    async close() {
      clearInterval(heartbeat);
      hub.dispose();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await app.close();
    },
  };
}

function notBuiltPage(roomCode: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The QuackBox — controller not built</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #0b0b12; color: #f4f4fb; font: 16px/1.6 system-ui, sans-serif; }
      main { max-width: 34rem; padding: 2rem; }
      code { background: #1b1b28; padding: .15rem .4rem; border-radius: .3rem; }
      h1 { font-size: 1.4rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>The hub is running, the controller is not built yet.</h1>
      <p>Room <code>${roomCode}</code> is open. Build the phone controller, then reload:</p>
      <p><code>corepack pnpm build</code></p>
      <p>The server is up at <code>/health</code> and the protocol is at <code>/ws</code>.</p>
    </main>
  </body>
</html>`;
}
