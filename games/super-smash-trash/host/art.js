// OpenGameArt backgrounds and junk props. Keeping this table separate from the
// simulation makes it easy to swap art without touching the fight rules.
import { FIGHTER_SPRITES } from "./sprites.js";

const assetRoot = new URL("../assets/", import.meta.url);
const backgroundUrl = (name) => new URL(`art/${name}`, assetRoot).href;

const SOURCES = {
  plant: backgroundUrl("stage-plant.jpg"),
  city: backgroundUrl("stage-city.png"),
  marsh: backgroundUrl("stage-marsh.png"),
  peaks: backgroundUrl("stage-peaks.jpg"),
  facade: backgroundUrl("stage-facade.jpg"),
  junk: backgroundUrl("junk-items.png"),
};

export const ART = {};
for (const [name, source] of Object.entries(SOURCES)) {
  const image = new Image();
  image.decoding = "async";
  image.src = source;
  ART[name] = image;
}

// Sprite fighters: one atlas per character, sliced from its source sheet by
// scripts/slice-sprites.mjs. Characters without an entry fall back to the
// procedural shapes in main.js.
// The sheets these atlases come from are personal-use rips, so they live in
// private-art/ rather than in the licensed assets tree described by ASSETS.md.
export const FIGHTER_ART = {};
for (const [id, sprite] of Object.entries(FIGHTER_SPRITES)) {
  const image = new Image();
  image.decoding = "async";
  image.src = new URL(`../private-art/fighters/${sprite.atlas}`, import.meta.url).href;
  FIGHTER_ART[id] = { ...sprite, image };
}

// The recycle-items sheet is 515x64 with 16 tightly packed objects.
export const JUNK_ICONS = [
  { x: 2, w: 15 },
  { x: 19, w: 39 },
  { x: 60, w: 36 },
  { x: 98, w: 51 },
  { x: 151, w: 53 },
  { x: 206, w: 35 },
  { x: 243, w: 17 },
  { x: 262, w: 23 },
  { x: 287, w: 16 },
  { x: 305, w: 23 },
  { x: 330, w: 21 },
  { x: 353, w: 18 },
  { x: 373, w: 28 },
  { x: 403, w: 60 },
  { x: 465, w: 29 },
  { x: 496, w: 17 },
];

export const STAGE_LOOKS = {
  "garbage-falls": {
    image: "plant",
    tint: "rgba(4, 10, 19, 0.58)",
    glow: "rgba(255, 178, 62, 0.15)",
    drift: 10,
    props: [
      { icon: 3, x: 34, y: 470, size: 56, alpha: 0.74, rot: -0.06 },
      { icon: 5, x: 122, y: 474, size: 38, alpha: 0.62, rot: 0.12 },
      { icon: 10, x: 842, y: 474, size: 44, alpha: 0.74, rot: 0.08 },
      { icon: 13, x: 926, y: 476, size: 62, alpha: 0.66, rot: -0.1 },
      { icon: 4, x: 280, y: 352, size: 20, alpha: 0.28, rot: 0.22 },
      { icon: 0, x: 708, y: 320, size: 18, alpha: 0.2, rot: -0.3 },
    ],
  },
  "sorting-line": {
    image: "plant",
    tint: "rgba(3, 22, 25, 0.56)",
    glow: "rgba(124, 255, 178, 0.16)",
    drift: 14,
    flip: true,
    props: [
      { icon: 2, x: 45, y: 474, size: 42, alpha: 0.66, rot: 0.06 },
      { icon: 9, x: 123, y: 476, size: 34, alpha: 0.6, rot: -0.12 },
      { icon: 11, x: 845, y: 474, size: 36, alpha: 0.68, rot: 0.16 },
      { icon: 1, x: 918, y: 476, size: 56, alpha: 0.58, rot: -0.08 },
      { icon: 7, x: 244, y: 332, size: 24, alpha: 0.24, rot: 0.18 },
      { icon: 8, x: 738, y: 310, size: 22, alpha: 0.22, rot: -0.16 },
    ],
  },
  "toxic-marsh": {
    image: "marsh",
    tint: "rgba(4, 16, 8, 0.55)",
    glow: "rgba(156, 255, 103, 0.18)",
    drift: 7,
    props: [
      { icon: 6, x: 36, y: 476, size: 44, alpha: 0.62, rot: 0.1 },
      { icon: 12, x: 106, y: 478, size: 30, alpha: 0.6, rot: -0.14 },
      { icon: 13, x: 854, y: 478, size: 54, alpha: 0.56, rot: 0.08 },
      { icon: 15, x: 926, y: 476, size: 32, alpha: 0.54, rot: -0.2 },
      { icon: 4, x: 310, y: 330, size: 22, alpha: 0.22, rot: 0.1 },
    ],
  },
  "neon-junkyard": {
    image: "city",
    tint: "rgba(19, 5, 28, 0.48)",
    glow: "rgba(255, 93, 210, 0.22)",
    drift: 12,
    props: [
      { icon: 14, x: 34, y: 474, size: 38, alpha: 0.7, rot: -0.08 },
      { icon: 10, x: 100, y: 476, size: 32, alpha: 0.66, rot: 0.2 },
      { icon: 7, x: 858, y: 476, size: 38, alpha: 0.64, rot: -0.16 },
      { icon: 3, x: 924, y: 478, size: 54, alpha: 0.58, rot: 0.1 },
      { icon: 11, x: 206, y: 326, size: 18, alpha: 0.25, rot: 0.18 },
      { icon: 0, x: 770, y: 292, size: 16, alpha: 0.24, rot: -0.3 },
    ],
  },
  compactor: {
    image: "facade",
    tint: "rgba(30, 12, 7, 0.54)",
    glow: "rgba(255, 146, 77, 0.18)",
    drift: 5,
    props: [
      { icon: 3, x: 42, y: 476, size: 54, alpha: 0.64, rot: -0.12 },
      { icon: 5, x: 122, y: 474, size: 36, alpha: 0.58, rot: 0.14 },
      { icon: 13, x: 854, y: 478, size: 58, alpha: 0.62, rot: 0.06 },
      { icon: 9, x: 928, y: 474, size: 32, alpha: 0.56, rot: -0.18 },
    ],
  },
  "landfill-summit": {
    image: "peaks",
    tint: "rgba(31, 17, 6, 0.54)",
    glow: "rgba(255, 192, 85, 0.28)",
    drift: 9,
    props: [
      { icon: 1, x: 36, y: 474, size: 48, alpha: 0.62, rot: 0.08 },
      { icon: 8, x: 112, y: 478, size: 28, alpha: 0.56, rot: -0.1 },
      { icon: 15, x: 850, y: 476, size: 32, alpha: 0.58, rot: 0.2 },
      { icon: 4, x: 922, y: 478, size: 54, alpha: 0.54, rot: -0.08 },
      { icon: 2, x: 220, y: 318, size: 20, alpha: 0.2, rot: 0.16 },
    ],
  },
};

export const DEFAULT_STAGE_LOOK = STAGE_LOOKS["garbage-falls"];

// Start the font request once; canvas redraws continuously, so the display
// face appears as soon as the WOFF2 is available.
if (typeof document !== "undefined" && document.fonts) {
  void document.fonts.load('400 48px "Bungee"').catch(() => undefined);
}
