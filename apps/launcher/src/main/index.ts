import { BrowserWindow, app, ipcMain } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type ServerConfig } from "../server/config.js";
import { startHubServer, type HubServer } from "../server/http.js";
import { listLanAddresses } from "../server/lan.js";
import type { RoomHandlers } from "../server/room.js";
import type { LauncherState } from "../shared/api.js";
import { discoverGames } from "./games.js";
import { qrSvg } from "./qr.js";

// apps/launcher (when run with `electron .` from this package)
const appRoot = app.getAppPath();
const controllerRoot =
  process.env.QUACKBOX_CONTROLLER_DIR ?? join(appRoot, "..", "controller", "dist");
const gamesRoot = process.env.QUACKBOX_GAMES_DIR ?? join(appRoot, "..", "..", "games");

const config: ServerConfig = loadConfig({
  controllerDir: controllerRoot,
  gamesDir: gamesRoot,
});

const MAX_PORT_ATTEMPTS = 10;

let server: HubServer | null = null;
let window: BrowserWindow | null = null;
let games: Awaited<ReturnType<typeof discoverGames>> = [];
let gamesError: string | null = null;
let selectedIface: string | null = null;
let selectedGameId: string | null = null;
let startupError: string | null = null;
let qrCache: { url: string; svg: string } | null = null;

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
  if (!window || window.isDestroyed()) return;
  window.webContents.send("launcher:state", buildState());
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
  const handlers: RoomHandlers = { onLobbyChange: () => broadcast() };

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
