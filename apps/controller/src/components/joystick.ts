import { clampAxis, el, round2, type ComponentContext, type ComponentOf } from "./context.js";

export function createJoystickPad(
  id: string,
  hzValue: number | undefined,
  context: ComponentContext,
): HTMLElement {
  const pad = el("div", "joy-pad");
  const knob = el("div", "joy-knob");
  pad.append(knob);

  const hz = Math.max(1, Math.min(60, hzValue ?? 20));
  const interval = 1000 / hz;

  let seq = 0;
  let lastSent = 0;
  let active = false;
  let pending: { x: number; y: number } | null = null;
  let timer: number | null = null;

  const emit = (x: number, y: number, force = false): void => {
    const now = performance.now();
    if (!force && now - lastSent < interval) return;
    lastSent = now;
    pending = null;
    seq += 1;
    context.send({ t: "in", id, k: "axis", x: round2(x), y: round2(y), seq });
  };

  const flush = (): void => {
    if (!pending) return;
    const { x, y } = pending;
    emit(x, y, true);
  };

  const track = (event: PointerEvent): void => {
    const rect = pad.getBoundingClientRect();
    const radius = Math.max(1, Math.min(rect.width, rect.height) / 2 - 18);
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.min(1, Math.hypot(dx, dy) / radius);
    const angle = Math.atan2(dy, dx);
    const x = clampAxis(Math.cos(angle) * distance);
    const y = clampAxis(Math.sin(angle) * distance);

    knob.style.transform = `translate(${x * radius}px, ${y * radius}px)`;

    pending = { x, y };
    if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null;
        flush();
      }, interval);
    }
    emit(x, y);
  };

  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    active = true;
    pad.setPointerCapture(event.pointerId);
    track(event);
  });

  pad.addEventListener("pointermove", (event) => {
    if (!active) return;
    track(event);
  });

  const release = (): void => {
    if (!active) return;
    active = false;
    pending = null;
    knob.style.transform = "translate(0, 0)";
    emit(0, 0, true);
  };

  pad.addEventListener("pointerup", release);
  pad.addEventListener("pointercancel", release);
  pad.addEventListener("lostpointercapture", release);
  pad.addEventListener("contextmenu", (event) => event.preventDefault());

  return pad;
}

export function joystickComponent(
  component: ComponentOf<"joystick">,
  context: ComponentContext,
): HTMLElement {
  const wrap = el("div", `component joystick ${component.side ?? "left"}`);
  wrap.append(createJoystickPad(component.id, component.hz, context));
  return wrap;
}
