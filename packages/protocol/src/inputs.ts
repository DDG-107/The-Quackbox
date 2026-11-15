import { z } from "zod";

const idSchema = z.string().min(1).max(64);
/** Normalised 0..1 coordinate (drawing). */
const unit = z.number().min(0).max(1);
/** Signed -1..1 coordinate (axes, motion). */
const signed = z.number().min(-1).max(1);
const seqSchema = z.number().int().nonnegative();

const axisInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("axis"),
  x: signed,
  y: signed,
  seq: seqSchema,
});

const motionInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("motion"),
  x: signed,
  y: signed,
  z: signed,
  seq: seqSchema,
});

const pressInput = z.object({ t: z.literal("in"), id: idSchema, k: z.literal("press") });
const releaseInput = z.object({ t: z.literal("in"), id: idSchema, k: z.literal("release") });

const strokeInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("stroke"),
  pts: z.array(z.tuple([unit, unit])).min(1).max(512),
});

const textInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("text"),
  v: z.string().max(200),
});

const choiceInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("choice"),
  v: z.array(idSchema).max(24),
});

const valueInput = z.object({
  t: z.literal("in"),
  id: idSchema,
  k: z.literal("value"),
  v: z.number(),
});

/** Everything a phone can send once it has joined a room. */
export const inputSchema = z.discriminatedUnion("k", [
  axisInput,
  motionInput,
  pressInput,
  releaseInput,
  strokeInput,
  textInput,
  choiceInput,
  valueInput,
]);

export type InputEvent = z.infer<typeof inputSchema>;
export type InputKind = InputEvent["k"];
