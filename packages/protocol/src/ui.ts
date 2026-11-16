import { z } from "zod";

const idSchema = z.string().min(1).max(64);

export const buttonStyleSchema = z.enum(["default", "big", "primary", "danger", "ghost"]);
export type ButtonStyle = z.infer<typeof buttonStyleSchema>;

export const uiButtonSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(48),
  style: buttonStyleSchema.optional(),
  cooldownMs: z.number().int().min(0).max(60_000).optional(),
});
export type UIButton = z.infer<typeof uiButtonSchema>;

const joystickComponent = z.object({
  type: z.literal("joystick"),
  id: idSchema,
  side: z.enum(["left", "right"]).optional(),
  hz: z.number().int().min(1).max(60).optional(),
});

const buttonsComponent = z.object({
  type: z.literal("buttons"),
  buttons: z.array(uiButtonSchema).min(1).max(12),
});

const gamepadStickSchema = z.object({
  id: idSchema,
  hz: z.number().int().min(1).max(60).optional(),
});

const gamepadComponent = z.object({
  type: z.literal("gamepad"),
  label: z.string().max(64).optional(),
  left: gamepadStickSchema,
  right: gamepadStickSchema.optional(),
  face: z.object({
    x: uiButtonSchema,
    y: uiButtonSchema,
    a: uiButtonSchema,
    b: uiButtonSchema,
  }),
  leftShoulder: uiButtonSchema.optional(),
  rightShoulder: uiButtonSchema.optional(),
});

const dpadComponent = z.object({
  type: z.literal("dpad"),
  id: idSchema,
});

const drawpadComponent = z.object({
  type: z.literal("drawpad"),
  id: idSchema,
  colors: z.array(z.string().max(32)).min(1).max(12).optional(),
  strokeMax: z.number().int().min(16).max(4096).optional(),
  prompt: z.string().max(80).optional(),
});

const textComponent = z.object({
  type: z.literal("text"),
  id: idSchema,
  prompt: z.string().min(1).max(80),
  maxLen: z.number().int().min(1).max(200),
  submitLabel: z.string().max(24).optional(),
});

const choiceComponent = z.object({
  type: z.literal("choice"),
  id: idSchema,
  // 40 rather than 24: a fighter-select screen lists a whole roster, and the
  // controller scrolls its option list, so a full roster must fit one message.
  options: z.array(z.object({ id: idSchema, label: z.string().min(1).max(64) })).min(1).max(40),
  multi: z.boolean().optional(),
});

const sliderComponent = z.object({
  type: z.literal("slider"),
  id: idSchema,
  min: z.number(),
  max: z.number(),
  label: z.string().max(32).optional(),
});

const motionComponent = z.object({
  type: z.literal("motion"),
  id: idSchema,
  hz: z.number().int().min(1).max(60).optional(),
});

const labelComponent = z.object({
  type: z.literal("label"),
  text: z.string().max(200),
});

const waitingComponent = z.object({
  type: z.literal("waiting"),
  text: z.string().max(200).optional(),
});

const customComponent = z.object({
  type: z.literal("custom"),
  url: z.string().min(1).max(1024),
});

export const componentSchema = z.discriminatedUnion("type", [
  joystickComponent,
  buttonsComponent,
  gamepadComponent,
  dpadComponent,
  drawpadComponent,
  textComponent,
  choiceComponent,
  sliderComponent,
  motionComponent,
  labelComponent,
  waitingComponent,
  customComponent,
]);

export type Component = z.infer<typeof componentSchema>;
export type ComponentType = Component["type"];

/**
 * The declarative screen a game pushes to a phone. The client ignores any
 * descriptor whose `v` is lower than the last one it rendered.
 */
export const controllerUISchema = z.object({
  v: z.number().int().nonnegative(),
  orientation: z.enum(["portrait", "landscape", "any"]).optional(),
  background: z.string().max(32).optional(),
  components: z.array(componentSchema).max(16),
});

export type ControllerUI = z.infer<typeof controllerUISchema>;

/** A UI descriptor as authored by a game: the hub stamps `v`. */
export const uiSpecSchema = controllerUISchema.omit({ v: true });
export type UISpec = z.infer<typeof uiSpecSchema>;

/** Who receives a UI descriptor. */
export const uiTargetSchema = z.union([
  z.literal("all"),
  z.object({ playerId: z.string().min(1).max(64) }),
  z.object({ team: z.string().min(1).max(64) }),
]);
export type UITarget = z.infer<typeof uiTargetSchema>;
