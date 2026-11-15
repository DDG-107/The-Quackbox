import type { Player, UITarget } from "@quackbox/protocol";
import { listenToHost, postToHost } from "./bridge.js";
import type { GameCartridge, HubContext, SetUITarget } from "./types.js";

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
        void Promise.resolve(cartridge.onStart(hub)).catch((error: unknown) => {
          hub.log("onStart failed:", error instanceof Error ? error.message : String(error));
        });
        break;
      }

      case "quackbox:player": {
        players.set(message.player.id, message.player);
        if (!started) break;
        switch (message.kind) {
          case "join":
            cartridge.onPlayerJoin?.(message.player);
            break;
          case "rejoin":
            cartridge.onPlayerRejoin?.(message.player);
            break;
          case "leave":
            cartridge.onPlayerLeave?.(message.player);
            break;
          case "removed":
            players.delete(message.player.id);
            cartridge.onPlayerRemoved?.(message.player);
            break;
        }
        break;
      }

      case "quackbox:input":
        if (started) cartridge.onInput(message.player, message.input);
        break;

      case "quackbox:stop":
        if (stopped) break;
        stopped = true;
        cartridge.onStop?.();
        break;
    }
  });

  postToHost({ type: "quackbox:ready" });
}
