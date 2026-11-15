import type { GameResult, InputEvent, Player, UISpec } from "@quackbox/protocol";

/** "all", one player id, or a whole team. */
export type SetUITarget = string | { team: string };

/**
 * What a cartridge gets in `onStart`. Everything here is a request to the host:
 * the game never touches a socket or the DOM outside its own iframe.
 */
export interface HubContext {
  /** Everyone in the room, keyed by player id. Read-only from the game's side. */
  readonly players: ReadonlyMap<string, Player>;
  /** Per-cartridge configuration from the lobby (empty for now). */
  readonly config: Readonly<Record<string, unknown>>;
  /** Replace a phone's controls. `"all"`, one player id, or `{ team }`. */
  setUI(target: SetUITarget, ui: UISpec): void;
  /** Send a private event to one phone (the controller ignores unknown events for now). */
  send(playerId: string, event: string, data?: unknown): void;
  broadcast(event: string, data?: unknown): void;
  /** Finish the round: everyone returns to the lobby. */
  end(results: GameResult[]): void;
  /** Print to the launcher console. */
  log(...args: unknown[]): void;
}

export interface GameCartridge {
  onStart(hub: HubContext): void | Promise<void>;
  onPlayerJoin?(player: Player): void;
  /** Disconnected; the slot is held and may come back. */
  onPlayerLeave?(player: Player): void;
  onPlayerRejoin?(player: Player): void;
  /** The grace period expired; the player is gone for good. */
  onPlayerRemoved?(player: Player): void;
  onInput(player: Player, input: InputEvent): void;
  onStop?(): void;
}
