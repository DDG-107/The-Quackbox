# @quackbox/game-shell

The reusable desktop application around one game. Super Smash Trash is the pilot: its build
packages this shell with the game's assets, SDK and phone controller under its own
product name and executable.

## Modes

**Platform mode** — QuackBox starts the executable with:

```
--quackbox-hub=http://127.0.0.1:<port>
--quackbox-ticket=<one-use ticket>
--quackbox-game=<id>
--quackbox-fullscreen
```

The shell opens the game window, loads the game from a loopback-only asset server,
connects to the hub at `/game`, sends `quackbox:hello`, and relays the SDK messages.
The SDK's `quackbox:ready` message is the second half of the handshake; the hub sends
`quackbox:init` only after it arrives, so a slow-loading game cannot miss the first
message. If either half does not arrive within 10 seconds, the session closes.
The platform owns the room and phones. Closing the window or losing the link exits the
app, and QuackBox restores the library.

**Standalone mode** — no hub/ticket arguments. The shell starts an embedded hub, serves
the phone controller, shows a QR/room screen, and creates its own game ticket when the
host presses Start. From then on the path is identical. Packaged builds find their game
under `resources/quackbox/games/`; in development pass `--quackbox-game=<id>` (and
`--quackbox-windowed` for a desktop-sized window).

## Boundaries

- The game renderer is sandboxed and sees only `window.quackboxDesktop` (send/receive).
  It never gets a phone socket, the ticket, or filesystem access.
- The shell main validates every renderer message against
  `gameClientMessageSchema` before sending it on. The hub validates the same messages
  again in `GameLink`; neither side trusts the other.
- Game assets are served only on `127.0.0.1` with a random port. The public LAN origin
  belongs to the platform hub, not to the game window.
- The game window disables background throttling and Chromium occlusion pauses so a
  TV host switching windows does not stop the simulation.

## Packaging

`scripts/build-game-app.ts` (run as `pnpm build:game [id]`) generates an
electron-builder config for the game, copies the game folder, SDK and controller into
`resources/quackbox/`, and writes the app to `release/game-apps/<id>/`. The launcher's
`afterPack` hook bundles every built desktop game app into the platform installer.
