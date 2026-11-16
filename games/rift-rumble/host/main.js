import { defineGame, ui } from "/sdk/index.js";
import { ROSTER, STAGES } from "./roster.js";

// Rift Rumble: a platform fighter with a character-select phase on the phones.
// The host owns the simulation; phones send an axis and button events only.

const WIDTH = 960;
const HEIGHT = 540;
const FLOOR_Y = 470;
const STEP = 1 / 60;
const GRAVITY = 2000;
const FIGHTER_R = 18;
const STOCKS = 3;
const ROUND_MS = 90_000;
const COUNTDOWN_MS = 4_000;
const RESULTS_MS = 9_000;
const HITSTUN = 0.3;
const RESPAWN_MS = 1.6;
const INVULN_MS = 1.4;

const SPAWNS = [
  { x: 170, y: FLOOR_Y - FIGHTER_R },
  { x: 320, y: FLOOR_Y - FIGHTER_R },
  { x: 640, y: FLOOR_Y - FIGHTER_R },
  { x: 790, y: FLOOR_Y - FIGHTER_R },
  { x: 470, y: FLOOR_Y - FIGHTER_R },
  { x: 295, y: 350 - FIGHTER_R },
  { x: 665, y: 350 - FIGHTER_R },
  { x: 480, y: 240 - FIGHTER_R },
];

const canvas = document.querySelector("#stage");
const ctx = canvas?.getContext("2d") ?? null;
const refs = {
  clock: document.querySelector("#clock"),
  status: document.querySelector("#status"),
  start: document.querySelector("#start"),
  rematch: document.querySelector("#rematch"),
};

const fighters = new Map();
const picks = new Map();
const axes = new Map();
const projectiles = [];
const mines = [];
const particles = [];

let hub = null;
let running = false;
let phase = "select";
let stage = STAGES[0];
let stageIndex = 0;
let countdownEndsAt = 0;
let fightEndsAt = 0;
let resultsUntil = 0;
let raf = 0;
let last = 0;
let accumulator = 0;
let hiddenAt = 0;
let lastBeat = 0;
let matchNumber = 0;
let rematchHandle = 0;
let spawnCursor = 0;

const randomIndex = () => Math.floor(Math.random() * ROSTER.length);

function connectedPlayers() {
  return [...(hub?.players.values() ?? [])].filter((player) => player.connected);
}

function rosterUI() {
  return ui.choice(
    ROSTER.map((character) => ({ id: character.id, label: character.name })),
    { id: "roster" },
  );
}

function pickedUI(character) {
  return ui.stack(
    { type: "label", text: character.name },
    { type: "waiting", text: "Locked in — waiting for the others" },
  );
}

function controlsFor(character) {
  return ui.stack(
    { type: "label", text: character.name },
    { type: "joystick", id: "move", hz: 30 },
    {
      type: "buttons",
      buttons: [
        { id: "attack", label: "ATTACK", style: "primary", cooldownMs: 180 },
        { id: "special1", label: "SP 1", cooldownMs: 600 },
        { id: "special2", label: "SP 2", cooldownMs: 600 },
        { id: "jump", label: "JUMP", style: "ghost" },
        { id: "guard", label: "GUARD", style: "ghost" },
      ],
    },
  );
}

function setHostButtons() {
  if (refs.start) refs.start.hidden = phase !== "select";
  if (refs.rematch) refs.rematch.hidden = phase !== "results";
}

function setStatus(text) {
  if (refs.status) refs.status.textContent = text;
}

function beginSelect() {
  if (!running) return;
  window.clearTimeout(rematchHandle);
  rematchHandle = 0;
  phase = "select";
  picks.clear();
  fighters.clear();
  axes.clear();
  projectiles.length = 0;
  mines.length = 0;
  particles.length = 0;
  accumulator = 0;

  const players = connectedPlayers();
  for (const player of players) hub?.setUI(player.id, rosterUI());
  setHostButtons();
  setStatus(players.length === 0 ? "Waiting for fighters…" : "Choose your fighter on your phone");
  if (refs.clock) refs.clock.textContent = String(Math.floor(ROUND_MS / 1000));
  hub?.log("rift select", `players=${players.length}`);
}

function maybeAutoStart() {
  if (phase !== "select") return;
  const players = connectedPlayers();
  if (players.length >= 2 && players.every((player) => picks.has(player.id))) {
    beginCountdown();
  }
}

function beginCountdown() {
  if (phase !== "select") return;
  phase = "countdown";
  countdownEndsAt = performance.now() + COUNTDOWN_MS;
  setHostButtons();
  setStatus("Get ready…");
  hub?.log("rift countdown", `picks=${picks.size} players=${connectedPlayers().length}`);
}

function forceStart() {
  if (phase !== "select") return;
  const players = connectedPlayers();
  if (players.length === 0) return;
  for (const player of players) {
    if (!picks.has(player.id)) picks.set(player.id, randomIndex());
  }
  beginCountdown();
}

function spawnPoint() {
  const point = SPAWNS[spawnCursor % SPAWNS.length];
  spawnCursor += 1;
  return point;
}

