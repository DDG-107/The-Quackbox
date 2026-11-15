import { defineGame, ui } from "/sdk/index.js";

// Crowd as one actor: each press nudges a shared rope. Team is decided by join
// order, and only the button matching your team counts.

const ROUND_MS = 30_000;
// One press moves the rope 2% of its length, so ~50 more presses than the other
// side wins; a 50/50 crowd deadlocks, which is the point of a tug-of-war.
const STEP = 0.02;
const BLUE = "blue";
const RED = "red";

const teams = new Map();
const pulls = { blue: 0, red: 0 };

const refs = {
  clock: document.querySelector("#clock"),
  marker: document.querySelector("#marker"),
  bluePulls: document.querySelector("#blue-pulls"),
  redPulls: document.querySelector("#red-pulls"),
  blueCount: document.querySelector("#blue-count"),
  redCount: document.querySelector("#red-count"),
  status: document.querySelector("#status"),
};

let hub = null;
let rope = 0;
let endsAt = 0;
let finished = false;
let joined = 0;
let renderHandle = 0;
let beatHandle = 0;
let endHandle = 0;

function teamUI(team) {
  return team === BLUE
    ? ui.buttons([{ id: "pull-blue", label: "◀ PULL", style: "primary" }])
    : ui.buttons([{ id: "pull-red", label: "PULL ▶", style: "danger" }]);
}

function assign(player) {
  const existing = teams.get(player.id);
  if (existing) return existing;

  const team = joined % 2 === 0 ? BLUE : RED;
  joined += 1;
  teams.set(player.id, team);
  return team;
}

defineGame({
  onStart(context) {
    hub = context;
    teams.clear();
    pulls.blue = 0;
    pulls.red = 0;
    joined = 0;
    rope = 0;
    finished = false;
    endsAt = performance.now() + ROUND_MS;

    for (const player of context.players.values()) assign(player);
    context.setUI("all", ui.waiting("Pulling starts now"));
    for (const [playerId, team] of teams) context.setUI(playerId, teamUI(team));

    context.log(`tug start players=${context.players.size}`);

    renderHandle = window.setInterval(() => paint(performance.now()), 120);
    beatHandle = window.setInterval(() => {
      if (!finished) hub?.log(`tug rope=${rope.toFixed(3)} blue=${pulls.blue} red=${pulls.red}`);
    }, 6000);
    endHandle = window.setTimeout(finish, ROUND_MS);

    paint(performance.now());
  },

  onPlayerJoin(player) {
    const team = assign(player);
    hub?.setUI(player.id, teamUI(team));
  },

  onPlayerRejoin(player) {
    const team = assign(player);
    hub?.setUI(player.id, teamUI(team));
  },

  onPlayerRemoved(player) {
    teams.delete(player.id);
  },

  onInput(player, input) {
    if (finished || input.k !== "press") return;

    const team = assign(player);
    if (input.id === "pull-blue" && team === BLUE) {
      rope = Math.max(-1, rope - STEP);
      pulls.blue += 1;
    } else if (input.id === "pull-red" && team === RED) {
      rope = Math.min(1, rope + STEP);
      pulls.red += 1;
    } else {
      return;
    }

    if (Math.abs(rope) >= 1) finish();
  },

  onStop() {
    window.clearInterval(renderHandle);
    window.clearInterval(beatHandle);
    window.clearTimeout(endHandle);
    hub = null;
  },
});

function paint(now) {
  refs.clock.textContent = String(Math.max(0, Math.ceil((endsAt - now) / 1000)));
  refs.bluePulls.textContent = String(pulls.blue);
  refs.redPulls.textContent = String(pulls.red);

  let blue = 0;
  for (const team of teams.values()) if (team === BLUE) blue += 1;
  refs.blueCount.textContent = String(blue);
  refs.redCount.textContent = String(teams.size - blue);

  refs.marker.style.left = `${50 + rope * 46}%`;
}

function finish() {
  if (finished) return;
  finished = true;
  window.clearInterval(beatHandle);

  const winner = rope <= -1 ? BLUE : rope >= 1 ? RED : rope < 0 ? BLUE : rope > 0 ? RED : null;

  refs.status.textContent =
    winner === BLUE
      ? "Blue side wins!"
      : winner === RED
        ? "Red side wins!"
        : "Dead even. Nobody wins.";

  const results = [...teams.entries()].map(([playerId, team]) => ({
    playerId,
    score: winner !== null && winner === team ? 1 : 0,
  }));

  hub?.log(
    "tug finished",
    `winner=${winner ?? "none"}`,
    `rope=${rope.toFixed(3)}`,
    `blue=${pulls.blue}`,
    `red=${pulls.red}`,
  );

  endHandle = window.setTimeout(() => hub?.end(results), 4000);
}
