import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * corepack pnpm create-game my-game
 *
 * Copies games/_template, points the manifest at the new id and leaves the game
 * ready to open in the launcher.
 */
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const gamesDir = join(projectRoot, "games");
const templateDir = join(gamesDir, "_template");

const id = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
  console.error("usage: corepack pnpm create-game <id>");
  console.error("  id: lowercase letters, digits and dashes, e.g. my-game");
  process.exit(1);
}

if (!existsSync(templateDir)) {
  console.error("games/_template is missing; cannot scaffold.");
  process.exit(1);
}

const target = join(gamesDir, id);
if (existsSync(target)) {
  console.error(`games/${id} already exists.`);
  process.exit(1);
}

await cp(templateDir, target, { recursive: true });

const manifestPath = join(target, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
manifest.id = id;
manifest.name = id
  .split("-")
  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  .join(" ");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Created games/${id}`);
console.log("");
console.log("Next:");
console.log(`  1. write the big screen in games/${id}/host/main.js`);
console.log("  2. corepack pnpm dev");
console.log("  3. pick the cartridge in the lobby and join from a phone");
