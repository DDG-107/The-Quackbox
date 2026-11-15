# Template cartridge

Copy this folder (or run `corepack pnpm create-game my-game`) and change:

1. `manifest.json` — `id` must match the folder name, then set `name`, `players`
   and the `controllers` your game sends.
2. `host/index.html` and `host/style.css` — the big screen.
3. `host/main.js` — the game itself. `defineGame` gives you `onStart`, the player
   lifecycle hooks and `onInput`; `hub.setUI` decides what the phones show.
4. `ASSETS.md` — list every file you add under `assets/` as
   `- path | license | source URL`. `corepack pnpm license-check` enforces it.

The page loads `/sdk/index.js` from the hub, so there is nothing to install or build.
`corepack pnpm dev`, pick the cartridge in the lobby, then join from a phone.
