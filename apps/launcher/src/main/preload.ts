import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  GameResult,
  InputEvent,
  LauncherState,
  Player,
  PlayerEvent,
  QuackboxApi,
  UISpec,
  UITarget,
} from "../shared/api.js";

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: QuackboxApi = {
  getState: () => ipcRenderer.invoke("launcher:getState") as Promise<LauncherState>,
  setInterface: (iface) => ipcRenderer.invoke("launcher:setInterface", iface) as Promise<void>,
  kick: (playerId) => ipcRenderer.invoke("launcher:kick", playerId) as Promise<void>,
  rename: (playerId, name) => ipcRenderer.invoke("launcher:rename", playerId, name) as Promise<void>,
  selectGame: (gameId) => ipcRenderer.invoke("launcher:selectGame", gameId) as Promise<void>,
  refreshGames: () => ipcRenderer.invoke("launcher:refreshGames") as Promise<void>,
  ready: () => ipcRenderer.invoke("launcher:ready") as Promise<void>,
  onState: (callback) => subscribe<LauncherState>("launcher:state", callback),

  setGameUI: (target: UITarget, ui: UISpec) =>
    ipcRenderer.invoke("launcher:game:setUI", target, ui) as Promise<void>,
  sendGameEvent: (playerId: string, event: string, data?: unknown) =>
    ipcRenderer.invoke("launcher:game:send", playerId, event, data) as Promise<void>,
  broadcastGameEvent: (event: string, data?: unknown) =>
    ipcRenderer.invoke("launcher:game:broadcast", event, data) as Promise<void>,
  endGame: (results: GameResult[]) =>
    ipcRenderer.invoke("launcher:game:end", results) as Promise<void>,
  logFromGame: (args: unknown[]) => ipcRenderer.invoke("launcher:game:log", args) as Promise<void>,

  onGameInput: (callback: (player: Player, input: InputEvent) => void) =>
    subscribe<{ player: Player; input: InputEvent }>("launcher:game:input", (payload) =>
      callback(payload.player, payload.input),
    ),
  onPlayerEvent: (callback: (event: PlayerEvent) => void) =>
    subscribe<PlayerEvent>("launcher:player", callback),
};

contextBridge.exposeInMainWorld("quackbox", api);
