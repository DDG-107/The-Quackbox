import { defineGame, ui } from "/sdk/index.js";

// A real-time brawler: fixed-step physics here on the host, phones only send an
// axis and two presses. Nothing about the simulation crosses the bridge; this is
// the reference for "bigger" cartridges (sports games follow the same shape).

const WIDTH = 960;
const HEIGHT = 540;
const FLOOR_Y = 470;
const STEP = 1 / 60;
const GRAVITY = 2000;
const MOVE_SPEED = 300;
const JUMP_SPEED = 640;
const FIGHTER_R = 18;
const STOCKS = 3;
const ROUND_MS = 60_000;
const PUNCH_COOLDOWN = 0.42;
const PUNCH_ACTIVE = 0.14;
const PUNCH_REACH = 62;
const PUNCH_VERTICAL = 46;
/** Hitstun: control is ignored so knockback actually carries a fighter out. */
const HITSTUN = 0.3;
const RESPAWN_MS = 1.4;
const BANNER_HOLD_MS = 4_000;

const PLATFORMS = [
  { x: 190, y: 350, w: 210 },
  { x: 560, y: 350, w: 210 },
  { x: 400, y: 240, w: 160 },
];

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

const CONTROLS = ui.stack(
  { type: "joystick", id: "move", hz: 30 },
  {
    type: "buttons",
    buttons: [
      { id: "jump", label: "JUMP", style: "ghost" },
      { id: "punch", label: "PUNCH", style: "primary", cooldownMs: 320 },
    ],
  },
);

const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d");
const refs = {
  clock: document.querySelector("#clock"),
  status: document.querySelector("#status"),
  banner: document.querySelector("#banner"),
};

const fighters = new Map();
const axes = new Map();
const particles = [];

let hub = null;
let running = false;
let ended = false;
let endsAt = 0;
let raf = 0;
let last = 0;
let accumulator = 0;
let spawnCursor = 0;
let endHandle = 0;
let lastBeat = 0;
let pressesSinceBeat = 0;
let hitsSinceBeat = 0;
let hiddenAt = 0;

function spawnPoint() {
  const point = SPAWNS[spawnCursor % SPAWNS.length];
  spawnCursor += 1;
  return point;
}

function addFighter(player) {
  const existing = fighters.get(player.id);
  if (existing) {
    existing.name = player.name;
    existing.color = player.color;
    return existing;
  }

  const spawn = spawnPoint();
  const fighter = {
    id: player.id,
    name: player.name,
    color: player.color,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    damage: 0,
    stocks: STOCKS,
    kos: 0,
    punch: 0,
    punchHit: false,
    cooldown: 0,
    hitstun: 0,
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

function burst(x, y, color, count) {
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 180;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      life: 0.35 + Math.random() * 0.25,
      color,
    });
  }
}

function hit(attacker, victim) {
  victim.damage = Math.min(999, victim.damage + 12);
  const power = 320 + victim.damage * 5.5;
  victim.vx = attacker.facing * power;
  victim.vy = -320 - victim.damage * 1.1;
  victim.grounded = false;
  victim.hitstun = HITSTUN;
  victim.flash = 0.18;
  victim.lastHitBy = attacker.id;
  hitsSinceBeat += 1;
  burst(victim.x, victim.y, attacker.color, 10);
}

function ko(fighter) {
  fighter.stocks -= 1;
  const credit = fighter.lastHitBy ? fighters.get(fighter.lastHitBy) : null;
  if (credit && credit !== fighter) credit.kos += 1;

  hub?.log(
    "arena ko",
    `${fighter.name} out`,
    `stocks=${fighter.stocks}`,
    `by=${credit && credit !== fighter ? credit.name : "arena"}`,
  );
  burst(fighter.x, Math.min(fighter.y, FLOOR_Y), "#ffd23f", 26);

  if (fighter.stocks <= 0) {
    fighter.gone = true;
    fighter.respawn = 0;
  } else {
    fighter.respawn = RESPAWN_MS;
    fighter.damage = 0;
    fighter.x = WIDTH / 2;
    fighter.y = HEIGHT + 200;
    fighter.vx = 0;
    fighter.vy = 0;
  }

  const alive = [...fighters.values()].filter((entry) => !entry.gone);
  if (alive.length <= 1) finish("ko", alive[0] ?? null);
}

