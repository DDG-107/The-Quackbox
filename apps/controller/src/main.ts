import type { ControllerUI, GameResult, InputEvent, Player } from "@quackbox/protocol";
import { createComponent, type ComponentContext } from "./components/index.js";
import { Connection, type ConnectionState } from "./net.js";
import "./styles.css";

const STORAGE = {
  token: "quackbox:token",
  name: "quackbox:name",
  room: "quackbox:room",
} as const;

function requireRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Controller is missing its #app element.");
  return element;
}

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Controller view is missing ${selector}`);
  return element;
}

function roomFromUrl(): string | null {
  const room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
  if (/^[A-Z0-9]{4}$/.test(room)) return room;
  const stored = localStorage.getItem(STORAGE.room) ?? "";
  return stored.length === 4 ? stored : null;
}

const app = requireRoot();

const state = {
  status: "idle" as ConnectionState,
  room: roomFromUrl(),
  playerId: null as string | null,
  players: [] as Player[],
  ui: null as ControllerUI | null,
  notice: null as string | null,
  results: null as GameResult[] | null,
  ended: false,
};

interface RoomView {
  name: HTMLElement;
  swatch: HTMLElement;
  room: HTMLElement;
  status: HTMLElement;
  stage: HTMLElement;
  count: HTMLElement;
  list: HTMLElement;
}

let screen: "join" | "room" | null = null;
let view: RoomView | null = null;
let mountedKey = "";

const me = (): Player | null =>
  state.players.find((player) => player.id === state.playerId) ?? null;

const connection = new Connection({
  onState(status) {
    state.status = status;
    if (screen === "room") updateRoom();
  },

  onWelcome(message) {
    localStorage.setItem(STORAGE.room, message.room);
    state.room = message.room;
    state.playerId = message.playerId;
    state.players = message.players;
    state.ui = message.ui;
    state.notice = null;
    state.results = null;
    state.ended = false;
    render();
  },

  onUI(message) {
    if (state.ui && message.ui.v < state.ui.v) return;
    state.ui = message.ui;
    updateStage();
  },

  onRoom(message) {
    state.room = message.room;
    state.players = message.players;
    updateRoom();
  },

  onEnded(results) {
    state.results = results;
    state.ui = null;
    state.ended = true;
    updateRoom();
    updateStage();
  },

  onKicked(reason) {
    state.playerId = null;
    state.ui = null;
    state.players = [];
    state.notice = reason;
    screen = null;
    render();
  },

  onError(code, message) {
    state.notice = message;
    if (code === "room-not-found" || code === "protocol") connection.stop();
    if (screen === "room") updateRoom();
    else renderJoin();
  },
});

function render(): void {
  if (state.playerId) {
    if (screen !== "room") {
      buildRoom();
      screen = "room";
      mountedKey = "";
    }
    updateRoom();
    updateStage();
    return;
  }

  renderJoin();
  screen = "join";
  view = null;
  mountedKey = "";
}

function statusLabel(): string | null {
  if (state.notice) return state.notice;
  if (state.status === "reconnecting") return "Reconnecting…";
  if (state.status === "connecting") return "Connecting…";
  if (state.status === "closed") return "Disconnected";
  return null;
}

function renderJoin(): void {
  const typed = document.querySelector<HTMLInputElement>("#name")?.value ?? "";
  const busy = state.status === "connecting" || state.status === "reconnecting";

  app.innerHTML = `
    <section class="card">
      <p class="eyebrow">The QuackBox</p>
      <h1>Join the party</h1>
      <p class="muted">Type a name. You are on the same Wi-Fi as the TV, right?</p>
      <form id="join-form" autocomplete="off">
        <label for="name">Your name</label>
        <input id="name" name="name" maxlength="24" enterkeyhint="go" required
               autocomplete="nickname" placeholder="Pato"
               value="${escapeHtml(typed || localStorage.getItem(STORAGE.name) || "")}" />
        <label for="room">Room code</label>
        <input id="room" name="room" maxlength="4" autocapitalize="characters" spellcheck="false"
               inputmode="text" placeholder="ABCD" value="${escapeHtml(state.room ?? "")}" />
        <button type="submit" class="primary" ${busy ? "disabled" : ""}>
          ${busy ? "Connecting…" : "Join"}
        </button>
      </form>
      ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ""}
    </section>
    <p class="hint">
      Can't connect? Use the same Wi-Fi as the host. Guest networks and "AP isolation"
      block phone-to-laptop traffic, and a firewall prompt on the laptop must be allowed.
    </p>`;

  document.querySelector<HTMLFormElement>("#join-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim().slice(0, 24);
    if (!name) return;

    const roomRaw = String(data.get("room") ?? "").trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(roomRaw)) {
      state.room = roomRaw;
      localStorage.setItem(STORAGE.room, roomRaw);
    } else {
      state.room = null;
    }

    localStorage.setItem(STORAGE.name, name);
    state.notice = null;
    connection.start({ ...(state.room ? { room: state.room } : {}), name });
  });
}

function buildRoom(): void {
  app.innerHTML = `
    <header class="bar">
      <span class="who"><i class="swatch" id="me-swatch"></i><span id="me-name">You</span></span>
      <span class="room" id="room-code"></span>
    </header>
    <p class="pill warn" id="status" hidden></p>
    <section class="stage" id="stage"></section>
    <footer class="roster">
      <p class="muted small" id="count"></p>
      <ul id="player-list"></ul>
    </footer>`;

  view = {
    name: must("#me-name"),
    swatch: must("#me-swatch"),
    room: must("#room-code"),
    status: must("#status"),
    stage: must("#stage"),
    count: must("#count"),
    list: must("#player-list"),
  };
}

function updateRoom(): void {
  if (!view) return;

  const player = me();
  view.name.textContent = player?.name ?? localStorage.getItem(STORAGE.name) ?? "You";
  view.swatch.style.background = player?.color ?? "#ffffff";
  view.room.textContent = state.room ?? "";

  const connected = state.players.filter((entry) => entry.connected).length;
  view.count.textContent = `${connected} of ${state.players.length} players connected — look at the TV`;

  view.list.replaceChildren(
    ...state.players.map((entry) => {
      const item = document.createElement("li");
      item.className = `small${entry.id === state.playerId ? " you" : ""}`;

      const dot = document.createElement("i");
      dot.className = "swatch";
      dot.style.background = entry.color;

      item.append(dot, ` ${entry.connected ? "●" : "○"} ${entry.name}`);
      return item;
    }),
  );

  const label = statusLabel();
  view.status.hidden = label === null;
  view.status.textContent = label ?? "";
}

function updateStage(): void {
  if (!view) return;

  const key = state.ended ? "ended" : state.ui ? `ui:${state.ui.v}` : "idle";
  if (key === mountedKey) return;
  mountedKey = key;

  if (state.ended) {
    const result = state.results?.find((entry) => entry.playerId === state.playerId);
    view.stage.replaceChildren(
      waitingCard(result ? `${result.score} points` : "Round over", "Back to the lobby — wait for the host."),
    );
    return;
  }

  if (!state.ui) {
    view.stage.replaceChildren(waitingCard("You're in!", "The host will start a game soon."));
    return;
  }

  if (state.ui.components.length === 0) {
    view.stage.replaceChildren(waitingCard("Look at the TV", ""));
    return;
  }

  const context: ComponentContext = {
    send: (input: InputEvent) => connection.send(input),
  };
  view.stage.replaceChildren(
    ...state.ui.components.map((component) => createComponent(component, context)),
  );
}

function waitingCard(title: string, note: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "waiting";

  const heading = document.createElement("strong");
  heading.textContent = title;
  wrap.append(heading);

  if (note) {
    const text = document.createElement("span");
    text.textContent = note;
    wrap.append(text);
  }

  return wrap;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();

// A stored token means this phone already has a slot: rejoin silently.
const storedName = localStorage.getItem(STORAGE.name);
if (localStorage.getItem(STORAGE.token) && storedName) {
  connection.start({ ...(state.room ? { room: state.room } : {}), name: storedName });
}
