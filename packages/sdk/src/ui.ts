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
    settings: IdOption & { multi?: boolean; orientation?: UISpec["orientation"] } = {},
  ): UISpec {
    return {
      ...(settings.orientation ? { orientation: settings.orientation } : {}),
      components: [
        { type: "choice", id: settings.id ?? "choice", options, multi: settings.multi },
      ],
    };
  },

  /**
   * A landscape console pad: two analog sticks and an XYAB diamond. Games still
   * receive ordinary axis, press and release inputs; the phone only draws it.
   */
  gamepad(options: {
    label?: string;
    left: { id: string; hz?: number };
    right?: { id: string; hz?: number };
    face: { x: UIButton; y: UIButton; a: UIButton; b: UIButton };
    leftShoulder?: UIButton;
    rightShoulder?: UIButton;
  }): UISpec {
    return {
      orientation: "landscape",
      components: [
        {
          type: "gamepad",
          ...(options.label ? { label: options.label } : {}),
          left: options.left,
          ...(options.right ? { right: options.right } : {}),
          face: options.face,
          ...(options.leftShoulder ? { leftShoulder: options.leftShoulder } : {}),
          ...(options.rightShoulder ? { rightShoulder: options.rightShoulder } : {}),
        },
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
