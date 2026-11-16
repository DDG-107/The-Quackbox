# Super Smash Trash

A trash-themed platform fighter for 1–10 fighters. Pick a dumpster legend on your
phone, add CPUs on the TV, then knock the recycling out of everyone else. The game
has 20 original fighters plus four guest fighters animated from their own
spritesheets, thirteen special archetypes, passive abilities, six pure platform
stages, stocks, shields, results and its own desktop shell.

The dumpster fighters are drawn procedurally by the host. The stage backdrops, junk
icons, font and sound effects are licensed works credited in `ASSETS.md`. The guest
fighters are personal-use sprite rips kept in `private-art/` — they are **unlicensed
and must not be redistributed**; see `ASSETS.md` for their credits.

## Running it

Super Smash Trash is a desktop game, not an iframe cartridge. In development, launch
it from the QuackBox lobby; the platform spawns `apps/game-shell` with this game's
assets and a one-use game ticket. For the standalone experience, build and launch the
packaged app:

```bash
corepack pnpm build
corepack pnpm build:game
release/game-apps/super-smash-trash/win-unpacked/SuperSmashTrash.exe
```

The standalone app starts its own hub, shows a QR/room screen, then opens the game.
The same executable launched from QuackBox uses the lobby's players instead. Build an
installer with `corepack pnpm dist:game`.

## Flow

1. **Select** — every connected phone gets the 25-fighter grid with each fighter's
   role and passive. A pick locks immediately and shows on the TV. Add any number of
   CPUs from the host controls; human fighters plus CPUs are capped at 10.
2. **Stage select** — the TV shows six platform layouts. Click a card, then press
   **Start fight**. Every stage has open edges and no stage hazards. The last pick is
   remembered for the next match.
3. **Countdown and fight** — 3 stocks, 90 seconds. Damage raises knockback, and the
   only way out is over the edge. A KO respawns the fighter on a temporary platform
   with **5 seconds of invulnerability**.
4. **Results** — standings with stocks and KOs, then back to fighter select after
   9 seconds or immediately with **Rematch**.

Players who join mid-match spectate and are dealt in at the next select. A player who
reconnects with their token keeps the fighter they were already playing.

**Esc** (or the **Quit** button, twice within four seconds) leaves the game from any
phase — select, countdown, fight or results — and returns to the lobby.

## The landscape phone gamepad

The battle screen asks for `orientation: "landscape"` and sends a `gamepad`
component. In portrait, the phone shows a rotate prompt; in landscape it fills the
screen with a console layout:

| Control | Action |
|---|---|
| Left stick | Run |
| Right stick | Aim projectiles and lobbed bombs |
| X | Melee attack in the facing direction |
| Y | Special 1 |
| B | Special 2 |
| A | Jump; most fighters get at least one air jump |
| L shoulder | Guard: hold to reduce damage and knockback |
| R shoulder | Drop through the platform you are standing on |

Gamepads still send ordinary axis, press and release inputs, so the host simulation
does not know anything about the phone's layout. The TV never receives phone state.

## Passive abilities

Every fighter has a one-line passive that changes how they play:

- **Armor** — 15% less knockback (Baron von Bag, Rust Bucket, Forklift Felix)
- **Bulwark** — shields recharge 60% faster (Sir Cansalot)
- **Regen** — heals while untouched for four seconds (Moldy Mike, Compost Carl)
- **Thorns** — reflects 15% of damage taken (Toxic Tina, Landfill Queen)
- **Float** — lower gravity and fall speed (Static Cling, Mothball)
- **Oil** — dashes leave a burning grease slick (Grease Trap)
- **Glass** — takes 12% more damage, deals 10% more (Captain Cardboard, Cracked Cup)
- **Vampire** — heals a little on every hit (Dumpster Diva, The Great Garbagio)
- **Rush** — movement speed rises with damage (Soggy Fry, Scrappy)
- **Spring** — 12% higher jumps (Neon Noodle)
- **Fuse** — shield breaks explode around the fighter (Bubble Wrap)
- **Scavenger** — KOs restore health and shield (Recycling Ranger)

## Move vocabulary

The fighters combine a small set of readable mechanics instead of 40 bespoke scripts:

`bolt`, `beam`, `wave`, `boomerang`, `dash`, `burst`, `trap`, `bomb`, `counter`,
`pull`, `slam`, `teleport` and `heal`.

Specials have per-fighter damage, knockback and cooldowns. The right stick aims
projectiles in eight directions, which makes zoners like Recycling Ranger and Cracked
Cup play differently from rushdown fighters like Scrappy and Soggy Fry.