function addFighter(player, character) {
  const spawn = spawnPoint();
  const fighter = {
    id: player.id,
    name: player.name,
    color: player.color,
    char: character,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    damage: 0,
    stocks: STOCKS,
    kos: 0,
    hits: 0,
    shield: character.stats.shield,
    shieldMax: character.stats.shield,
    guardHeld: false,
    airJumps: character.stats.airJumps,
    attackTimer: 0,
    attackCd: 0,
    attackHit: false,
    cds: [0, 0],
    dashTimer: 0,
    dashHit: null,
    hitstun: 0,
    invuln: INVULN_MS,
    respawn: 0,
    flash: 0,
    online: true,
    gone: false,
    lastHitBy: null,
  };
  fighters.set(player.id, fighter);
  axes.set(player.id, { x: 0, y: 0 });
  return fighter;
}

function startMatch() {
  if (phase !== "countdown") return;
  phase = "fight";
  matchNumber += 1;
  stage = STAGES[stageIndex % STAGES.length];
  stageIndex += 1;
  fighters.clear();
  axes.clear();
  projectiles.length = 0;
  mines.length = 0;
  particles.length = 0;
  spawnCursor = 0;
  accumulator = 0;

  for (const player of connectedPlayers()) {
    const index = picks.has(player.id) ? picks.get(player.id) : randomIndex();
    addFighter(player, ROSTER[index]);
  }

  fightEndsAt = performance.now() + ROUND_MS;
  for (const fighter of fighters.values()) hub?.setUI(fighter.id, controlsFor(fighter.char));
  setHostButtons();
  setStatus(fighters.size <= 1 ? "Practice mode — no rivals yet" : "Fight!");

  hub?.log(
    "rift start",
    `stage=${stage.id}`,
    `fighters=${fighters.size}`,
    [...fighters.values()].map((fighter) => `${fighter.name}:${fighter.char.id}`).join(","),
  );
}

function finishMatch(reason) {
  if (phase !== "fight") return;
  phase = "results";
  resultsUntil = performance.now() + RESULTS_MS;

  const standings = [...fighters.values()]
    .map((fighter) => ({
      fighter,
      score: fighter.stocks * 10000 + fighter.kos * 500 + Math.max(0, 900 - Math.round(fighter.damage)),
    }))
    .sort((a, b) => b.score - a.score);

  const winner = standings[0]?.fighter ?? null;
  const label = winner ? `${winner.name} wins as ${winner.char.name}` : "No winner";
  setStatus(label);
  if (refs.clock) refs.clock.textContent = "0";
  hub?.setUI("all", ui.waiting("Round over — look at the TV"));
  setHostButtons();

  hub?.log(
    "rift done",
    `reason=${reason}`,
    `winner=${winner ? winner.char.id : "none"}`,
    `standings=${standings
      .map((entry) => `${entry.fighter.char.id}:${entry.score}`)
      .join(",")}`,
  );

  rematchHandle = window.setTimeout(beginSelect, RESULTS_MS);
}

function checkLastStanding() {
  if (phase !== "fight" || fighters.size < 2) return;
  const alive = [...fighters.values()].filter((fighter) => !fighter.gone);
  if (alive.length <= 1) finishMatch("ko");
}

function burst(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 200;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 0.3 + Math.random() * 0.3,
      color,
    });
  }
}

function damageFighter(attacker, victim, move, dir) {
  if (!attacker || victim.gone || victim.respawn > 0 || victim.invuln > 0) return;

  const blocking = victim.guardHeld && victim.shield > 0 && victim.hitstun <= 0;
  let damage = move.damage ?? 0;
  let knockback = move.knockback ?? 100;

  if (blocking) {
    damage *= 0.35;
    knockback *= 0.45;
    victim.shield = Math.max(0, victim.shield - damage * 2.4);
    if (victim.shield <= 0) {
      victim.guardHeld = false;
      victim.hitstun = 0.8;
      burst(victim.x, victim.y, "#ffd23f", 16);
    }
  }

  victim.damage = Math.min(999, victim.damage + damage);
  const power = (knockback + victim.damage * 4.2) / victim.char.stats.weight;
  victim.vx = dir * power;
  victim.vy = -220 - Math.min(340, power * 0.32);
  victim.grounded = false;
  victim.hitstun = blocking ? 0.14 : HITSTUN;
  victim.lastHitBy = attacker.id;
  victim.flash = 0.18;
  attacker.hits += 1;

  burst(victim.x, victim.y, attacker.char.accent, blocking ? 5 : 10);
}

function ko(fighter) {
  fighter.stocks -= 1;
  const credit = fighter.lastHitBy ? fighters.get(fighter.lastHitBy) : null;
  if (credit && credit !== fighter) credit.kos += 1;

  hub?.log(
    "rift ko",
    fighter.char.id,
    `stocks=${fighter.stocks}`,
    `by=${credit && credit !== fighter ? credit.char.id : "rift"}`,
  );
  burst(fighter.x, Math.min(fighter.y, FLOOR_Y), "#ffd23f", 26);

  if (fighter.stocks <= 0) {
    fighter.gone = true;
    fighter.respawn = 0;
  } else {
    fighter.respawn = RESPAWN_MS;
    fighter.damage = 0;
    fighter.shield = fighter.shieldMax;
    fighter.x = WIDTH / 2;
    fighter.y = HEIGHT + 200;
    fighter.vx = 0;
    fighter.vy = 0;
  }

  checkLastStanding();
}

