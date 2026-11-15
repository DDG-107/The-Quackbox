# Cartridges

A cartridge is one folder here. The launcher scans `games/*/manifest.json`, shows a
card for each one, and loads `host/index.html` in a sandboxed iframe served from
`/games/<id>/`. Nothing else in the repo needs to change to add a game.

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
`ui.choice`, `ui.joystick`, `ui.drawpad`, `ui.waiting`, `ui.label` or `ui.stack`.

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