function simulate(dt) {
  if (!running) return;

  if (!ended && performance.now() >= endsAt) finish("time");

  for (const fighter of fighters.values()) {
    if (fighter.gone) continue;
    if (fighter.flash > 0) fighter.flash = Math.max(0, fighter.flash - dt);

    if (fighter.respawn > 0) {
      fighter.respawn = Math.max(0, fighter.respawn - dt);
      if (fighter.respawn === 0) {
        const spawn = spawnPoint();
        fighter.x = spawn.x;
        fighter.y = spawn.y;
        fighter.vx = 0;
        fighter.vy = 0;
      }
      continue;
    }

    if (fighter.hitstun > 0) {
      fighter.hitstun = Math.max(0, fighter.hitstun - dt);
    } else {
      const axis = fighter.online ? axes.get(fighter.id) : null;
      const target = axis ? Math.max(-1, Math.min(1, axis.x)) * MOVE_SPEED : 0;
      fighter.vx += (target - fighter.vx) * Math.min(1, dt * 14);
    }
    if (Math.abs(fighter.vx) > 12) fighter.facing = Math.sign(fighter.vx);

    fighter.vy = Math.min(1400, fighter.vy + GRAVITY * dt);

    const previousY = fighter.y;
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
    fighter.grounded = false;

    // One-way platforms: only land when falling onto them from above.
    for (const platform of PLATFORMS) {
      const bottomBefore = previousY + FIGHTER_R;
      const bottomAfter = fighter.y + FIGHTER_R;
      const withinX =
        fighter.x >= platform.x - 12 && fighter.x <= platform.x + platform.w + 12;
      if (
        fighter.vy >= 0 &&
        withinX &&
        bottomBefore <= platform.y + 2 &&
        bottomAfter >= platform.y
      ) {
        fighter.y = platform.y - FIGHTER_R;
        fighter.vy = 0;
        fighter.grounded = true;
      }
    }

    if (fighter.y + FIGHTER_R >= FLOOR_Y) {
      fighter.y = FLOOR_Y - FIGHTER_R;
      fighter.vy = 0;
      fighter.grounded = true;
    }

    if (fighter.punch > 0) {
      fighter.punch = Math.max(0, fighter.punch - dt);
      if (!fighter.punchHit) {
        for (const other of fighters.values()) {
          if (other === fighter || other.gone || other.respawn > 0) continue;
          const dx = other.x - fighter.x;
          const dy = Math.abs(other.y - fighter.y);
          const inFront = dx * fighter.facing > 6;
          if (inFront && Math.abs(dx) <= PUNCH_REACH && dy <= PUNCH_VERTICAL) {
            hit(fighter, other);
            fighter.punchHit = true;
            break;
          }
        }
      }
    }
    if (fighter.cooldown > 0) fighter.cooldown = Math.max(0, fighter.cooldown - dt);

    if (fighter.x < -50 || fighter.x > WIDTH + 50 || fighter.y > HEIGHT + 70) ko(fighter);
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

// A minimized host window pauses requestAnimationFrame; pause the round clock too
// instead of letting it expire in the background and ending on restore.
document.addEventListener("visibilitychange", () => {
  if (!running) return;
  const now = performance.now();
  if (document.visibilityState === "hidden") {
    hiddenAt = now;
    return;
  }
  if (hiddenAt > 0) {
    endsAt += now - hiddenAt;
    hiddenAt = 0;
  }
  last = now;
  accumulator = 0;
});

function frame(now) {
  if (!running) return;
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += delta;

  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    simulate(STEP);
    accumulator -= STEP;
    steps += 1;
  }
  if (steps === 5) accumulator = 0;

  draw();
  refs.clock.textContent = String(Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)));

  if (now - lastBeat >= 5000) {
    lastBeat = now;
    const snapshot = [...fighters.values()]
      .map((fighter) => `${fighter.name}@${Math.round(fighter.x)} st${fighter.stocks}`)
      .join(" ");
    hub?.log(
      "arena state",
      snapshot || "no fighters",
      `presses=${pressesSinceBeat}`,
      `hits=${hitsSinceBeat}`,
    );
    pressesSinceBeat = 0;
    hitsSinceBeat = 0;
  }

  raf = requestAnimationFrame(frame);
}

