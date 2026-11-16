#!/usr/bin/env node
/**
 * Turns the raw fighter spritesheets in assets/sprites/source into the game's
 * per-fighter atlases.
 *
 *   node scripts/slice-sprites.mjs inspect [sheet]   contact sheets to pick frames
 *   node scripts/slice-sprites.mjs build             atlases + host/sprites.js
 *
 * ffmpeg decodes and encodes the images; background keying, frame detection and
 * packing happen here so the result is reproducible without an image library.
 * Frame indices used by the config are the detection order: rows top to bottom,
 * each row left to right (the numbers printed on the contact sheets).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = join(root, "scripts", "fighter-sheets.json");
const workDir = join(root, ".work", "sprites");

/** PNG framing: IHDR width/height live at bytes 16..23. */
function pngSize(file) {
  const header = readFileSync(file).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function decode(file) {
  const { width, height } = pngSize(file);
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg could not decode ${file}: ${result.stderr?.toString() ?? ""}`);
  }
  return { width, height, data: result.stdout };
}

function encode(image, file) {
  mkdirSync(join(file, ".."), { recursive: true });
  const result = spawnSync(
    "ffmpeg",
    [
      "-v", "error", "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${image.width}x${image.height}`,
      "-i", "-",
      "-pix_fmt", "rgba",
      file,
    ],
    { input: Buffer.from(image.data) },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg could not encode ${file}: ${result.stderr?.toString() ?? ""}`);
  }
}

const at = (image, x, y) => (y * image.width + x) * 4;

function colorDistance(data, offset, color) {
  const dr = data[offset] - color[0];
  const dg = data[offset + 1] - color[1];
  const db = data[offset + 2] - color[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Most common border colour, i.e. the flat colour the sheet was exported on. */
function borderColor(image) {
  const counts = new Map();
  const add = (x, y) => {
    const offset = at(image, x, y);
    if (image.data[offset + 3] < 8) return;
    const key = (image.data[offset] >> 2) << 12 | (image.data[offset + 1] >> 2) << 6 | (image.data[offset + 2] >> 2);
    const entry = counts.get(key) ?? { count: 0, color: [0, 0, 0] };
    entry.count += 1;
    entry.color = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    counts.set(key, entry);
  };
  for (let x = 0; x < image.width; x += 1) {
    add(x, 0);
    add(x, image.height - 1);
  }
  for (let y = 0; y < image.height; y += 1) {
    add(0, y);
    add(image.width - 1, y);
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  if (ranked.length === 0) {
    // Fully transparent export: any opaque colour is background by construction.
    return [0, 0, 0];
  }
  return ranked[0].color;
}

/**
 * Flood fill from the sheet border: only background connected to the outside is
 * cleared, so white highlights inside a sprite survive a white backdrop.
 * `extra` lists colours that are always background (interior panels).
 */
function backgroundMask(image, sheet) {
  const tolerance = sheet.tolerance ?? 26;
  const panelTolerance = sheet.panelTolerance ?? 10;
  const extra = sheet.panels ?? [];
  const mask = new Uint8Array(image.width * image.height);
  const bg = borderColor(image);
  const isBackground = (x, y) => {
    const offset = at(image, x, y);
    if (image.data[offset + 3] < 8) return true;
    if (colorDistance(image.data, offset, bg) <= tolerance) return true;
    // Cell panels are slightly off the sheet background, so they get their own
    // tighter key: a wide tolerance would punch holes in the sprite shading.
    return extra.some((color) => colorDistance(image.data, offset, color) <= panelTolerance);
  };

  const queue = [];
  const push = (x, y) => {
    const index = y * image.width + x;
    if (mask[index]) return;
    if (!isBackground(x, y)) return;
    mask[index] = 1;
    queue.push(x, y);
  };
  for (let x = 0; x < image.width; x += 1) {
    push(x, 0);
    push(x, image.height - 1);
  }
  for (let y = 0; y < image.height; y += 1) {
    push(0, y);
    push(image.width - 1, y);
  }

  // Interior panels never touch the border, so match them globally instead.
  for (const color of extra) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = at(image, x, y);
        if (colorDistance(image.data, offset, color) <= panelTolerance) mask[y * image.width + x] = 1;
      }
    }
  }

  while (queue.length > 0) {
    const y = queue.pop();
    const x = queue.pop();
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  // Some exports frame every cell in a colour that never touches the border, so
  // the flood finds almost nothing. Fall back to clearing the dominant colour
  // wherever it appears.
  let cleared = 0;
  for (let index = 0; index < mask.length; index += 1) cleared += mask[index];
  if (cleared < image.width * image.height * 0.1) {
    mask.fill(0);
    const dominant = dominantColor(image);
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = at(image, x, y);
        if (image.data[offset + 3] < 8 || colorDistance(image.data, offset, dominant) <= tolerance) {
          mask[y * image.width + x] = 1;
        }
      }
    }
    for (const color of extra) {
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const offset = at(image, x, y);
          if (colorDistance(image.data, offset, color) <= panelTolerance) mask[y * image.width + x] = 1;
        }
      }
    }
  }
  return mask;
}

/** Most common colour over the whole sheet, quantised to survive re-encoding noise. */
function dominantColor(image) {
  const counts = new Map();
  for (let index = 0; index < image.width * image.height; index += 1) {
    if (image.data[index * 4 + 3] < 8) continue;
    const key =
      (image.data[index * 4] >> 2) << 12 |
      (image.data[index * 4 + 1] >> 2) << 6 |
      (image.data[index * 4 + 2] >> 2);
    const entry = counts.get(key) ?? { count: 0, color: [0, 0, 0] };
    entry.count += 1;
    entry.color = [image.data[index * 4], image.data[index * 4 + 1], image.data[index * 4 + 2]];
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.color ?? [0, 0, 0];
}

function components(image, mask, { minPixels, alphaFloor }) {
  const seen = new Uint8Array(image.width * image.height);
  const boxes = [];
  const solid = (x, y) => {
    const index = y * image.width + x;
    return !mask[index] && image.data[index * 4 + 3] >= alphaFloor;
  };

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (seen[y * image.width + x] || !solid(x, y)) continue;
      const box = { x0: x, y0: y, x1: x, y1: y, pixels: 0 };
      const stack = [x, y];
      seen[y * image.width + x] = 1;
      while (stack.length > 0) {
        const cy = stack.pop();
        const cx = stack.pop();
        box.pixels += 1;
        box.x0 = Math.min(box.x0, cx);
        box.y0 = Math.min(box.y0, cy);
        box.x1 = Math.max(box.x1, cx);
        box.y1 = Math.max(box.y1, cy);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
            if (seen[ny * image.width + nx] || !solid(nx, ny)) continue;
            seen[ny * image.width + nx] = 1;
            stack.push(nx, ny);
          }
        }
      }
      if (box.pixels >= minPixels) boxes.push(box);
    }
  }
  return boxes;
}

/** Detached swords, capes and dust are part of one frame: merge touching boxes. */
function mergeBoxes(boxes, gap) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const one = boxes[a];
        const two = boxes[b];
        const nearX = one.x0 - gap <= two.x1 && two.x0 - gap <= one.x1;
        const nearY = one.y0 - gap <= two.y1 && two.y0 - gap <= one.y1;
        if (!nearX || !nearY) continue;
        one.x0 = Math.min(one.x0, two.x0);
        one.y0 = Math.min(one.y0, two.y0);
        one.x1 = Math.max(one.x1, two.x1);
        one.y1 = Math.max(one.y1, two.y1);
        one.pixels += two.pixels;
        boxes.splice(b, 1);
        merged = true;
        b -= 1;
      }
    }
  }
  return boxes;
}

/** Reading order: cluster by vertical centre into rows, then sort each row. */
function readingOrder(boxes) {
  const sorted = [...boxes].sort(
    (a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0,
  );
  const rows = [];
  for (const box of sorted) {
    const centre = (box.y0 + box.y1) / 2;
    const row = rows.find((candidate) => Math.abs(candidate.centre - centre) < (box.y1 - box.y0) * 0.6);
    if (row) {
      row.boxes.push(box);
      row.centre = (row.centre * (row.boxes.length - 1) + centre) / row.boxes.length;
    } else {
      rows.push({ centre, boxes: [box] });
    }
  }
  rows.sort((a, b) => a.centre - b.centre);
  return rows.flatMap((row) => row.boxes.sort((a, b) => a.x0 - b.x0));
}

/** Clear the keyed background in place so every later pass sees real alpha. */
function applyMask(image, mask) {
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) image.data[index * 4 + 3] = 0;
  }
}

/**
 * Panel sheets (a rounded card behind every sprite) defeat connected-component
 * detection: the cards and their labels chain together. Instead the cards are
 * found by colour, and each card becomes one frame.
 */
function detectCells(source, sheet) {
  const image = { width: source.width, height: source.height, data: Buffer.from(source.data) };
  const tolerance = sheet.panelTolerance ?? 10;
  const isPanel = (x, y) => {
    const offset = at(image, x, y);
    if (image.data[offset + 3] < 8) return false;
    return sheet.panelColors.some((color) => colorDistance(image.data, offset, color) <= tolerance);
  };

  // Panels sit on a regular grid, so project the panel colour onto both axes and
  // cut where it is dense. That finds whole cards even when the fill has noise.
  const columnHits = new Uint32Array(image.width);
  const rowHits = new Uint32Array(image.height);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (!isPanel(x, y)) continue;
      columnHits[x] += 1;
      rowHits[y] += 1;
    }
  }
  const runs = (hits, threshold) => {
    const spans = [];
    let start = -1;
    for (let index = 0; index < hits.length; index += 1) {
      if (hits[index] >= threshold) {
        if (start < 0) start = index;
      } else if (start >= 0) {
        spans.push([start, index - 1]);
        start = -1;
      }
    }
    if (start >= 0) spans.push([start, hits.length - 1]);
    return spans.filter(([from, to]) => to - from >= 12);
  };
  const columnSpans = runs(columnHits, Math.max(6, Math.round(image.height * 0.02)));
  const rowSpans = runs(rowHits, Math.max(6, Math.round(image.width * 0.02)));

  const frames = [];
  for (const [y0, y1] of rowSpans) {
    for (const [x0, x1] of columnSpans) {
      const width = x1 - x0 + 1;
      const height = y1 - y0 + 1;
      const cell = { width, height, data: Buffer.alloc(width * height * 4) };
      let panelPixels = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const from = at(image, x0 + x, y0 + y);
          const to = (y * width + x) * 4;
          const panel = isPanel(x0 + x, y0 + y);
          if (panel) panelPixels += 1;
          cell.data[to] = image.data[from];
          cell.data[to + 1] = image.data[from + 1];
          cell.data[to + 2] = image.data[from + 2];
          cell.data[to + 3] = panel ? 0 : image.data[from + 3];
        }
      }
      if (panelPixels < width * height * 0.15) continue;
      const tight = tightBox(cell, sheet.minPixels ?? 12);
      if (!tight) continue;
      frames.push({
        x0: x0 + tight.x0,
        y0: y0 + tight.y0,
        x1: x0 + tight.x1,
        y1: y0 + tight.y1,
        pixels: tight.pixels,
      });
    }
  }
  return { image, keyed: 0, raw: frames.length, frames };
}

/**
 * Cards left behind by the sheet-level key are cleared per frame: flood from
 * the frame's border inwards over whatever fill surrounds the sprite. The card
 * is always what touches the box edge, so the fighter itself is never reached.
 */
function trimFrameBorder(image, box, tolerance = 26) {
  const width = box.x1 - box.x0 + 1;
  const height = box.y1 - box.y0 + 1;
  const seen = new Uint8Array(width * height);
  const seed = (() => {
    const counts = new Map();
    const add = (x, y) => {
      const offset = ((box.y0 + y) * image.width + box.x0 + x) * 4;
      // Transparent edges carry no colour; seeding from them would clear nothing.
      if (image.data[offset + 3] < 40) return;
      const key = (image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2];
      const entry = counts.get(key) ?? { count: 0, color: [0, 0, 0] };
      entry.count += 1;
      entry.color = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
      counts.set(key, entry);
    };
    for (let x = 0; x < width; x += 1) {
      add(x, 0);
      add(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      add(0, y);
      add(width - 1, y);
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
    if (ranked.length > 0) return ranked[0].color;
    const all = new Map();
    for (let y = box.y0; y <= box.y1; y += 1) {
      for (let x = box.x0; x <= box.x1; x += 1) {
        const offset = (y * image.width + x) * 4;
        if (image.data[offset + 3] < 40) continue;
        const key = (image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2];
        const entry = all.get(key) ?? { count: 0, color: [0, 0, 0] };
        entry.count += 1;
        entry.color = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
        all.set(key, entry);
      }
    }
    return [...all.values()].sort((a, b) => b.count - a.count)[0]?.color ?? [0, 0, 0];
  })();

  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = y * width + x;
    if (seen[index]) return;
    seen[index] = 1;
    const offset = ((box.y0 + y) * image.width + box.x0 + x) * 4;
    if (image.data[offset + 3] > 0 && colorDistance(image.data, offset, seed) > tolerance) return;
    image.data[offset + 3] = 0;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const y = stack.pop();
    const x = stack.pop();
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
}

/** Bounding box of the visible pixels, ignoring specks below `minPixels`. */
function tightBox(image, minPixels) {
  const columns = new Uint32Array(image.width);
  const rows = new Uint32Array(image.height);
  let pixels = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] < 40) continue;
      columns[x] += 1;
      rows[y] += 1;
      pixels += 1;
    }
  }
  if (pixels < minPixels) return null;
  // Ignore rows/columns that only carry a few stray pixels (text antialiasing).
  const solidColumns = [...columns.keys()].filter((x) => columns[x] >= 2);
  const solidRows = [...rows.keys()].filter((y) => rows[y] >= 2);
  if (solidColumns.length === 0 || solidRows.length === 0) return null;
  return {
    x0: solidColumns[0],
    y0: solidRows[0],
    x1: solidColumns[solidColumns.length - 1],
    y1: solidRows[solidRows.length - 1],
    pixels,
  };
}

/**
 * Sheets that defeat component detection can be driven by explicit rectangles:
 * key the sheet background and cell panels globally, then keep the biggest
 * blob inside each rectangle. Rectangles only have to be roughly right.
 */
function keyEverything(source, sheet) {
  const image = { width: source.width, height: source.height, data: Buffer.from(source.data) };
  const tolerance = sheet.tolerance ?? 24;
  const panelTolerance = sheet.panelTolerance ?? 8;
  const bg = borderColor(image);
  const keys = [bg, ...(sheet.panelColors ?? [])];
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    if (image.data[offset + 3] < 8) {
      image.data[offset + 3] = 0;
      continue;
    }
    const near = keys.some((color, position) =>
      colorDistance(image.data, offset, color) <= (position === 0 ? tolerance : panelTolerance),
    );
    if (near) image.data[offset + 3] = 0;
  }
  return image;
}

/** Largest visible blob inside a rectangle, tightened to its own bounds. */
function rectFrame(image, rect, sheet) {
  const [x, y, w, h] = rect;
  const crop = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  for (let row = 0; row < h; row += 1) {
    for (let column = 0; column < w; column += 1) {
      const sx = x + column;
      const sy = y + row;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const from = (sy * image.width + sx) * 4;
      const to = (row * w + column) * 4;
      crop.data[to] = image.data[from];
      crop.data[to + 1] = image.data[from + 1];
      crop.data[to + 2] = image.data[from + 2];
      crop.data[to + 3] = image.data[from + 3];
    }
  }
  const boxes = components(crop, new Uint8Array(w * h), {
    minPixels: sheet.minPixels ?? 16,
    alphaFloor: 40,
  });
  if (boxes.length === 0) throw new Error(`no sprite inside ${rect.join(",")}`);
  const biggest = boxes.sort((a, b) => b.pixels - a.pixels)[0];
  return { x0: x + biggest.x0, y0: y + biggest.y0, x1: x + biggest.x1, y1: y + biggest.y1, pixels: biggest.pixels };
}

function detect(source, sheet) {
  if (sheet.panelColors) return detectCells(source, sheet);
  const image = { width: source.width, height: source.height, data: Buffer.from(source.data) };
  // Sheets exported with a real alpha channel already have their background
  // cleared; keying them by colour would eat the fighter's own dark pixels.
  const mask = sheet.keyByColor === false
    ? Uint8Array.from({ length: image.width * image.height }, (_, index) => (image.data[index * 4 + 3] < 8 ? 1 : 0))
    : backgroundMask(image, sheet);
  applyMask(image, mask);
  // Last resort for sheets whose cards come in several noisy shades: drop whole
  // colour ranges (the card family) before looking for sprites.
  for (const [r0, g0, b0, r1, g1, b1] of sheet.remove ?? []) {
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4;
      const r = image.data[offset];
      const g = image.data[offset + 1];
      const b = image.data[offset + 2];
      if (r >= r0 && r <= r1 && g >= g0 && g <= g1 && b >= b0 && b <= b1) image.data[offset + 3] = 0;
    }
  }
  const boxes = components(image, mask, {
    minPixels: sheet.minPixels ?? 40,
    alphaFloor: sheet.alphaFloor ?? 32,
  });
  let keyed = 0;
  for (let index = 0; index < mask.length; index += 1) keyed += mask[index];
  return {
    image,
    keyed: Math.round((keyed / mask.length) * 100),
    raw: boxes.length,
    frames: readingOrder(sheet.mergeGap === null ? boxes : mergeBoxes(boxes, sheet.mergeGap ?? 1)),
  };
}

/** Frames whose vertical spans overlap belong to the same animation row. */
function bands(frames) {
  const groups = [];
  frames.forEach((box, index) => {
    const group = groups.find((candidate) => box.y0 <= candidate.y1 && box.y1 >= candidate.y0);
    if (group) {
      group.indices.push(index);
      group.y0 = Math.min(group.y0, box.y0);
      group.y1 = Math.max(group.y1, box.y1);
    } else {
      groups.push({ indices: [index], y0: box.y0, y1: box.y1 });
    }
  });
  return groups;
}

// --- PNG-ish output ---------------------------------------------------------

const DIGITS = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "010", "010", "010"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
};

function blank(width, height, fill = [90, 90, 104, 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill[0];
    data[index * 4 + 1] = fill[1];
    data[index * 4 + 2] = fill[2];
    data[index * 4 + 3] = fill[3];
  }
  return { width, height, data };
}

function blit(target, source, source_rect, dx, dy, scale) {
  for (let y = 0; y < source_rect.h * scale; y += 1) {
    for (let x = 0; x < source_rect.w * scale; x += 1) {
      const sx = source_rect.x + Math.floor(x / scale);
      const sy = source_rect.y + Math.floor(y / scale);
      const alpha = source.data[(sy * source.width + sx) * 4 + 3];
      if (alpha < 24) continue;
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      const to = (ty * target.width + tx) * 4;
      const from = (sy * source.width + sx) * 4;
      target.data[to] = source.data[from];
      target.data[to + 1] = source.data[from + 1];
      target.data[to + 2] = source.data[from + 2];
      target.data[to + 3] = 255;
    }
  }
}

function stamp(target, x, y, color) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const offset = (y * target.width + x) * 4;
  target.data[offset] = color[0];
  target.data[offset + 1] = color[1];
  target.data[offset + 2] = color[2];
  target.data[offset + 3] = 255;
}

function label(target, text, x, y, scale, color = [255, 210, 63]) {
  let cursor = x;
  for (const character of String(text)) {
    if (character === " ") {
      cursor += 4 * scale;
      continue;
    }
    const glyph = DIGITS[character];
    if (!glyph) continue;
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] !== "1") continue;
        for (let oy = 0; oy < scale; oy += 1) {
          for (let ox = 0; ox < scale; ox += 1) {
            stamp(target, cursor + column * scale + ox, y + row * scale + oy, color);
          }
        }
      }
    }
    cursor += 5 * scale;
  }
}

// --- commands ---------------------------------------------------------------

function loadConfig() {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

function inspect(only) {
  const config = loadConfig();
  mkdirSync(workDir, { recursive: true });
  for (const sheet of config.sheets) {
    if (only && sheet.key !== only) continue;
    const file = join(root, sheet.file);
    const { image, keyed, raw, frames } = detect(decode(file), sheet);
    console.log(`${sheet.key}: keyed ${keyed}% of pixels, ${raw} raw components, ${frames.length} frames after merging`);
    const tallest = frames.reduce((max, box) => Math.max(max, box.y1 - box.y0 + 1), 0);
    const widest = frames.reduce((max, box) => Math.max(max, box.x1 - box.x0 + 1), 0);
    const scale = tallest * 3 > 100 ? 2 : 3;
    const cell = Math.min(140, Math.max(48, Math.ceil(Math.max(tallest, widest) * scale) + 18));
    const columns = 8;
    const perPage = 48;
    const rows = Math.ceil(Math.min(frames.length, perPage) / columns);
    const pages = Math.max(1, Math.ceil(frames.length / perPage));

    for (let page = 0; page < pages; page += 1) {
      const pageFrames = frames.slice(page * perPage, page * perPage + perPage);
      const target = blank(columns * cell, rows * cell);
      pageFrames.forEach((box, index) => {
        const frameIndex = page * perPage + index;
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = column * cell;
        const y = row * cell;
        for (let line = 0; line < cell; line += 1) {
          stamp(target, x + line, y, [46, 46, 62]);
          stamp(target, x, y + line, [46, 46, 62]);
        }
        const width = (box.x1 - box.x0 + 1) * scale;
        const height = (box.y1 - box.y0 + 1) * scale;
        blit(target, image, { x: box.x0, y: box.y0, w: box.x1 - box.x0 + 1, h: box.y1 - box.y0 + 1 }, x + Math.floor((cell - width) / 2), y + 14, scale);
        label(target, frameIndex, x + 4, y + cell - 9, 2, [159, 232, 255]);
        void height;
      });
      const name = `${sheet.key}-p${page}.png`;
      encode(target, join(workDir, name));
      console.log(`${name}: ${pageFrames.length} frames of ${frames.length}`);
    }
    const rowBands = bands(frames);
    console.log(
      `${sheet.key}: ${frames.length} frames in ${rowBands.length} rows, biggest ${widest}x${tallest}, ` +
        `median ${median(frames.map((box) => box.y1 - box.y0 + 1))}x${median(frames.map((box) => box.x1 - box.x0 + 1))}`,
    );
    for (const row of rowBands) {
      console.log(`  y${row.y0}-${row.y1}: ${row.indices.length} frames ${row.indices[0]}-${row.indices[row.indices.length - 1]}`);
    }
  }
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function build() {
  const config = loadConfig();
  const cell = config.cell ?? 64;
  const columns = config.columns ?? 8;
  const outDir = join(root, config.outDir);
  const characterData = {};

  for (const sheet of config.sheets) {
    if (!sheet.characters) continue;
    const decoded = decode(join(root, sheet.file));
    const detected = sheet.manual
      ? { image: keyEverything(decoded, sheet), frames: [] }
      : detect(decoded, sheet);
    const image = detected.image;
    const resolveFrame = (entry) => {
      if (Array.isArray(entry)) return rectFrame(image, entry, sheet);
      const box = detected.frames[entry];
      if (!box) {
        throw new Error(`${sheet.key}: frame ${entry} does not exist (${detected.frames.length} detected)`);
      }
      return box;
    };

    for (const character of sheet.characters) {
      const clips = {};
      const order = [];
      for (const [clip, entries] of Object.entries(character.clips)) {
        clips[clip] = entries.map(resolveFrame);
        for (const box of clips[clip]) if (!order.includes(box)) order.push(box);
      }

      const idleHeight = median(clips.idle.map((box) => box.y1 - box.y0 + 1)) || 32;
      const scale = character.scale ?? Math.max(1, Math.round(((cell * 0.72) / idleHeight) * 4) / 4);
      const rows = Math.max(1, Math.ceil(order.length / columns));
      const atlas = blank(columns * cell, rows * cell, [0, 0, 0, 0]);
      const slotOf = new Map();

      order.forEach((box, slot) => {
        slotOf.set(box, slot);
        if (sheet.trimPanel) {
          // Seed the flood just outside the frame so the card, not the fighter,
          // is what touches the edge being sampled.
          const pad = sheet.expandBox ?? 0;
          const padded = {
            x0: Math.max(0, box.x0 - pad),
            y0: Math.max(0, box.y0 - pad),
            x1: Math.min(image.width - 1, box.x1 + pad),
            y1: Math.min(image.height - 1, box.y1 + pad),
          };
          trimFrameBorder(image, padded, sheet.panelTolerance ?? 26);
        }
        const width = box.x1 - box.x0 + 1;
        const height = box.y1 - box.y0 + 1;
        const drawWidth = Math.max(1, Math.round(width * scale));
        const drawHeight = Math.max(1, Math.round(height * scale));
        const left = (slot % columns) * cell + Math.round((cell - drawWidth) / 2);
        const top = Math.floor(slot / columns) * cell + Math.round(cell * 0.94 - drawHeight);
        for (let py = 0; py < drawHeight; py += 1) {
          for (let px = 0; px < drawWidth; px += 1) {
            const sx = box.x0 + Math.floor(px / scale);
            const sy = box.y0 + Math.floor(py / scale);
            const from = (sy * image.width + sx) * 4;
            if (image.data[from + 3] < 40) continue;
            const to = ((top + py) * atlas.width + left + px) * 4;
            atlas.data[to] = image.data[from];
            atlas.data[to + 1] = image.data[from + 1];
            atlas.data[to + 2] = image.data[from + 2];
            atlas.data[to + 3] = image.data[from + 3];
          }
        }
      });

      const file = `${character.id}.png`;
      encode(atlas, join(outDir, file));
      characterData[character.id] = {
        atlas: file,
        cell,
        columns,
        clips: Object.fromEntries(
          Object.entries(clips).map(([clip, boxes]) => [clip, boxes.map((box) => slotOf.get(box))]),
        ),
      };
      console.log(`${character.id}: ${order.length} frames -> ${file} (scale ${scale})`);
    }
  }

  const module = `// Generated by scripts/slice-sprites.mjs from the fighter spritesheets.\n// Do not hand-edit: rerun \`node scripts/slice-sprites.mjs build\`.\nexport const FIGHTER_SPRITES = ${JSON.stringify(characterData, null, 2)};\n`;
  writeFileSync(join(root, config.generatedModule), module);
  console.log(`wrote ${config.generatedModule}`);
}

