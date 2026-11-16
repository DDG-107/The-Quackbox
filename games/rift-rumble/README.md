# Rift Rumble

A platform fighter for 2–8 players: pick a fighter on your phone, then knock the
others off the stage. This is the "actual game" cartridge — character select,
countdown, stocks, shields, two specials per fighter, three rotating stages and a
results screen. All 20 fighters are original characters from invented universes; no
trademarked characters, art or audio are used, so the roster can ship under the
repository's asset rules.

## Flow

1. **Select** — every connected phone gets a 20-fighter grid. A pick locks immediately
   and shows on the TV. When everyone has picked (or the host presses **Start match**),
   a 4-second countdown begins.
2. **Fight** — 3 stocks, 90 seconds, last fighter standing wins. Damage raises
   knockback; the stage edges are open, so a hard hit near the edge is a stock.
3. **Results** — standings with stocks and KOs, then back to fighter select after
   9 seconds or immediately with **Rematch**.

Players who join mid-match spectate and are dealt in at the next select.

## Phone controls

| Control | Action |
|---|---|
| Joystick | Run (30Hz axis) |
| ATTACK | Melee arc in the facing direction |
| SP 1 / SP 2 | That fighter's two specials |
| JUMP | Jump; most fighters get at least one air jump |
| GUARD | Hold to reduce damage and knockback; the shield recharges |

Specials come from a small move vocabulary — bolt, beam, wave, dash, burst, trap,
teleport and heal — with per-fighter damage, knockback and cooldowns. Each of the 20
fighters has distinct speed, jump, weight, air jumps, shield size, reach and special
pairing, so the roster plays differently without 40 bespoke ability scripts.

## Implementation notes

- Fixed 60Hz accumulator loop; the renderer is `requestAnimationFrame` and the phone
  never receives game state. See `games/rumble-arena/README.md` for the same pattern
  in a smaller cartridge.
- The stage list is data in `roster.js`; adding a stage is one object with platform
  rectangles and a palette.
- `onStart` opens select even with zero players, so phones can join and pick before
  the host starts.
- The round clock pauses if the host window is minimized, and rejoining keeps a
  fighter and their stocks.

## Extending it

- **More fighters**: add an object to `ROSTER` with stats, an attack and two
  specials. The select grid is generated from the array, so a 21st fighter would need
  a second page on the phone (the choice component caps at 24).
- **New specials**: add a `type` branch in `useSpecial` and a cooldown/damage entry in
  the character data.
- **Sprites and audio**: put files in `assets/` and list each one in `ASSETS.md`;
  `pnpm license-check` requires a license and source URL per file.
- Avoid adding trademarked characters or copied art; that is a hard rule in
  `AGENTS.md`, independent of how the roster is themed.