function aoe(attacker, x, y, radius, move, dir) {
  for (const other of fighters.values()) {
    if (other.id === attacker.id || other.gone || other.respawn > 0) continue;
    if (Math.hypot(other.x - x, other.y - y) <= radius + FIGHTER_R) {
      damageFighter(attacker, other, move, Math.sign(other.x - x) || dir);
    }
  }
}

function useSpecial(fighter, slot) {
  if (fighter.cds[slot] > 0) return;
  const move = fighter.char.specials[slot];
  if (!move) return;

  switch (move.type) {
    case "bolt":
    case "beam":
    case "wave":
      projectiles.push({
        owner: fighter.id,
        x: fighter.x + fighter.facing * 24,
        y: fighter.y - 2,
        vx: fighter.facing * move.speed,
        vy: 0,
        life: move.type === "beam" ? 1.2 : 1.7,
        radius: move.type === "beam" ? 7 : 9,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      burst(fighter.x + fighter.facing * 20, fighter.y, fighter.char.accent, 4);
      break;

    case "dash":
      fighter.vx = fighter.facing * (move.speed ?? 520);
      fighter.dashTimer = 0.22;
      fighter.dashHit = new Set();
      break;

    case "burst":
      aoe(fighter, fighter.x, fighter.y, move.radius ?? 92, move, fighter.facing);
      burst(fighter.x, fighter.y, fighter.char.accent, 18);
      break;

    case "trap":
      mines.push({
        owner: fighter.id,
        x: fighter.x,
        y: fighter.y + FIGHTER_R - 2,
        arm: 0.7,
        life: 9,
        radius: move.radius ?? 46,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      break;

    case "teleport": {
      burst(fighter.x, fighter.y, fighter.char.accent, 12);
      fighter.x = Math.max(30, Math.min(WIDTH - 30, fighter.x + fighter.facing * 150));
      fighter.invuln = Math.max(fighter.invuln, 0.3);
      burst(fighter.x, fighter.y, fighter.char.accent, 12);
      break;
    }

    case "heal":
      fighter.damage = Math.max(0, fighter.damage - (move.heal ?? 25));
      burst(fighter.x, fighter.y, "#7cff6b", 14);
      break;
  }

  fighter.cds[slot] = move.cooldown;
}

function simulate(dt) {
  if (phase !== "fight") return;

  for (const fighter of fighters.values()) {
    if (fighter.gone) continue;

    if (fighter.flash > 0) fighter.flash = Math.max(0, fighter.flash - dt);
    if (fighter.invuln > 0) fighter.invuln = Math.max(0, fighter.invuln - dt);
    if (fighter.attackCd > 0) fighter.attackCd = Math.max(0, fighter.attackCd - dt);
    if (fighter.cds[0] > 0) fighter.cds[0] = Math.max(0, fighter.cds[0] - dt);
    if (fighter.cds[1] > 0) fighter.cds[1] = Math.max(0, fighter.cds[1] - dt);

    if (fighter.respawn > 0) {
      fighter.respawn = Math.max(0, fighter.respawn - dt);
      if (fighter.respawn === 0) {
        const spawn = spawnPoint();
        fighter.x = spawn.x;
        fighter.y = spawn.y;
        fighter.vx = 0;
        fighter.vy = 0;
        fighter.invuln = INVULN_MS;
      }
      continue;
    }

    const guarding = fighter.guardHeld && fighter.shield > 0 && fighter.hitstun <= 0;
    if (guarding) {
      fighter.shield = Math.max(0, fighter.shield - 28 * dt);
      if (fighter.shield === 0) {
        fighter.guardHeld = false;
        fighter.hitstun = 0.8;
        burst(fighter.x, fighter.y, "#ffd23f", 16);
      }
    } else {
      fighter.shield = Math.min(fighter.shieldMax, fighter.shield + 16 * dt);
    }

    if (fighter.hitstun > 0) {
      fighter.hitstun = Math.max(0, fighter.hitstun - dt);
    } else {
      const axis = fighter.online ? axes.get(fighter.id) : null;
      const target = axis && !guarding ? Math.max(-1, Math.min(1, axis.x)) * fighter.char.stats.speed : 0;
      fighter.vx += (target - fighter.vx) * Math.min(1, dt * 16);
    }
    if (Math.abs(fighter.vx) > 14) fighter.facing = Math.sign(fighter.vx);

    fighter.vy = Math.min(1400, fighter.vy + GRAVITY * dt);

    const previousY = fighter.y;
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
    fighter.grounded = false;

    for (const platform of stage.platforms) {
      const bottomBefore = previousY + FIGHTER_R;
      const bottomAfter = fighter.y + FIGHTER_R;
      const withinX = fighter.x >= platform.x - 12 && fighter.x <= platform.x + platform.w + 12;
      if (
        fighter.vy >= 0 &&
        withinX &&
        bottomBefore <= platform.y + 2 &&
        bottomAfter >= platform.y
      ) {
        fighter.y = platform.y - FIGHTER_R;
        fighter.vy = 0;
        fighter.grounded = true;
        fighter.airJumps = fighter.char.stats.airJumps;
      }
    }

    if (fighter.y + FIGHTER_R >= FLOOR_Y) {
      fighter.y = FLOOR_Y - FIGHTER_R;
      fighter.vy = 0;
      fighter.grounded = true;
      fighter.airJumps = fighter.char.stats.airJumps;
    }

    if (fighter.attackTimer > 0) {
      fighter.attackTimer = Math.max(0, fighter.attackTimer - dt);
      if (!fighter.attackHit) {
        for (const other of fighters.values()) {
          if (other === fighter || other.gone || other.respawn > 0) continue;
          const dx = other.x - fighter.x;
          const dy = Math.abs(other.y - fighter.y);
          if (dx * fighter.facing > 4 && Math.abs(dx) <= fighter.char.attack.reach && dy <= fighter.char.attack.arc) {
            damageFighter(fighter, other, fighter.char.attack, fighter.facing);
            fighter.attackHit = true;
            break;
          }
        }
      }
    }

    if (fighter.dashTimer > 0) {
      fighter.dashTimer = Math.max(0, fighter.dashTimer - dt);
      if (fighter.dashHit) {
        for (const other of fighters.values()) {
          if (other.id === fighter.id || other.gone || other.respawn > 0) continue;
          if (Math.abs(other.x - fighter.x) <= 52 && Math.abs(other.y - fighter.y) <= 54) {
            if (!fighter.dashHit.has(other.id)) {
              fighter.dashHit.add(other.id);
              const move = fighter.char.specials[0].type === "dash"
                ? fighter.char.specials[0]
                : fighter.char.specials[1];
              damageFighter(fighter, other, move, fighter.facing);
            }
          }
        }
      }
    }

    if (fighter.x < -50 || fighter.x > WIDTH + 50 || fighter.y > HEIGHT + 70) ko(fighter);
  }

  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const shot = projectiles[index];
    shot.x += shot.vx * dt;
    shot.life -= dt;

    let hitSomething = false;
    for (const fighter of fighters.values()) {
      if (fighter.id === shot.owner || fighter.gone || fighter.respawn > 0) continue;
      if (Math.hypot(fighter.x - shot.x, fighter.y - shot.y) <= FIGHTER_R + shot.radius) {
        const attacker = fighters.get(shot.owner);
        if (attacker) damageFighter(attacker, fighter, shot, Math.sign(shot.vx) || 1);
        hitSomething = true;
        break;
      }
    }

    if (hitSomething || shot.life <= 0 || shot.x < -60 || shot.x > WIDTH + 60) {
      projectiles.splice(index, 1);
    }
  }

  for (let index = mines.length - 1; index >= 0; index -= 1) {
    const mine = mines[index];
    if (mine.arm > 0) mine.arm -= dt;
    mine.life -= dt;

    let triggered = mine.life <= 0;
    if (mine.arm <= 0) {
      for (const fighter of fighters.values()) {
        if (fighter.id === mine.owner || fighter.gone || fighter.respawn > 0) continue;
        if (Math.hypot(fighter.x - mine.x, fighter.y - mine.y) <= mine.radius + FIGHTER_R) {
          triggered = true;
          break;
        }
      }
    }

    if (!triggered) continue;
    const attacker = fighters.get(mine.owner);
    if (attacker) aoe(attacker, mine.x, mine.y, mine.radius, mine, 1);
    burst(mine.x, mine.y, mine.color, 22);
    mines.splice(index, 1);
  }

  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.life -= dt;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += GRAVITY * 0.5 * dt;
  }
}

// A minimized host window pauses requestAnimationFrame; pause every clock too.
document.addEventListener("visibilitychange", () => {
  if (!running) return;
  const now = performance.now();
  if (document.visibilityState === "hidden") {
    hiddenAt = now;
    return;
  }
  if (hiddenAt > 0) {
    const delta = now - hiddenAt;
    countdownEndsAt += delta;
    fightEndsAt += delta;
    resultsUntil += delta;
    hiddenAt = 0;
  }
  last = now;
  accumulator = 0;
});

function frame(now) {
  if (!running) return;

  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (phase === "countdown" && now >= countdownEndsAt) startMatch();
  if (phase === "fight" && now >= fightEndsAt) finishMatch("time");
  if (phase === "results" && now >= resultsUntil) beginSelect();

  if (phase === "fight") {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      simulate(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 5) accumulator = 0;
    if (refs.clock) {
      refs.clock.textContent = String(Math.max(0, Math.ceil((fightEndsAt - now) / 1000)));
    }
    if (now - lastBeat >= 10000) {
      lastBeat = now;
      const state = [...fighters.values()]
        .map((fighter) => `${fighter.char.id}:${fighter.stocks}@${Math.round(fighter.x)}`)
        .join(" ");
      hub?.log("rift state", state || "no fighters");
    }
  } else {
    accumulator = 0;
  }

  draw(now);
  raf = requestAnimationFrame(frame);
}

// --- rendering --------------------------------------------------------------

function draw(now) {
  if (!ctx) return;

  if (phase === "select" || phase === "countdown") {
    drawSelect(now);
    if (phase === "countdown") drawCountdown(now);
    return;
  }

  drawFight(now);
  if (phase === "results") drawResults(now);
}

function paintBackdrop(palette) {
  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, palette.sky[0]);
  sky.addColorStop(1, palette.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
  for (let index = 0; index < 8; index += 1) {
    ctx.beginPath();
    ctx.arc(80 + index * 120, 60 + (index % 3) * 26, 24, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSelect(now) {
  paintBackdrop(STAGES[0]);

  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f4fb";
  ctx.font = "900 40px ui-rounded, system-ui, sans-serif";
  ctx.fillText("RIFT RUMBLE", WIDTH / 2, 54);
  ctx.fillStyle = "#9a9ab0";
  ctx.font = "600 14px ui-rounded, system-ui, sans-serif";
  ctx.fillText("Choose your fighter on your phone", WIDTH / 2, 76);

  const columns = 5;
  const cardW = 164;
  const cardH = 94;
  const gapX = 12;
  const gapY = 10;
  const startX = (WIDTH - (columns * cardW + (columns - 1) * gapX)) / 2;
  const startY = 92;

  const pickers = new Map();
  for (const [playerId, index] of picks) {
    const player = hub?.players.get(playerId);
    if (player) pickers.set(ROSTER[index].id, player);
  }

  ROSTER.forEach((character, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    const picker = pickers.get(character.id);

    ctx.fillStyle = "rgba(255, 255, 255, 0.045)";
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 10);
    ctx.fill();

    ctx.strokeStyle = picker ? picker.color : "#2b2b3f";
    ctx.lineWidth = picker ? 3 : 1;
    ctx.stroke();

    ctx.fillStyle = character.color;
    ctx.beginPath();
    ctx.arc(x + 26, y + 32, 15, 0, Math.PI * 2);
    ctx.fill();

    drawEmblem(character.emblem, x + 26, y + 32, 9, "#0b0b12");

    ctx.textAlign = "left";
    ctx.fillStyle = "#f4f4fb";
    ctx.font = "700 13px ui-rounded, system-ui, sans-serif";
    ctx.fillText(character.name, x + 48, y + 29);

    ctx.fillStyle = "#8f8fa8";
    ctx.font = "500 10px ui-rounded, system-ui, sans-serif";
    ctx.fillText(character.role, x + 48, y + 45);

    ctx.fillStyle = character.accent;
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.fillText(`${character.stats.weight.toFixed(2)}w · ${character.stats.airJumps}j`, x + 12, y + 80);

    if (picker) {
      ctx.fillStyle = picker.color;
      ctx.font = "700 10px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(picker.name.slice(0, 12), x + cardW - 10, y + 80);
    }
  });

  const players = connectedPlayers();
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-rounded, system-ui, sans-serif";
  let chipX = 30;
  for (const player of players) {
    const chosen = picks.has(player.id) ? ROSTER[picks.get(player.id)].name : "choosing…";
    const label = `${player.name} · ${chosen}`;
    const width = ctx.measureText(label).width + 34;
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.beginPath();
    ctx.roundRect(chipX, HEIGHT - 42, width, 26, 13);
    ctx.fill();
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(chipX + 13, HEIGHT - 29, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f4fb";
    ctx.fillText(label, chipX + 24, HEIGHT - 25);
    chipX += width + 10;
  }

  if (players.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#9a9ab0";
    ctx.font = "600 16px ui-rounded, system-ui, sans-serif";
    ctx.fillText("Open the join link on your phone to pick a fighter", WIDTH / 2, HEIGHT - 24);
  }

  // A slow scan line keeps the static select screen feeling alive.
  const sweep = (now / 18) % WIDTH;
  ctx.fillStyle = "rgba(255, 210, 63, 0.04)";
  ctx.fillRect(sweep, 0, 40, HEIGHT);
}

function drawCountdown(now) {
  const seconds = Math.max(1, Math.ceil((countdownEndsAt - now) / 1000));
  ctx.fillStyle = "rgba(6, 6, 12, 0.72)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd23f";
  ctx.font = "900 120px ui-rounded, system-ui, sans-serif";
  ctx.fillText(String(seconds), WIDTH / 2, HEIGHT / 2 + 40);
  ctx.fillStyle = "#f4f4fb";
  ctx.font = "700 18px ui-rounded, system-ui, sans-serif";
  ctx.fillText("Get ready", WIDTH / 2, HEIGHT / 2 + 86);
}

function drawFight(now) {
  paintBackdrop(stage);

  ctx.fillStyle = stage.platform;
  for (const platform of stage.platforms) {
    ctx.fillRect(platform.x, platform.y, platform.w, 14);
    ctx.fillStyle = stage.trim;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(platform.x, platform.y, platform.w, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = stage.platform;
  }

  ctx.fillStyle = stage.floor;
  ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);
  ctx.fillStyle = stage.trim;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(0, FLOOR_Y, WIDTH, 4);
  ctx.globalAlpha = 1;

  for (const mine of mines) {
    ctx.globalAlpha = mine.arm > 0 ? 0.45 : 0.9;
    ctx.fillStyle = mine.color;
    ctx.beginPath();
    ctx.arc(mine.x, mine.y, 7 + Math.sin(now / 120) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const shot of projectiles) {
    ctx.fillStyle = shot.color;
    ctx.beginPath();
    ctx.ellipse(shot.x, shot.y, shot.radius * 1.8, shot.radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.ellipse(shot.x - Math.sign(shot.vx) * 16, shot.y, shot.radius * 2.6, shot.radius * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const fighter of fighters.values()) {
    if (fighter.gone || fighter.respawn > 0) continue;
    drawFighter(fighter, now);
  }

  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life * 2);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawHud();
}

function drawFighter(fighter, now) {
  const character = fighter.char;
  ctx.save();
  ctx.translate(fighter.x, fighter.y);
  ctx.globalAlpha = fighter.online ? 1 : 0.4;
  if (fighter.invuln > 0) ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(now / 45);

  if (fighter.flash > 0) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, FIGHTER_R + 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (fighter.guardHeld && fighter.shield > 0) {
    ctx.strokeStyle = "rgba(120, 210, 255, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, FIGHTER_R + 12, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = character.color;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 2;

  switch (character.shape) {
    case "knight":
      ctx.beginPath();
      ctx.roundRect(-14, -20, 28, 38, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.moveTo(-4, -20);
      ctx.lineTo(0, -34);
      ctx.lineTo(8, -20);
      ctx.closePath();
      ctx.fill();
      break;
    case "mage":
      ctx.beginPath();
      ctx.arc(0, 2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.moveTo(-16, -6);
      ctx.lineTo(0, -36);
      ctx.lineTo(16, -6);
      ctx.closePath();
      ctx.fill();
      break;
    case "robot":
      ctx.beginPath();
      ctx.roundRect(-15, -18, 30, 34, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.fillRect(-7, -10, 14, 5);
      ctx.fillRect(-2, -28, 4, 10);
      break;
    case "beast":
      ctx.beginPath();
      ctx.arc(0, 2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.moveTo(-16, -10);
      ctx.lineTo(-8, -28);
      ctx.lineTo(-2, -12);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(16, -10);
      ctx.lineTo(8, -28);
      ctx.lineTo(2, -12);
      ctx.closePath();
      ctx.fill();
      break;
    case "rogue":
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(15, 0);
      ctx.lineTo(0, 20);
      ctx.lineTo(-15, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
  }

  ctx.fillStyle = character.accent;
  ctx.beginPath();
  ctx.arc(fighter.facing * 8, -4, 3.5, 0, Math.PI * 2);
  ctx.fill();

  if (fighter.attackTimer > 0) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fighter.facing * 26, 0, 18, -Math.PI / 2, Math.PI / 2, fighter.facing < 0);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f4f4fb";
  ctx.textAlign = "center";
  ctx.font = "600 12px ui-rounded, system-ui, sans-serif";
  ctx.fillText(fighter.name.slice(0, 12), 0, -FIGHTER_R - 18);
  ctx.fillStyle = fighter.damage > 90 ? "#ff6b6b" : "#9a9ab0";
  ctx.font = "700 11px ui-monospace, monospace";
  ctx.fillText(`${Math.round(fighter.damage)}%`, 0, FIGHTER_R + 16);
  ctx.restore();
}

function drawHud() {
  const entries = [...fighters.values()];
  ctx.textAlign = "left";
  entries.forEach((fighter, index) => {
    const x = 18 + (index % 4) * 230;
    const y = 24 + Math.floor(index / 4) * 32;
    ctx.fillStyle = fighter.char.color;
    ctx.beginPath();
    ctx.arc(x, y - 4, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fighter.gone ? "#6b6b7f" : "#f4f4fb";
    ctx.font = "700 12px ui-rounded, system-ui, sans-serif";
    ctx.fillText(fighter.char.name, x + 14, y);

    ctx.fillStyle = "#ffd23f";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.fillText("●".repeat(Math.max(0, fighter.stocks)), x + 14, y + 14);

    ctx.fillStyle = "#9a9ab0";
    ctx.fillText(`${Math.round(fighter.damage)}%`, x + 70, y + 14);

    if (fighter.shield < fighter.shieldMax) {
      ctx.fillStyle = "rgba(120, 210, 255, 0.25)";
      ctx.fillRect(x + 14, y + 18, 70, 3);
      ctx.fillStyle = "#78d2ff";
      ctx.fillRect(x + 14, y + 18, (fighter.shield / fighter.shieldMax) * 70, 3);
    }
  });

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.fillText(stage.name, WIDTH / 2, 26);
}

function drawResults(now) {
  ctx.fillStyle = "rgba(6, 6, 12, 0.78)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const standings = [...fighters.values()]
    .map((fighter) => ({
      fighter,
      score: fighter.stocks * 10000 + fighter.kos * 500 + Math.max(0, 900 - Math.round(fighter.damage)),
    }))
    .sort((a, b) => b.score - a.score);

  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd23f";
  ctx.font = "900 44px ui-rounded, system-ui, sans-serif";
  ctx.fillText("RESULTS", WIDTH / 2, 96);

  const winner = standings[0]?.fighter;
  if (winner) {
    ctx.fillStyle = "#f4f4fb";
    ctx.font = "800 26px ui-rounded, system-ui, sans-serif";
    ctx.fillText(`${winner.name} wins as ${winner.char.name}`, WIDTH / 2, 138);
  }

  standings.forEach((entry, index) => {
    const y = 196 + index * 52;
    const fighter = entry.fighter;
    ctx.fillStyle = index === 0 ? "rgba(255, 210, 63, 0.12)" : "rgba(255, 255, 255, 0.04)";
    ctx.beginPath();
    ctx.roundRect(WIDTH / 2 - 280, y - 30, 560, 42, 10);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = index === 0 ? "#ffd23f" : "#9a9ab0";
    ctx.font = "800 16px ui-monospace, monospace";
    ctx.fillText(`#${index + 1}`, WIDTH / 2 - 258, y - 4);

    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.arc(WIDTH / 2 - 206, y - 9, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f4f4fb";
    ctx.font = "700 15px ui-rounded, system-ui, sans-serif";
    ctx.fillText(`${fighter.name} · ${fighter.char.name}`, WIDTH / 2 - 190, y - 4);

    ctx.textAlign = "right";
    ctx.fillStyle = "#9a9ab0";
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.fillText(
      `${Math.max(0, fighter.stocks)} stocks · ${fighter.kos} KO${fighter.kos === 1 ? "" : "s"}`,
      WIDTH / 2 + 258,
      y - 4,
    );
  });

  const seconds = Math.max(0, Math.ceil((resultsUntil - now) / 1000));
  ctx.textAlign = "center";
  ctx.fillStyle = "#9a9ab0";
  ctx.font = "600 13px ui-rounded, system-ui, sans-serif";
  ctx.fillText(`Next fighter select in ${seconds}s — or press Rematch`, WIDTH / 2, HEIGHT - 34);
}

function drawEmblem(kind, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  switch (kind) {
    case "star": {
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const radius = point % 2 === 0 ? size : size * 0.45;
        const angle = -Math.PI / 2 + (point * Math.PI) / 5;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "bolt":
      ctx.beginPath();
      ctx.moveTo(-size * 0.2, -size);
      ctx.lineTo(size * 0.55, -size * 0.1);
      ctx.lineTo(size * 0.05, -size * 0.1);
      ctx.lineTo(size * 0.3, size);
      ctx.lineTo(-size * 0.55, size * 0.05);
      ctx.lineTo(-size * 0.05, size * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case "wave":
      for (let line = -1; line <= 1; line += 1) {
        ctx.beginPath();
        ctx.arc(0, line * size * 0.45, size * 0.9, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      break;
    case "leaf":
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.55, size, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "skull":
      ctx.beginPath();
      ctx.arc(0, -size * 0.2, size * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-size * 0.45, size * 0.3, size * 0.9, size * 0.35);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(-size * 0.35, -size * 0.25, size * 0.18, 0, Math.PI * 2);
      ctx.arc(size * 0.35, -size * 0.25, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "gear":
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
      for (let tooth = 0; tooth < 6; tooth += 1) {
        const angle = (tooth * Math.PI) / 3;
        ctx.save();
        ctx.rotate(angle);
        ctx.fillRect(-size * 0.15, -size, size * 0.3, size * 0.45);
        ctx.restore();
      }
      break;
    case "clock":
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -size * 0.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(size * 0.45, size * 0.2);
      ctx.stroke();
      break;
    case "snow":
      for (let arm = 0; arm < 3; arm += 1) {
        ctx.save();
        ctx.rotate((arm * Math.PI) / 3);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(0, size);
        ctx.stroke();
        ctx.restore();
      }
      break;
    case "bomb":
      ctx.beginPath();
      ctx.arc(0, size * 0.2, size * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(size * 0.2, -size * 0.45);
      ctx.quadraticCurveTo(size * 0.9, -size, size * 0.3, -size);
      ctx.stroke();
      break;
    case "note":
      ctx.beginPath();
      ctx.arc(-size * 0.3, size * 0.5, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(size * 0.02, -size * 0.8, size * 0.22, size * 1.3);
      break;
    case "rock":
      ctx.beginPath();
      ctx.moveTo(-size, size * 0.5);
      ctx.lineTo(-size * 0.3, -size * 0.8);
      ctx.lineTo(size * 0.7, -size * 0.3);
      ctx.lineTo(size, size * 0.6);
      ctx.closePath();
      ctx.fill();
      break;
    case "sun":
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      for (let ray = 0; ray < 8; ray += 1) {
        const angle = (ray * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * size * 0.7, Math.sin(angle) * size * 0.7);
        ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
        ctx.stroke();
      }
      break;
    case "arrow":
      ctx.beginPath();
      ctx.moveTo(-size, size * 0.7);
      ctx.lineTo(size, -size * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size, -size * 0.7);
      ctx.lineTo(size * 0.15, -size * 0.8);
      ctx.lineTo(size * 0.75, -size * 0.15);
      ctx.closePath();
      ctx.fill();
      break;
    case "magma":
      ctx.beginPath();
      ctx.moveTo(-size, size);
      ctx.lineTo(-size * 0.2, -size);
      ctx.lineTo(size * 0.3, size * 0.1);
      ctx.lineTo(size * 0.7, -size * 0.4);
      ctx.lineTo(size, size);
      ctx.closePath();
      ctx.fill();
      break;
    case "wind":
      for (let line = 0; line < 3; line += 1) {
        ctx.beginPath();
        ctx.arc(-size * 0.2, line * size * 0.5 - size * 0.5, size * 0.8, -Math.PI * 0.9, Math.PI * 0.2);
        ctx.stroke();
      }
      break;
    case "eye":
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "crown":
      ctx.beginPath();
      ctx.moveTo(-size, size * 0.5);
      ctx.lineTo(-size * 0.8, -size * 0.6);
      ctx.lineTo(-size * 0.25, size * 0.05);
      ctx.lineTo(0, -size);
      ctx.lineTo(size * 0.25, size * 0.05);
      ctx.lineTo(size * 0.8, -size * 0.6);
      ctx.lineTo(size, size * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case "flame":
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size, -size * 0.1, size * 0.4, size * 0.8);
      ctx.quadraticCurveTo(0, size * 1.05, -size * 0.4, size * 0.8);
      ctx.quadraticCurveTo(-size, -size * 0.1, 0, -size);
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
      ctx.fill();
  }

  ctx.restore();
}

// --- wiring -----------------------------------------------------------------

if (refs.start) refs.start.addEventListener("click", forceStart);
if (refs.rematch) refs.rematch.addEventListener("click", beginSelect);

defineGame({
  onStart(context) {
    hub = context;
    running = true;
    stage = STAGES[0];
    stageIndex = 0;
    matchNumber = 0;
    spawnCursor = 0;
    last = performance.now();
    lastBeat = last;
    hiddenAt = 0;
    accumulator = 0;
    context.log("rift loaded", `roster=${ROSTER.length}`, `stages=${STAGES.length}`);
    beginSelect();
    raf = requestAnimationFrame(frame);
  },

  onPlayerJoin(player) {
    if (phase === "select") {
      hub?.setUI(player.id, rosterUI());
      maybeAutoStart();
    } else if (phase === "fight") {
      hub?.setUI(player.id, ui.waiting("Spectating — you are in the next match"));
      hub?.log("rift spectator", player.name);
    } else {
      hub?.setUI(player.id, ui.waiting("Next match starts soon"));
    }
  },

  onPlayerRejoin(player) {
    const fighter = fighters.get(player.id);
    if (fighter) {
      fighter.online = true;
      if (phase === "fight") hub?.setUI(player.id, controlsFor(fighter.char));
      return;
    }
    if (phase === "select") hub?.setUI(player.id, rosterUI());
  },

  onPlayerLeave(player) {
    const fighter = fighters.get(player.id);
    if (fighter) fighter.online = false;
    axes.set(player.id, { x: 0, y: 0 });
  },

  onPlayerRemoved(player) {
    fighters.delete(player.id);
    picks.delete(player.id);
    axes.delete(player.id);
    if (phase === "fight") checkLastStanding();
    if (phase === "select") maybeAutoStart();
  },

  onInput(player, input) {
    if (input.k === "choice") {
      if (input.id !== "roster" || phase !== "select") return;
      const chosen = ROSTER.findIndex((character) => character.id === input.v[0]);
      const index = chosen >= 0 ? chosen : randomIndex();
      picks.set(player.id, index);
      hub?.setUI(player.id, pickedUI(ROSTER[index]));
      hub?.log("rift pick", `${player.name} ${ROSTER[index].id}`);
      maybeAutoStart();
      return;
    }

    const fighter = fighters.get(player.id);
    if (!fighter || phase !== "fight" || fighter.gone) return;

    if (input.k === "axis") {
      if (input.id === "move") axes.set(player.id, { x: input.x, y: input.y });
      return;
    }

    if (input.k === "release") {
      if (input.id === "guard") fighter.guardHeld = false;
      return;
    }

    if (input.k !== "press") return;
    if (fighter.hitstun > 0 || fighter.respawn > 0) return;

    switch (input.id) {
      case "jump":
        if (fighter.grounded) {
          fighter.vy = -fighter.char.stats.jump;
          fighter.grounded = false;
          burst(fighter.x, fighter.y + FIGHTER_R, fighter.char.accent, 4);
        } else if (fighter.airJumps > 0) {
          fighter.airJumps -= 1;
          fighter.vy = -fighter.char.stats.jump * 0.92;
          burst(fighter.x, fighter.y + FIGHTER_R, fighter.char.accent, 6);
        }
        break;
      case "attack":
        if (fighter.attackCd <= 0) {
          fighter.attackTimer = 0.16;
          fighter.attackCd = fighter.char.attack.cooldown;
          fighter.attackHit = false;
        }
        break;
      case "special1":
        useSpecial(fighter, 0);
        break;
      case "special2":
        useSpecial(fighter, 1);
        break;
      case "guard":
        fighter.guardHeld = true;
        break;
    }
  },

  onStop() {
    running = false;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(rematchHandle);
    hub = null;
  },
});
