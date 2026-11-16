import type { StandaloneInfo } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function splashHtml(info: StandaloneInfo): string {
  const join = info.joinUrl
    ? `<code class="url">${escapeHtml(info.joinUrl)}</code>
       <p class="muted">Scan with a phone camera, or type the address.</p>`
    : `<p class="alert">No LAN address found. Connect this computer to the same Wi-Fi as the phones.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(info.name)}</title>
    <style>
      :root { color-scheme: dark; --bg: #0b0b12; --panel: #161622; --line: #2b2b3d; --text: #f4f4fb; --muted: #9a9ab0; --accent: #ffd23f; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(120% 90% at 20% 0%, #1b1b2b 0%, var(--bg) 60%); color: var(--text); font: 15px/1.5 ui-rounded, system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { width: min(42rem, calc(100vw - 2rem)); padding: 1.5rem; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.2rem; }
      .brand { display: flex; align-items: center; gap: .8rem; }
      .logo { font-size: 2rem; filter: drop-shadow(0 2px 6px rgba(255,210,63,.35)); }
      h1 { margin: 0; font-size: 1.35rem; letter-spacing: -.01em; }
      .muted { color: var(--muted); font-size: .85rem; }
      .room { display: grid; justify-items: end; gap: .1rem; }
      .room strong { color: var(--accent); font-size: 1.5rem; letter-spacing: .3em; }
      .join { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 1.1rem; display: grid; justify-items: center; gap: .7rem; text-align: center; }
      .qr { width: min(280px, 60vw); aspect-ratio: 1; background: #fff; border-radius: 12px; padding: .55rem; }
      .url { color: var(--accent); word-break: break-all; font-size: .9rem; }
      .alert { margin: 0; padding: .75rem .9rem; border-radius: 12px; background: #2a1616; border: 1px solid #5a2626; color: #ffd7d7; font-size: .85rem; text-align: left; }
      .players { list-style: none; margin: .9rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: .35rem; justify-content: center; min-height: 1.9rem; }
      .players li { padding: .2rem .55rem; border-radius: 999px; background: #222235; font-size: .8rem; display: flex; align-items: center; gap: .35rem; }
      .dot { width: .55rem; height: .55rem; border-radius: 999px; }
      .empty { color: var(--muted); background: transparent !important; }
      .actions { display: flex; align-items: center; justify-content: center; gap: .8rem; margin-top: 1.2rem; }
      button { font: inherit; cursor: pointer; border: 0; border-radius: 12px; padding: .7rem 1.3rem; background: var(--accent); color: #1a1200; font-weight: 800; }
      button:disabled { opacity: .55; cursor: wait; }
      .note { margin: .8rem 0 0; text-align: center; color: var(--muted); font-size: .78rem; }
      .error { margin-top: .8rem; color: #ff9a9a; text-align: center; min-height: 1.2rem; font-size: .82rem; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="brand">
          <span class="logo">🦆</span>
          <div>
            <h1>${escapeHtml(info.name)}</h1>
            <p class="muted">The QuackBox is running this game</p>
          </div>
        </div>
        <div class="room"><span class="muted">Room code</span><strong>${escapeHtml(info.room)}</strong></div>
      </header>

      <section class="join">
        ${info.qrSvg ? `<div class="qr">${info.qrSvg}</div>` : ""}
        ${join}
        <ul class="players" id="players"></ul>
        <div class="actions">
          <button id="start" type="button">Start game</button>
        </div>
        <p class="note">Phones join with the QR code. You can start before everyone is in — they can join during the match.</p>
        <p class="error" id="error"></p>
      </section>
    </main>
    <script>
      (function () {
        var start = document.getElementById("start");
        var error = document.getElementById("error");
        var list = document.getElementById("players");

        function render(players) {
          list.textContent = "";
          if (!players || players.length === 0) {
            var empty = document.createElement("li");
            empty.className = "empty";
            empty.textContent = "Waiting for phones…";
            list.append(empty);
            return;
          }
          players.forEach(function (player) {
            var item = document.createElement("li");
            var dot = document.createElement("i");
            dot.className = "dot";
            dot.style.background = player.color;
            var name = document.createElement("span");
            name.textContent = player.name + (player.connected ? "" : " (away)");
            item.append(dot, name);
            list.append(item);
          });
        }

        if (window.quackboxStandalone) {
          window.quackboxStandalone.onPlayers(render);
          window.quackboxStandalone.info().then(function (info) {
            render(info.players);
          });
        }

        start.addEventListener("click", async function () {
          start.disabled = true;
          start.textContent = "Starting…";
          error.textContent = "";
          try {
            await window.quackboxStandalone.start();
          } catch (cause) {
            start.disabled = false;
            start.textContent = "Start game";
            error.textContent = cause instanceof Error ? cause.message : String(cause);
          }
        });
      })();
    </script>
  </body>
</html>`;
}
