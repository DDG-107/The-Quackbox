import type { Player, UITarget } from "@quackbox/protocol";
import { listenToHost, postToHost } from "./bridge.js";
import type { GameCartridge, HubContext, SetUITarget } from "./types.js";

/** A cartridge that throws on every input must not flood the host with reports. */
const MAX_ERROR_REPORTS = 20;

/** A bare string is either "all" or a player id; the wire format is explicit. */
function toWireTarget(target: SetUITarget): UITarget {
  if (target === "all") return "all";
  if (typeof target === "string") return { playerId: target };
  return { team: target.team };
}

/**
 * Register a cartridge. Call once, at module scope, from the game page:
 *
 *   import { defineGame, ui } from "/sdk/index.js";
 *   defineGame({ onStart(hub) { hub.setUI("all", ui.buttons([{ id: "tap", label: "TAP!" }])); },
 *                onInput(p, input) { ... } });
 */
export function defineGame(cartridge: GameCartridge): void {
  const players = new Map<string, Player>();
  let config: Readonly<Record<string, unknown>> = {};
  let started = false;
  let stopped = false;
  let errorReports = 0;

  /**
   * The crash boundary: a cartridge callback that throws is caught here, logged
   * in the frame's own console, and reported to the launcher so the TV can show
   * what died instead of a silent black screen.
   */
  function reportError(source: string, error: unknown): void {
    console.error(`[quackbox] ${source}:`, error);
    if (errorReports >= MAX_ERROR_REPORTS) return;
    errorReports += 1;

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack.split("\n")[0] ?? "" : "";
    postToHost({
      type: "quackbox:error",
      source,
      message: `${source}: ${message}`.slice(0, 400),
      ...(stack ? { stack: stack.slice(0, 400) } : {}),
    });
  }

  function invoke(source: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      reportError(source, error);
    }
  }

  window.addEventListener("error", (event) => {
    reportError("Uncaught error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("Unhandled rejection", event.reason);
  });

  const hub: HubContext = {
    get players() {
      return players;
    },
    get config() {
      return config;
    },
    setUI(target, descriptor) {
      postToHost({ type: "quackbox:setUI", target: toWireTarget(target), ui: descriptor });
    },
    send(playerId, event, data) {
      postToHost({ type: "quackbox:send", playerId, event, data });
    },
    broadcast(event, data) {
      postToHost({ type: "quackbox:broadcast", event, data });
    },
    end(results) {
      postToHost({ type: "quackbox:end", results });
    },
    log(...args) {
      postToHost({ type: "quackbox:log", args });
    },
  };

  listenToHost((message) => {
    switch (message.type) {
      case "quackbox:init": {
        for (const player of message.players) players.set(player.id, player);
        config = message.config;
        started = true;
        invoke("onStart", () => {
          void Promise.resolve(cartridge.onStart(hub)).catch((error: unknown) => {
            reportError("onStart", error);
          });
        });
        break;
      }

      case "quackbox:player": {
        players.set(message.player.id, message.player);
        if (!started) break;
        switch (message.kind) {
          case "join":
            invoke("onPlayerJoin", () => cartridge.onPlayerJoin?.(message.player));
            break;
          case "rejoin":
            invoke("onPlayerRejoin", () => cartridge.onPlayerRejoin?.(message.player));
            break;
          case "leave":
            invoke("onPlayerLeave", () => cartridge.onPlayerLeave?.(message.player));
            break;
          case "removed":
            players.delete(message.player.id);
            invoke("onPlayerRemoved", () => cartridge.onPlayerRemoved?.(message.player));
            break;
        }
        break;
      }

      case "quackbox:input":
        if (started) invoke("onInput", () => cartridge.onInput(message.player, message.input));
        break;

      case "quackbox:stop":
        if (stopped) break;
        stopped = true;
        invoke("onStop", () => cartridge.onStop?.());
        break;
    }
  });

  postToHost({ type: "quackbox:ready" });
}
