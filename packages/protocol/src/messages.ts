import { z } from "zod";
import { inputSchema } from "./inputs.js";
import { playerSchema } from "./player.js";
import { controllerUISchema } from "./ui.js";

/** Bumped when a change would break an older peer. Peers refuse a mismatch. */
export const PROTOCOL_VERSION = 1;

export const joinMessageSchema = z.object({
  t: z.literal("join"),
  room: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/)
    .optional(),
  /** Reconnect token from a previous `welcome`; presents as the same player slot. */
  token: z.uuid().optional(),
  name: z.string().trim().min(1).max(24).optional(),
  protocol: z.number().int().optional(),
});

export type JoinMessage = z.infer<typeof joinMessageSchema>;

/** Room code shown on the big screen and encoded in the join URL. */
export const roomCodeSchema = z.string().regex(/^[A-Z0-9]{4}$/);

export const clientMessageSchema = z.union([joinMessageSchema, inputSchema]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const welcomeMessageSchema = z.object({
  t: z.literal("welcome"),
  room: z.string(),
  playerId: z.string(),
  token: z.uuid(),
  resumed: z.boolean(),
  graceMs: z.number(),
  players: z.array(playerSchema),
  ui: controllerUISchema.nullable(),
});

export const uiMessageSchema = z.object({
  t: z.literal("ui"),
  ui: controllerUISchema,
});

export const roomMessageSchema = z.object({
  t: z.literal("room"),
  room: z.string(),
  players: z.array(playerSchema),
});

export const eventMessageSchema = z.object({
  t: z.literal("event"),
  event: z.string(),
  data: z.unknown(),
});

export const errorCodeSchema = z.enum([
  "bad-message",
  "not-joined",
  "room-not-found",
  "name-required",
  "room-full",
  "protocol",
]);

export const errorMessageSchema = z.object({
  t: z.literal("error"),
  code: errorCodeSchema,
  message: z.string(),
});

export const endedMessageSchema = z.object({
  t: z.literal("ended"),
  results: z.array(z.object({ playerId: z.string(), score: z.number() })),
});

export const kickedMessageSchema = z.object({
  t: z.literal("kicked"),
  reason: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion("t", [
  welcomeMessageSchema,
  uiMessageSchema,
  roomMessageSchema,
  eventMessageSchema,
  errorMessageSchema,
  endedMessageSchema,
  kickedMessageSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type WelcomeMessage = z.infer<typeof welcomeMessageSchema>;
export type UIMessage = z.infer<typeof uiMessageSchema>;
export type RoomMessage = z.infer<typeof roomMessageSchema>;
export type EventMessage = z.infer<typeof eventMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type EndedMessage = z.infer<typeof endedMessageSchema>;
export type KickedMessage = z.infer<typeof kickedMessageSchema>;
export type GameResult = EndedMessage["results"][number];
