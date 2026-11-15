import type { UISpec, UIButton } from "@quackbox/protocol";

interface IdOption {
  id?: string;
}

/**
 * Helpers that build controller screens. Each returns a complete `UISpec`, so a
 * game can hand the result straight to `hub.setUI`.
 */
export const ui = {
  label(text: string): UISpec {
    return { components: [{ type: "label", text }] };
  },

  waiting(text?: string): UISpec {
    return { components: [{ type: "waiting", text }] };
  },

  buttons(buttons: UIButton[], extra: UISpec["components"][number][] = []): UISpec {
    return { components: [{ type: "buttons", buttons }, ...extra] };
  },

  text(
    prompt: string,
    options: IdOption & { maxLen?: number; submitLabel?: string } = {},
  ): UISpec {
    return {
      components: [
        {
          type: "text",
          id: options.id ?? "text",
          prompt,
          maxLen: options.maxLen ?? 40,
          submitLabel: options.submitLabel,
        },
      ],
    };
  },

  choice(
    options: { id: string; label: string }[],
    settings: IdOption & { multi?: boolean } = {},
  ): UISpec {
    return {
      components: [
        { type: "choice", id: settings.id ?? "choice", options, multi: settings.multi },
      ],
    };
  },

  joystick(
    options: IdOption & { side?: "left" | "right"; hz?: number } = {},
  ): UISpec {
    return {
      components: [
        { type: "joystick", id: options.id ?? "stick", side: options.side, hz: options.hz ?? 20 },
      ],
    };
  },

  drawpad(
    options: IdOption & { colors?: string[]; strokeMax?: number; prompt?: string } = {},
  ): UISpec {
    return {
      components: [
        {
          type: "drawpad",
          id: options.id ?? "pad",
          colors: options.colors,
          strokeMax: options.strokeMax ?? 2048,
          prompt: options.prompt,
        },
      ],
    };
  },

  /** Several components on one screen, top to bottom. */
  stack(...components: UISpec["components"][number][]): UISpec {
    return { components };
  },
};
