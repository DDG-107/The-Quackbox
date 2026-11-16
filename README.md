# The QuackBox

A LAN party platform. The host app runs the game on the big screen; everyone else's
phone becomes a controller. No internet, no accounts, no installs on the phones.

**Status: Phases 0–6 complete, plus the platform/game split.** The Electron launcher,
lobby, QR join flow, the `@quackbox/sdk` bridge, the controller components and five
starter cartridges (Tap Race, Draw and Vote, Crowd Tug-of-War, Rumble Arena, Super
Smash Trash) work. Super Smash Trash is now a **separate desktop application**: QuackBox is the
library that launches it, and the same executable can run on its own with an embedded
hub and join screen. The other four cartridges still use the legacy sandboxed iframe
while the desktop model is proven. `pnpm create-game` starts a new cartridge from
`games/_template`.

## Quickstart

```bash
corepack pnpm install     # pnpm via Corepack; also fetches the Electron binary
corepack pnpm build       # builds the phone controller, launcher main and lobby
corepack pnpm dev         # builds again and opens the launcher window
```

The lobby shows a QR code, the LAN join URL and the room code. Scan with a phone on
the same Wi-Fi, type a name, and the player appears in the list. Kick and rename from
the list. Any folder in `games/` with a valid `manifest.json` shows up as a card. A
`runtime: "desktop"` game (Super Smash Trash) launches as its own application window and
connects back to the lobby's players; a legacy `runtime: "web"` game loads its
`host/index.html` in the sandboxed stage iframe.

`pnpm dev` rebuilds and relaunches; there is no hot reload yet. For server-only work
the headless runner is faster:

```bash
corepack pnpm dev:hub          # tsx watch, prints the join URL and live roster
corepack pnpm dev:controller   # Vite on :5173, proxies /ws and /health to :4321
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Build everything and open the Electron launcher |
| `pnpm dev:hub` | Headless hub with file watching and a console roster |
| `pnpm dev:controller` | Vite dev server for the phone controller |
| `pnpm build` | Cartridge SDK + controller + launcher + shared game shell |
| `pnpm start` | Open the launcher using the last build |
| `pnpm build:game` | Package Super Smash Trash into its own app in `release/game-apps/` |
| `pnpm dist:game` | Build the Super Smash Trash installer for this OS |
| `pnpm dist` | Build and package the host app (with the Super Smash Trash app) into `release/` |
| `pnpm dist:dir` | Unpacked build in `release/<platform>-unpacked`, for smoke tests |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm license-check` | Cartridge manifests + `ASSETS.md` guardrail |
| `pnpm check` | typecheck + lint + license-check |
| `pnpm create-game my-game` | Copy `games/_template` to `games/my-game` and rename it |
| `pnpm sim --players 100 --tap 200` | Headless bots: join, tap (`--draw`, `--punch`, `--attack`), pick a fighter, drop and resume slots |

`pnpm` here means `corepack pnpm` unless you have pnpm installed globally.

## Packaging

```bash
corepack pnpm build:game  # unpacked Super Smash Trash app + resources
corepack pnpm dist:game   # Super Smash Trash installer
corepack pnpm dist        # platform installer, with Super Smash Trash bundled
corepack pnpm dist:dir    # unpacked platform build, for a quick smoke test
```

`electron-builder` is configured in `apps/launcher/electron-builder.yml`. The platform
bundles its main, preload and renderer into an asar archive; the phone controller,
the cartridge SDK and `games/` are copied to `resources/quackbox/`, which the main
process resolves when `app.isPackaged`. Its `afterPack` hook also copies a packaged
desktop game apps from `release/game-apps/` to `resources/quackbox/game-apps/`, so a
fresh platform install has playable library entries.

Super Smash Trash is packaged from the shared shell in `apps/game-shell` with its own game
id, product name, executable name and installer. The result is a normal standalone
Electron application:

```
release/game-apps/super-smash-trash/win-unpacked/SuperSmashTrash.exe
release/game-apps/super-smash-trash/SuperSmashTrash-0.1.0-win-x64.exe   # after pnpm dist:game
```

Run the executable with no arguments to get its own join screen and embedded hub.
Run it from QuackBox to use the platform's existing room and players instead.

Builds are unsigned: configure your own signing before distributing, and drop a
licensed icon at `apps/launcher/build/icon.png` (and a game icon build resource) —
otherwise the default Electron icon is used.

