import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import type {
  ControllerUI,
  GameResult,
  InputEvent,
  Player,
  ServerMessage,
  UISpec,
} from "@quackbox/protocol";

const COLORS = [
  "#ff5c8a",
  "#36d1ff",
  "#ffd23f",
  "#7cff6b",
  "#c77dff",
  "#ff8f3f",
  "#41e0b8",
  "#9aa5ff",
] as const;

const FALLBACK_COLOR = "#ffffff";

export interface RoomOptions {
  code: string;
  /** Milliseconds a disconnected player keeps their slot. */
  graceMs: number;
  maxPlayers?: number;
}

export interface RoomHandlers {
  onInput?(player: Player, input: InputEvent): void;
  onPlayerJoin?(player: Player): void;
  onPlayerRejoin?(player: Player): void;
  onPlayerLeave?(player: Player): void;
  onPlayerRemoved?(player: Player): void;
  onLobbyChange?(room: Room): void;
}

export type UITarget = "all" | { playerId: string } | { team: string };

export interface PlayerRecord {
  player: Player;
  token: string;
  socket: WebSocket | null;
  lastUI: ControllerUI | null;
  /** Last accepted `seq` per input id, so out-of-order packets are dropped. */
  seq: Map<string, number>;
  lastSeen: number;
}

export type JoinOutcome =
  | { ok: true; record: PlayerRecord; resumed: boolean }
  | { ok: false; error: "name-required" | "room-full" };

/**
 * One room: the player slots, their tokens and their current controller screen.
 * Sockets are attached and detached here; the grace timer decides when a slot
 * is finally removed.
 */
export class Room {
  readonly code: string;
  private readonly graceMs: number;
  private readonly maxPlayers: number;
  private readonly handlers: RoomHandlers;
  private readonly records = new Map<string, PlayerRecord>();
  private readonly byToken = new Map<string, string>();
  private readonly graceTimers = new Map<string, NodeJS.Timeout>();
  private uiVersion = 0;

  constructor(options: RoomOptions, handlers: RoomHandlers = {}) {
    this.code = options.code;
    this.graceMs = options.graceMs;
    this.maxPlayers = options.maxPlayers ?? 200;
    this.handlers = handlers;
  }

  get players(): Player[] {
    return [...this.records.values()].map((record) => record.player);
  }

  get slots(): number {
    return this.records.size;
  }

  get connectedCount(): number {
    return this.players.filter((player) => player.connected).length;
  }

  /**
   * Claim a slot. A known token always wins (same player id, same score, same
   * team); otherwise a name is required to create a new slot.
   */
  join({ name, token }: { name?: string; token?: string }): JoinOutcome {
    if (token) {
      const playerId = this.byToken.get(token);
      const record = playerId ? this.records.get(playerId) : undefined;
      if (record) {
        if (name) record.player.name = this.uniqueName(name, record.player.id);
        return { ok: true, record, resumed: true };
      }
    }

    if (!name) return { ok: false, error: "name-required" };
    if (this.records.size >= this.maxPlayers) return { ok: false, error: "room-full" };

    const record: PlayerRecord = {
      player: {
        id: randomUUID(),
        name: this.uniqueName(name),
        color: COLORS[this.records.size % COLORS.length] ?? FALLBACK_COLOR,
        connected: false,
      },
      token: randomUUID(),
      socket: null,
      lastUI: null,
      seq: new Map(),
      lastSeen: Date.now(),
    };

    this.records.set(record.player.id, record);
    this.byToken.set(record.token, record.player.id);
    return { ok: true, record, resumed: false };
  }

  /** Bind a socket to an existing slot and replay whatever screen it had. */
  attach(record: PlayerRecord, socket: WebSocket, resumed: boolean): void {
    const previous = record.socket;
    if (previous && previous !== socket) previous.close(4001, "superseded");

    this.clearGrace(record.player.id);
    const wasConnected = record.player.connected;
    record.socket = socket;
    record.lastSeen = Date.now();
    record.player.connected = true;

    this.send(record, {
      t: "welcome",
      room: this.code,
      playerId: record.player.id,
      token: record.token,
      resumed,
      graceMs: this.graceMs,
      players: this.players,
      ui: record.lastUI,
    });
    this.broadcastLobby();

    if (wasConnected) this.handlers.onPlayerRejoin?.(record.player);
    else this.handlers.onPlayerJoin?.(record.player);
  }

