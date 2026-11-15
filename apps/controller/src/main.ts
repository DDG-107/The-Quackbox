import type { Component, ControllerUI, GameResult, Player } from "@quackbox/protocol";
import { Connection, type ConnectionState } from "./net.js";
import "./styles.css";

const STORAGE = {
  token: "quackbox:token",
  name: "quackbox:name",
  room: "quackbox:room",
} as const;

function requireAppRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Controller is missing its #app element.");
  return element;
}

const app = requireAppRoot();

interface ViewState {
  status: ConnectionState;
  room: string | null;
  playerId: string | null;
  players: Player[];
  ui: ControllerUI | null;
  notice: string | null;
  results: GameResult[] | null;
  ended: boolean;
}

function roomFromUrl(): string | null {
  const room = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
  if (/^[A-Z0-9]{4}$/.test(room)) return room;
  const stored = localStorage.getItem(STORAGE.room) ?? "";
  return stored.length === 4 ? stored : null;
}

const state: ViewState = {
  status: "idle",
  room: roomFromUrl(),
  playerId: null,
  players: [],
  ui: null,
  notice: null,
  results: null,
  ended: false,
};

const connection = new Connection({
  onState(status) {
    state.status = status;
    render();
  },
  onWelcome(message) {
    localStorage.setItem(STORAGE.room, message.room);
    state.room = message.room;
    state.playerId = message.playerId;
    state.players = message.players;
    state.ui = message.ui;
    state.notice = null;
    state.ended = false;
    render();
  },
  onUI(message) {
    if (state.ui && message.ui.v < state.ui.v) return;
    state.ui = message.ui;
    render();
  },
  onRoom(message) {
    state.room = message.room;
    state.players = message.players;
    render();
  },
  onEnded(results) {
    state.results = results;
    state.ui = null;
    state.ended = true;
    render();
  },
  onKicked(reason) {
    state.playerId = null;
    state.ui = null;
    state.players = [];
    state.notice = reason;
    render();
  },
  onError(code, message) {
    state.notice = message;
    if (code === "room-not-found" || code === "protocol") connection.stop();
    render();
  },
});

const me = (): Player | null => state.players.find((player) => player.id === state.playerId) ?? null;

function render(): void {
  const typedName = document.querySelector<HTMLInputElement>("#name")?.value ?? "";
  app.innerHTML = state.playerId ? roomView() : joinView();
  if (!state.playerId) {
    const input = document.querySelector<HTMLInputElement>("#name");
    if (input) input.value = typedName || localStorage.getItem(STORAGE.name) || "";
  }
  bind();
}

function joinView(): string {
  const busy = state.status === "connecting" || state.status === "reconnecting";
  return `
    <section class="card">
      <p class="eyebrow">The QuackBox</p>
      <h1>Join the party</h1>
      <p class="muted">Type a name. You are on the same Wi-Fi as the TV, right?</p>
      <form id="join-form" autocomplete="off">
        <label for="name">Your name</label>
        <input id="name" name="name" maxlength="24" enterkeyhint="go" required
               autocomplete="nickname" placeholder="Pato" />
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
    </p>
  `;
}

function roomView(): string {
  const player = me();
  return `
    <header class="bar">
      <span class="who">
        <i class="swatch" style="background:${player?.color ?? "#fff"}"></i>
        ${escapeHtml(player?.name ?? "You")}
      </span>
      <span class="room">${escapeHtml(state.room ?? "")}</span>
    </header>
    ${statusLine()}
    <section class="stage">${stageView()}</section>
    <footer class="roster">
      <p class="muted small">
        ${state.players.filter((entry) => entry.connected).length} of ${state.players.length}
        players connected — look at the TV
      </p>
      <ul>${state.players.map(rosterRow).join("")}</ul>
    </footer>
  `;
}

function statusLine(): string {
  if (state.status === "open") return "";
  const label =
    state.status === "reconnecting" ? "Reconnecting…" : state.status === "connecting" ? "Connecting…" : "Disconnected";
  return `<p class="pill warn">${label}</p>`;
}

function stageView(): string {
  if (state.ended) {
    const result = state.results?.find((entry) => entry.playerId === state.playerId);
    const text = result ? `${result.score} points` : "Round over";
    return `<div class="waiting"><strong>${escapeHtml(text)}</strong><span>Wait for the host…</span></div>`;
  }
  if (!state.ui) {
    return `<div class="waiting"><strong>You're in!</strong><span>The host will start a game soon.</span></div>`;
  }
  if (state.ui.components.length === 0) {
    return `<div class="waiting"><strong>Look at the TV</strong></div>`;
  }
  return state.ui.components.map(componentView).join("");
}

function componentView(component: Component): string {
  switch (component.type) {
    case "label":
      return `<p class="label">${escapeHtml(component.text)}</p>`;
    case "waiting":
      return `<div class="waiting"><strong>${escapeHtml(component.text ?? "Waiting…")}</strong></div>`;
    default:
      return `<div class="pending">${escapeHtml(String(component.type))} control lands in Phase 3</div>`;
  }
}

function rosterRow(player: Player): string {
  const dot = player.connected ? "●" : "○";
  const you = player.id === state.playerId ? " you" : "";
  return `<li class="small${you}"><i class="swatch" style="background:${player.color}"></i>${dot} ${escapeHtml(player.name)}</li>`;
}

function bind(): void {
  const form = document.querySelector<HTMLFormElement>("#join-form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
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
    connection.start({ ...(state.room ? { room: state.room } : {}), name });
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// A stored token means this phone already has a slot: rejoin silently.
const storedName = localStorage.getItem(STORAGE.name);
if (localStorage.getItem(STORAGE.token) && storedName) {
  connection.start({ ...(state.room ? { room: state.room } : {}), name: storedName });
}

render();