## Guest fighters

Four fighters are animated from spritesheets instead of the procedural shapes. Their
sheets are sliced offline into one 64px-cell atlas per fighter. `private-art/` is
gitignored, because those sheets are unlicensed: a clone without it still plays, with
those four fighters drawn as procedural shapes instead of sprites.

| Fighter | Atlas | Sheet | Moves taken from the sheet |
|---|---|---|---|
| The Hooded Blade | `green-hood` | Link rip | sword reach, boomerang, spin slash |
| The Lean Green | `green-brother` | Luigi rip | high floaty jump, fireball, cyclone pull |
| The Caped Crusader | `caped-crusader` | Batman (SNES) rip | batarang boomerang, grapple teleport, cape glide |
| The Pale Reaper | `pale-reaper` | hooded reaper rip | wide scythe sweep, harvest burst, shadow step |

Southpaw is still drawn procedurally: its sheet puts every figure on a light blue card
that touches its neighbours and shares colours with the fighter's own clothing, so an
automatic cut either keeps the whole card lattice or punches holes in the sprite. The
sheet and its slicer settings are kept in `private-art/source/brawler.png` and
`scripts/fighter-sheets.json` for a future manual re-cut.

The host treats them like any other fighter: the simulation only knows stats, a
passive, one attack and two specials. `main.js` picks a clip from the fighter's state
(`idle`, `run`, `jump`, `fall`, `attack`, `special`, `hurt`, `ko`), advances it at that
clip's frame rate and draws the cell with the feet on the collision circle.

To add another sheet, copy it into `private-art/source/`, describe it in
`scripts/fighter-sheets.json` and run:

```bash
node scripts/slice-sprites.mjs annotate <sheet-key>   # numbered frames, in place
node scripts/slice-sprites.mjs build                  # atlases + host/sprites.js
```

`annotate` and `inspect` write their images to `.work/sprites/`; the build only needs
ffmpeg, no image library. Frame lists in the config are detection order (rows top to
bottom, each row left to right) as printed on those images.

## Stages

| Stage | Layout |
|---|---|
| Garbage Falls | Wide main stage, two side ledges, one top platform |
| Sorting Line | Three clean tiers with open edges |
| Toxic Marsh | Tight main stage with high escape ledges |
| Neon Junkyard | Two side ledges and a high top platform |
| The Compactor | Stacked platforms and a long drop |
| Landfill Summit | High summit platforms, no wind |

Stage geometry is data in `roster.js`. Every stage is a pure platform layout: no
hazards, no conveyors, no floor underneath. Choose the stage before each fight.

## Implementation notes

- Fixed 60Hz accumulator loop; the renderer is `requestAnimationFrame` and the phone
  never receives game state.
- The host owns projectiles, passives, CPUs and stage time. Pausing due to visibility
  or a minimized window pauses the round clock and stage clock.
- CPUs are host-side synthetic fighters. They never enter the hub roster; the phone
  UI is sent only to human players.
- `onStart` opens select even with zero players, so phones can join and pick before
  the host starts.
- Rejoining keeps a fighter, its stocks and its controls. A dropped phone's fighter is
  handed to the bot brain for the room's grace period, so it keeps fighting instead of
  standing still until it is knocked out; the player takes it back on reconnect.
  Mid-match joiners spectate until the next select.
- The game window keeps rendering when it loses focus (`backgroundThrottling: false`),
  because a TV host may be using another window while the match runs.
- Standalone mode uses the same `/game` ticket and SDK transport as a QuackBox launch;
  only the hub owner differs.

## Extending it

- **More fighters**: add an object to `ROSTER` with stats, a passive, an attack and two
  specials. The select grid is generated from the array. Add `sprite: "<atlas-id>"` to
  draw the fighter from an atlas in `host/sprites.js`, or leave it out for procedural
  art.
- **New passives**: add a branch where damage, movement or shield recharge is applied
  in `main.js`, then give it a label in the roster.
- **New specials**: add a `type` branch in `useSpecial` and a cooldown/damage entry in
  the character data.
- **New stages**: add a stage object with a `main` platform and open edges. Keep the
  main platform reachable from the side ledges and avoid full-width floors.
- **Audio**: replace files in `assets/audio` and update `ASSETS.md`; `pnpm
  license-check` requires a license and source URL per file.
- Avoid adding trademarked characters or copied art; that is a hard rule in
  `AGENTS.md`, independent of how the roster is themed.
