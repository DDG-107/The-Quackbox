// The host is a TV; keep a tiny, preloaded pool instead of decoding on every
// punch. Browsers may still refuse playback before a user gesture, so failure is
// deliberately silent.
const SOURCES = {
  hit: new URL("../assets/audio/hit.ogg", import.meta.url).href,
  hurt: new URL("../assets/audio/hurt.ogg", import.meta.url).href,
  swing: new URL("../assets/audio/swing.ogg", import.meta.url).href,
  ko: new URL("../assets/audio/ko.ogg", import.meta.url).href,
  jump: new URL("../assets/audio/jump.wav", import.meta.url).href,
  select: new URL("../assets/audio/select.wav", import.meta.url).href,
};

const templates = new Map(Object.entries(SOURCES).map(([name, src]) => [name, new Audio(src)]));

export function playSound(name, volume = 0.55) {
  const template = templates.get(name);
  if (!template) return;

  try {
    const sound = template.cloneNode();
    sound.volume = Math.max(0, Math.min(1, volume));
    void sound.play().catch(() => undefined);
  } catch {
    // Audio is garnish, never a reason to break a match.
  }
}
