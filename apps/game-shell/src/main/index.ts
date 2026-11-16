import { BrowserWindow, app, ipcMain } from "electron";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  gameClientMessageSchema,
  gameManifestSchema,
  gameServerMessageSchema,
  type GameClientMessage,
  type GameManifest,
  type GameServerMessage,
  type Player,
} from "@quackbox/protocol";
import {
  listLanAddresses,
  loadConfig,
  qrSvg,
  startHubServer,
  type HubServer,
  type RoomHandlers,
} from "@quackbox/hub";
import { startAssetServer, type AssetServer } from "./assets.js";
import { splashHtml } from "./splash.js";
import type { StandaloneInfo } from "./types.js";

const appRoot = app.getAppPath();
const packagedRoot = app.isPackaged ? join(process.resourcesPath, "quackbox") : null;
const gamesRoot = packagedRoot
  ? join(packagedRoot, "games")
  : join(appRoot, "..", "..", "games");
const sdkDir = packagedRoot
  ? join(packagedRoot, "sdk")
  : join(appRoot, "..", "..", "packages", "sdk", "dist");
const controllerDir = packagedRoot
  ? join(packagedRoot, "controller")
  : join(appRoot, "..", "controller", "dist");

// The host machine is often a TV or a background window. A game's simulation
// must not stop because Chromium thinks another window covers it.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const args = process.argv.slice(app.isPackaged ? 1 : 2);
const flag = (name: string): boolean => args.includes(`--${name}`);

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const hubUrl = argValue("quackbox-hub");
const ticket = argValue("quackbox-ticket");
const gameIdArg = argValue("quackbox-game");
const gameDirArg = argValue("quackbox-game-dir");
const standalone = !hubUrl && !ticket;
/** A game cannot grow an unbounded pre-connection queue by flooding the bridge. */
const MAX_QUEUED_MESSAGES = 128;
// Standalone opens a full-screen TV experience; a platform launch follows the
// manifest's fullscreen flag, which the launcher passes explicitly.
const fullscreen =
  !flag("quackbox-windowed") && (standalone || flag("quackbox-fullscreen"));

let assetServer: AssetServer | null = null;
let gameWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let socket: WebSocket | null = null;
let hub: HubServer | null = null;
let standaloneInfo: StandaloneInfo | null = null;
let standaloneTicket: string | null = null;
let gameStarted = false;
let socketOpen = false;
let quitting = false;
const queued: GameClientMessage[] = [];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findGameDir(): string {
  if (gameDirArg) {
    const path = resolve(gameDirArg);
    if (existsSync(join(path, "manifest.json"))) return path;
    throw new Error(`No manifest.json in ${path}`);
  }

  if (gameIdArg) {
    const path = join(gamesRoot, gameIdArg);
    if (existsSync(join(path, "manifest.json"))) return path;
    throw new Error(`No game ${gameIdArg} in ${gamesRoot}`);
  }

  const candidates = readdirSync(gamesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .map((entry) => join(gamesRoot, entry.name))
    .filter((path) => existsSync(join(path, "manifest.json")));

  if (candidates.length === 1 && candidates[0]) return candidates[0];
  throw new Error("This game application has no game directory; pass --quackbox-game=<id>.");
}

function readManifest(gameDir: string): GameManifest {
  const parsed = gameManifestSchema.safeParse(JSON.parse(readFileSync(join(gameDir, "manifest.json"), "utf8")));
  if (!parsed.success) throw new Error(`Invalid game manifest: ${parsed.error.message}`);
  return parsed.data;
}

function gameAssetUrl(gameId: string, entry: string): string {
  if (!assetServer) throw new Error("Asset server is not running");
  const path = entry
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${assetServer.url}/games/${encodeURIComponent(gameId)}/${path}`;
}

function sendToGameWindow(message: GameServerMessage): void {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  gameWindow.webContents.send("quackbox:game:message", message);
}

function writeMessage(message: GameClientMessage): void {
  if (!socket || !socketOpen) return;
  try {
    socket.send(JSON.stringify(message));
  } catch (error) {
    // A game can log arbitrary values; a value JSON cannot represent must not
    // take down the shell before the handshake finishes.
    console.warn(`[game-shell] dropped a game message: ${describe(error)}`);
  }
}

function sendMessage(message: GameClientMessage): void {
  if (socket && socketOpen) {
    writeMessage(message);
    return;
  }
  if (queued.length >= MAX_QUEUED_MESSAGES) {
    console.warn("[game-shell] dropping a message: pre-connection queue is full");
    return;
  }
  queued.push(message);
}

function flushQueue(): void {
  while (socket && socketOpen && queued.length > 0) {
    const message = queued.shift();
    if (message) writeMessage(message);
  }
}

function connectGame(endpoint: string, launchTicket: string, gameId: string): void {
  if (socket) return;

  const wsUrl = `${endpoint.replace(/^http/, "ws").replace(/\/$/, "")}/game?ticket=${encodeURIComponent(launchTicket)}`;
  const client = new WebSocket(wsUrl);
  socket = client;

  client.on("open", () => {
    socketOpen = true;
    client.send(JSON.stringify({ type: "quackbox:hello", gameId }));
    flushQueue();
  });

  client.on("message", (data) => {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data.toString());
    } catch {
      console.warn("[game-shell] ignored a malformed hub message");
      return;
    }
    const parsed = gameServerMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      console.warn(`[game-shell] ignored an invalid hub message: ${parsed.error.message}`);
      return;
    }

    sendToGameWindow(parsed.data);
    if (parsed.data.type === "quackbox:stop") {
      quitting = true;
      gameWindow?.close();
      app.quit();
    }
  });

  client.on("error", (error) => {
    console.error(`[game-shell] game link error: ${describe(error)}`);
  });

  client.on("close", (code) => {
    socketOpen = false;
    socket = null;
    if (quitting) return;
    quitting = true;
    console.warn(`[game-shell] game link closed (${code})`);
    app.exit(1);
  });
}

function createGameWindow(gameDir: string, manifest: GameManifest): BrowserWindow {
  if (splashWindow) {
    splashWindow.close();
    splashWindow = null;
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: "#000000",
    title: manifest.name,
    show: false,
    fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  gameWindow = window;

  window.once("ready-to-show", () => {
    window.show();
    window.focus();
    if (fullscreen) window.setFullScreen(true);
  });
  window.on("closed", () => {
    gameWindow = null;
    if (!quitting) {
      quitting = true;
      app.quit();
    }
  });
  // A reload gets a fresh document but the same game session. Reconnecting on
  // a later finish-load would replace the live link and make the old socket
  // close look like a crash.
  window.webContents.once("did-finish-load", () => {
    const endpoint = hubUrl ?? (hub ? `http://127.0.0.1:${hub.port}` : null);
    const launchTicket = ticket ?? standaloneTicket;
    if (!endpoint || !launchTicket) return;
    connectGame(endpoint, launchTicket, manifest.id);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // Subresource failures are handled by the game page, not the shell.
    if (!isMainFrame) return;
    console.error(`[game-shell] failed to load ${url}: ${description} (${code})`);
    if (!quitting) {
      quitting = true;
      app.exit(1);
    }
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[game-shell] renderer stopped: ${details.reason}`);
    if (!quitting) {
      quitting = true;
      app.exit(1);
    }
  });

  void window.loadURL(gameAssetUrl(basename(gameDir), manifest.entry));
  return window;
}

function sendSplashPlayers(players: Player[]): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send("quackbox:standalone:players", players);
}

function showSplash(info: StandaloneInfo): void {
  splashWindow = new BrowserWindow({
    width: 780,
    height: 760,
    minWidth: 620,
    minHeight: 620,
    backgroundColor: "#0b0b12",
    title: info.name,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  splashWindow.once("ready-to-show", () => splashWindow?.show());
  splashWindow.on("closed", () => {
    splashWindow = null;
    if (!gameStarted && !quitting) {
      quitting = true;
      app.quit();
    }
  });
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(info))}`);
}

function isPortInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 4; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function startStandaloneHub(manifest: GameManifest): Promise<void> {
  const roomCode = makeRoomCode();
  const base = loadConfig({ controllerDir, sdkDir, gamesDir: gamesRoot, roomCode });
  const handlers: RoomHandlers = {
    onLobbyChange: (room) => sendSplashPlayers(room.players),
    onPlayerJoin: (player) => console.log(`[game-shell] ${player.name} joined`),
    onPlayerRejoin: (player) => console.log(`[game-shell] ${player.name} reconnected`),
    onPlayerLeave: (player) => console.log(`[game-shell] ${player.name} disconnected`),
    onPlayerRemoved: (player) => console.log(`[game-shell] ${player.name} removed`),
    onGameClosed: () => {
      if (quitting) return;
      quitting = true;
      app.quit();
    },
  };

  for (let offset = 0; offset < 10; offset += 1) {
    try {
      hub = await startHubServer({ ...base, port: base.port + offset }, { handlers });
      break;
    } catch (error) {
      if (!isPortInUse(error)) throw error;
    }
  }
  if (!hub) throw new Error("No free port for the standalone hub.");

  const lan = listLanAddresses();
  const active = lan[0];
  const joinUrl = active
    ? `http://${active.address}:${hub.port}/?room=${roomCode}`
    : null;
  standaloneInfo = {
    name: manifest.name,
    room: roomCode,
    joinUrl,
    qrSvg: joinUrl ? qrSvg(joinUrl) : null,
    players: hub.hub.defaultRoom.players,
  };

  console.log(`[game-shell] standalone hub on ${hub.localUrl}, room ${roomCode}`);
  showSplash(standaloneInfo);
}

function registerIpc(gameDir: string, manifest: GameManifest): void {
  ipcMain.on("quackbox:game:send", (_event, input: unknown) => {
    const parsed = gameClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      console.warn(`[game-shell] rejected a game message: ${parsed.error.message}`);
      return;
    }
    sendMessage(parsed.data);
  });

  ipcMain.handle("quackbox:standalone:info", () => {
    if (!standaloneInfo) throw new Error("Standalone join screen is not ready.");
    return standaloneInfo;
  });

  ipcMain.handle("quackbox:standalone:start", () => {
    if (gameStarted) return;
    if (!hub) throw new Error("The embedded hub is not running.");
    gameStarted = true;
    const launchTicket = hub.hub.createGameTicket(manifest.id);
    standaloneTicket = launchTicket;
    createGameWindow(gameDir, manifest);
  });
}

async function main(): Promise<void> {
  if (!standalone && (!hubUrl || !ticket)) {
    throw new Error("Platform launch requires both --quackbox-hub and --quackbox-ticket.");
  }

  const gameDir = findGameDir();
  const manifest = readManifest(gameDir);
  assetServer = await startAssetServer({ gamesRoot, sdkDir });
  registerIpc(gameDir, manifest);

  if (standalone) {
    await startStandaloneHub(manifest);
    return;
  }

  createGameWindow(gameDir, manifest);
  console.log(`[game-shell] ${manifest.name} launched against ${hubUrl}`);
}

void app.whenReady().then(main).catch((error: unknown) => {
  console.error(`[game-shell] ${describe(error)}`);
  quitting = true;
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  quitting = true;
  socket?.close();
  socket = null;
  void hub?.close();
  hub = null;
  void assetServer?.close();
  assetServer = null;
});
