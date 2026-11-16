import type { Component } from "@quackbox/protocol";
import { buttonsComponent } from "./buttons.js";
import { choiceComponent } from "./choice.js";
import { drawpadComponent } from "./drawpad.js";
import { gamepadComponent } from "./gamepad.js";
import { joystickComponent } from "./joystick.js";
import { labelComponent, unsupportedComponent, waitingComponent } from "./static.js";
import { textComponent } from "./text.js";
import type { ComponentContext } from "./context.js";

export type { ComponentContext } from "./context.js";

export function createComponent(component: Component, context: ComponentContext): HTMLElement {
  switch (component.type) {
    case "buttons":
      return buttonsComponent(component, context);
    case "gamepad":
      return gamepadComponent(component, context);
    case "text":
      return textComponent(component, context);
    case "choice":
      return choiceComponent(component, context);
    case "joystick":
      return joystickComponent(component, context);
    case "drawpad":
      return drawpadComponent(component, context);
    case "label":
      return labelComponent(component);
    case "waiting":
      return waitingComponent(component);
    default:
      return unsupportedComponent(component);
  }
}
