import type { Player } from "@quackbox/protocol";

export interface StandaloneInfo {
  name: string;
  room: string;
  joinUrl: string | null;
  qrSvg: string | null;
  players: Player[];
}
