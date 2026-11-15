import { defineGame, ui } from "/sdk/index.js";

// Everyone draws the same prompt, the host shows a gallery, the room votes.
// Submissions are capped so one screen never has to render 100 drawings.

const PROMPTS = [
  "a duck in a hat",
  "a haunted lamp",
  "a very round cat",
  "a confused robot",
  "a cursed sandwich",
  "a proud potato",
];

const PHASE_MS = { prompt: 6000, draw: 22_000, vote: 14_000, results: 6000 };
const DRAW_COLORS = ["#111111", "#ff5c8a", "#36d1ff", "#ffd23f"];
const MAX_CANDIDATES = 6;

const names = new Map();
const drawings = new Map();
const votes = new Map();

const refs = {
  phase: document.querySelector("#phase"),
  prompt: document.querySelector("#prompt"),
  timer: document.querySelector("#timer"),
  count: document.querySelector("#count"),
  gallery: document.querySelector("#gallery"),
  status: document.querySelector("#status"),
};

let hub = null;
let phase = "idle";
let phaseEndsAt = 0;
let phaseTimer = 0;
let endHandle = 0;
let renderHandle = 0;
let lastPaint = 0;
let prompt = "";
let candidates = [];

defineGame({
  onStart(context) {
    hub = context;
    for (const player of context.players.values()) names.set(player.id, player.name);
    renderHandle = window.setInterval(() => paint(performance.now()), 200);
    context.log(`draw-vote start players=${context.players.size}`);
    startPrompt();
  },

  onPlayerJoin(player) {
    names.set(player.id, player.name);
    sendPhaseUI(player.id);
  },

  onPlayerRejoin(player) {
    names.set(player.id, player.name);
    sendPhaseUI(player.id);
  },

  onPlayerRemoved(player) {
    drawings.delete(player.id);
    votes.delete(player.id);
  },

  onInput(player, input) {
    if (phase === "draw" && input.k === "stroke" && input.id === "draw") {
      const segments = drawings.get(player.id) ?? [];
      segments.push(input.pts);
      drawings.set(player.id, segments);
      return;
    }

    if (phase === "vote" && input.k === "choice" && input.id === "vote") {
      const pick = input.v[0];
      if (!pick || pick === player.id || !candidates.includes(pick)) return;
      votes.set(player.id, pick);
    }
  },

  onStop() {
    window.clearInterval(renderHandle);
    window.clearTimeout(phaseTimer);
    window.clearTimeout(endHandle);
    hub = null;
  },
});

function startPrompt() {
  drawings.clear();
  votes.clear();
  candidates = [];
  refs.gallery.replaceChildren();

  prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)] ?? PROMPTS[0];
  phase = "prompt";
  phaseEndsAt = performance.now() + PHASE_MS.prompt;
  refs.status.textContent = "Phones are getting ready…";

  hub?.setUI("all", ui.label(`Get ready: ${prompt}`));
  hub?.log(`draw-vote prompt=${prompt}`);

  phaseTimer = window.setTimeout(startDraw, PHASE_MS.prompt);
}

function drawUI() {
  return ui.drawpad({
    id: "draw",
    prompt: `Draw: ${prompt}`,
    colors: DRAW_COLORS,
    strokeMax: 1600,
  });
}

function startDraw() {
  phase = "draw";
  phaseEndsAt = performance.now() + PHASE_MS.draw;
  refs.status.textContent = "Draw on your phone";

  for (const player of hub?.players.values() ?? []) {
    if (player.connected) hub?.setUI(player.id, drawUI());
  }

  hub?.log("draw-vote drawing phase");
  phaseTimer = window.setTimeout(startVote, PHASE_MS.draw);
}

function voteUI(playerId) {
  const options = candidates
    .filter((artistId) => artistId !== playerId)
    .map((artistId) => ({ id: artistId, label: nameOf(artistId) }));

  return options.length > 0
    ? ui.choice(options, { id: "vote" })
    : ui.waiting("Everyone is voting on other drawings");
}

function startVote() {
  candidates = shuffle([...drawings.keys()]).slice(0, MAX_CANDIDATES);

  if (candidates.length === 0) {
    refs.status.textContent = "Nobody drew anything. Awkward.";
    startResults();
    return;
  }

  phase = "vote";
  phaseEndsAt = performance.now() + PHASE_MS.vote;
  refs.status.textContent = "Vote for your favourite on your phone";

  for (const player of hub?.players.values() ?? []) {
    if (player.connected) hub?.setUI(player.id, voteUI(player.id));
  }

  hub?.log(`draw-vote voting phase candidates=${candidates.length}`);
  phaseTimer = window.setTimeout(startResults, PHASE_MS.vote);
}