`.github/workflows/ci.yml` runs `pnpm check` and `pnpm build` on every push and pull
request. `.github/workflows/release.yml` builds Windows (NSIS), macOS (dmg + zip) and
Linux (AppImage + deb) installers on a `v*` tag or manual dispatch; artifacts are on
the Actions run. The release job packages the Super Smash Trash app before the platform so
the afterPack hook can bundle it.

## Layout

```
apps/launcher/src/main/      Electron main: window, in-process hub, IPC, game process launch, discovery
apps/launcher/src/renderer/  Lobby UI (vanilla TS, built by Vite, loaded from file://)
apps/launcher/src/server/    headless hub runner only; the server lives in packages/hub
apps/launcher/src/shared/    IPC types shared by main, preload and renderer
apps/controller/             the phone PWA (vanilla TS) and its components
apps/game-shell/             shared desktop game shell: window, game link, embedded hub
packages/hub/                Fastify + ws hub: rooms, tokens, heartbeat, game link
packages/protocol/           zod schemas + types shared by hub, controller and games
packages/sdk/                cartridge API, served to games at /sdk/index.js
packages/create-game/        the `pnpm create-game` scaffolder
tools/license-check/         CI guardrail for cartridge assets
apps/launcher/electron-builder.yml  installer targets and packaged resource layout
games/                       the five starter cartridges, `_template`, see games/README.md
scripts/sim.ts               simulated phones for load and reconnect tests
scripts/build-game-app.ts    packages one game with the shared game shell
```

## How it works

- **One hub, one port.** The platform main process starts the hub in-process. Fastify
  serves the phone controller at `/`, legacy cartridges at `/games/` and `/health`;
  `ws` handles phone sockets at `/ws` and the game application channel at `/game` on
  the same HTTP server. If the port is taken it walks up to the next free one.
- **The lobby is a sandboxed renderer.** `contextIsolation`, no Node in the page, and
  every IPC argument is validated in the main process. The four legacy cartridges
  still load in an iframe with `sandbox="allow-scripts"`, served from the hub so they
  behave like the web pages they are.
- **Desktop games are separate processes.** Super Smash Trash is its own executable. The
  lobby mints a one-use, 30-second ticket, spawns the app with the hub URL and ticket,
  and the app opens its own window. Its renderer is sandboxed and talks to its own
  main process through a narrow preload bridge; that process connects to `/game` on
  the hub. The game window loads from a loopback-only asset server, not the LAN hub
  origin. Direct execution starts an embedded hub and a QR join screen, then the same
  game window and SDK.
- **Networking.** A phone sends `{ t: "join", room, name, token? }`. A known token
  reclaims the same slot (same id, score and team); otherwise a name creates one.
  `welcome` carries the token and the current controller screen.
- **Screens, not state.** Games never push game state to a phone, only a declarative
  `ControllerUI` descriptor; the phone ignores any descriptor older than the last.
- **Heartbeat.** The hub pings every 5s and terminates a socket after 15s of silence.
  A dropped player keeps their slot for the 60s grace period.
- **Reconnect.** The phone reconnects with backoff (0.5s → 5s), also on
  `visibilitychange` and `online`, re-sends its token, and the hub replays its screen.
- **Game link.** Both transports use the same `quackbox:*` vocabulary, so `defineGame`,
  `ui.*` and `HubContext` do not change. A legacy iframe posts over `postMessage` to
  the lobby renderer, which relays over IPC; a desktop game uses a preload bridge in
  the game shell. Both main processes validate targets and descriptors with zod, and
  the hub validates the `/game` messages again before touching a room. Game code never
  sees a phone socket or a raw filesystem.
- **Crash boundary.** A cartridge callback that throws is caught by the SDK. In the
  lobby it shows a “Cartridge stopped” card; a desktop game shell closes its window
  and the platform restores the library. A cartridge that never announces itself
  within 10s gets the same kind of failure instead of a black screen.
- **Rate limits.** Every phone socket has a 60 msg/s token bucket (120 burst); sustained
  flooding past 500 dropped messages closes it with code 4008. The game link has its
  own 180/s budget (240 burst) and rejects `send`/`broadcast` payloads over 32 KB.
- **Connection help.** The lobby and the phone join screen both carry a “Phones can't
  join?” panel: same network, the platform's firewall prompt, AP/client isolation, the
  exact address and room code, and VPNs.

## Writing a cartridge

A cartridge is a folder in `games/` with a manifest and a host page. The page imports
the SDK from the hub itself — no build step, no dependency to install:

