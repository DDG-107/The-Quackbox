import { z } from "zod";
import { inputSchema } from "./inputs.js";
import { endedMessageSchema } from "./messages.js";
import { playerSchema } from "./player.js";
import { uiSpecSchema, uiTargetSchema } from "./ui.js";

/**
 * The game application -> hub channel. It is deliberately the same vocabulary
 * the in-frame SDK already uses; only the transport changes.
 */
export const gameClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quackbox:hello"),
    gameId: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal("quackbox:ready") }),
  z.object({
    type: z.literal("quackbox:setUI"),
    target: uiTargetSchema,
    ui: uiSpecSchema,
  }),
  z.object({
    type: z.literal("quackbox:send"),
    playerId: z.string().min(1).max(64),
    event: z.string().min(1).max(64),
    data: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("quackbox:broadcast"),
    event: z.string().min(1).max(64),
    data: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("quackbox:end"),
    results: endedMessageSchema.shape.results.max(200),
  }),
  z.object({
    type: z.literal("quackbox:log"),
    args: z.array(z.unknown()).max(12),
  }),
  z.object({
    type: z.literal("quackbox:error"),
    source: z.string().max(80),
    message: z.string().max(400),
    stack: z.string().max(400).optional(),
  }),
]);

export type GameClientMessage = z.infer<typeof gameClientMessageSchema>;

/** The hub -> game application channel. */
export const gameServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("quackbox:init"),
    gameId: z.string(),
    players: z.array(playerSchema),
    config: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("quackbox:player"),
    kind: z.enum(["join", "rejoin", "leave", "removed"]),
    player: playerSchema,
  }),
  z.object({
    type: z.literal("quackbox:input"),
    player: playerSchema,
    input: inputSchema,
  }),
  z.object({ type: z.literal("quackbox:stop") }),
]);

export type GameServerMessage = z.infer<typeof gameServerMessageSchema>;
