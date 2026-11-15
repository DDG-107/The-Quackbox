import { el, promptLine, type ComponentContext, type ComponentOf } from "./context.js";

export function textComponent(
  component: ComponentOf<"text">,
  context: ComponentContext,
): HTMLElement {
  const form = el("form", "component text-form");
  const input = el("input", "text-input");
  input.maxLength = component.maxLen;
  input.autocomplete = "off";
  input.enterKeyHint = "send";
  input.placeholder = component.prompt;

  const submit = el("button", "primary");
  submit.type = "submit";
  submit.textContent = component.submitLabel ?? "Send";

  form.append(promptLine(component.prompt), input, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim().slice(0, component.maxLen);
    if (!value) return;

    context.send({ t: "in", id: component.id, k: "text", v: value });
    input.value = "";
    // Brief lock so a double tap does not send twice; the next UI change clears it.
    submit.disabled = true;
    window.setTimeout(() => {
      submit.disabled = false;
    }, 900);
  });

  return form;
}
