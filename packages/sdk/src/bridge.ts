import type { GameResult, InputEvent, Player, UISpec, UITarget } from "@quackbox/protocol";

export type PlayerEventKind = "join" | "rejoin" | "leave" | "removed";

export type BridgeToHost =
  | { type: "quackbox:ready" }
  | { type: "quackbox:setUI"; target: UITarget; ui: UISpec }
  | { type: "quackbox:send"; playerId: string; event: string; data?: unknown }
  | { type: "quackbox:broadcast"; event: string; data?: unknown }
  | { type: "quackbox:end"; results: GameResult[] }
  | { type: "quackbox:log"; args: unknown[] };

export type BridgeToGame =
  | {
      type: "quackbox:init";
      gameId: string;
      players: Player[];
      config: Record<string, unknown>;
    }
  | { type: "quackbox:player"; kind: PlayerEventKind; player: Player }
  | { type: "quackbox:input"; player: Player; input: InputEvent }
  | { type: "quackbox:stop" };

/**
 * The cartridge runs in a sandboxed, opaque-origin iframe, so there is no origin
 * to check. The host proves itself by being `window.parent`; anything else is
 * ignored. Messages are treated as data, never as code.
 */
export function postToHost(message: BridgeToHost): void {
  window.parent.postMessage(message, "*");
}

export function listenToHost(handler: (message: BridgeToGame) => void): void {
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;

    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== "string" || !type.startsWith("quackbox:")) return;

    handler(data as BridgeToGame);
  });
}
