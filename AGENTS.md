# AGENTS.md

Instructions for any AI session working in this repo. Read this before editing.

## What this is

The QuackBox is a LAN party platform: an Electron host app runs a game on the big
screen, phones join over local Wi-Fi with a server-hosted web controller. Games live
in `games/<id>/`. Super Smash Trash is now a separate desktop application launched by the
platform; the other four are still plain web cartridges with no engine lock-in.

Tech: TypeScript everywhere, pnpm workspaces, Fastify + `ws` for the LAN server,
vanilla TS for the controller, zod for every wire boundary.

Current state: Phases 0–6 are done, plus the desktop game split pilot. The launcher,
lobby, QR flow, legacy cartridge loader, the `@quackbox/sdk` bridge, the controller
components, five starter cartridges (`tap-race`, `draw-and-vote`, `tug-of-war`,
`rumble-arena`, `super-smash-trash`) and the `create-game` scaffolder work. Super
Smash Trash is the full platform fighter (20 passives, thirteen special archetypes, six
pure-platform stages, CPUs, up to 10 fighters and a landscape phone gamepad) and now packages and launches as its own app through
`apps/game-shell`; its standalone executable starts an embedded hub and join screen.
The other four still use the sandboxed iframe stage. `rumble-arena` is the smaller
real-time loop. Next: migrate the remaining cartridges and add assets/audio.

## Commands

```bash
corepack pnpm install
corepack pnpm build            # SDK + controller + launcher + shared game shell
corepack pnpm dev              # build, then open the Electron launcher
corepack pnpm dev:hub          # headless hub on :4321, prints join URLs, live roster
corepack pnpm dev:controller   # Vite on :5173, proxies /ws and /health
corepack pnpm typecheck        # tsc --noEmit in every package
corepack pnpm lint
corepack pnpm license-check
corepack pnpm check            # all three checks
corepack pnpm build:game       # package Super Smash Trash as its own app
corepack pnpm dist:game        # Super Smash Trash installer
corepack pnpm dist             # platform installer with Super Smash Trash bundled
corepack pnpm dist:dir         # unpacked platform build for a smoke test
corepack pnpm create-game my-game          # new cartridge from games/_template
corepack pnpm sim --players 20 --drop 3    # headless bots + reconnect test
corepack pnpm sim --players 100 --drop 0 --tap 200 --seconds 30   # load test
corepack pnpm sim --players 8 --pick 800 --move 80 --attack 320 --special 900  # super-smash-trash match
```

`pnpm` may not be on PATH; `corepack pnpm` always works.

## Layout

- `packages/protocol/` — the single source of truth for the wire format. zod schemas
  plus inferred types. Source-exported (`exports: "./src/index.ts"`), no build step.
- `packages/hub/` — `hub.ts` (rooms, join dispatch, game tickets), `room.ts` (player
  slots, tokens, UI replay, grace timers, game bridge), `http.ts` (Fastify + static
  controller + `/ws` and `/game` sockets), `game-link.ts` (authenticated game process
  channel), `limits.ts`, `config.ts`, `lan.ts`, `qr.ts`.
- `apps/game-shell/` — the standalone game application: Electron window, sandboxed
  preload bridge, loopback asset server, embedded hub and QR join screen. Packaged
  per game by `scripts/build-game-app.ts`.
- `apps/launcher/src/server/` — `standalone.ts`, the headless development runner only.
- `apps/launcher/src/main/` — Electron main: `index.ts` (window, IPC, port fallback,
  game process launch/stop), `games.ts` (manifest discovery), `preload.ts` (bridge).
- `apps/launcher/src/renderer/` — the lobby UI. It renders only what `LauncherState`
  says and never touches Node or the filesystem.
- `apps/launcher/src/shared/api.ts` — the IPC surface, imported by main, preload and
  renderer so all three agree.
- `apps/controller/src/` — `net.ts` (connection, backoff, token), `main.ts` (the room
  shell, orientation and stage mounting) and `components/` (buttons, gamepad, text,
  choice, joystick, drawpad, label, waiting).
