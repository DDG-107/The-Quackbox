import { BrowserWindow, app, ipcMain } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  endedMessageSchema,
  uiSpecSchema,
  uiTargetSchema,
  type InputEvent,
  type Player,
} from "@quackbox/protocol";
import {
  TokenBucket,
  listLanAddresses,
  loadConfig,
  qrSvg,
  startHubServer,
  type HubServer,
  type RoomHandlers,
  type ServerConfig,
} from "@quackbox/hub";
import type { LauncherState, PlayerEvent } from "../shared/api.js";
import { discoverGames } from "./games.js";

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
// A desktop game is its own application. In development we run the shared game
// shell; a packaged build finds each installed game app here.
const gameShellRoot =
  process.env.QUACKBOX_GAME_SHELL ?? join(appRoot, "..", "game-shell");
const gameAppsRoot =
  process.env.QUACKBOX_GAME_APPS_DIR ??
  (packagedRoot ? join(packagedRoot, "game-apps") : join(appRoot, "..", "..", "games"));

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
let runningGameId: string | null = null;
let launchingGameId: string | null = null;
let gameLaunchError: string | null = null;
let gameProcess: ChildProcess | null = null;
let gameStopping = false;
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
    runningGameId,
    launchingGameId,
    gameLaunchError,
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

function restoreLobby(): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function resolveGameExecutable(gameId: string): { command: string; prefix: string[] } | null {
  if (!app.isPackaged) {
    if (!existsSync(join(gameShellRoot, "package.json"))) return null;
    return { command: process.execPath, prefix: [gameShellRoot] };
  }

  const dir = join(gameAppsRoot, gameId);
  if (!existsSync(dir)) return null;
  const game = games.find((entry) => entry.id === gameId);
  const name = game?.app?.executable ?? gameId;
  const appName = game?.name ?? name;
  const candidates =
    process.platform === "win32"
      ? [`${name}.exe`]
      : process.platform === "darwin"
        ? [
            `${appName}.app/Contents/MacOS/${appName}`,
            `${appName}.app/Contents/MacOS/${name}`,
            `${name}.app/Contents/MacOS/${name}`,
            name,
          ]
        : [name];

  for (const candidate of candidates) {
    const path = join(dir, candidate);
    if (existsSync(path)) return { command: path, prefix: [] };
  }
  return null;
}

function launchGame(gameId: string): void {
  // gameProcess can outlive the runningGameId reset during shutdown; never
  // start a second child over a process that is still exiting.
  if (!server || gameProcess || runningGameId !== null || launchingGameId !== null) return;
  const game = games.find((entry) => entry.id === gameId && !entry.error);
  if (!game || game.runtime !== "desktop") return;

  const executable = resolveGameExecutable(game.id);
  if (!executable) {
    gameLaunchError =
      "This game application is not installed. Build it with pnpm build:game " + game.id + ".";
    broadcast();
    return;
  }

  const ticket = server.hub.createGameTicket(game.id);
  const args = [
    ...executable.prefix,
    `--quackbox-hub=http://127.0.0.1:${server.port}`,
    `--quackbox-ticket=${ticket}`,
    `--quackbox-game=${game.id}`,
    ...(app.isPackaged ? [] : [`--quackbox-game-dir=${join(gamesRoot, game.id)}`]),
    ...(game.app?.fullscreen === false ? [] : ["--quackbox-fullscreen"]),
  ];

  selectedGameId = null;
  launchingGameId = game.id;
  gameLaunchError = null;
  gameStopping = false;
  broadcast();

  let child: ChildProcess;
  try {
    child = spawn(executable.command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    launchingGameId = null;
    gameLaunchError = "Could not start the game: " + describe(error);
    broadcast();
    return;
  }

  gameProcess = child;
  console.log(`[launcher] launching ${game.id} (pid ${child.pid ?? "?"})`);

  child.stdout?.on("data", (data: Buffer) => console.log(`[game] ${data.toString().trimEnd()}`));
  child.stderr?.on("data", (data: Buffer) => console.error(`[game] ${data.toString().trimEnd()}`));

  child.once("spawn", () => {
    if (gameProcess !== child) return;
    launchingGameId = null;
    runningGameId = game.id;
    broadcast();
  });

  child.once("error", (error) => {
    if (gameProcess !== child) return;
    gameProcess = null;
    launchingGameId = null;
    runningGameId = null;
    gameLaunchError = "The game failed to start: " + describe(error);
    restoreLobby();
    broadcast();
  });

  child.once("exit", (code, signal) => {
    if (gameProcess !== child) return;
    gameProcess = null;
    const wasStopping = gameStopping;
    gameStopping = false;
    launchingGameId = null;
    runningGameId = null;
    if (!wasStopping && code !== 0 && code !== null) {
      gameLaunchError = `The game stopped unexpectedly (${signal ?? `exit ${code}`}). See the terminal for details.`;
    }
    console.log(`[launcher] ${game.id} exited (${signal ?? code ?? "closed"})`);
    restoreLobby();
    broadcast();
  });
}

function stopGame(): void {
  const child = gameProcess;
  if (!child) {
    runningGameId = null;
    launchingGameId = null;
    broadcast();
    return;
  }

  gameStopping = true;
  console.log("[launcher] stopping the running game");
  child.kill();

  // Electron child processes can outlive the parent on Windows; make the
  // process-tree cleanup explicit if a plain terminate did not take.
  setTimeout(() => {
    if (gameProcess !== child) return;
    if (process.platform === "win32" && child.pid) {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => undefined);
    }
  }, 1_500).unref();
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
    onGameClosed: (gameId) => {
      if (runningGameId !== gameId && launchingGameId !== gameId) return;
      launchingGameId = null;
      runningGameId = null;
      if (gameProcess) {
        // This close was ours, not a crash; suppress the exit handler's
        // "stopped unexpectedly" message.
        gameStopping = true;
        gameProcess.kill();
      }
      restoreLobby();
      broadcast();
    },
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
    const game = typeof gameId === "string" ? games.find((entry) => entry.id === gameId) : null;
    if (game?.runtime === "desktop") return;
    selectedGameId =
      gameId === null || !games.some((game) => game.id === gameId && !game.error) ? null : gameId;
    broadcast();
  });

  ipcMain.handle("launcher:launchGame", (_event, gameId: unknown) => {
    if (typeof gameId !== "string") return;
    launchGame(gameId);
  });

  ipcMain.handle("launcher:stopGame", () => {
    stopGame();
  });

  ipcMain.handle("launcher:refreshGames", async () => {
    await loadGames();
    broadcast();
  });

  // --- cartridge bridge -----------------------------------------------------

  ipcMain.handle("launcher:game:setUI", (_event, target: unknown, spec: unknown) => {
    if (!server || !allowBridgeCall("setUI")) return;

    const parsedTarget = uiTargetSchema.safeParse(target);
    if (!parsedTarget.success) {
      // Cartridges are untrusted input: say what was rejected instead of failing silently.
      console.warn(`[game] ignored setUI with an invalid target: ${formatLogArg(target)}`);
      return;
    }

    const parsedSpec = uiSpecSchema.safeParse(spec);
    if (!parsedSpec.success) {
      console.warn(`[game] ignored setUI with an invalid descriptor: ${parsedSpec.error.message}`);
      return;
    }

    server.hub.defaultRoom.setUI(parsedTarget.data, parsedSpec.data);
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
  gameStopping = true;
  gameProcess?.kill();
  gameProcess = null;
  void server?.close();
  server = null;
});
