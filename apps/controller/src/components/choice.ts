import { el, type ComponentContext, type ComponentOf } from "./context.js";

export function choiceComponent(
  component: ComponentOf<"choice">,
  context: ComponentContext,
): HTMLElement {
  const wrap = el("div", "component choice");
  const selected = new Set<string>();

  const nodes = component.options.map((option) => {
    const node = el("button", "choice-option");
    node.type = "button";
    node.textContent = option.label;

    node.addEventListener("click", () => {
      if (component.multi) {
        if (selected.has(option.id)) selected.delete(option.id);
        else selected.add(option.id);
        node.classList.toggle("selected", selected.has(option.id));
      } else {
        selected.clear();
        selected.add(option.id);
        for (const other of nodes) other.classList.toggle("selected", other === node);
      }

      context.send({ t: "in", id: component.id, k: "choice", v: [...selected] });
    });

    return node;
  });

  wrap.append(...nodes);
  return wrap;
}
