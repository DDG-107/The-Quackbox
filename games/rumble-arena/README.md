# Rumble Arena

A real-time, physics-driven brawler for 2–8 players. Everyone gets three stocks;
knock the others off the stage and be the last one standing before the 60-second
clock runs out. This is the reference cartridge for bigger games: a fixed 60 Hz
host loop, canvas rendering, and no simulation state on the phones.

Phone controls: joystick to move, **JUMP**, **PUNCH**. Touch targets are large and
the punch button has a 320ms controller-side cooldown.

## How it works

- `main.js` accumulates `requestAnimationFrame` deltas and runs up to five fixed
  `1/60`s steps per frame, so knockback and platform landings do not depend on the
  TV's frame rate.
- The phone sends only `{ k: "axis", id: "move" }` at 30Hz and press events for
  jump and punch. The hub's per-socket limit (60 messages/s) leaves room for eight
  players on one hub.
- Damage raises knockback, exactly like the party fighters this borrows from:
  `power = 210 + damage * 3.4`. A fighter at 100% flies much further.
- Platforms are one-way (you can jump up through them), the stage edges are open,
  and a fall costs a stock. Rejoining keeps the same fighter and stocks.
- Minimizing the host window pauses the loop and the round clock, so restoring the
  TV does not end the round in the background.
- Everything is drawn with canvas primitives — no image or audio assets — so the
  cartridge needs no `ASSETS.md`.

## Extending it

- **Sprites and sound** go in `assets/`; serve them from `/games/rumble-arena/assets/…`
  and list every file in `ASSETS.md` (CC0, CC-BY, OFL, MIT, Apache-2.0 or public
  domain only). `corepack pnpm license-check` enforces it.
- **More moves** need a button in `CONTROLS` and a branch in `onInput`; the
  controller renders any button without a new component.
- **A sports game** (football, hockey) uses the same skeleton: keep the fixed-step
  loop, replace the fighter physics with a ball body and goal checks, and reuse the
  joystick plus two-button controller. The phone never needs to know the rules.
- **Keep the phone budget**: 20–30Hz analog input per phone. Do not stream game
  state to phones; they are controllers, not second screens.
