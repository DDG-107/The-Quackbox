# The QuackBox

A LAN party platform. The host app runs the game on the big screen; everyone else's
phone becomes a controller. No internet, no accounts, no installs on the phones.

**Status: Phases 0–2 complete.** The Electron launcher, lobby, QR join flow and
cartridge discovery work. The SDK, controller components and games are next.

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
| `pnpm build` | Controller + launcher main/preload + lobby renderer |
| `pnpm start` | Open the launcher using the last build |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm license-check` | Cartridge manifests + `ASSETS.md` guardrail |
| `pnpm check` | typecheck + lint + license-check |
| `pnpm sim --players 100` | Headless bots: join, send input, drop and resume slots |

`pnpm` here means `corepack pnpm` unless you have pnpm installed globally.

## Layout

```
apps/launcher/src/main/      Electron main: window, in-process hub, IPC, QR, discovery
apps/launcher/src/renderer/  Lobby UI (vanilla TS, built by Vite, loaded from file://)
apps/launcher/src/server/    Fastify + ws hub: rooms, tokens, heartbeat, grace period
apps/launcher/src/shared/    IPC types shared by main, preload and renderer
apps/controller/             the phone PWA (vanilla TS)
packages/protocol/           zod schemas + types shared by hub, controller and games
tools/license-check/         CI guardrail for cartridge assets
games/                       cartridges; see games/README.md
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
- ⬜ **Phase 3** — `@quackbox/sdk`, `postMessage` bridge, controller components
- ⬜ **Phase 4** — `_template` cartridge, `create-game`, three starter games, load test
- ⬜ **Phase 5** — firewall/AP-isolation screens, crash boundaries, rate limits
- ⬜ **Phase 6** — `electron-builder` releases, CI build matrix, docs

## License

Code: MIT (`LICENSE`). Every cartridge declares its own license and must list the
source and license of each asset in `ASSETS.md`; `pnpm license-check` enforces it.
