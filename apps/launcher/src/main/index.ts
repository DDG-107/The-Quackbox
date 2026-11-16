import { BrowserWindow, app, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  endedMessageSchema,
  uiSpecSchema,
  type InputEvent,
  type Player,
  type UITarget,
} from "@quackbox/protocol";
import { loadConfig, type ServerConfig } from "../server/config.js";
import { startHubServer, type HubServer } from "../server/http.js";
import { listLanAddresses } from "../server/lan.js";
import { TokenBucket } from "../server/limits.js";
import type { RoomHandlers } from "../server/room.js";
import type { LauncherState, PlayerEvent } from "../shared/api.js";
import { discoverGames } from "./games.js";
import { qrSvg } from "./qr.js";

// apps/launcher (when run with `electron .` from this package)
const appRoot = app.getAppPath();
// A packaged build keeps its served assets in resources/quackbox/ (see
// electron-builder.yml); the dev tree keeps them next to the packages.
const packagedRoot = app.isPackaged ? join(process.resourcesPath, "quackbox") : null;
const controllerRoot =
  process.env.QUACKBOX_CONTROLLER_DIR ??
  (packagedRoot ? join(packagedRoot, "controller") : join(appRoot, "..", "controller", "dist"));
const sdkRoot =
  process.env.QUACKBOX_SDK_DIR ??
  (packagedRoot ? join(packagedRoot, "sdk") : join(appRoot, "..", "..", "packages", "sdk", "dist"));
const gamesRoot =
  process.env.QUACKBOX_GAMES_DIR ??
  (packagedRoot ? join(packagedRoot, "games") : join(appRoot, "..", "..", "games"));

const config: ServerConfig = loadConfig({
  controllerDir: controllerRoot,
  sdkDir: sdkRoot,
  gamesDir: gamesRoot,
});

const MAX_PORT_ATTEMPTS = 10;

// Cartridges are untrusted and can postMessage as fast as they like: shape the
// bridge here, in the main process, so the renderer's relay cannot be flooded.
const BRIDGE_RATE_PER_SECOND = 180;
const BRIDGE_BURST = 240;
/** One game event fans out to 100 phones; keep the payload small on purpose. */
const MAX_GAME_PAYLOAD_BYTES = 32 * 1024;
const BRIDGE_WARN_INTERVAL_MS = 5_000;

let server: HubServer | null = null;
let window: BrowserWindow | null = null;
let games: Awaited<ReturnType<typeof discoverGames>> = [];
let gamesError: string | null = null;
let selectedIface: string | null = null;
let selectedGameId: string | null = null;
let startupError: string | null = null;
let qrCache: { url: string; svg: string } | null = null;

const bridgeBucket = new TokenBucket(BRIDGE_RATE_PER_SECOND, BRIDGE_BURST);
let bridgeDropped = 0;
let bridgeWarnedAt = 0;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadGames(): Promise<void> {
  try {
    games = await discoverGames(gamesRoot);
    gamesError = null;
    console.log(`[launcher] ${games.length} cartridge(s) in ${gamesRoot}`);
  } catch (error) {
    games = [];
    gamesError = `Could not read ${gamesRoot}: ${describe(error)}`;
  }
}

function buildState(): LauncherState {
  const addresses = listLanAddresses();
  const active = addresses.find((entry) => entry.iface === selectedIface) ?? addresses[0] ?? null;
  const port = server?.port ?? config.port;
  const joinUrl = active ? `http://${active.address}:${port}/?room=${config.roomCode}` : null;

  let qr: string | null = null;
  if (joinUrl) {
    if (qrCache?.url !== joinUrl) qrCache = { url: joinUrl, svg: qrSvg(joinUrl) };
    qr = qrCache.svg;
  }

  const selected = games.find((game) => game.id === selectedGameId && !game.error) ?? null;

  return {
    platform: process.platform,
    room: config.roomCode,
    port,
    lan: addresses.map((entry) => ({
      iface: entry.iface,
      address: entry.address,
      url: `http://${entry.address}:${port}/?room=${config.roomCode}`,
    })),
    active: active?.iface ?? null,
    joinUrl,
    qrSvg: qr,
    players: server?.hub.defaultRoom.players ?? [],
    games,
    selectedGameId: selected?.id ?? null,
    gameUrl: selected
      ? `http://127.0.0.1:${port}/games/${encodeURIComponent(selected.id)}/${selected.entry}`
      : null,
    gamesError,
    startupError,
  };
}

function broadcast(): void {
  sendToWindow("launcher:state", buildState());
}

function sendToWindow(channel: string, payload: unknown): void {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function sendPlayerEvent(kind: PlayerEvent["kind"], player: Player): void {
  sendToWindow("launcher:player", { kind, player } satisfies PlayerEvent);
}

function isPortInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

async function startHub(): Promise<void> {
  const handlers: RoomHandlers = {
    onLobbyChange: () => broadcast(),
    onInput: (player: Player, input: InputEvent) =>
      sendToWindow("launcher:game:input", { player, input }),
    onPlayerJoin: (player) => sendPlayerEvent("join", player),
    onPlayerRejoin: (player) => sendPlayerEvent("rejoin", player),
    onPlayerLeave: (player) => sendPlayerEvent("leave", player),
    onPlayerRemoved: (player) => sendPlayerEvent("removed", player),
  };

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = config.port + offset;
    try {
      server = await startHubServer({ ...config, port }, { handlers });
      console.log(`[launcher] hub on port ${server.port}, room ${config.roomCode}`);
      return;
    } catch (error) {
      if (!isPortInUse(error)) throw error;
    }
  }

  throw new Error(`Ports ${config.port}–${config.port + MAX_PORT_ATTEMPTS - 1} are all in use.`);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b0b12",
    title: "The QuackBox",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`[launcher] failed to load ${url}: ${description} (${code})`);
  });

  void window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
}

