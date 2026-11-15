import type { Component } from "@quackbox/protocol";
import { el, type ComponentOf } from "./context.js";

export function labelComponent(component: ComponentOf<"label">): HTMLElement {
  const label = el("p", "label");
  label.textContent = component.text;
  return label;
}

export function waitingComponent(component: ComponentOf<"waiting">): HTMLElement {
  const wrap = el("div", "waiting");
  const title = el("strong");
  title.textContent = component.text ?? "Waiting…";
  wrap.append(title);
  return wrap;
}

/** Components the controller does not render yet stay visible, but inert. */
export function unsupportedComponent(component: Component): HTMLElement {
  const node = el("div", "pending");
  node.textContent = `The "${component.type}" control is not available yet.`;
  return node;
}