```html
<script type="module">
  import { defineGame, ui } from "/sdk/index.js";

  defineGame({
    onStart(hub) {
      hub.setUI("all", ui.buttons([{ id: "tap", label: "TAP!" }]));
    },
    onPlayerJoin(player) {
      hub.log("joined", player.name);
    },
    onInput(player, input) {
      if (input.k === "press") hub.broadcast("scored", { playerId: player.id });
    },
  });
</script>
```

- `hub.setUI("all" | playerId | { team }, descriptor)` replaces a phone's controls.
- `hub.send(playerId, event, data)` / `hub.broadcast(event, data)` push events.
- `hub.end(results)` finishes the round and returns everyone to the lobby.
- Lifecycle: `onPlayerJoin`, `onPlayerLeave`, `onPlayerRejoin`, `onPlayerRemoved`,
  `onStop`.

`games/super-smash-trash` is the full platform fighter: 20 original trash-themed
fighters with passive abilities, phone-side character select, stocks, shields, thirteen
special archetypes, six stages with hazards and match results. It is the
reference for a complete desktop game, not just a page: its manifest sets
`"runtime": "desktop"` and names the packaged executable, and it is built with the
shared `apps/game-shell`. `games/rumble-arena` remains the smaller iframe loop if you
want one screen and one rule set.

A new game starts as a legacy web cartridge. To make it a desktop application, set
`runtime` and `app.executable` in its manifest, then package it with
`corepack pnpm build:game <id>`; the shell provides the window, game link and
standalone join screen. The platform discovers the packaged app under
`resources/quackbox/game-apps/<id>` (or `QUACKBOX_GAME_APPS_DIR`).

Controller components available today: `buttons`, `gamepad`, `text`, `choice`,
`joystick`, `drawpad`, `waiting`, `label`. The `gamepad` component renders a landscape
console pad with two sticks, XYAB, and shoulder buttons. `/games/` and `/sdk/` are served with
`Access-Control-Allow-Origin: *` because the sandboxed frame has an opaque origin and
its ES module imports would otherwise be blocked.

Configuration lives in `packages/hub/src/config.ts` and can be overridden with
`QUACKBOX_PORT`, `QUACKBOX_ROOM`, `QUACKBOX_GRACE_MS`, `QUACKBOX_HEARTBEAT_MS`,
`QUACKBOX_DROP_MS`, `QUACKBOX_MAX_PAYLOAD`, `QUACKBOX_MSG_RATE`, `QUACKBOX_MSG_BURST`,
`QUACKBOX_GAMES_DIR` (cartridge root) and `QUACKBOX_CONTROLLER_DIR` (built controller).
For development of the desktop split, `QUACKBOX_GAME_SHELL` selects the game shell
path and `QUACKBOX_GAME_APPS_DIR` selects the installed game-app directory.

## Roadmap

- ✅ **Phase 0** — monorepo, TypeScript, ESLint, MIT license, `AGENTS.md`, asset guardrail
- ✅ **Phase 1** — protocol package, Fastify + `ws` hub (rooms, tokens, heartbeat,
  reconnect, grace period), controller PWA, headless console test
- ✅ **Phase 2** — Electron shell, in-process hub, LAN interface picker, QR code, lobby
  with live roster / kick / rename, cartridge discovery and sandboxed iframe loader
- ✅ **Phase 3** — `@quackbox/sdk` (`defineGame`, `ui`, `HubContext`), `postMessage`
  bridge, and the buttons / text / choice / joystick / drawpad / waiting components
- ✅ **Phase 4** — `_template` cartridge, `create-game` scaffolder, Tap Race,
  Draw and Vote, Crowd Tug-of-War, and a 100-bot load test (`pnpm sim ... --tap`)
- ✅ **Phase 5** — firewall / AP-isolation guidance on the lobby and join screens,
  cartridge crash boundary and load timeout, per-socket and bridge rate limits
- ✅ **Phase 6** — `electron-builder` installers for Windows/macOS/Linux, packaged
  `resources/quackbox` assets, GitHub Actions check and release matrix
- ✅ **Super Smash Trash** — a full 20-fighter platform fighter with phone character
  select, passives, thirteen special archetypes, six hazard stages, licensed CC0 audio
  and a landscape phone gamepad, all original IP
- ✅ **Desktop game split (pilot)** — shared hub package, authenticated game link,
  reusable game shell, standalone Super Smash Trash executable and platform library launch
- **Next** — migrate the other four cartridges to standalone apps, then continue
  library polish and game-specific art

## License

Code: MIT (`LICENSE`). Every cartridge declares its own license and must list the
source and license of each asset in `ASSETS.md`; `pnpm license-check` enforces it.
