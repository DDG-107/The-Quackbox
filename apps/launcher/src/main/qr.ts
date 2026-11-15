import { create } from "qrcode";

const cache = new Map<string, string>();

/**
 * Render the join URL as an inline SVG. Built row by row from the QR matrix so
 * it stays synchronous and dependency-free at render time.
 */
export function qrSvg(text: string, moduleSize = 7, quietZone = 3): string {
  const cached = cache.get(text);
  if (cached) return cached;

  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const count = modules.size;
  const dimension = (count + quietZone * 2) * moduleSize;
  let path = "";

  for (let row = 0; row < count; row += 1) {
    let column = 0;
    while (column < count) {
      if (!modules.get(row, column)) {
        column += 1;
        continue;
      }
      let run = 1;
      while (column + run < count && modules.get(row, column + run)) run += 1;

      const x = (column + quietZone) * moduleSize;
      const y = (row + quietZone) * moduleSize;
      path += `M${x} ${y}h${run * moduleSize}v${moduleSize}h${-run * moduleSize}z`;
      column += run;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" width="100%" height="100%"` +
    ` role="img" aria-label="Join the room" shape-rendering="crispEdges">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#0b0b12"/></svg>`;

  cache.set(text, svg);
  return svg;
}
