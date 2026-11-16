import type { GameInfo, LauncherState, QuackboxApi } from "../shared/api.js";
import type { GameResult, UITarget } from "@quackbox/protocol";
import "./styles.css";

function requireRoot(): HTMLElement {
  const element = document.querySelector<HTMLElement>("#app");
  if (!element) throw new Error("Lobby is missing its #app element.");
  return element;
}

const app = requireRoot();
const bridge = window.quackbox;

if (!bridge) {
  app.innerHTML = `<p class="alert">Open this lobby through the QuackBox launcher.</p>`;
} else {
  run(bridge);
}

function run(api: QuackboxApi): void {
  let state: LauncherState | null = null;
  let pending: LauncherState | null = null;
  let editing: { id: string; value: string } | null = null;
  /** URL currently in the iframe; prevents a roster update from reloading a game. */
  let stagedUrl: string | null = null;
  let frame: HTMLIFrameElement | null = null;
  /** A cartridge that never says hello is treated as a crash, not a black screen. */
  const READY_TIMEOUT_MS = 10_000;
  let readyTimer: number | null = null;
  let crashVisible = false;

  api.onState((next) => {
    // Do not clobber an open rename field; the state is applied when editing ends.
    if (editing) {
      pending = next;
      return;
    }
    state = next;
    render();
  });

  void api.getState().then((initial) => {
    state = initial;
    render();
    void api.ready();
  });

  // --- cartridge bridge -----------------------------------------------------

  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return;

    const data: unknown = event.data;
    if (typeof data !== "object" || data === null) return;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== "string" || !type.startsWith("quackbox:")) return;

    const payload = data as Record<string, unknown>;
    switch (type) {
      case "quackbox:ready":
        clearReadyTimer();
        sendInit();
        break;
      case "quackbox:error":
        showCrash("The cartridge hit an error", crashDetail(payload));
        break;
      case "quackbox:setUI":
        void api.setGameUI(payload.target as UITarget, payload.ui as never);
        break;
      case "quackbox:send":
        void api.sendGameEvent(
          payload.playerId as string,
          payload.event as string,
          payload.data,
        );
        break;
      case "quackbox:broadcast":
        void api.broadcastGameEvent(payload.event as string, payload.data);
        break;
      case "quackbox:end":
        void api.endGame(payload.results as GameResult[]);
        break;
      case "quackbox:log":
        void api.logFromGame(Array.isArray(payload.args) ? payload.args : []);
        break;
    }
  });

  api.onGameInput((player, input) => {
    postToFrame({ type: "quackbox:input", player, input });
  });

  api.onPlayerEvent((event) => {
    postToFrame({ type: "quackbox:player", kind: event.kind, player: event.player });
  });

  function postToFrame(message: unknown): void {
    frame?.contentWindow?.postMessage(message, "*");
  }

  function sendInit(): void {
    if (!state) return;
    postToFrame({
      type: "quackbox:init",
      gameId: state.selectedGameId,
      players: state.players,
      config: {},
    });
  }

  // --- rendering ------------------------------------------------------------

  function render(): void {
    if (!state) return;

    if (state.gameUrl !== null && state.gameUrl === stagedUrl) {
      updateStageMeta(state);
      return;
    }

    if (frame) {
      postToFrame({ type: "quackbox:stop" });
      frame = null;
    }
    clearReadyTimer();

    stagedUrl = state.gameUrl;
    app.innerHTML = state.gameUrl ? stageView(state) : lobbyView(state);
    bind();

    frame = app.querySelector<HTMLIFrameElement>("#game");
    crashVisible = false;
    if (frame) armReadyTimer();

    if (editing) {
      const input = app.querySelector<HTMLInputElement>(".rename-input");
      input?.focus();
      input?.select();
    }
  }

  function connectedCount(current: LauncherState): number {
    return current.players.filter((player) => player.connected).length;
  }

  function lobbyView(current: LauncherState): string {
    return `
      <div class="shell">
        <header class="top">
          <div class="brand">
            <span class="logo">🦆</span>
            <div>
              <h1>The QuackBox</h1>
              <p class="muted small">${connectedCount(current)} of ${current.players.length} players connected</p>
            </div>
          </div>
          <div class="room">
            <span class="muted small">Room code</span>
            <strong>${escapeHtml(current.room)}</strong>
          </div>
        </header>

        ${current.startupError ? `<p class="alert">${escapeHtml(current.startupError)}</p>` : ""}

        <main class="lobby">
          <section class="panel join">
            ${joinPanel(current)}
          </section>
          <section class="panel roster-panel">
            <div class="panelhead">
              <h2>Players</h2>
              <span class="badge">${current.players.length}</span>
            </div>
            ${playersView(current)}
          </section>
        </main>

        <section class="panel games">
          <div class="panelhead">
            <h2>Cartridges</h2>
            <button id="refresh" class="ghost">Refresh</button>
          </div>
          ${gamesView(current)}
        </section>
      </div>
    `;
  }

  function joinPanel(current: LauncherState): string {
    if (!current.joinUrl) {
      return `<p class="alert">No LAN address found. Connect this machine to Wi-Fi, or pick a network below. Phones cannot reach a hub with no LAN address.</p>${interfacePicker(current)}${connectionHelp(current)}`;
    }

    return `
      <div class="qr">${current.qrSvg ?? ""}</div>
      <code class="url">${escapeHtml(current.joinUrl)}</code>
      <p class="muted small">Scan with a phone camera, or type the address.</p>
      ${interfacePicker(current)}
      ${connectionHelp(current)}
    `;
  }

  /**
   * The host-side troubleshooting screen. It is always available because the
   * moments it is needed — nobody has joined yet — are exactly when a host has
   * no other feedback to go on.
   */
  function connectionHelp(current: LauncherState): string {
    return `
      <details class="help">
        <summary>Phones can't join?</summary>
        <ol>
          <li><strong>Same network.</strong> The phone must be on the same Wi-Fi as this computer — not a guest network, and not mobile data.</li>
          <li><strong>Allow the firewall.</strong> ${firewallHelp(current.platform, current.port)}</li>
          <li><strong>Turn off AP isolation.</strong> Guest networks and many routers block phone-to-laptop traffic. Disable “AP isolation”, “client isolation” or “guest mode” for the network the TV is on.</li>
          <li><strong>Type the address.</strong> Open <code>${escapeHtml(current.joinUrl ?? "http://<this computer's IP>:port")}</code> on the phone and enter room <code>${escapeHtml(current.room)}</code>.</li>
          <li><strong>Turn off VPNs.</strong> A VPN on the phone or the host can hide the LAN from both sides.</li>
        </ol>
        <p class="muted small">If the page never loads, it is the network or the firewall — the room code only matters once the phone reaches this server.</p>
      </details>`;
  }

  function firewallHelp(platform: string, port: number): string {
    switch (platform) {
      case "win32":
        return `Windows asked for access the first time the host started — choose “Allow access” on <em>Private networks</em>. If that prompt was dismissed, open Windows Security → Firewall &amp; network protection → Allow an app through the firewall and enable Node.js / The QuackBox on Private.`;
      case "darwin":
        return `macOS asks whether to allow incoming connections — click Allow. If it was denied, open System Settings → Network → Firewall → Options and allow the app.`;
      case "linux":
        return `Allow the hub port through the local firewall, for example <code>ufw allow ${port}</code>.`;
      default:
        return `Allow incoming connections for this app on private networks.`;
    }
  }

  function interfacePicker(current: LauncherState): string {
    if (current.lan.length === 0) return "";
    if (current.lan.length === 1) {
      return `<p class="muted small">Network: ${escapeHtml(current.lan[0]?.iface ?? "")}</p>`;
    }
    const options = current.lan
      .map(
        (entry) =>
          `<option value="${escapeHtml(entry.iface)}" ${entry.iface === current.active ? "selected" : ""}>${escapeHtml(entry.iface)} — ${escapeHtml(entry.address)}</option>`,
      )
      .join("");
    return `<label class="field">Network <select id="iface">${options}</select></label>`;
  }

  function playersView(current: LauncherState): string {
    if (current.players.length === 0) {
      return `<p class="empty">No phones yet. They appear here as they join.</p>`;
    }

    const rows = current.players.map((player) => {
      if (editing?.id === player.id) {
        return `
          <li class="row editing">
            <i class="swatch" style="background:${player.color}"></i>
            <input class="rename-input" value="${escapeHtml(editing.value)}" maxlength="24" />
            <button class="ghost" data-save="${player.id}">Save</button>
            <button class="ghost" data-cancel="1">Cancel</button>
          </li>`;
      }

      return `
        <li class="row">
          <i class="swatch" style="background:${player.color}"></i>
          <span class="name">${escapeHtml(player.name)}</span>
          <span class="state ${player.connected ? "here" : "away"}">${player.connected ? "here" : "away"}</span>
          <button class="ghost" data-rename="${player.id}">Rename</button>
          <button class="ghost danger" data-kick="${player.id}">Kick</button>
        </li>`;
    });

    return `<ul class="roster">${rows.join("")}</ul>`;
  }

  function gamesView(current: LauncherState): string {
    if (current.gamesError) return `<p class="alert">${escapeHtml(current.gamesError)}</p>`;
    if (current.games.length === 0) {
      return `<p class="empty">No cartridges yet. Drop a folder with a <code>manifest.json</code> into <code>games/</code>, then refresh.</p>`;
    }
    return `<ul class="carts">${current.games.map(cartView).join("")}</ul>`;
  }

  function cartView(game: GameInfo): string {
    const range = game.players.recommended
      ? `${game.players.recommended[0]}–${game.players.recommended[1]}`
      : `${game.players.min}–${game.players.max}`;
    const meta = game.error
      ? escapeHtml(game.error)
      : `${range} players · v${escapeHtml(game.version)} · reconnect: ${escapeHtml(game.reconnect)}`;
    const tags = game.tags.map((tag) => `<em>${escapeHtml(tag)}</em>`).join("");

    return `
      <li>
        <button class="cart ${game.error ? "broken" : ""}" data-game="${escapeHtml(game.id)}" ${game.error ? "disabled" : ""}>
          <strong>${escapeHtml(game.name)}</strong>
          <span class="muted small">${meta}</span>
          ${tags ? `<span class="tags">${tags}</span>` : ""}
        </button>
      </li>`;
  }

  function stageView(current: LauncherState): string {
    const game = current.games.find((entry) => entry.id === current.selectedGameId);
    const title = game?.name ?? "Cartridge";
    return `
      <div class="stage">
        <header class="top">
          <div class="brand">
            <h1>${escapeHtml(title)}</h1>
            <p class="muted small" id="stage-players">${connectedCount(current)} connected</p>
          </div>
          <button class="ghost" data-back="1">Back to lobby</button>
        </header>
        <div class="stage-body">
          <iframe
            id="game"
            class="game-frame"
            title="${escapeHtml(title)}"
            src="${escapeHtml(current.gameUrl ?? "")}"
            sandbox="allow-scripts"
          ></iframe>
          <div id="game-crash" class="crash" hidden>
            <div class="crash-card">
              <p class="eyebrow">Cartridge stopped</p>
              <h2 id="crash-title"></h2>
              <p id="crash-detail" class="muted small"></p>
              <div class="crash-actions">
                <button id="reload" class="ghost">Reload cartridge</button>
                <button class="ghost" data-back="1">Back to lobby</button>
              </div>
            </div>
          </div>
        </div>
        <p class="hint">The cartridge talks to the hub only through the QuackBox SDK bridge.</p>
      </div>
    `;
  }

  function updateStageMeta(current: LauncherState): void {
    const meta = app.querySelector<HTMLElement>("#stage-players");
    if (meta) meta.textContent = `${connectedCount(current)} connected`;
  }

  // --- cartridge crash boundary ---------------------------------------------

  function armReadyTimer(): void {
    clearReadyTimer();
    readyTimer = window.setTimeout(() => {
      readyTimer = null;
      showCrash(
        "This cartridge did not start",
        `It did not answer within ${READY_TIMEOUT_MS / 1000} seconds. It may have crashed while loading.`,
      );
    }, READY_TIMEOUT_MS);
  }

  function clearReadyTimer(): void {
    if (readyTimer === null) return;
    window.clearTimeout(readyTimer);
    readyTimer = null;
  }

  function crashDetail(payload: Record<string, unknown>): string {
    const message = typeof payload.message === "string" ? payload.message : "Unknown error.";
    const stack = typeof payload.stack === "string" ? payload.stack.split("\n")[0] ?? "" : "";
    const detail = stack && !message.includes(stack) ? `${message} (${stack})` : message;
    return detail.slice(0, 400);
  }

  function showCrash(title: string, detail: string): void {
    if (!frame || crashVisible) return;
    crashVisible = true;
    clearReadyTimer();
    console.warn(`[stage] ${title}: ${detail}`);

    const panel = app.querySelector<HTMLElement>("#game-crash");
    if (!panel) return;
    const heading = panel.querySelector<HTMLElement>("#crash-title");
    const text = panel.querySelector<HTMLElement>("#crash-detail");
    if (heading) heading.textContent = title;
    if (text) text.textContent = detail;
    panel.hidden = false;
  }

  function reloadStage(): void {
    const url = state?.gameUrl;
    if (!frame || !url) return;

    const panel = app.querySelector<HTMLElement>("#game-crash");
    if (panel) panel.hidden = true;
    crashVisible = false;
    armReadyTimer();
    // Assigning src to the same URL re-navigates the frame, which is exactly
    // the fresh start a crashed cartridge needs.
    frame.src = url;
  }

  function bind(): void {
    app.querySelector<HTMLSelectElement>("#iface")?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      void api.setInterface(value);
    });

    app.querySelector<HTMLButtonElement>("#refresh")?.addEventListener("click", () => {
      void api.refreshGames();
    });

    app.querySelector<HTMLButtonElement>("#reload")?.addEventListener("click", reloadStage);

    app.onclick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      if (target.closest("[data-back]")) {
        void api.selectGame(null);
        return;
      }

      const cart = target.closest<HTMLElement>("[data-game]");
      if (cart?.dataset.game) {
        void api.selectGame(cart.dataset.game);
        return;
      }

      const rename = target.closest<HTMLElement>("[data-rename]");
      if (rename?.dataset.rename) {
        startEditing(rename.dataset.rename);
        return;
      }

      const kick = target.closest<HTMLElement>("[data-kick]");
      if (kick?.dataset.kick) {
        void api.kick(kick.dataset.kick);
        return;
      }

      const save = target.closest<HTMLElement>("[data-save]");
      if (save?.dataset.save) {
        commitRename(save.dataset.save);
        return;
      }

      if (target.closest("[data-cancel]")) cancelEditing();
    };

    app.onkeydown = (event) => {
      if (!editing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        commitRename(editing.id);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
      }
    };
  }

  function startEditing(id: string): void {
    const player = state?.players.find((entry) => entry.id === id);
    if (!player) return;
    editing = { id, value: player.name };
    render();
  }

  function commitRename(id: string): void {
    if (!editing || editing.id !== id) return;
    const input = app.querySelector<HTMLInputElement>(".rename-input");
    const name = (input?.value ?? editing.value).trim().slice(0, 24);
    editing = null;
    if (name) void api.rename(id, name);
    applyPending();
    render();
  }

  function cancelEditing(): void {
    editing = null;
    applyPending();
    render();
  }

  function applyPending(): void {
    if (!pending) return;
    state = pending;
    pending = null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
