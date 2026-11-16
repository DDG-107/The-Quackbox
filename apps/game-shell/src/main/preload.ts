import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { GameClientMessage, GameServerMessage, Player } from "@quackbox/protocol";
import type { StandaloneInfo } from "./types.js";

contextBridge.exposeInMainWorld("quackboxDesktop", {
  send(message: GameClientMessage): void {
    ipcRenderer.send("quackbox:game:send", message);
  },
  onMessage(handler: (message: GameServerMessage) => void): () => void {
    const listener = (_event: IpcRendererEvent, message: GameServerMessage) => handler(message);
    ipcRenderer.on("quackbox:game:message", listener);
    return () => ipcRenderer.removeListener("quackbox:game:message", listener);
  },
});

contextBridge.exposeInMainWorld("quackboxStandalone", {
  info(): Promise<StandaloneInfo> {
    return ipcRenderer.invoke("quackbox:standalone:info") as Promise<StandaloneInfo>;
  },
  start(): Promise<void> {
    return ipcRenderer.invoke("quackbox:standalone:start") as Promise<void>;
  },
  onPlayers(handler: (players: Player[]) => void): () => void {
    const listener = (_event: IpcRendererEvent, players: Player[]) => handler(players);
    ipcRenderer.on("quackbox:standalone:players", listener);
    return () => ipcRenderer.removeListener("quackbox:standalone:players", listener);
  },
});
