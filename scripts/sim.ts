import { parseArgs } from "node:util";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION, serverMessageSchema } from "@quackbox/protocol";

/**
 * Headless load and reconnect test:
 *   corepack pnpm sim --players 5
 *   corepack pnpm sim --players 100 --drop 10 --seconds 8
 *   corepack pnpm sim --players 100 --drop 0 --tap 200 --seconds 30
 *   corepack pnpm sim --players 4 --drop 0 --draw 250 --seconds 40
 */
const { values } = parseArgs({
  options: {
    players: { type: "string", default: "5" },
    url: { type: "string", default: "ws://127.0.0.1:4321/ws" },
    room: { type: "string" },
    seconds: { type: "string", default: "4" },
    drop: { type: "string", default: "2" },
    /** Send a press on the "tap" control every N ms (0 disables). */
    tap: { type: "string", default: "0" },
    /** Send a short drawpad stroke every N ms (0 disables). */
    draw: { type: "string", default: "0" },
    /** Pull both tug-of-war ropes every N ms; only your team's press counts. */
    pull: { type: "string", default: "0" },
  },
});

const playerCount = Number.parseInt(values.players, 10);
const holdMs = Number.parseFloat(values.seconds) * 1000;
const tapMs = Number.parseInt(values.tap, 10);
const drawMs = Number.parseInt(values.draw, 10);
const pullMs = Number.parseInt(values.pull, 10);
const dropCount = Math.min(Number.parseInt(values.drop, 10), playerCount);
const url = values.url;
const room = values.room?.toUpperCase();

const NAMES = [
  "Pato", "Ana", "Bo", "Cleo", "Dex", "Eve", "Fin", "Gus", "Hana", "Ivo",
  "Jo", "Kai", "Lia", "Mo", "Nia", "Oli", "Pia", "Quin", "Rae", "Sol",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SimClient {
  token: string | null = null;
  playerId: string | null = null;
  resumed = false;
  private socket: WebSocket | null = null;

  constructor(
    readonly index: number,
    readonly name: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const timer = setTimeout(() => reject(new Error(`${this.name}: timed out`)), 8000);

      socket.on("open", () => {
        const join: Record<string, unknown> = { t: "join", protocol: PROTOCOL_VERSION, name: this.name };
        if (room) join.room = room;
        if (this.token) join.token = this.token;
        socket.send(JSON.stringify(join));
      });

      socket.on("message", (data) => {
        let json: unknown;
        try {
          json = JSON.parse(String(data));
        } catch {
          return;
        }
        const parsed = serverMessageSchema.safeParse(json);
        if (!parsed.success) return;
        const message = parsed.data;

        if (message.t === "welcome") {
          clearTimeout(timer);
          this.token = message.token;
          this.playerId = message.playerId;
          this.resumed = message.resumed;
          resolve();
        } else if (message.t === "error") {
          clearTimeout(timer);
          reject(new Error(`${this.name}: ${message.message}`));
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}

function httpHealthUrl(): string {
  return `${url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/ws$/, "")}/health`;
}

async function main(): Promise<void> {
  const clients = Array.from(
    { length: playerCount },
    (_, index) => new SimClient(index, `${NAMES[index % NAMES.length] ?? "Bot"}`),
  );

  console.log(`[sim] ${playerCount} client(s) -> ${url}${room ? ` room ${room}` : ""}`);
  for (const client of clients) {
    await client.connect();
    await sleep(25);
  }
  console.log(`[sim] ${clients.length}/${playerCount} joined`);

  clients[0]?.send({ t: "in", id: "tap", k: "press" });
  clients[1]?.send({ t: "in", id: "joy", k: "axis", x: 0.4, y: -0.9, seq: 1 });

  let tapHandle: NodeJS.Timeout | null = null;
  if (tapMs > 0) {
    console.log(`[sim] tapping every ${tapMs}ms from ${clients.length} client(s)`);
    tapHandle = setInterval(() => {
      for (const client of clients) client.send({ t: "in", id: "tap", k: "press" });
    }, tapMs);
  }

  let drawHandle: NodeJS.Timeout | null = null;
  if (drawMs > 0) {
    console.log(`[sim] drawing every ${drawMs}ms from ${clients.length} client(s)`);
    let step = 0;
    drawHandle = setInterval(() => {
      for (const [index, client] of clients.entries()) {
        const phase = step / 8 + index * 0.15;
        const pts: [number, number][] = [0, 1, 2, 3].map((offset) => {
          const angle = phase + offset * 0.12;
          return [0.5 + Math.cos(angle) * 0.2, 0.5 + Math.sin(angle) * 0.2];
        });
        client.send({ t: "in", id: "draw", k: "stroke", pts });
      }
      step += 1;
    }, drawMs);
  }

  let pullHandle: NodeJS.Timeout | null = null;
  if (pullMs > 0) {
    console.log(`[sim] pulling every ${pullMs}ms from ${clients.length} client(s)`);
    pullHandle = setInterval(() => {
      for (const client of clients) {
        client.send({ t: "in", id: "pull-blue", k: "press" });
        client.send({ t: "in", id: "pull-red", k: "press" });
      }
    }, pullMs);
  }

  await sleep(holdMs);
  if (tapHandle) clearInterval(tapHandle);
  if (drawHandle) clearInterval(drawHandle);
  if (pullHandle) clearInterval(pullHandle);

  const health = await fetch(httpHealthUrl()).then((response) => response.json());
  console.log(`[sim] hub health: ${JSON.stringify(health)}`);

  let failures = 0;
  if (dropCount > 0) {
    console.log(`[sim] dropping ${dropCount} client(s) to test token reconnect`);
    const dropped = clients.slice(0, dropCount);
    for (const client of dropped) client.close();
    await sleep(700);

    for (const client of dropped) {
      await client.connect();
      if (!client.resumed) {
        failures += 1;
        console.error(`[sim] ✗ ${client.name} did not resume their slot`);
      }
    }
    console.log(`[sim] ${dropped.length} reconnected, resumed=${dropped.filter((c) => c.resumed).length}`);
  }

  const resumedPlayers = clients.filter((client) => client.resumed).length;
  for (const client of clients) client.close();

  if (failures > 0) {
    console.error(`[sim] FAILED: ${failures} reconnect(s) did not resume`);
    process.exitCode = 1;
    return;
  }
  console.log(`[sim] OK: ${clients.length} clients, ${resumedPlayers} resumed slot(s)`);
}

await main();
