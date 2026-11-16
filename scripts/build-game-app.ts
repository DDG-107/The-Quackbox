import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { gameManifestSchema } from "@quackbox/protocol";

/**
 * corepack pnpm build:game [game-id] [--installer]
 *
 * Packages the shared game shell with one game's assets. The default is a
 * --dir build for fast smoke tests; --installer asks electron-builder for the
 * platform installer as well.
 */
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const installer = args.includes("--installer");
const gameId = args.find((argument) => !argument.startsWith("--")) ?? "super-smash-trash";

const gameDir = join(projectRoot, "games", gameId);
const manifestPath = join(gameDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`No game at games/${gameId}/manifest.json`);
  process.exit(1);
}

const manifest = gameManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
if (manifest.runtime !== "desktop") {
  console.error(`games/${gameId} is a ${manifest.runtime} game; set "runtime": "desktop" to package it.`);
  process.exit(1);
}

const shellDir = join(projectRoot, "apps", "game-shell");
if (!existsSync(join(shellDir, "dist", "main", "index.mjs"))) {
  console.error("The game shell is not built. Run: corepack pnpm build");
  process.exit(1);
}
if (!existsSync(join(projectRoot, "packages", "sdk", "dist", "index.js"))) {
  console.error("The SDK is not built. Run: corepack pnpm build");
  process.exit(1);
}
if (!existsSync(join(projectRoot, "apps", "controller", "dist", "index.html"))) {
  console.error("The phone controller is not built. Run: corepack pnpm build");
  process.exit(1);
}

const executable = manifest.app?.executable ?? gameId.replaceAll("-", "");
const configPath = join(shellDir, ".game-builder.yml");
const outputDir = join(projectRoot, "release", "game-apps", gameId);
const config = `appId: app.quackbox.game.${gameId}
productName: ${JSON.stringify(manifest.name)}
copyright: Copyright © 2026 The QuackBox contributors

directories:
  output: ${JSON.stringify(join("..", "..", "release", "game-apps", gameId))}

files:
  - dist/**/*
  - package.json

extraResources:
  - from: ${JSON.stringify(join("..", "..", "games", gameId))}
    to: ${JSON.stringify(join("quackbox", "games", gameId))}
    filter:
      - "**/*"
      - "!**/README.md"
  - from: ${JSON.stringify(join("..", "..", "packages", "sdk", "dist"))}
    to: quackbox/sdk
  - from: ${JSON.stringify(join("..", "..", "apps", "controller", "dist"))}
    to: quackbox/controller

asar: true
npmRebuild: false

win:
  target:
    - nsis
  executableName: ${JSON.stringify(executable)}
  artifactName: ${JSON.stringify(`${executable}-\${version}-win-\${arch}.\${ext}`)}

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  shortcutName: ${JSON.stringify(manifest.name)}

mac:
  target:
    - dmg
    - zip
  category: public.app-category.games
  identity: null
  artifactName: ${JSON.stringify(`${executable}-\${version}-mac-\${arch}.\${ext}`)}

linux:
  target:
    - AppImage
    - deb
  category: Game
  maintainer: The QuackBox contributors
  executableName: ${JSON.stringify(executable)}
  artifactName: ${JSON.stringify(`${executable}-\${version}-linux-\${arch}.\${ext}`)}
`;

writeFileSync(configPath, config);
console.log(`Packaging ${manifest.name} (${gameId})${installer ? " with installer" : " for a smoke test"}`);

const commandArgs = [
  "pnpm",
  "--filter",
  "@quackbox/game-shell",
  "exec",
  "electron-builder",
  "--config",
  ".game-builder.yml",
  "--publish",
  "never",
  ...(installer ? [] : ["--dir"]),
];

const result = spawnSync("corepack", commandArgs, {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

rmSync(configPath, { force: true });

if (result.status !== 0) {
  console.error(`Game packaging failed with exit ${result.status ?? "unknown"}.`);
  process.exit(result.status ?? 1);
}

console.log(`Game application ready in ${outputDir}`);
