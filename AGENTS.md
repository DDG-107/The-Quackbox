# AGENTS.md

Instructions for any AI session working in this repo. Read this before editing.

## What this is

The QuackBox is a LAN party platform: an Electron host app runs a game on the big
screen, phones join over local Wi-Fi with a server-hosted web controller. Games
("cartridges") are plain web pages in `games/<id>/` with no engine lock-in.

Tech: TypeScript everywhere, pnpm workspaces, Fastify + `ws` for the LAN server,
vanilla TS for the controller, zod for every wire boundary.

Current state: Phase 0 and Phase 1 are done. There is no Electron shell, no SDK,
no cartridge loader and no game yet — do not pretend otherwise in docs or UI.

## Commands

```bash
corepack pnpm install
corepack pnpm build            # controller -> apps/controller/dist
corepack pnpm dev:hub          # hub on :4321, prints join URLs, live roster
corepack pnpm dev:controller   # Vite on :5173, proxies /ws and /health
corepack pnpm typecheck        # tsc --noEmit in every package
corepack pnpm lint
corepack pnpm license-check
corepack pnpm check            # all three checks
corepack pnpm sim --players 20 --drop 3   # headless bots + reconnect test
```

`pnpm` may not be on PATH; `corepack pnpm` always works.

## Layout

- `packages/protocol/` — the single source of truth for the wire format. zod schemas
  plus inferred types. Source-exported (`exports: "./src/index.ts"`), no build step.
- `apps/launcher/src/server/` — `hub.ts` (sockets, join dispatch), `room.ts` (player
  slots, tokens, UI replay, grace timers), `http.ts` (Fastify + static controller +
  heartbeat), `config.ts`, `lan.ts`, `standalone.ts` (headless runner).
- `apps/controller/src/` — `net.ts` (connection, backoff, token) and `main.ts`
  (renders the `ControllerUI` descriptor).
- `tools/license-check/` — cartridge manifest + asset license guardrail.

## Rules

1. **Every wire boundary is parsed with zod.** Client messages are validated in
   `hub.ts`; server messages are validated in the controller. Never trust a field
   because it exists in a TypeScript type.
2. **Only `hub.ts` touches raw sockets.** Games and the controller talk in protocol
   messages. If a feature needs a socket, add a room method.
3. **The phone is dumb.** Games send a declarative `ControllerUI` descriptor, never
   game state, never HTML. New components go in `packages/protocol/src/ui.ts` first,
   then the controller renders them.
4. **Player identity is the token.** The token, not the socket, owns the slot, score
   and team. Anything keyed by socket breaks reconnects.
5. **Versioned screens.** `Room.setUI` stamps `v`; the client drops stale descriptors.
   Never render one that is older than the last.
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
components → Phase 4 starter games and load tests → Phase 5 hardening → Phase 6
packaging and CI.