/**
 * The whole sheet, scaled up, with every detected frame numbered in place. This
 * is the view to author clips from: the sheet layout shows what each row does.
 */
function annotate(only, pageHeight = 420, scale = 2) {
  const config = loadConfig();
  mkdirSync(workDir, { recursive: true });
  for (const sheet of config.sheets) {
    if (only && sheet.key !== only) continue;
    const { image, frames } = detect(decode(join(root, sheet.file)), sheet);
    const pages = Math.ceil(image.height / pageHeight);
    for (let page = 0; page < pages; page += 1) {
      const from = page * pageHeight;
      const to = Math.min(image.height, from + pageHeight);
      const target = blank(image.width * scale, (to - from) * scale);
      // Paint the keyed sheet first, then a translucent white so black and white
      // fighters are both legible.
      for (let y = from; y < to; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const alpha = image.data[(y * image.width + x) * 4 + 3];
          if (alpha < 24) continue;
          const source = (y * image.width + x) * 4;
          for (let oy = 0; oy < scale; oy += 1) {
            for (let ox = 0; ox < scale; ox += 1) {
              stamp(target, x * scale + ox, (y - from) * scale + oy, [
                image.data[source],
                image.data[source + 1],
                image.data[source + 2],
              ]);
            }
          }
        }
      }
      frames.forEach((box, index) => {
        if (box.y1 < from || box.y0 >= to) return;
        const x = box.x0 * scale;
        const y = (Math.max(box.y0, from) - from) * scale;
        const digits = String(index).length;
        for (let oy = 1; oy < 12; oy += 1) {
          for (let ox = 1; ox < 5 + digits * 10; ox += 1) stamp(target, x + ox, y + oy, [0, 0, 0]);
        }
        label(target, index, x + 3, y + 3, 2, [255, 210, 63]);
      });
      const name = `${sheet.key}-annotate-p${page}.png`;
      encode(target, join(workDir, name));
      console.log(`${name}: y${from}-${to} of ${image.height}, ${frames.length} frames total`);
    }
  }
}

const [command, argument, third] = process.argv.slice(2);
if (command === "inspect") inspect(argument);
else if (command === "annotate") annotate(argument, third ? Number(third) : 420);
else if (command === "build") build();
else {
  console.error(`Usage: node scripts/slice-sprites.mjs <inspect|annotate|build> [sheet] [pageHeight]`);
  process.exit(1);
}
void basename;
