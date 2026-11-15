import { z } from "zod";
import type { ComponentType } from "./ui.js";

const controllerKindSchema = z.enum([
  "buttons",
  "joystick",
  "dpad",
  "drawpad",
  "text",
  "choice",
  "slider",
  "motion",
  "custom",
]);

const _controllerKindsAreCovered = (kind: ComponentType) => controllerKindSchema.safeParse(kind);

/** `games/<id>/manifest.json` — the whole contract between a cartridge and the hub. */
export const gameManifestSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "lowercase letters, digits and dashes only"),
    name: z.string().min(1).max(48),
    version: z.string().min(1).max(32),
    sdk: z.string().min(1),
    players: z.object({
      min: z.number().int().min(1),
      max: z.number().int().min(1),
      recommended: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(),
    }),
    entry: z.string().min(1),
    thumbnail: z.string().min(1).optional(),
    controllers: z.array(controllerKindSchema).default([]),
    needs: z.array(z.enum(["motion", "wake-lock"])).default([]),
    reconnect: z.enum(["resume", "skip", "drop"]).default("resume"),
    lateJoin: z.boolean().default(true),
    license: z.string().min(1),
    assetLicenses: z.string().default("ASSETS.md"),
    tags: z.array(z.string().max(24)).default([]),
  })
  .refine((manifest) => manifest.players.max >= manifest.players.min, {
    message: "players.max must be >= players.min",
    path: ["players", "max"],
  });

export type GameManifest = z.infer<typeof gameManifestSchema>;
