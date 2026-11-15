import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LauncherState, QuackboxApi } from "../shared/api.js";

const api: QuackboxApi = {
  getState: () => ipcRenderer.invoke("launcher:getState") as Promise<LauncherState>,
  setInterface: (iface) => ipcRenderer.invoke("launcher:setInterface", iface) as Promise<void>,
  kick: (playerId) => ipcRenderer.invoke("launcher:kick", playerId) as Promise<void>,
  rename: (playerId, name) => ipcRenderer.invoke("launcher:rename", playerId, name) as Promise<void>,
  selectGame: (gameId) => ipcRenderer.invoke("launcher:selectGame", gameId) as Promise<void>,
  refreshGames: () => ipcRenderer.invoke("launcher:refreshGames") as Promise<void>,
  ready: () => ipcRenderer.invoke("launcher:ready") as Promise<void>,
  onState(callback) {
    const listener = (_event: IpcRendererEvent, state: LauncherState) => callback(state);
    ipcRenderer.on("launcher:state", listener);
    return () => {
      ipcRenderer.removeListener("launcher:state", listener);
    };
  },
};

contextBridge.exposeInMainWorld("quackbox", api);
