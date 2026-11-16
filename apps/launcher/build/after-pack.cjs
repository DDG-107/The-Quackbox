const { cpSync, existsSync, mkdirSync, readdirSync, rmSync } = require("node:fs");
const { join } = require("node:path");

/**
 * The platform installer includes the desktop game apps that were already
 * packaged into release/game-apps. If none were built, the platform still
 * installs; it just has no desktop games to launch.
 */
module.exports = async function afterPack(context) {
  const repoRoot = join(__dirname, "..", "..", "..");
  const gameAppsRoot = join(repoRoot, "release", "game-apps");
  if (!existsSync(gameAppsRoot)) {
    console.log("[afterPack] no desktop game apps were built; skipping bundled copy");
    return;
  }

  // This hook runs on the build host, which is not necessarily the target
  // platform when cross-building. Use the target platform from electron-builder.
  const platform = context.electronPlatformName;
  const candidates =
    platform === "win32"
      ? ["win-unpacked"]
      : platform === "darwin"
        ? ["mac", "mac-arm64", "mac-universal"]
        : ["linux-unpacked", "linux-arm64-unpacked"];

  // On macOS the app resources live inside the .app bundle; on Windows and
  // Linux they sit directly under appOutDir.
  const resourcesRoot =
    platform === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  const packagedGamesRoot = join(resourcesRoot, "quackbox", "games");
  const targetRoot = join(resourcesRoot, "quackbox", "game-apps");

  // Only bundle games that are actually present in this build. A stale
  // release/game-apps directory must not smuggle an old game into the installer.
  const gameIds = readdirSync(gameAppsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((gameId) => existsSync(join(packagedGamesRoot, gameId, "manifest.json")))
    .sort();

  // Start clean so a previous local build cannot leave a removed game behind.
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });

  let bundled = 0;
  for (const gameId of gameIds) {
    const source = candidates
      .map((candidate) => join(gameAppsRoot, gameId, candidate))
      .find((candidate) => existsSync(candidate));
    if (!source) {
      console.log(`[afterPack] ${gameId} app not built for this platform; skipping`);
      continue;
    }

    const target = join(targetRoot, gameId);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
    console.log(`[afterPack] bundled ${gameId} from ${source}`);
    bundled += 1;
  }

  if (bundled === 0) {
    console.log("[afterPack] no desktop game apps matched this platform; skipping bundled copy");
  }
};
