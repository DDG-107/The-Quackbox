import type {
  GameManifest,
  GameResult,
  InputEvent,
  Player,
  UISpec,
  UITarget,
} from "@quackbox/protocol";

export type { GameResult, InputEvent, Player, UISpec, UITarget };

export interface LanOption {
  iface: string;
  address: string;
  /** Join URL for phones on this adapter. */
  url: string;
}

export interface GameInfo {
  id: string;
  name: string;
  version: string;
  entry: string;
  tags: string[];
  players: GameManifest["players"];
  reconnect: GameManifest["reconnect"];
  /** Desktop games launch as their own application; web games use the legacy frame. */
  runtime: GameManifest["runtime"];
  app?: GameManifest["app"];
  /** Present when the cartridge was found but cannot be played. */
  error?: string;
}

/** Everything the lobby window renders. Pushed over IPC on every change. */
export interface LauncherState {
  /** `process.platform`; the lobby tailors firewall guidance to it. */
  platform: string;
  room: string;
  port: number;
  lan: LanOption[];
  /** Interface currently used for the QR code and join URL. */
  active: string | null;
  joinUrl: string | null;
  qrSvg: string | null;
  players: Player[];
  games: GameInfo[];
  selectedGameId: string | null;
  gameUrl: string | null;
  runningGameId: string | null;
  launchingGameId: string | null;
  gameLaunchError: string | null;
  gamesError: string | null;
  startupError: string | null;
}

export type PlayerEventKind = "join" | "rejoin" | "leave" | "removed";

export interface PlayerEvent {
  kind: PlayerEventKind;
  player: Player;
}

/** The surface exposed to the renderer through the preload bridge. */
export interface QuackboxApi {
  getState(): Promise<LauncherState>;
  setInterface(iface: string): Promise<void>;
  kick(playerId: string): Promise<void>;
  rename(playerId: string, name: string): Promise<void>;
  selectGame(gameId: string | null): Promise<void>;
  launchGame(gameId: string): Promise<void>;
  stopGame(): Promise<void>;
  refreshGames(): Promise<void>;
  ready(): Promise<void>;
  onState(callback: (state: LauncherState) => void): () => void;

  // Requests from the cartridge, relayed by the lobby renderer.
  setGameUI(target: UITarget, ui: UISpec): Promise<void>;
  sendGameEvent(playerId: string, event: string, data?: unknown): Promise<void>;
  broadcastGameEvent(event: string, data?: unknown): Promise<void>;
  endGame(results: GameResult[]): Promise<void>;
  logFromGame(args: unknown[]): Promise<void>;

  // Room activity the cartridge needs to see.
  onGameInput(callback: (player: Player, input: InputEvent) => void): () => void;
  onPlayerEvent(callback: (event: PlayerEvent) => void): () => void;
}