function draw() {
  if (!ctx) return;

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, "#16162a");
  sky.addColorStop(1, "#0a0a12");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Distant lights, so the arena does not read as an empty rectangle.
  ctx.fillStyle = "rgba(255, 210, 63, 0.06)";
  for (let index = 0; index < 7; index += 1) {
    ctx.beginPath();
    ctx.arc(90 + index * 140, 70 + (index % 2) * 34, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#20203a";
  for (const platform of PLATFORMS) {
    ctx.fillRect(platform.x, platform.y, platform.w, 14);
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.fillRect(platform.x, platform.y, platform.w, 3);
    ctx.fillStyle = "#20203a";
  }

  ctx.fillStyle = "#262640";
  ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(0, FLOOR_Y, WIDTH, 4);

  for (const fighter of fighters.values()) {
    if (fighter.gone || fighter.respawn > 0) continue;

    ctx.globalAlpha = fighter.online ? 1 : 0.45;

    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(fighter.x, FLOOR_Y + 2, FIGHTER_R * 0.9, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (fighter.flash > 0) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fighter.x, fighter.y, FIGHTER_R + 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.arc(fighter.x, fighter.y, FIGHTER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Face marker makes the punch direction readable.
    ctx.fillStyle = "#0b0b12";
    ctx.beginPath();
    ctx.arc(fighter.x + fighter.facing * 8, fighter.y - 3, 3.5, 0, Math.PI * 2);
    ctx.fill();

    if (fighter.punch > 0) {
      ctx.strokeStyle = "rgba(255, 210, 63, 0.8)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(
        fighter.x + fighter.facing * (FIGHTER_R + 16),
        fighter.y,
        10,
        -Math.PI / 2,
        Math.PI / 2,
        fighter.facing < 0,
      );
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f4f4fb";
    ctx.font = "600 13px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(fighter.name, fighter.x, fighter.y - FIGHTER_R - 12);
    ctx.fillStyle = fighter.damage > 90 ? "#ff6b6b" : "#9a9ab0";
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.fillText(`${Math.round(fighter.damage)}%`, fighter.x, fighter.y + FIGHTER_R + 16);
  }

  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life * 2);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  drawHud();
}

function drawHud() {
  const entries = [...fighters.values()];
  ctx.textAlign = "left";
  entries.forEach((fighter, index) => {
    const x = 18 + (index % 4) * 230;
    const y = 26 + Math.floor(index / 4) * 30;
    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.arc(x, y - 4, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = fighter.gone ? "#6b6b7f" : "#f4f4fb";
    ctx.font = "700 13px ui-rounded, system-ui, sans-serif";
    const stocks = "●".repeat(Math.max(0, fighter.stocks));
    ctx.fillText(`${fighter.name}`, x + 14, y);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "600 12px ui-monospace, monospace";
    ctx.fillText(stocks, x + 14, y + 14);
  });
}

function finish(reason, sole) {
  if (ended) return;
  ended = true;

  const alive = [...fighters.values()].filter((entry) => !entry.gone);
  const winner =
    sole ??
    [...alive].sort(
      (a, b) => b.stocks - a.stocks || b.kos - a.kos || a.damage - b.damage,
    )[0] ??
    null;

  const results = [...fighters.values()]
    .map((fighter) => ({
      playerId: fighter.id,
      score: fighter.stocks * 1000 + fighter.kos * 100 - Math.round(fighter.damage),
    }))
    .sort((a, b) => b.score - a.score);

  refs.banner.hidden = false;
  refs.banner.textContent = winner ? `${winner.name} wins!` : "Time!";
  refs.status.textContent = winner
    ? `${winner.name} is the last one standing`
    : "Nobody survived";
  refs.clock.textContent = "0";

  hub?.log(
    "arena finished",
    `reason=${reason}`,
    `winner=${winner ? winner.name : "none"}`,
    `standings=${results
      .slice(0, 4)
      .map((entry) => `${fighters.get(entry.playerId)?.name}:${entry.score}`)
      .join(",")}`,
  );

  hub?.setUI("all", ui.waiting("Round over — look at the TV"));
  endHandle = window.setTimeout(() => hub?.end(results), BANNER_HOLD_MS);
}

defineGame({
  onStart(context) {
    hub = context;
    fighters.clear();
    axes.clear();
    particles.length = 0;
    spawnCursor = 0;
    ended = false;
    running = true;
    accumulator = 0;
    last = performance.now();
    lastBeat = last;
    hiddenAt = 0;
    endsAt = performance.now() + ROUND_MS;
    refs.banner.hidden = true;
    refs.status.textContent = "Fight!";

    for (const player of context.players.values()) addFighter(player);
    context.setUI("all", CONTROLS);
    context.log("arena start", `players=${fighters.size}`);
    raf = requestAnimationFrame(frame);
  },

  onPlayerJoin(player) {
    const fighter = addFighter(player);
    fighter.online = true;
    hub?.log("arena join", player.name, `fighters=${fighters.size}`);
    if (!ended) hub?.setUI(player.id, CONTROLS);
  },

  onPlayerRejoin(player) {
    const fighter = addFighter(player);
    fighter.online = true;
    axes.set(player.id, { x: 0, y: 0 });
    if (!ended) hub?.setUI(player.id, CONTROLS);
  },

  onPlayerLeave(player) {
    const fighter = fighters.get(player.id);
    if (fighter) fighter.online = false;
    axes.set(player.id, { x: 0, y: 0 });
  },

  onPlayerRemoved(player) {
    fighters.delete(player.id);
    axes.delete(player.id);
  },

  onInput(player, input) {
    const fighter = fighters.get(player.id);
    if (!running || !fighter || fighter.gone) return;

    if (input.k === "axis" && input.id === "move") {
      axes.set(player.id, { x: input.x, y: input.y });
      return;
    }
    if (input.k !== "press") return;

    if (input.id === "jump") {
      if (fighter.grounded && fighter.respawn === 0 && fighter.hitstun === 0) {
        fighter.vy = -JUMP_SPEED;
        fighter.grounded = false;
        burst(fighter.x, fighter.y + FIGHTER_R, fighter.color, 5);
      }
      return;
    }

    if (
      input.id === "punch" &&
      fighter.cooldown === 0 &&
      fighter.respawn === 0 &&
      fighter.hitstun === 0
    ) {
      pressesSinceBeat += 1;
      fighter.punch = PUNCH_ACTIVE;
      fighter.cooldown = PUNCH_COOLDOWN;
      fighter.punchHit = false;
      const axis = axes.get(player.id);
      if (axis && Math.abs(axis.x) > 0.2) fighter.facing = Math.sign(axis.x);
    }
  },

  onStop() {
    running = false;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(endHandle);
    hub = null;
  },
});
