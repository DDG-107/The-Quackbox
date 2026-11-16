import type { GameClientMessage, GameServerMessage } from "@quackbox/protocol";

export type PlayerEventKind = "join" | "rejoin" | "leave" | "removed";

export type BridgeToHost = GameClientMessage;
export type BridgeToGame = GameServerMessage;

/** The narrow surface a desktop game shell exposes to the game renderer. */
export interface DesktopTransport {
  send(message: BridgeToHost): void;
  onMessage(handler: (message: BridgeToGame) => void): () => void;
}

declare global {
  interface Window {
    quackboxDesktop?: DesktopTransport;
  }
}

/**
 * The cartridge runs in a sandboxed, opaque-origin iframe, so there is no origin
 * to check. The host proves itself by being `window.parent`; anything else is
 * ignored. Messages are treated as data, never as code.
 */
export function postToHost(message: BridgeToHost): void {
  if (window.quackboxDesktop) {
    window.quackboxDesktop.send(message);
    return;
  }
  window.parent.postMessage(message, "*");
}

export function listenToHost(handler: (message: BridgeToGame) => void): void {
  if (window.quackboxDesktop) {
    window.quackboxDesktop.onMessage(handler);
    return;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== "string" || !type.startsWith("quackbox:")) return;

    handler(data as BridgeToGame);
  });
}
