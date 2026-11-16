import type { UIButton } from "@quackbox/protocol";
import { el, type ComponentContext, type ComponentOf } from "./context.js";

export function createPadButton(
  button: UIButton,
  context: ComponentContext,
  extraClass = "",
): HTMLButtonElement {
  const node = el("button", `pad-button ${button.style ?? "default"} ${extraClass}`.trim());
  node.type = "button";
  node.textContent = button.label;

  let held = false;
  let cooldownUntil = 0;

  const release = () => {
    if (!held) return;
    held = false;
    node.classList.remove("held");
    context.send({ t: "in", id: button.id, k: "release" });

    const cooldown = button.cooldownMs ?? 0;
    if (cooldown <= 0) return;
    cooldownUntil = Date.now() + cooldown;
    node.disabled = true;
    window.setTimeout(() => {
      if (Date.now() >= cooldownUntil) node.disabled = false;
    }, cooldown);
  };

  node.addEventListener("pointerdown", (event) => {
    if (Date.now() < cooldownUntil) return;
    event.preventDefault();
    held = true;
    node.classList.add("held");
    node.setPointerCapture(event.pointerId);
    if ("vibrate" in navigator) navigator.vibrate(6);
    context.send({ t: "in", id: button.id, k: "press" });
  });
  node.addEventListener("pointerup", release);
  node.addEventListener("pointercancel", release);
  node.addEventListener("lostpointercapture", release);
  // Holding a button should not open the context menu on a long press.
  node.addEventListener("contextmenu", (event) => event.preventDefault());

  return node;
}

export function buttonsComponent(
  component: ComponentOf<"buttons">,
  context: ComponentContext,
): HTMLElement {
  const wrap = el("div", "component buttons");
  for (const button of component.buttons) wrap.append(createPadButton(button, context));
  return wrap;
}
