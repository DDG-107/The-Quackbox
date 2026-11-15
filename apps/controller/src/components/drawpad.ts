import { el, promptLine, type ComponentContext, type ComponentOf } from "./context.js";

interface Stroke {
  color: string;
  points: [number, number][];
}

const DEFAULT_COLORS = ["#111111", "#ff5c8a", "#36d1ff", "#ffd23f"];

export function drawpadComponent(
  component: ComponentOf<"drawpad">,
  context: ComponentContext,
): HTMLElement {
  const wrap = el("div", "component drawpad");
  const colors = component.colors?.length ? component.colors : DEFAULT_COLORS;
  const maxPoints = component.strokeMax ?? 2048;

  let color = colors[0] ?? "#111111";
  let sentPoints = 0;

  if (component.prompt) wrap.append(promptLine(component.prompt));

  const controls = el("div", "pad-controls");
  const swatches = colors.map((value) => {
    const button = el("button", "swatch-button");
    button.type = "button";
    button.style.background = value;
    button.setAttribute("aria-label", `colour ${value}`);
    button.classList.toggle("selected", value === color);
    button.addEventListener("click", () => {
      color = value;
      for (const other of swatches) other.classList.toggle("selected", other === button);
    });
    return button;
  });

  const clear = el("button", "ghost small");
  clear.type = "button";
  clear.textContent = "Clear";
  controls.append(...swatches, clear);

  const canvas = el("canvas", "pad");
  wrap.append(controls, canvas);

  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;

  const strokes: Stroke[] = [];
  let active: Stroke | null = null;
  let batch: [number, number][] = [];
  let flushTimer: number | null = null;

  const drawStroke = (stroke: Stroke): void => {
    if (!ctx || stroke.points.length === 0) return;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = 4;
    const [first] = stroke.points;
    if (!first) return;

    if (stroke.points.length === 1) {
      ctx.beginPath();
      ctx.arc(first[0] * width, first[1] * height, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(first[0] * width, first[1] * height);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point[0] * width, point[1] * height);
    ctx.stroke();
  };

  const redraw = (): void => {
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    for (const stroke of strokes) drawStroke(stroke);
    if (active) drawStroke(active);
  };

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (ctx) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }
    redraw();
  };

  const flush = (): void => {
    if (flushTimer !== null) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (batch.length === 0) return;
    const points = batch;
    batch = [];
    context.send({ t: "in", id: component.id, k: "stroke", pts: points });
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null) return;
    flushTimer = window.setTimeout(flush, 80);
  };

  const append = (point: [number, number]): void => {
    if (!active || sentPoints >= maxPoints) return;

    const last = active.points.at(-1);
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.004) return;

    active.points.push(point);
    batch.push(point);
    sentPoints += 1;

    if (!ctx) return;
    ctx.strokeStyle = active.color;
    ctx.fillStyle = active.color;
    ctx.lineWidth = 4;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last[0] * width, last[1] * height);
      ctx.lineTo(point[0] * width, point[1] * height);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(point[0] * width, point[1] * height, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const pointFrom = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const x = rect.width === 0 ? 0 : (event.clientX - rect.left) / rect.width;
    const y = rect.height === 0 ? 0 : (event.clientY - rect.top) / rect.height;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    active = { color, points: [] };
    append(pointFrom(event));
    scheduleFlush();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!active) return;
    append(pointFrom(event));
    scheduleFlush();
  });

  const finish = (): void => {
    if (!active) return;
    strokes.push(active);
    active = null;
    flush();
  };

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("lostpointercapture", finish);

  clear.addEventListener("click", () => {
    strokes.length = 0;
    active = null;
    batch = [];
    sentPoints = 0;
    redraw();
  });

  const observer = new ResizeObserver(() => {
    if (!canvas.isConnected) {
      observer.disconnect();
      return;
    }
    resize();
  });
  observer.observe(canvas);
  window.requestAnimationFrame(resize);

  return wrap;
}
