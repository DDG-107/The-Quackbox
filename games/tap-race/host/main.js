import { defineGame, ui } from "/sdk/index.js";

// Everyone taps for 20 seconds. Renders a top-ten board, not 100 rows, and
// never sends per-tap updates to the phones.

const ROUND_MS = 20_000;
const MAX_ROWS = 10;
const TAP_UI = ui.buttons([{ id: "tap", label: "TAP!", style: "big" }]);

const scores = new Map();
const names = new Map();

const refs = {
  clock: document.querySelector("#clock"),
  total: document.querySelector("#total"),
  players: document.querySelector("#players"),
  leader: document.querySelector("#leader"),
  board: document.querySelector("#board"),
  status: document.querySelector("#status"),
};

let hub = null;
let endsAt = 0;
let finished = false;
let renderHandle = 0;
let beatHandle = 0;
let endHandle = 0;

defineGame({
  onStart(context) {
    hub = context;
    scores.clear();
    names.clear();

    for (const player of context.players.values()) {
      scores.set(player.id, 0);
      names.set(player.id, player.name);
    }

    finished = false;
    endsAt = performance.now() + ROUND_MS;
    context.setUI("all", TAP_UI);
    context.log("tap-race start players=" + context.players.size);

    renderHandle = window.setInterval(() => paint(performance.now()), 120);
    beatHandle = window.setInterval(() => {
      if (!finished) hub?.log("tap-race taps=" + totalScore() + " players=" + (hub?.players.size ?? 0));
    }, 5000);
    endHandle = window.setTimeout(finish, ROUND_MS);

    paint(performance.now());
  },

  onPlayerJoin(player) {
    if (!scores.has(player.id)) scores.set(player.id, 0);
    names.set(player.id, player.name);
    hub?.setUI(player.id, TAP_UI);
  },

  onPlayerRejoin(player) {
    names.set(player.id, player.name);
    hub?.setUI(player.id, TAP_UI);
  },

  onPlayerRemoved(player) {
    scores.delete(player.id);
  },

  onInput(player, input) {
    if (finished || input.id !== "tap" || input.k !== "press") return;
    scores.set(player.id, (scores.get(player.id) ?? 0) + 1);
  },

  onStop() {
    window.clearInterval(renderHandle);
    window.clearInterval(beatHandle);
    window.clearTimeout(endHandle);
    hub = null;
  },
});

function nameOf(playerId) {
  return names.get(playerId) ?? "Player";
}

function totalScore() {
  return [...scores.values()].reduce((sum, score) => sum + score, 0);
}

function sortedScores() {
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

function paint(now) {
  const sorted = sortedScores();
  refs.clock.textContent = String(Math.max(0, Math.ceil((endsAt - now) / 1000)));
  refs.total.textContent = totalScore().toLocaleString();
  refs.players.textContent = String(hub?.players.size ?? scores.size);
  refs.leader.textContent = sorted[0] ? nameOf(sorted[0][0]) : "–";

  const best = sorted[0]?.[1] ?? 0;
  refs.board.replaceChildren(
    ...sorted.slice(0, MAX_ROWS).map(([playerId, score], index) => {
      const row = document.createElement("li");
      row.style.setProperty("--fill", `${best === 0 ? 0 : Math.round((score / best) * 100)}%`);

      const rank = document.createElement("span");
      rank.className = "rank";
      rank.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = nameOf(playerId);

      const value = document.createElement("span");
      value.className = "score";
      value.textContent = String(score);

      row.append(rank, name, value);
      return row;
    }),
  );
}

function finish() {
  if (finished) return;
  finished = true;
  window.clearInterval(beatHandle);

  const results = sortedScores().map(([playerId, score]) => ({ playerId, score }));
  const winner = results[0];

  refs.status.textContent = winner
    ? `Winner: ${nameOf(winner.playerId)} with ${winner.score} taps`
    : "Nobody tapped. Bold strategy.";

  paint(performance.now());

  hub?.log(
    "tap-race finished",
    `winner=${winner ? nameOf(winner.playerId) : "none"}`,
    `top3=${results
      .slice(0, 3)
      .map((entry) => `${nameOf(entry.playerId)}:${entry.score}`)
      .join(",")}`,
    `total=${results.reduce((sum, entry) => sum + entry.score, 0)}`,
  );

  endHandle = window.setTimeout(() => hub?.end(results), 4000);
}
