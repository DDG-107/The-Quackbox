import type { Component, InputEvent } from "@quackbox/protocol";

export interface ComponentContext {
  send(input: InputEvent): void;
}

export type ComponentOf<T extends Component["type"]> = Extract<Component, { type: T }>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export const clampAxis = (value: number): number => Math.max(-1, Math.min(1, value));

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function promptLine(text: string): HTMLElement {
  const prompt = el("p", "prompt");
  prompt.textContent = text;
  return prompt;
}
