import { fileURLToPath } from "node:url";

export interface ServerConfig {
  /** Port the LAN server listens on. */
  port: number;
  /** Interface to bind. `0.0.0.0` so phones on the LAN can reach it. */
  host: string;
  /** Room code shown on the big screen and encoded in the join URL. */
  roomCode: string;
  /** How long a dropped player keeps their slot (and score) before removal. */
  graceMs: number;
  /** How often the hub pings every socket. */
  heartbeatMs: number;
  /** Silence after which a socket is considered dead and terminated. */
  dropAfterMs: number;
  /** Frame size cap; phones only ever send tiny input messages. */
  maxPayloadBytes: number;
  /** Built phone controller, served at `/`. */
  controllerDir: string;
  /** Cartridge root, served at `/games/`. */
  gamesDir: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeRoomCode(raw: string | undefined, fallback = "ABCD"): string {
  const code = (raw ?? fallback).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return code.length === 4 ? code : fallback;
}

/**
 * Defaults are resolved relative to this source file, which is what the
 * headless runner uses. The Electron main runs bundled, so it passes explicit
 * paths for `controllerDir` and `gamesDir`.
 */
export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const defaults: ServerConfig = {
    port: envInt("QUACKBOX_PORT", 4321),
    host: process.env.QUACKBOX_HOST ?? "0.0.0.0",
    roomCode: normalizeRoomCode(process.env.QUACKBOX_ROOM),
    graceMs: envInt("QUACKBOX_GRACE_MS", 60_000),
    heartbeatMs: envInt("QUACKBOX_HEARTBEAT_MS", 5_000),
    dropAfterMs: envInt("QUACKBOX_DROP_MS", 15_000),
    maxPayloadBytes: envInt("QUACKBOX_MAX_PAYLOAD", 16 * 1024),
    // apps/launcher/src/server/ -> apps/controller/dist
    controllerDir: fileURLToPath(new URL("../../../controller/dist/", import.meta.url)),
    // apps/launcher/src/server/ -> <repo>/games
    gamesDir: fileURLToPath(new URL("../../../../games/", import.meta.url)),
  };

  return { ...defaults, ...overrides };
}