- `packages/sdk/` — the cartridge API, bundled to `packages/sdk/dist/index.js` and
  served at `/sdk/index.js`. This is the only channel a cartridge has to the hub.
- `packages/create-game/` — the scaffolder behind `pnpm create-game`; copies
  `games/_template` and rewrites the id and name.
- `games/` — five starter cartridges plus `_template` (folders starting with `_` are
  skipped by discovery and `license-check`).
- `tools/license-check/` — cartridge manifest + asset license guardrail.

## Rules

1. **Every wire boundary is parsed with zod.** Client messages are validated in
   `hub.ts`; server messages are validated in the controller. Never trust a field
   because it exists in a TypeScript type.
2. **Sockets stay inside `packages/hub/`.** `hub.ts` owns phone connection lifetime,
   `http.ts` owns the HTTP/upgrade boundary and `game-link.ts` owns the game socket;
   games and the controller talk only in protocol messages. If a feature needs a
   socket, add a room method.
3. **The phone is dumb.** Games send a declarative `ControllerUI` descriptor, never
   game state, never HTML. New components go in `packages/protocol/src/ui.ts` first,
   then the controller renders them in `apps/controller/src/components/`.
   `hub.setUI` takes `"all"`, a player id or `{ team }`; the SDK converts that to the
   wire target, and only the main process may apply it to a room.
4. **Player identity is the token.** The token, not the socket, owns the slot, score
   and team. Anything keyed by socket breaks reconnects.
5. **Versioned screens.** `Room.setUI` stamps `v`; the client drops stale descriptors.
   Never render one that is older than the last.
6. **Every IPC argument is validated in the main process.** The renderer is a web page;
   `ipcMain.handle` callbacks type-check their inputs (`unknown`), not just Trust them.
   Never expose raw `fs` or `ipcRenderer` through the preload bridge.
7. **Cartridges are untrusted.** Legacy cartridges run in `sandbox="allow-scripts"`
   iframes served from `/games/`; do not add `allow-same-origin` or pass host
   privileges. Desktop games run in the sandboxed game shell and use a narrow preload
   bridge, a loopback-only asset server and a one-use `/game` ticket. Both paths
   re-validate every target and descriptor with zod before touching a room. Never
   move that validation into a renderer or the game code.
8. **Changing a real cartridge API is a breaking change.** `defineGame`, `ui.*` and
   `HubContext` are what every game is written against; add, don't rename.
6. **Scale target is 100 phones.** Inputs at 10–20Hz for analog, event-only for
   buttons, nothing when idle. No full-state broadcasts to phones; aggregate crowds
   on the host screen. Keep `perMessageDeflate` off and `maxPayload` small.
7. **No core edits for a game.** A cartridge is a folder in `games/`; if a game needs
   a change in `apps/` or `packages/`, it is a protocol/SDK change, discussed as such.
8. **Assets are licensed or they do not ship.** Every non-`_` cartridge needs a
   `manifest.json` and, if it has assets, an `ASSETS.md` with
   `- path | license | source URL` for each file. `pnpm license-check` must pass.
   Allowed licenses: CC0, CC-BY, OFL, MIT, Apache-2.0, public domain. No trademarked
   brands (do not use "Jackbox") in code, UI or docs.
9. **Style.** Strict TypeScript, explicit `.js` extensions in relative imports,
   `import type` for types, named exports, no `any` (use `unknown` + zod), small
   focused modules. Comments explain *why*, not *what*.
10. **Scope.** Build what the current phase needs. Do not add dependencies, pages,
    analytics or refactors that were not asked for.

## Roadmap (do not skip ahead)

Phase 2 Electron shell + lobby + cartridge discovery → Phase 3 SDK and controller
components → Phase 4 starter games and load tests (done) → Phase 5 hardening (done) →
Phase 6 packaging and CI (done) → desktop game split pilot (Super Smash Trash, done) →
migrate the remaining cartridges to standalone apps → assets and audio.
