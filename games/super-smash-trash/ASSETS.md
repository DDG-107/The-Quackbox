# Asset licenses

All assets are used under the license listed below. Backgrounds were cropped,
resized and color-graded at runtime; junk icons are drawn from the original sheet.

## Audio

- assets/audio/hit.ogg | CC0-1.0 | https://opengameart.org/content/rpg-sound-effect-pack
- assets/audio/hurt.ogg | CC0-1.0 | https://opengameart.org/content/rpg-sound-effect-pack
- assets/audio/swing.ogg | CC0-1.0 | https://opengameart.org/content/rpg-sound-effect-pack
- assets/audio/ko.ogg | CC0-1.0 | https://opengameart.org/content/rpg-sound-effect-pack
- assets/audio/jump.wav | CC0-1.0 | https://opengameart.org/content/8-bit-sound-effect-pack-vol-001
- assets/audio/select.wav | CC0-1.0 | https://opengameart.org/content/8-bit-sound-effect-pack-vol-001

## Art

- assets/art/stage-plant.jpg | CC-BY-3.0 | https://opengameart.org/content/industrial-background-2d
- assets/art/stage-city.png | CC-BY-3.0 | https://opengameart.org/content/backgrounds-for-2d-platformers
- assets/art/stage-peaks.jpg | CC-BY-3.0 | https://opengameart.org/content/backgrounds-for-2d-platformers
- assets/art/stage-marsh.png | public domain | https://opengameart.org/content/gotthicvania-swamp
- assets/art/stage-facade.jpg | CC0-1.0 | https://opengameart.org/content/abandon-city-seamless-background
- assets/art/junk-items.png | CC-BY-4.0 | https://opengameart.org/content/recycle-items-set

## Fonts

- assets/fonts/Bungee-Regular.woff2 | OFL-1.1 | https://github.com/google/fonts/blob/main/ofl/bungee/Bungee-Regular.ttf
- assets/fonts/OFL.txt | OFL-1.1 | https://github.com/google/fonts/blob/main/ofl/bungee/OFL.txt

## Guest fighter sprites (personal use only)

These files are **not** covered by any of the licenses above. They are fan rips the
project owner supplied for a private, non-distributed build, kept out of `assets/` so
the licensed asset guardrail stays meaningful. Credits are reproduced as they appear
on the sheets; where the sheet carried no credit, that is stated.

- private-art/source/link.png — Link sprite sheet, credited on the sheet to GoLDuStUd
- private-art/source/luigi.png — Luigi sprite sheet, artist unknown (sheet credit not legible)
- private-art/source/batman.png — "Batman from The Adventures of Batman & Robin (SNES)", ripped by Ultimecia
- private-art/source/reaper.png — hooded reaper sprite sheet, artist unknown
- private-art/source/brawler.png — portrait-and-sprite brawler sheet, artist unknown (not cut yet: its cards merge with the sprite)
- private-art/source/seymour-battle.png — "Character Select and Overworld" sheet, artist unknown (not used yet)
- private-art/fighters/green-hood.png — atlas sliced from link.png
- private-art/fighters/green-brother.png — atlas sliced from luigi.png
- private-art/fighters/caped-crusader.png — atlas sliced from batman.png
- private-art/fighters/pale-reaper.png — atlas sliced from reaper.png

You can regenerate the atlases with `node scripts/slice-sprites.mjs build` (needs
ffmpeg); `inspect` and `annotate` print the frame views used to pick each animation.

## Credits

- Industrial background by Alucard (CC-BY 3.0).
- City and mountain backdrops by Zeyu Ren 任泽宇 (CC-BY 3.0).
- Gothicvania Swamp background by Luis Zuno / ansimuz (public domain).
- Abandoned city wall by acasas (CC0 1.0).
- Recycle item icons by Clint Bellanger (CC-BY 4.0).
- Bungee typeface by David Jonathan Ross (SIL Open Font License 1.1).

The dumpster fighters, stages, emblems and effects are original procedural art drawn
by the game code. The five guest fighters are the exception: they are sprite rips the
owner supplied for personal play, they are unlicensed, and they live in `private-art/`
precisely because they cannot be shipped under any of the licenses above.
