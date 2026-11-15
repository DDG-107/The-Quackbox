# Contributing

## Setup

```bash
corepack pnpm install
corepack pnpm check       # typecheck + lint + license-check
corepack pnpm dev:hub     # hub on :4321
```

Phones must be on the same Wi-Fi as the host. If a phone cannot connect, the cause
is almost always the network, not the code: guest networks and "AP isolation" block
device-to-device traffic, and the OS firewall prompt on first run has to be allowed.

## Code conventions

- TypeScript, strict mode, no `any` at boundaries — parse with zod instead.
- Relative imports carry `.js` extensions; type-only imports use `import type`.
- The protocol is the contract: change `packages/protocol/src/` first, then the hub,
  then the controller.
- Keep the phone's job small: it renders a `ControllerUI` descriptor and sends
  throttled input. Anything else belongs on the host.
- Analog input is capped at 10–20Hz, buttons are event-only, and nothing is sent
  while idle. A 100-player room has to stay smooth.
- Run `corepack pnpm check` before opening a pull request.

## Licensing guardrails

These are enforced by `corepack pnpm license-check` and by review.

- **Public domain does not mean any version.** Use the original text/art, not modern
  adaptations or designs. Universal's Dracula look and later Sherlock film/TV
  designs are not public domain.
- **1920s cartoons:** only the specific works and versions that are actually public
  domain in the US (published before 1931 as of 2026). Do not use later redesigns
  of those characters.
- **Audio:** prefer CC0 (Kenney, Freesound CC0, OpenGameArt CC0) or your own. Old
  recordings and compositions carry separate rights — verify both.
- **Fonts:** OFL only.
- **Trademarks are separate from copyright.** Avoid "Jackbox" and other brand terms
  in the project name, UI and marketing.
- Every cartridge ships `manifest.json`; every asset is listed in `ASSETS.md` as
  `- path | license | source URL`. Missing entries fail the build.

## Submitting a cartridge

- [ ] `games/<id>/manifest.json` validates, and `id` matches the folder name
- [ ] `players.min` / `players.max` reflect what the game actually handles
- [ ] `reconnect` policy chosen (`resume`, `skip`, `drop`) and late join decided
- [ ] `ASSETS.md` lists every asset with license and source URL
- [ ] No trademarked names, characters or logos
- [ ] Tested with 3 phones and with 10 simulated clients (`corepack pnpm sim`)
- [ ] Playing a round twice in a row leaves no stale state
