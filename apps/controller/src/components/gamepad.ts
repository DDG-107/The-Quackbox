import { createPadButton } from "./buttons.js";
import { createJoystickPad } from "./joystick.js";
import { el, promptLine, type ComponentContext, type ComponentOf } from "./context.js";

type FaceKey = "x" | "y" | "a" | "b";

export function gamepadComponent(
  component: ComponentOf<"gamepad">,
  context: ComponentContext,
): HTMLElement {
  const wrap = el("div", "component gamepad");
  if (component.label) wrap.append(promptLine(component.label));

  const shoulders = el("div", "gamepad-shoulders");
  if (component.leftShoulder) {
    shoulders.append(createPadButton(component.leftShoulder, context, "shoulder left"));
  } else {
    shoulders.append(el("span", "shoulder-spacer"));
  }
  if (component.rightShoulder) {
    shoulders.append(createPadButton(component.rightShoulder, context, "shoulder right"));
  } else {
    shoulders.append(el("span", "shoulder-spacer"));
  }

  const main = el("div", "gamepad-main");

  const left = el("div", "gamepad-stick left");
  const leftLabel = el("span", "stick-label");
  leftLabel.textContent = "MOVE";
  left.append(leftLabel, createJoystickPad(component.left.id, component.left.hz, context));

  const right = el("div", "gamepad-stick right");
  const rightLabel = el("span", "stick-label");
  rightLabel.textContent = component.right ? "AIM" : "";
  right.append(rightLabel);
  if (component.right) {
    right.append(createJoystickPad(component.right.id, component.right.hz, context));
  } else {
    right.append(el("span", "stick-empty"));
  }

  const face = el("div", "gamepad-face");
  const faceLabel = el("span", "stick-label");
  faceLabel.textContent = "XYAB";
  face.append(faceLabel);
  const diamond = el("div", "face-diamond");
  const hub = el("span", "face-hub");
  hub.textContent = "TRASH";
  diamond.append(hub);

  const faces: [FaceKey, ComponentOf<"gamepad">["face"][FaceKey]][] = [
    ["y", component.face.y],
    ["x", component.face.x],
    ["b", component.face.b],
    ["a", component.face.a],
  ];
  for (const [key, button] of faces) {
    diamond.append(createPadButton(button, context, `face-button face-${key}`));
  }

  face.append(diamond);
  main.append(left, right, face);
  wrap.append(shoulders, main);

  return wrap;
}
