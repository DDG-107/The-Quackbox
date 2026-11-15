import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gameManifestSchema } from "@quackbox/protocol";

/**
 * Licensing guardrail: every cartridge must ship a valid manifest and an
 * ASSETS.md that lists source, license and URL for each file in assets/.
 *
 * Entry format, one per line:
 *   - assets/thumb.png | CC0-1.0 | https://example.com/thumb
 */
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const gamesDir = join(projectRoot, "games");

const problems: string[] = [];

interface AssetEntry {
  path: string;
  license: string;
  source: string;
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

async function listFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile() && !entry.name.startsWith(".")) files.push(full);
  }
  return files;
}

function parseAssetEntries(markdown: string): AssetEntry[] {
  const entries: AssetEntry[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("- ")) continue;
    const parts = line.slice(2).split("|").map((part) => part.trim());
    if (parts.length < 3) continue;
    const [path, license, source] = parts;
    if (!path || !license || !source) continue;
    entries.push({ path: path.replace(/^\.\//, ""), license, source });
  }
  return entries;
}

async function checkGame(gameDir: string, gameId: string): Promise<void> {
  const manifestPath = join(gameDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    problems.push(`${gameId}: missing manifest.json`);
    return;
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    problems.push(`${gameId}: manifest.json is not valid JSON (${String(error)})`);
    return;
  }

  const parsed = gameManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${gameId}: manifest.${issue.path.map(String).join(".") || "?"} — ${issue.message}`);
    }
    return;
  }

  const manifest = parsed.data;
  if (manifest.id !== gameId) {
    problems.push(`${gameId}: manifest id "${manifest.id}" does not match the folder name`);
  }

  const assetFiles = (await listFiles(join(gameDir, "assets"))).map((file) =>
    toPosix(relative(gameDir, file)),
  );

  const declared: string[] = [];
  if (manifest.thumbnail) declared.push(manifest.thumbnail);

  if (assetFiles.length === 0 && declared.length === 0) return;

  const assetsDoc = join(gameDir, manifest.assetLicenses);
  if (!existsSync(assetsDoc)) {
    problems.push(
      `${gameId}: ${manifest.assetLicenses} is required because this cartridge ships assets`,
    );
    return;
  }

  const entries = parseAssetEntries(await readFile(assetsDoc, "utf8"));
  const listed = new Set(entries.map((entry) => entry.path));

  for (const entry of entries) {
    if (!existsSync(join(gameDir, entry.path))) {
      problems.push(`${gameId}: ${manifest.assetLicenses} lists ${entry.path}, which does not exist`);
    }
    if (!/^(CC0|CC-BY|OFL|MIT|Apache-2\.0|public domain|PD)/i.test(entry.license)) {
      problems.push(
        `${gameId}: ${entry.path} uses license "${entry.license}" — use CC0, CC-BY, OFL, MIT, Apache-2.0 or public domain`,
      );
    }
  }

  for (const asset of [...assetFiles, ...declared]) {
    if (!listed.has(asset)) {
      problems.push(`${gameId}: ${asset} is missing from ${manifest.assetLicenses} (path | license | source URL)`);
    }
  }
}

async function main(): Promise<void> {
  if (!existsSync(gamesDir)) {
    console.log("license-check: no games/ directory — nothing to check.");
    return;
  }

  const entries = await readdir(gamesDir, { withFileTypes: true });
  const gameFolders = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  if (gameFolders.length === 0) {
    console.log("license-check: no cartridges yet — nothing to check.");
    return;
  }

  for (const gameId of gameFolders) {
    await checkGame(join(gamesDir, gameId), gameId);
  }

  if (problems.length > 0) {
    console.error(`license-check: ${problems.length} problem(s)\n`);
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error("");
    process.exitCode = 1;
    return;
  }

  console.log(`license-check: ${gameFolders.length} cartridge(s) OK (${gameFolders.join(", ")})`);
}

await main();
