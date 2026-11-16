# CLAUDE.md

Read `AGENTS.md` in this repo first — it is the single source of truth for
architecture, commands and rules. This file only repeats the parts that are easy
to get wrong.

- Package manager: pnpm via Corepack. Use `corepack pnpm ...` if `pnpm` is missing.
- TypeScript everywhere, strict, source-exported `@quackbox/protocol`, `.js`
  extensions in relative imports, `import type` for type-only imports.
- Wire format: zod schemas in `packages/protocol/src/`. Validate every inbound
  message. Bump `PROTOCOL_VERSION` only for breaking changes.
- Sockets exist only in `apps/launcher/src/server/hub.ts`; rooms own player slots,
  tokens, UI replay and the grace timer.
- The phone never receives game state — only a declarative `ControllerUI`.
- Player identity is the reconnect token, never the socket.
- Never call `pnpm license-check` optional: cartridges need a `manifest.json` and an
  `ASSETS.md` listing `- path | license | source URL` for every asset.
- Current state: Phases 0–6. Launcher, lobby, QR, cartridge loader, SDK bridge,
  controller components, four starter cartridges, the `create-game` scaffolder, the
  Phase 5 hardening and the Phase 6 installer/CI setup exist. Next: bigger real-time
  cartridges; `games/rumble-arena` is the reference (fixed 60Hz loop, canvas, no game
  state on phones).
- Packaging: `apps/launcher/electron-builder.yml` copies the controller, SDK and
  `games/` to `resources/quackbox/`; the main process switches paths with
  `app.isPackaged`. Do not add a served asset that only exists in the dev tree.
- Phase 5 limits are deliberate: 60 messages/s per phone socket (120 burst, close at
  500 dropped), 180 bridge calls/s (240 burst), 32 KB game-event payloads, and a 10s
  cartridge start timeout. The SDK catches cartridge throws and reports them so the
  lobby can show a crash card. Do not loosen these to make a game work.
- Cartridges import `/sdk/index.js` (built from `packages/sdk`). Keep `defineGame`,
  `ui.*` and `HubContext` compatible. `hub.setUI` takes `"all"`, a player id or
  `{ team }`; the SDK maps that to the wire target and the main process validates it.
- Electron: main process owns the hub and the window; the lobby is a sandboxed
  renderer that talks only through `window.quackbox` (preload). Validate every IPC
  argument in `ipcMain.handle`. Cartridges load in `sandbox="allow-scripts"` iframes.

Before finishing: `corepack pnpm check` must pass (`typecheck`, `lint`,
`license-check`).