  /** Socket went away: hold the slot for the grace period, then drop it. */
  detach(record: PlayerRecord, socket: WebSocket): void {
    if (record.socket !== socket) return;

    record.socket = null;
    record.player.connected = false;
    record.lastSeen = Date.now();
    this.broadcastLobby();
    this.handlers.onPlayerLeave?.(record.player);

    const timer = setTimeout(() => this.remove(record.player.id), this.graceMs);
    timer.unref();
    this.graceTimers.set(record.player.id, timer);
  }

  receive(record: PlayerRecord, input: InputEvent): void {
    if (!this.records.has(record.player.id)) return;
    record.lastSeen = Date.now();

    if (input.k === "axis" || input.k === "motion") {
      const last = record.seq.get(input.id) ?? -1;
      if (input.seq <= last) return;
      record.seq.set(input.id, input.seq);
    }

    this.handlers.onInput?.(record.player, input);
  }

  /** Push a controller screen to one player, a whole team, or everyone. */
  setUI(target: UITarget, spec: UISpec): void {
    const version = ++this.uiVersion;
    const ui: ControllerUI = { ...spec, v: version };
    for (const record of this.targets(target)) {
      record.lastUI = ui;
      this.send(record, { t: "ui", ui });
    }
  }

  sendEvent(playerId: string, event: string, data?: unknown): void {
    const record = this.records.get(playerId);
    if (record) this.send(record, { t: "event", event, data });
  }

  broadcastEvent(event: string, data?: unknown): void {
    for (const record of this.records.values()) this.send(record, { t: "event", event, data });
  }

  /** Finish the round: everyone goes back to the lobby (slots and tokens kept). */
  end(results: GameResult[]): void {
    for (const record of this.records.values()) {
      record.lastUI = null;
      record.seq.clear();
      this.send(record, { t: "ended", results });
    }
  }

  kick(playerId: string, reason = "Removed by the host"): void {
    const record = this.records.get(playerId);
    if (!record) return;
    this.send(record, { t: "kicked", reason });
    record.socket?.close(4002, "kicked");
    this.remove(playerId);
  }

  remove(playerId: string): void {
    const record = this.records.get(playerId);
    if (!record) return;

    this.clearGrace(playerId);
    this.records.delete(playerId);
    this.byToken.delete(record.token);
    record.socket?.close(4000, "removed");
    this.broadcastLobby();
    this.handlers.onPlayerRemoved?.(record.player);
  }

  dispose(): void {
    for (const playerId of [...this.records.keys()]) {
      this.clearGrace(playerId);
      this.records.get(playerId)?.socket?.close(1001, "hub shutting down");
    }
    this.records.clear();
    this.byToken.clear();
  }

  private targets(target: UITarget): PlayerRecord[] {
    if (target === "all") return [...this.records.values()];
    if ("playerId" in target) {
      const record = this.records.get(target.playerId);
      return record ? [record] : [];
    }
    return [...this.records.values()].filter((record) => record.player.team === target.team);
  }

  private broadcastLobby(): void {
    const players = this.players;
    for (const record of this.records.values()) {
      this.send(record, { t: "room", room: this.code, players });
    }
    this.handlers.onLobbyChange?.(this);
  }

  private send(record: PlayerRecord, message: ServerMessage): void {
    const socket = record.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private clearGrace(playerId: string): void {
    const timer = this.graceTimers.get(playerId);
    if (!timer) return;
    clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }

  private uniqueName(name: string, exceptId?: string): string {
    const base = name.trim().slice(0, 24) || "Player";
    const taken = new Set(
      [...this.records.values()]
        .filter((record) => record.player.id !== exceptId)
        .map((record) => record.player.name.toLowerCase()),
    );
    if (!taken.has(base.toLowerCase())) return base;

    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} ${randomUUID().slice(0, 4)}`;
  }
}