function parseTarget(value: unknown): UITarget | null {
  if (value === "all") return "all";
  if (typeof value !== "object" || value === null) return null;

  const record = value as { playerId?: unknown; team?: unknown };
  if (typeof record.playerId === "string" && record.playerId.length <= 64) {
    return { playerId: record.playerId };
  }
  if (typeof record.team === "string" && record.team.length <= 64) {
    return { team: record.team };
  }
  return null;
}

function formatLogArg(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** False means this bridge call is over budget and should be dropped. */
function allowBridgeCall(call: string): boolean {
  if (bridgeBucket.take()) return true;

  bridgeDropped += 1;
  const now = Date.now();
  if (now - bridgeWarnedAt >= BRIDGE_WARN_INTERVAL_MS) {
    bridgeWarnedAt = now;
    console.warn(`[game] rate limit: dropped ${bridgeDropped} bridge call(s), last was ${call}`);
  }
  return false;
}

function payloadTooLarge(data: unknown): boolean {
  if (data === undefined) return false;
  try {
    return Buffer.byteLength(JSON.stringify(data)) > MAX_GAME_PAYLOAD_BYTES;
  } catch {
    return true;
  }
}

function registerIpc(): void {
  ipcMain.handle("launcher:getState", () => buildState());

  ipcMain.handle("launcher:ready", () => {
    console.log("[launcher] lobby ready");
  });

  ipcMain.handle("launcher:setInterface", (_event, iface: unknown) => {
    if (typeof iface !== "string") return;
    selectedIface = listLanAddresses().some((entry) => entry.iface === iface) ? iface : null;
    broadcast();
  });

  ipcMain.handle("launcher:kick", (_event, playerId: unknown) => {
    if (typeof playerId !== "string" || !server) return;
    server.hub.defaultRoom.kick(playerId);
    broadcast();
  });

  ipcMain.handle("launcher:rename", (_event, playerId: unknown, name: unknown) => {
    if (typeof playerId !== "string" || typeof name !== "string" || !server) return;
    server.hub.defaultRoom.rename(playerId, name);
    broadcast();
  });

  ipcMain.handle("launcher:selectGame", (_event, gameId: unknown) => {
    if (gameId !== null && typeof gameId !== "string") return;
    selectedGameId =
      gameId === null || !games.some((game) => game.id === gameId && !game.error) ? null : gameId;
    broadcast();
  });

  ipcMain.handle("launcher:refreshGames", async () => {
    await loadGames();
    broadcast();
  });

  // --- cartridge bridge -----------------------------------------------------

  ipcMain.handle("launcher:game:setUI", (_event, target: unknown, spec: unknown) => {
    if (!server || !allowBridgeCall("setUI")) return;

    const parsedTarget = parseTarget(target);
    if (!parsedTarget) {
      // Cartridges are untrusted input: say what was rejected instead of failing silently.
      console.warn(`[game] ignored setUI with an invalid target: ${formatLogArg(target)}`);
      return;
    }

    const parsedSpec = uiSpecSchema.safeParse(spec);
    if (!parsedSpec.success) {
      console.warn(`[game] ignored setUI with an invalid descriptor: ${parsedSpec.error.message}`);
      return;
    }

    server.hub.defaultRoom.setUI(parsedTarget, parsedSpec.data);
  });

  ipcMain.handle(
    "launcher:game:send",
    (_event, playerId: unknown, event: unknown, data: unknown) => {
      if (!server || !allowBridgeCall("send")) return;
      if (typeof playerId !== "string" || typeof event !== "string") return;
      if (event.length === 0 || event.length > 64) return;
      if (payloadTooLarge(data)) {
        console.warn(`[game] dropped send(${event}): payload over ${MAX_GAME_PAYLOAD_BYTES} bytes`);
        return;
      }
      server.hub.defaultRoom.sendEvent(playerId, event, data);
    },
  );

  ipcMain.handle("launcher:game:broadcast", (_event, event: unknown, data: unknown) => {
    if (!server || !allowBridgeCall("broadcast")) return;
    if (typeof event !== "string") return;
    if (event.length === 0 || event.length > 64) return;
    if (payloadTooLarge(data)) {
      console.warn(`[game] dropped broadcast(${event}): payload over ${MAX_GAME_PAYLOAD_BYTES} bytes`);
      return;
    }
    server.hub.defaultRoom.broadcastEvent(event, data);
  });

  ipcMain.handle("launcher:game:end", (_event, results: unknown) => {
    if (!server) return;
    const parsed = endedMessageSchema.shape.results.safeParse(results);
    if (!parsed.success) return;
    server.hub.defaultRoom.end(parsed.data);
    selectedGameId = null;
    broadcast();
  });

  ipcMain.handle("launcher:game:log", (_event, args: unknown) => {
    if (!Array.isArray(args) || !allowBridgeCall("log")) return;
    const line = args
      .slice(0, 12)
      .map((arg) => formatLogArg(arg).slice(0, 500))
      .join(" ");
    console.log(`[game] ${line}`);
  });
}

void app.whenReady().then(async () => {
  registerIpc();
  await loadGames();

  try {
    await startHub();
  } catch (error) {
    startupError = `The hub could not start: ${describe(error)}`;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void server?.close();
  server = null;
});
