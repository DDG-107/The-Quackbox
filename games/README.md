# Cartridges

A cartridge is one folder here. The launcher scans `games/*/manifest.json` and shows
a card for each one. A legacy web cartridge loads `host/index.html` in a sandboxed
iframe served from `/games/<id>/`; a `runtime: "desktop"` game is packaged with
`apps/game-shell` and launched as its own application window. Nothing else in the
repo needs to change to add a game.

```
games/my-game/
├─ manifest.json      # the contract (see packages/protocol/src/manifest.ts)
├─ host/index.html    # the big-screen page
├─ host/main.ts
├─ controller/        # optional custom controller page
├─ assets/            # every file must be listed in ASSETS.md
└─ ASSETS.md          # license + source for every asset
```

Folders that start with `_` (for example `_template`) are ignored by discovery and
by `license-check`.

## Starter games

| Cartridge | Shows off |
|---|---|
| `tap-race` | buttons at 100 players, a top-ten board instead of 100 avatars |
| `draw-and-vote` | drawpad, gallery, choice voting, `hub.end(results)` |
| `tug-of-war` | crowd-as-one-actor input, teams, a shared rope |
| `rumble-arena` | real-time canvas brawler: fixed 60Hz loop, joystick + buttons, 2–8 players |
| `super-smash-trash` | desktop platform fighter: 20 passives, landscape gamepad, CPUs, up to 10 fighters and six pure-platform stages |
| `_template` | the smallest working cartridge; copied by `pnpm create-game` |

## Using the SDK

The hub serves the cartridge API at `/sdk/index.js`, so a host page needs no build step:

```html
<script type="module">
  import { defineGame, ui } from "/sdk/index.js";

  defineGame({
    onStart(hub) {
      hub.setUI("all", ui.buttons([{ id: "tap", label: "TAP!" }]));
    },
    onInput(player, input) {
      if (input.k === "press") hub.log(player.name, "tapped");
    },
  });
</script>
```

Lifecycle hooks: `onStart`, `onPlayerJoin`, `onPlayerLeave`, `onPlayerRejoin`,
`onPlayerRemoved`, `onInput`, `onStop`. Screens are built with `ui.buttons`, `ui.text`,
`ui.choice`, `ui.gamepad`, `ui.joystick`, `ui.drawpad`, `ui.waiting`, `ui.label` or
`ui.stack`. `ui.gamepad` asks the phone for a landscape console pad (two sticks, XYAB,
shoulders); its axes and buttons arrive through the same `onInput` events.

## Desktop games

A game becomes a standalone application by setting `runtime` and the executable name
in its manifest:

```json
"runtime": "desktop",
"app": { "executable": "MyGame" }
```

`apps/game-shell` supplies the window, sandboxed preload bridge, game-link connection
and standalone QR join screen. Package one game with:

```bash
corepack pnpm build:game my-game
corepack pnpm dist:game            # installer; add the id for another game
```

The app is written to `release/game-apps/<id>/`. It runs standalone with no arguments
(embedded hub + join screen) or receives the platform's hub URL and ticket when
launched from QuackBox. The game code keeps using `defineGame` and `ui.*` unchanged.
The platform currently bundles only Super Smash Trash; see `README.md` for the discovery
path and `apps/game-shell/README.md` for the shell internals.

## ASSETS.md

One line per asset, pipe separated:

```
- assets/thumb.png | CC0-1.0 | https://kenney.nl/assets/ui-pack
- assets/honk.ogg  | CC0-1.0 | https://freesound.org/s/123456/
```

`corepack pnpm license-check` fails if any file under `assets/` (or the manifest
thumbnail) is missing from that list, if the file does not exist, or if the license
is not one of CC0, CC-BY, OFL, MIT, Apache-2.0 or public domain.

See `CONTRIBUTING.md` for the rules about public-domain works, audio and fonts.
