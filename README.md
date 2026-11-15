# The QuackBox

A LAN party platform. The host app runs the game on the big screen; everyone else's
phone becomes a controller. No internet, no accounts, no installs on the phones.

**Status: Phases 0–4 complete.** The Electron launcher, lobby, QR join flow,
cartridge loader, the `@quackbox/sdk` bridge, the controller components and three
starter cartridges (Tap Race, Draw and Vote, Crowd Tug-of-War) work. `pnpm create-game`
starts a new cartridge from `games/_template`.

## Quickstart

```bash
corepack pnpm install     # pnpm via Corepack; also fetches the Electron binary
corepack pnpm build       # builds the phone controller, launcher main and lobby
corepack pnpm dev         # builds again and opens the launcher window
```

The lobby shows a QR code, the LAN join URL and the room code. Scan with a phone on
the same Wi-Fi, type a name, and the player appears in the list. Kick and rename from
the list. Any folder in `games/` with a valid `manifest.json` shows up as a cartridge
card; picking one loads its `host/index.html` in a sandboxed iframe.

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
| `pnpm build` | Cartridge SDK + controller + launcher main/preload + lobby renderer |
| `pnpm start` | Open the launcher using the last build |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm license-check` | Cartridge manifests + `ASSETS.md` guardrail |
| `pnpm check` | typecheck + lint + license-check |
| `pnpm create-game my-game` | Copy `games/_template` to `games/my-game` and rename it |
| `pnpm sim --players 100 --tap 200` | Headless bots: join, tap (or `--draw`), drop and resume slots |

`pnpm` here means `corepack pnpm` unless you have pnpm installed globally.

## Layout

```
apps/launcher/src/main/      Electron main: window, in-process hub, IPC, QR, discovery
apps/launcher/src/renderer/  Lobby UI (vanilla TS, built by Vite, loaded from file://)
apps/launcher/src/server/    Fastify + ws hub: rooms, tokens, heartbeat, grace period
apps/launcher/src/shared/    IPC types shared by main, preload and renderer
apps/controller/             the phone PWA (vanilla TS) and its components
packages/protocol/           zod schemas + types shared by hub, controller and games
packages/sdk/                cartridge API, served to games at /sdk/index.js
packages/create-game/        the `pnpm create-game` scaffolder
tools/license-check/         CI guardrail for cartridge assets
games/                       the three starter cartridges, `_template`, see games/README.md
scripts/sim.ts               simulated phones for load and reconnect tests
```

## How it works

- **One process, one port.** The Electron main process starts the hub in-process, so
  there is no sidecar. Fastify serves the phone controller at `/`, cartridges at
  `/games/` and `/health`; `ws` handles `/ws` on the same HTTP server. If the port is
  taken it walks up to the next free one.
- **The lobby is a sandboxed renderer.** `contextIsolation`, no Node in the page, and
  every IPC argument is validated in the main process. Cartridges load in an iframe
  with `sandbox="allow-scripts"`, served from the hub so they behave like the web
  pages they are.
- **Networking.** A phone sends `{ t: "join", room, name, token? }`. A known token
  reclaims the same slot (same id, score and team); otherwise a name creates one.
  `welcome` carries the token and the current controller screen.
- **Screens, not state.** Games never push game state to a phone, only a declarative
  `ControllerUI` descriptor; the phone ignores any descriptor older than the last.
- **Heartbeat.** The hub pings every 5s and terminates a socket after 15s of silence.
  A dropped player keeps their slot for the 60s grace period.
- **Reconnect.** The phone reconnects with backoff (0.5s → 5s), also on
  `visibilitychange` and `online`, re-sends its token, and the hub replays its screen.
- **Bridge.** A cartridge talks to the hub over `postMessage` only: the SDK posts
  `quackbox:*` messages, the lobby renderer relays them to the main process over IPC,
  and the main process validates every target and descriptor before touching a room.
  The frame is `sandbox="allow-scripts"`, so game code never sees Node or the launcher.

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

Controller components available today: `buttons`, `text`, `choice`, `joystick`,
`drawpad`, `waiting`, `label`. `/games/` and `/sdk/` are served with
`Access-Control-Allow-Origin: *` because the sandboxed frame has an opaque origin and
its ES module imports would otherwise be blocked.

Configuration lives in `apps/launcher/src/server/config.ts` and can be overridden with
`QUACKBOX_PORT`, `QUACKBOX_ROOM`, `QUACKBOX_GRACE_MS`, `QUACKBOX_HEARTBEAT_MS`,
`QUACKBOX_DROP_MS`, `QUACKBOX_MAX_PAYLOAD`, `QUACKBOX_GAMES_DIR` (cartridge root) and
`QUACKBOX_CONTROLLER_DIR` (built controller).

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
- ⬜ **Phase 5** — firewall/AP-isolation screens, crash boundaries, rate limits
- ⬜ **Phase 6** — `electron-builder` releases, CI build matrix, docs

## License

Code: MIT (`LICENSE`). Every cartridge declares its own license and must list the
source and license of each asset in `ASSETS.md`; `pnpm license-check` enforces it.
