import { WebSocket, type RawData } from "ws";
import {
  gameClientMessageSchema,
  type GameServerMessage,
  type InputEvent,
  type Player,
} from "@quackbox/protocol";
import { TokenBucket } from "./limits.js";
import type { GameBridge, PlayerEventKind, Room } from "./room.js";

/** A game may push UI and events quickly, but not as fast as a phone can mash. */
const GAME_RATE_PER_SECOND = 180;
const GAME_BURST = 240;
const MAX_PAYLOAD_BYTES = 32 * 1024;

export interface GameLinkOptions {
  socket: WebSocket;
  room: Room;
  gameId: string;
  onClosed?: (gameId: string) => void;
}

/**
 * One running game application attached to one room. The game renderer never
 * sees the room socket; its shell talks this channel and the hub re-validates
 * every message before it can reach a phone.
 */
export class GameLink implements GameBridge {
  private readonly socket: WebSocket;
  private readonly room: Room;
  private readonly gameId: string;
  private readonly onClosed?: (gameId: string) => void;
  private readonly bucket = new TokenBucket(GAME_RATE_PER_SECOND, GAME_BURST);
  private identified = false;
  private ready = false;
  private closed = false;
  private ended = false;
  private readonly readyTimer: NodeJS.Timeout;

  constructor(options: GameLinkOptions) {
    this.socket = options.socket;
    this.room = options.room;
    this.gameId = options.gameId;
    this.onClosed = options.onClosed;

    this.socket.on("message", (data, isBinary) => this.onMessage(data, isBinary));
    this.socket.on("close", () => this.finish());
    this.socket.on("error", () => this.finish());

    // A game that never initializes should not leave the platform stuck in
    // “running” while the host looks at a blank window.
    this.readyTimer = setTimeout(() => {
      if (!this.ready) this.close("game did not become ready");
    }, 10_000);
    this.readyTimer.unref();
  }

  get active(): boolean {
    return this.ready && !this.closed;
  }

  /** Called by the hub when a replacement game takes over. */
  close(reason = "replaced"): void {
    if (this.closed) return;
    this.socket.close(4009, reason);
    this.finish();
  }

  input(player: Player, input: InputEvent): void {
    if (!this.active) return;
    this.send({ type: "quackbox:input", player, input });
  }

  player(kind: PlayerEventKind, player: Player): void {
    if (!this.active) return;
    this.send({ type: "quackbox:player", kind, player });
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (this.closed || isBinary) {
      this.close(isBinary ? "binary frames are not supported" : "closed");
      return;
    }
    if (!this.bucket.take()) {
      this.close("rate limited");
      return;
    }

    const text = readText(data);
    if (text === null || Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) {
      this.close("message too large");
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.close("malformed JSON");
      return;
    }

    const parsed = gameClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.close("invalid game message");
      return;
    }

    const message = parsed.data;

    if (!this.ready) {
      // The shell identifies itself first; the renderer then reports that its
      // SDK handlers are installed. Init goes out only after both, so a game
      // cannot miss the first message while its page is still loading.
      if (message.type === "quackbox:hello") {
        if (this.identified) return;
        if (message.gameId !== this.gameId) {
          this.close("game id mismatch");
          return;
        }
        this.identified = true;
        return;
      }
      if (!this.identified || message.type !== "quackbox:ready") {
        this.close("hello and ready required");
        return;
      }

      this.initialize();
      return;
    }

    // A repeated handshake after initialization is harmless.
    if (message.type === "quackbox:hello" || message.type === "quackbox:ready") return;

    switch (message.type) {
      case "quackbox:setUI":
        this.room.setUI(message.target, message.ui);
        break;

      case "quackbox:send":
        if (payloadTooLarge(message.data)) {
          this.close("payload too large");
          return;
        }
        this.room.sendEvent(message.playerId, message.event, message.data);
        break;

      case "quackbox:broadcast":
        if (payloadTooLarge(message.data)) {
          this.close("payload too large");
          return;
        }
        this.room.broadcastEvent(message.event, message.data);
        break;

      case "quackbox:end":
        this.ended = true;
        this.room.end(message.results);
        this.send({ type: "quackbox:stop" });
        this.socket.close(4000, "round ended");
        break;

      case "quackbox:log": {
        const line = message.args
          .map((argument) => formatLogArg(argument))
          .map((argument) => argument.slice(0, 500))
          .join(" ");
        console.log(`[game] ${line}`);
        break;
      }

      case "quackbox:error":
        console.warn(`[game] ${message.message}${message.stack ? ` (${message.stack})` : ""}`);
        break;
    }
  }

  private initialize(): void {
    this.ready = true;
    clearTimeout(this.readyTimer);
    this.room.attachGameBridge(this);
    this.send({
      type: "quackbox:init",
      gameId: this.gameId,
      players: this.room.players,
      config: {},
    });
  }

  private send(message: GameServerMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    if (this.socket.bufferedAmount > 1024 * 1024) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // The close handler is the cleanup path.
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    this.room.detachGameBridge(this);

    if (!this.ended) {
      this.ended = true;
      this.room.end([]);
    }
    this.onClosed?.(this.gameId);
  }
}

function readText(data: RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return null;
}

function payloadTooLarge(data: unknown): boolean {
  if (data === undefined) return false;
  try {
    return Buffer.byteLength(JSON.stringify(data)) > MAX_PAYLOAD_BYTES;
  } catch {
    return true;
  }
}

function formatLogArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
