import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gameManifestSchema, type GameManifest } from "@quackbox/protocol";
import type { GameInfo } from "../shared/api.js";

const EMPTY_PLAYERS: GameManifest["players"] = { min: 1, max: 1 };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function broken(id: string, name: string, message: string): GameInfo {
  return {
    id,
    name,
    version: "—",
    entry: "",
    tags: [],
    players: EMPTY_PLAYERS,
    reconnect: "resume",
    runtime: "web",
    error: message,
  };
}

/**
 * Scan `games/<id>/manifest.json`. Folders starting with `_` (templates) or `.`
 * are ignored. A cartridge with a bad manifest still shows up, marked broken,
 * so the host can see why it did not load.
 */
export async function discoverGames(gamesRoot: string): Promise<GameInfo[]> {
  if (!existsSync(gamesRoot)) return [];

  const entries = await readdir(gamesRoot, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const games: GameInfo[] = [];

  for (const folder of folders) {
    const manifestPath = join(gamesRoot, folder, "manifest.json");
    if (!existsSync(manifestPath)) continue;

    let manifest: GameManifest;
    try {
      manifest = gameManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
    } catch (error) {
      games.push(broken(folder, folder, `manifest.json is invalid: ${describe(error)}`));
      continue;
    }

    if (manifest.id !== folder) {
      games.push(
        broken(folder, manifest.name, `manifest id "${manifest.id}" does not match folder "${folder}"`),
      );
      continue;
    }

    if (!existsSync(join(gamesRoot, folder, manifest.entry))) {
      games.push(broken(folder, manifest.name, `entry "${manifest.entry}" does not exist`));
      continue;
    }

    games.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      entry: manifest.entry,
      tags: manifest.tags,
      players: manifest.players,
      reconnect: manifest.reconnect,
      runtime: manifest.runtime,
      ...(manifest.app ? { app: manifest.app } : {}),
    });
  }

  return games;
}
