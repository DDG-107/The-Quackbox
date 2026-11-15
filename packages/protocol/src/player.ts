import { z } from "zod";

/** A player slot in a room, as seen by the hub and by games. */
export const playerSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  connected: z.boolean(),
  team: z.string().optional(),
});

export type Player = z.infer<typeof playerSchema>;