function startResults() {
  phase = "results";
  phaseEndsAt = performance.now() + PHASE_MS.results;

  hub?.setUI("all", ui.waiting("Look at the TV"));

  const tally = tallyVotes();
  const winner = tally[0];

  refs.status.textContent = winner
    ? `${nameOf(winner.playerId)} wins with ${winner.votes} vote${winner.votes === 1 ? "" : "s"}`
    : "No votes this round";

  hub?.log(
    "draw-vote results",
    `winner=${winner ? `${nameOf(winner.playerId)}:${winner.votes}` : "none"}`,
    `votes=${votes.size}`,
  );

  const results = [...drawings.keys()].map((playerId) => ({
    playerId,
    score: tally.find((entry) => entry.playerId === playerId)?.votes ?? 0,
  }));

  endHandle = window.setTimeout(() => hub?.end(results), PHASE_MS.results);
}

function sendPhaseUI(playerId) {
  if (phase === "prompt") hub?.setUI(playerId, ui.label(`Get ready: ${prompt}`));
  else if (phase === "draw") hub?.setUI(playerId, drawUI());
  else if (phase === "vote") hub?.setUI(playerId, voteUI(playerId));
  else hub?.setUI(playerId, ui.waiting("Look at the TV"));
}

function tallyVotes() {
  const counts = new Map();
  for (const artistId of candidates) counts.set(artistId, 0);
  for (const artistId of votes.values()) counts.set(artistId, (counts.get(artistId) ?? 0) + 1);

  return [...counts.entries()]
    .map(([playerId, votes]) => ({ playerId, votes }))
    .sort((a, b) => b.votes - a.votes);
}

function nameOf(playerId) {
  return names.get(playerId) ?? "Player";
}

function phaseLabel() {
  if (phase === "prompt") return "Get ready";
  if (phase === "draw") return "Drawing";
  if (phase === "vote") return "Voting";
  if (phase === "results") return "Results";
  return "Waiting";
}

function paint(now) {
  refs.timer.textContent = String(Math.max(0, Math.ceil((phaseEndsAt - now) / 1000)));
  refs.phase.textContent = phaseLabel();

  if (phase === "prompt" || phase === "draw") {
    refs.prompt.textContent = `Draw: ${prompt}`;
    refs.count.textContent = `${drawings.size} drawing${drawings.size === 1 ? "" : "s"} in`;
  } else if (phase === "vote") {
    refs.prompt.textContent = "Vote on the TV";
    refs.count.textContent = `${votes.size} vote${votes.size === 1 ? "" : "s"} in`;
  }

  if (now - lastPaint < 500) return;
  lastPaint = now;

  if (phase === "draw") renderGallery();
  else if (phase === "vote" || phase === "results") renderVoteBoard();
}

function renderGallery() {
  const entries = [...drawings.entries()].slice(-MAX_CANDIDATES);
  refs.gallery.replaceChildren(
    ...entries.map(([playerId, segments]) => card(playerId, segments, nameOf(playerId))),
  );
}

function renderVoteBoard() {
  const tally = new Map(tallyVotes().map((entry) => [entry.playerId, entry.votes]));
  refs.gallery.replaceChildren(
    ...candidates.map((artistId) =>
      card(artistId, drawings.get(artistId) ?? [], `${nameOf(artistId)} · ${tally.get(artistId) ?? 0} votes`),
    ),
  );
}

function card(playerId, segments, caption) {
  const figure = document.createElement("figure");

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  paintSegments(canvas, segments);

  const label = document.createElement("figcaption");
  label.textContent = caption;
  label.dataset.player = playerId;

  figure.append(canvas, label);
  return figure;
}

function paintSegments(canvas, segments) {
  const context = canvas.getContext("2d");
  if (!context) return;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#111111";
  context.fillStyle = "#111111";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const points of segments) {
    const [first] = points;
    if (!first) continue;

    if (points.length === 1) {
      context.beginPath();
      context.arc(first[0] * canvas.width, first[1] * canvas.height, 1.6, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    context.beginPath();
    context.moveTo(first[0] * canvas.width, first[1] * canvas.height);
    for (const point of points.slice(1)) {
      context.lineTo(point[0] * canvas.width, point[1] * canvas.height);
    }
    context.stroke();
  }
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
