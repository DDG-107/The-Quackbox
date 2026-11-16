import { Buffer } from "node:buffer";
import type { RawData, WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  clientMessageSchema,
  type ClientMessage,
  type ErrorCode,
  type JoinMessage,
} from "@quackbox/protocol";
import { TokenBucket } from "./limits.js";
import { Room, type PlayerRecord, type RoomHandlers } from "./room.js";

export interface HubOptions {
  roomCode: string;
  graceMs: number;
  maxPayloadBytes: number;
  /** Sustained inbound messages per second, per socket. */
  messageRatePerSecond: number;
  /** Messages a socket may send back-to-back before the sustained rate applies. */
  messageBurst: number;
  maxPlayers?: number;
  handlers?: RoomHandlers;
}

/** Dropped messages before a socket is hung up: this is flooding, not jitter. */
const DROP_LIMIT = 500;
const RATE_WARN_INTERVAL_MS = 5_000;

interface Client {
  room: Room;
  record: PlayerRecord | null;
  bucket: TokenBucket;
  dropped: number;
  lastRateWarn: number;
}

/** Owns the rooms and every socket lifetime. Game code never touches a socket. */
export class Hub {
  readonly defaultRoom: Room;
  private readonly rooms = new Map<string, Room>();
  private readonly clients = new Map<WebSocket, Client>();
  private readonly maxPayloadBytes: number;
  private disposed = false;
  private rateLimited = 0;

  constructor(private readonly options: HubOptions) {
    this.maxPayloadBytes = options.maxPayloadBytes;
    this.defaultRoom = this.ensureRoom(options.roomCode);
  }

  ensureRoom(code: string): Room {
    const existing = this.rooms.get(code);
    if (existing) return existing;

    const room = new Room(
      { code, graceMs: this.options.graceMs, maxPlayers: this.options.maxPlayers },
      this.options.handlers,
    );
    this.rooms.set(code, room);
    return room;
  }

  get stats(): {
    rooms: number;
    sockets: number;
    players: number;
    connected: number;
    rateLimited: number;
  } {
    let players = 0;
    let connected = 0;
    for (const room of this.rooms.values()) {
      players += room.slots;
      connected += room.connectedCount;
    }
    return {
      rooms: this.rooms.size,
      sockets: this.clients.size,
      players,
      connected,
      rateLimited: this.rateLimited,
    };
  }

  handleConnection(socket: WebSocket): void {
    this.clients.set(socket, {
      room: this.defaultRoom,
      record: null,
      bucket: new TokenBucket(this.options.messageRatePerSecond, this.options.messageBurst),
      dropped: 0,
      lastRateWarn: 0,
    });
    socket.on("message", (data, isBinary) => this.onMessage(socket, data, isBinary));
    socket.on("close", () => this.onClose(socket));
    socket.on("error", () => {
      // ws always emits 'close' after 'error'; detach happens there.
    });
  }

  kick(playerId: string, reason?: string): void {
    for (const room of this.rooms.values()) room.kick(playerId, reason);
  }

  dispose(): void {
    this.disposed = true;
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.clients.clear();
  }

  private onMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (this.disposed) return;

    const client = this.clients.get(socket);
    if (!client) return;

    // Shape traffic before parsing: a flooding phone must not cost JSON and zod
    // work, and the limit is per socket, so one phone cannot slow the room down.
    if (!client.bucket.take()) {
      this.onRateLimited(socket, client);
      return;
    }

    if (isBinary) {
      this.reject(socket, "bad-message", "Binary frames are not implemented yet; send JSON.");
      return;
    }

    const text = readText(data);
    if (text === null) {
      this.reject(socket, "bad-message", "Unsupported frame.");
      return;
    }
    if (Buffer.byteLength(text) > this.maxPayloadBytes) {
      this.reject(socket, "bad-message", "Message too large.");
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.reject(socket, "bad-message", "Malformed JSON.");
      return;
    }

    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.reject(socket, "bad-message", describeIssues(parsed.error));
      return;
    }

    const message: ClientMessage = parsed.data;
    if (message.t === "join") {
      this.onJoin(socket, client, message);
      return;
    }

    if (!client.record) {
      this.reject(socket, "not-joined", "Send a join message first.");
      return;
    }
    client.room.receive(client.record, message);
  }

  private onJoin(socket: WebSocket, client: Client, message: JoinMessage): void {
    // A socket joins once; a reconnect arrives on a fresh socket with its token.
    if (client.record) return;

    if (message.protocol !== undefined && message.protocol !== PROTOCOL_VERSION) {
      this.reject(
        socket,
        "protocol",
        `Controller speaks protocol v${message.protocol}, hub speaks v${PROTOCOL_VERSION}. Reload the controller page.`,
      );
      return;
    }

    const room = message.room ? this.rooms.get(message.room) : this.defaultRoom;
    if (!room) {
      this.reject(socket, "room-not-found", `This hub has no room ${message.room}.`);
      return;
    }

    const outcome = room.join({ name: message.name, token: message.token });
    if (!outcome.ok) {
      const text =
        outcome.error === "room-full"
          ? "This room is full."
          : "Enter a name to join, or reopen the link from the TV.";
      this.reject(socket, outcome.error, text);
      return;
    }

    client.room = room;
    client.record = outcome.record;
    room.attach(outcome.record, socket, outcome.resumed);
  }

  private onClose(socket: WebSocket): void {
    const client = this.clients.get(socket);
    this.clients.delete(socket);
    if (client?.record) client.room.detach(client.record, socket);
  }

  private onRateLimited(socket: WebSocket, client: Client): void {
    client.dropped += 1;
    this.rateLimited += 1;

    const now = Date.now();
    if (now - client.lastRateWarn >= RATE_WARN_INTERVAL_MS) {
      client.lastRateWarn = now;
      const who = client.record?.player.name ?? "an unjoined socket";
      console.warn(`[hub] rate limit: dropped ${client.dropped} message(s) from ${who}`);
    }

    if (client.dropped < DROP_LIMIT) return;
    this.reject(socket, "rate-limited", "Too many messages. Wait a moment, then reconnect.");
    socket.close(4008, "rate limited");
  }

  private reject(socket: WebSocket, code: ErrorCode, message: string): void {
    socket.send(JSON.stringify({ t: "error", code, message }));
  }
}

function readText(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return null;
}

function describeIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.map(String).join(".") || "message"}: ${issue.message}`)
    .join("; ");
}
