# CLAUDE.md

Read `AGENTS.md` in this repo first — it is the single source of truth for
architecture, commands and rules. This file only repeats the parts that are easy
to get wrong.

- Package manager: pnpm via Corepack. Use `corepack pnpm ...` if `pnpm` is missing.
- TypeScript everywhere, strict, source-exported `@quackbox/protocol`, `.js`
  extensions in relative imports, `import type` for type-only imports.
- Wire format: zod schemas in `packages/protocol/src/`. Validate every inbound
  message. Bump `PROTOCOL_VERSION` only for breaking changes.
- Sockets exist only in `packages/hub/`; rooms own player slots, tokens, UI replay,
  the grace timer and the active game bridge. `/game` is ticket-authenticated and
  separate from the phone `/ws` channel.
- The phone never receives game state — only a declarative `ControllerUI`.
- Player identity is the reconnect token, never the socket.
- Never call `pnpm license-check` optional: cartridges need a `manifest.json` and an
  `ASSETS.md` listing `- path | license | source URL` for every asset.
- Current state: Phases 0–6 plus the desktop game split pilot. Launcher, lobby, QR,
  legacy iframe loader, SDK bridge, controller components, five starter cartridges,
  the `create-game` scaffolder, hardening and installers exist. `games/super-smash-trash`
  is packaged as its own app through `apps/game-shell`; the same executable runs
  standalone with an embedded hub and join screen. It has 20 passives, 13 special
  archetypes, six hazard stages, CC0 audio and a landscape phone gamepad. The other
  four are still legacy web iframes. Next: migrate them, then continue art polish.
- Packaging: `apps/launcher/electron-builder.yml` copies the controller, SDK and
  `games/` to `resources/quackbox/`; the main process switches paths with
  `app.isPackaged`. `apps/launcher/build/after-pack.cjs` also bundles the packaged
  desktop game apps under `resources/quackbox/game-apps/`. Do not add a served asset
  that only exists in the dev tree; game apps need the same controller/SDK/game assets
  in their own package (see `scripts/build-game-app.ts`).
- Phase 5 limits are deliberate: 60 messages/s per phone socket (120 burst, close at
  500 dropped), 180 bridge calls/s (240 burst), 32 KB game-event payloads, and a 10s
  cartridge start timeout. The SDK catches cartridge throws and reports them so the
  lobby can show a crash card. Do not loosen these to make a game work.
- Cartridges import `/sdk/index.js` (built from `packages/sdk`). Keep `defineGame`,
  `ui.*` and `HubContext` compatible. `hub.setUI` takes `"all"`, a player id or
  `{ team }`; the SDK maps that to the wire target and the main process validates it.
- Electron: the platform main owns the hub and lobby window; the lobby talks only
  through `window.quackbox` (preload). The game shell owns its game window and talks
  to its own main through `window.quackboxDesktop`. Validate every IPC argument in
  the receiving main process. Legacy cartridges load in `sandbox="allow-scripts"`
  iframes; desktop games load from a loopback-only asset server in a separate process.

Before finishing: `corepack pnpm check` must pass (`typecheck`, `lint`,
`license-check`).
