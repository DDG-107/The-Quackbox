import type { GameManifest, Player } from "@quackbox/protocol";

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
  /** Present when the cartridge was found but cannot be played. */
  error?: string;
}

/** Everything the lobby window renders. Pushed over IPC on every change. */
export interface LauncherState {
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
  gamesError: string | null;
  startupError: string | null;
}

/** The surface exposed to the renderer through the preload bridge. */
export interface QuackboxApi {
  getState(): Promise<LauncherState>;
  setInterface(iface: string): Promise<void>;
  kick(playerId: string): Promise<void>;
  rename(playerId: string, name: string): Promise<void>;
  selectGame(gameId: string | null): Promise<void>;
  refreshGames(): Promise<void>;
  ready(): Promise<void>;
  onState(callback: (state: LauncherState) => void): () => void;
}
