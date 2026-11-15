# The QuackBox

A LAN party platform. The host app runs the game on the big screen; everyone else's
phone becomes a controller. No internet, no accounts, no installs on the phones.

**Status: Phase 0 + Phase 1 complete.** The repo, protocol and networking skeleton
work and are tested. The Electron shell, the cartridge loader and the SDK are next
(see [Roadmap](#roadmap)).

## Quickstart

```bash
corepack pnpm install     # pnpm comes from Corepack; no global install needed
corepack pnpm build       # builds the phone controller into apps/controller/dist
corepack pnpm dev:hub     # starts the LAN hub on :4321
```

The hub prints a join URL for every LAN address it found:

```
  room code   ABCD
  controller  http://localhost:4321/?room=ABCD
  LAN         http://192.168.0.42:4321/?room=ABCD  (Wi-Fi)
```

Open the LAN URL on a phone that is on the same Wi-Fi. Type a name, join, and the
hub console lists the player. Repeat for as many phones as you like.

For controller work with hot reload, run the hub and `corepack pnpm dev:controller`
side by side; Vite proxies `/ws` and `/health` to `127.0.0.1:4321`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev:hub` | Hub with file watching, console roster |
| `pnpm dev:controller` | Vite dev server for the phone controller |
| `pnpm build` | Build the controller (the hub serves `apps/controller/dist`) |
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm lint` | ESLint over the whole repo |
| `pnpm license-check` | Cartridge manifests + `ASSETS.md` guardrail |
| `pnpm check` | typecheck + lint + license-check |
| `pnpm sim --players 100` | Headless bots: join, send input, drop and resume slots |

`pnpm` here means `corepack pnpm` unless you have pnpm installed globally.

## Layout

```
apps/launcher/     host process: Fastify + ws LAN server (Electron shell in Phase 2)
apps/controller/   the phone PWA (vanilla TS)
packages/protocol/ zod schemas + types shared by hub, controller and games
tools/license-check/  CI guardrail for cartridge assets
games/             cartridges; see games/README.md
scripts/sim.ts     simulated phones for load and reconnect tests
```

## How the networking works

- **One port.** Fastify serves the controller and `/health`; `ws` handles `/ws` on
  the same HTTP server.
- **Join.** The phone sends `{ t: "join", room, name, token? }`. A known token
  reclaims the same player slot (same id, score and team); otherwise a name creates
  one. The hub answers with `welcome`, which carries the reconnect token and the
  current controller screen.
- **Screens, not state.** A game never sends game state to a phone. It sends a
  declarative `ControllerUI` descriptor; the phone ignores any descriptor with a
  lower `v` than the last one it drew.
- **Heartbeat.** The hub pings every 5s and terminates a socket after 15s of
  silence. A dropped player keeps their slot for a 60s grace period, then the hub
  emits `onPlayerRemoved`.
- **Reconnect.** The phone reconnects with exponential backoff (0.5s → 5s), also on
  `visibilitychange` and `online`, and re-sends its token. The hub replays the
  player's last screen, so they land exactly where the game expects them.

Configuration lives in `apps/launcher/src/server/config.ts` and can be overridden
with `QUACKBOX_PORT`, `QUACKBOX_ROOM`, `QUACKBOX_GRACE_MS`,
`QUACKBOX_HEARTBEAT_MS`, `QUACKBOX_DROP_MS`, `QUACKBOX_MAX_PAYLOAD`.

## Roadmap

- ✅ **Phase 0** — monorepo, TypeScript, ESLint, MIT license, `AGENTS.md`, asset guardrail
- ✅ **Phase 1** — protocol package, Fastify + `ws` hub (rooms, tokens, heartbeat,
  reconnect, grace period), controller PWA, headless console test
- ⬜ **Phase 2** — Electron shell, LAN IP picker, QR code, lobby, cartridge discovery
- ⬜ **Phase 3** — `@quackbox/sdk`, controller components (buttons, text, choice, joystick, drawpad)
- ⬜ **Phase 4** — `_template` cartridge, `create-game`, three starter games, 50/100-bot load test
- ⬜ **Phase 5** — firewall/AP-isolation screens, crash boundaries, rate limits, real-device pass
- ⬜ **Phase 6** — `electron-builder` releases, CI build matrix, docs and submission checklist

## License

Code: MIT (`LICENSE`). Every cartridge declares its own license and must list the
source and license of each asset in `ASSETS.md`; `pnpm license-check` enforces it.
