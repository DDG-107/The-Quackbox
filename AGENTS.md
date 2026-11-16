# AGENTS.md

Instructions for any AI session working in this repo. Read this before editing.

## What this is

The QuackBox is a LAN party platform: an Electron host app runs a game on the big
screen, phones join over local Wi-Fi with a server-hosted web controller. Games
("cartridges") are plain web pages in `games/<id>/` with no engine lock-in.

Tech: TypeScript everywhere, pnpm workspaces, Fastify + `ws` for the LAN server,
vanilla TS for the controller, zod for every wire boundary.

Current state: Phases 0–6 are done. The launcher, lobby, QR flow, cartridge
discovery/loader, the `@quackbox/sdk` bridge, the controller components, five starter
cartridges (`tap-race`, `draw-and-vote`, `tug-of-war`, `rumble-arena`, `rift-rumble`)
and the `create-game` scaffolder work. Phase 5 adds connection troubleshooting screens, a
cartridge crash boundary and rate limits. Phase 6 adds `electron-builder` installers
(packaged assets in `resources/quackbox/`) and the GitHub Actions check/release
workflows. Rift Rumble is the full platform fighter and the reference for a complete
cartridge; `rumble-arena` is the smaller real-time loop. Next: assets and audio.

## Commands

```bash
corepack pnpm install
corepack pnpm build            # controller + launcher main/preload + lobby renderer
corepack pnpm dev              # build, then open the Electron launcher
corepack pnpm dev:hub          # headless hub on :4321, prints join URLs, live roster
corepack pnpm dev:controller   # Vite on :5173, proxies /ws and /health
corepack pnpm typecheck        # tsc --noEmit in every package
corepack pnpm lint
corepack pnpm license-check
corepack pnpm check            # all three checks
corepack pnpm dist             # build + installer for this OS into release/
corepack pnpm dist:dir         # unpacked build for a smoke test
corepack pnpm create-game my-game          # new cartridge from games/_template
corepack pnpm sim --players 20 --drop 3    # headless bots + reconnect test
corepack pnpm sim --players 100 --drop 0 --tap 200 --seconds 30   # load test
corepack pnpm sim --players 8 --pick 800 --move 80 --attack 320 --special 900  # rift-rumble match
```

`pnpm` may not be on PATH; `corepack pnpm` always works.

## Layout

- `packages/protocol/` — the single source of truth for the wire format. zod schemas
  plus inferred types. Source-exported (`exports: "./src/index.ts"`), no build step.
- `apps/launcher/src/server/` — `hub.ts` (sockets, join dispatch), `room.ts` (player
  slots, tokens, UI replay, grace timers), `http.ts` (Fastify + static controller +
  heartbeat), `limits.ts` (token bucket for socket and bridge budgets), `config.ts`,
  `lan.ts`, `standalone.ts` (headless runner).
- `apps/launcher/src/main/` — Electron main: `index.ts` (window, IPC, port fallback),
  `games.ts` (manifest discovery), `qr.ts` (SVG QR), `preload.ts` (context bridge).
- `apps/launcher/src/renderer/` — the lobby UI. It renders only what `LauncherState`
  says and never touches Node or the filesystem.
- `apps/launcher/src/shared/api.ts` — the IPC surface, imported by main, preload and
  renderer so all three agree.
- `apps/controller/src/` — `net.ts` (connection, backoff, token), `main.ts` (the room
  shell and stage mounting) and `components/` (buttons, text, choice, joystick,
  drawpad, label, waiting).
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
2. **Only `hub.ts` touches raw sockets.** Games and the controller talk in protocol
   messages. If a feature needs a socket, add a room method.
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
7. **Cartridges are untrusted.** They run in `sandbox="allow-scripts"` iframes served
   from `/games/`. Do not add `allow-same-origin`, and do not pass host privileges in.
   The bridge is `postMessage` → lobby renderer → IPC → main, and the main process
   re-validates every target and descriptor with zod before it reaches a room. Never
   move that validation into the renderer or the cartridge.
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
Phase 6 packaging and CI (done) → bigger cartridges (Rift Rumble and Rumble Arena).
