import { defineGame, ui } from "/sdk/index.js";
import { ART, DEFAULT_STAGE_LOOK, FIGHTER_ART, JUNK_ICONS, STAGE_LOOKS } from "./art.js";
import { playSound } from "./audio.js";
import { ROSTER, STAGES } from "./roster.js";

// Super Smash Trash: a platform fighter with a character-select phase on the
// phones. The host owns the simulation; phones send axes and button events only.

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
const RESPAWN_DELAY = 1.4;
const SPAWN_INVULN = 5;
const START_INVULN = 1.4;
const MAX_FIGHTERS = 10;
const CPU_COLORS = ["#ff8a3d", "#9fe8ff", "#c9b89a", "#d8a96b", "#b7e4ff"];
const DISPLAY_FONT = '"Bungee", ui-rounded, system-ui, sans-serif';
const JUNK_HEIGHT = 64;
// Playback speed per sprite clip, in frames per second.
const CLIP_FPS = { idle: 6, run: 12, jump: 8, fall: 8, attack: 16, special: 14, hurt: 10, ko: 8 };

const canvas = document.querySelector("#stage");
const ctx = canvas?.getContext("2d") ?? null;
const refs = {
  clock: document.querySelector("#clock"),
  status: document.querySelector("#status"),
  start: document.querySelector("#start"),
  rematch: document.querySelector("#rematch"),
  cpuControls: document.querySelector("#cpu-controls"),
  cpuCount: document.querySelector("#cpu-count"),
  addCpu: document.querySelector("#add-cpu"),
  removeCpu: document.querySelector("#remove-cpu"),
};

const fighters = new Map();
const picks = new Map();
const axes = new Map();
const aims = new Map();
const projectiles = [];
const mines = [];
const slicks = [];
const vortices = [];
const debris = [];
const particles = [];
const respawnPlatforms = [];
const stageSelectHitboxes = [];

const HAZARD_SOURCE = { id: null, char: { accent: "#ffd23f" }, hits: 0 };
let hub = null;
let running = false;
let phase = "select";
let stage = STAGES[0];
let selectedStageIndex = 0;
let cpuCount = 0;
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
let stageTime = 0;
let lastHazardCycle = -1;

const randomIndex = () => Math.floor(Math.random() * ROSTER.length);

function connectedPlayers() {
  return [...(hub?.players.values() ?? [])].filter((player) => player.connected);
}

function rosterUI() {
  return ui.choice(
    ROSTER.map((character) => ({ id: character.id, label: `${character.name} · ${character.role}` })),
    { id: "roster", orientation: "landscape" },
  );
}

function pickedUI(character) {
  return {
    orientation: "landscape",
    components: [
      { type: "label", text: character.name },
      { type: "label", text: `${character.passive.label} — ${character.role}` },
    ],
  };
}

function controlsFor(character) {
  return ui.gamepad({
    label: `${character.name} · ${character.passive.label}`,
    left: { id: "move", hz: 30 },
    right: { id: "aim", hz: 20 },
    face: {
      x: { id: "attack", label: "X", style: "primary", cooldownMs: 180 },
      y: { id: "special1", label: "Y", cooldownMs: 600 },
      b: { id: "special2", label: "B", cooldownMs: 600 },
      a: { id: "jump", label: "A" },
    },
    leftShoulder: { id: "guard", label: "GUARD" },
    rightShoulder: { id: "drop", label: "DROP" },
  });
}

function setHostButtons() {
  const preMatch = phase === "select" || phase === "stage";
  normalizeCpuCount();

  if (refs.start) {
    refs.start.hidden = !preMatch;
    refs.start.textContent = phase === "stage" ? "Start fight" : "Start match";
    refs.start.disabled = preMatch && connectedPlayers().length + cpuCount === 0;
  }
  if (refs.rematch) refs.rematch.hidden = phase !== "results";
  if (refs.cpuControls) refs.cpuControls.hidden = !preMatch;
  if (refs.cpuCount) {
    refs.cpuCount.textContent = `${cpuCount} ${cpuCount === 1 ? "CPU" : "CPUs"}`;
  }
  if (refs.addCpu) refs.addCpu.disabled = cpuCount >= cpuCapacity();
  if (refs.removeCpu) refs.removeCpu.disabled = cpuCount <= 0;
  if (canvas) canvas.style.cursor = phase === "stage" ? "pointer" : "default";
}

function setStatus(text) {
  if (refs.status) refs.status.textContent = text;
}

function cpuCapacity() {
  return Math.max(0, MAX_FIGHTERS - Math.min(MAX_FIGHTERS, connectedPlayers().length));
}

function normalizeCpuCount() {
  cpuCount = Math.max(0, Math.min(cpuCount, cpuCapacity()));
}

function setCpuCount(next) {
  cpuCount = Math.max(0, Math.min(Math.round(next), cpuCapacity()));
  setHostButtons();
  if (phase === "select" || phase === "stage") {
    setStatus(
      cpuCount > 0
        ? `${connectedPlayers().length} humans + ${cpuCount} CPUs ready`
        : connectedPlayers().length > 0
          ? "Add CPUs or start with humans only"
          : "Waiting for fighters…",
    );
  }
}

function beginSelect() {
  if (!running) return;
  window.clearTimeout(rematchHandle);
  rematchHandle = 0;
  phase = "select";
  picks.clear();
  fighters.clear();
  axes.clear();
  aims.clear();
  projectiles.length = 0;
  mines.length = 0;
  slicks.length = 0;
  vortices.length = 0;
  debris.length = 0;
  particles.length = 0;
  respawnPlatforms.length = 0;
  accumulator = 0;
  stageTime = 0;
  lastHazardCycle = -1;

  const players = connectedPlayers();
  for (const player of players) hub?.setUI(player.id, rosterUI());
  setHostButtons();
  setStatus(
    players.length === 0
      ? cpuCount > 0
        ? `${cpuCount} CPUs ready — add phones or start`
        : "Waiting for fighters — or add CPUs"
      : cpuCount > 0
        ? `Choose your fighter · ${cpuCount} CPUs ready`
        : "Choose your fighter on your phone",
  );
  if (refs.clock) refs.clock.textContent = String(Math.floor(ROUND_MS / 1000));
  hub?.log("trash select", `players=${players.length}`);
}

function maybeAutoStart() {
  if (phase !== "select") return;
  const players = connectedPlayers();
  if (
    players.length + cpuCount >= 2 &&
    players.every((player) => picks.has(player.id))
  ) {
    beginStageSelect();
  }
}

function beginStageSelect() {
  if (phase !== "select") return;
  phase = "stage";
  stage = STAGES[selectedStageIndex] ?? STAGES[0];
  setHostButtons();
  setStatus("Choose a stage — click a card, then press Start fight");
  hub?.log(
    "trash stage select",
    `players=${connectedPlayers().length}`,
    `cpus=${cpuCount}`,
    `stage=${stage.id}`,
  );
}

function beginCountdown() {
  if (phase !== "stage") return;
  phase = "countdown";
  countdownEndsAt = performance.now() + COUNTDOWN_MS;
  setHostButtons();
  setStatus("Get ready…");
  hub?.log("trash countdown", `picks=${picks.size} players=${connectedPlayers().length}`);
}

function forceStart() {
  if (phase !== "select") return;
  const players = connectedPlayers();
  if (players.length === 0 && cpuCount === 0) return;
  for (const player of players) {
    if (!picks.has(player.id)) picks.set(player.id, randomIndex());
  }
  playSound("select", 0.45);
  beginStageSelect();
}

function spawnPoint() {
  const main = stage.platforms.find((platform) => platform.main) ?? stage.platforms[0];
  const slot = spawnCursor % MAX_FIGHTERS;
  const gap = main ? Math.max(38, (main.w - 92) / (MAX_FIGHTERS - 1)) : 60;
  const point = {
    x: (main?.x ?? 200) + 46 + slot * gap,
    y: (main?.y ?? FLOOR_Y) - FIGHTER_R,
  };
  spawnCursor += 1;
  return point;
}

function makeRespawnPlatform(fighter) {
  const slot = spawnCursor % MAX_FIGHTERS;
  spawnCursor += 1;
  const x = 130 + (slot % 5) * 150;
  const y = 300 + Math.floor(slot / 5) * 80;
  respawnPlatforms.push({
    x,
    y,
    w: 100,
    life: 7,
    color: fighter.color,
    respawn: true,
  });
  return { x: x + 50, y: y - FIGHTER_R };
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
    invuln: START_INVULN,
    respawn: 0,
    flash: 0,
    online: true,
    gone: false,
    lastHitBy: null,
    sinceHit: 0,
    counterTimer: 0,
    dropTimer: 0,
    slamTimer: 0,
    slamMove: null,
    slowTimer: 0,
    animSeed: Math.random(),
    isCPU: player.isCPU === true,
    cpu: player.isCPU
      ? { jumpCd: 0.35 + Math.random() * 0.8, specialCd: 1.5 + Math.random() * 2 }
      : null,
  };
  fighters.set(player.id, fighter);
  axes.set(player.id, { x: 0, y: 0 });
  aims.set(player.id, { x: 0, y: 0 });
  return fighter;
}

function startMatch() {
  if (phase !== "countdown") return;
  phase = "fight";
  matchNumber += 1;
  stage = STAGES[selectedStageIndex] ?? STAGES[0];
  fighters.clear();
  axes.clear();
  aims.clear();
  projectiles.length = 0;
  mines.length = 0;
  slicks.length = 0;
  vortices.length = 0;
  debris.length = 0;
  particles.length = 0;
  respawnPlatforms.length = 0;
  spawnCursor = 0;
  accumulator = 0;
  stageTime = 0;
  lastHazardCycle = -1;

  const allHumans = connectedPlayers();
  for (const extra of allHumans.slice(MAX_FIGHTERS)) {
    hub?.setUI(extra.id, ui.waiting("Spectating — this match has 10 fighters"));
  }
  const humans = allHumans.slice(0, MAX_FIGHTERS);
  for (const player of humans) {
    const index = picks.has(player.id) ? picks.get(player.id) : randomIndex();
    addFighter(player, ROSTER[index]);
  }

  const cpus = Math.min(cpuCount, MAX_FIGHTERS - humans.length);
  for (let index = 0; index < cpus; index += 1) {
    addFighter(
      {
        id: `cpu-${index + 1}`,
        name: `CPU ${index + 1}`,
        color: CPU_COLORS[index % CPU_COLORS.length],
        isCPU: true,
      },
      ROSTER[randomIndex()],
    );
  }

  fightEndsAt = performance.now() + ROUND_MS;
  for (const fighter of fighters.values()) {
    if (!fighter.isCPU) hub?.setUI(fighter.id, controlsFor(fighter.char));
  }
  setHostButtons();
  setStatus(fighters.size <= 1 ? "Practice mode — no rivals yet" : "Fight!");

  hub?.log(
    "trash start",
    `stage=${stage.id}`,
    `fighters=${fighters.size}`,
    `cpus=${cpus}`,
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
    "trash done",
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

function breakShield(fighter) {
  fighter.guardHeld = false;
  fighter.hitstun = Math.max(fighter.hitstun, 0.8);
  burst(fighter.x, fighter.y, "#ffd23f", 16);
  playSound("swing", 0.4);

  if (fighter.char.passive?.type === "fuse") {
    aoe(fighter, fighter.x, fighter.y, 96, { damage: 8, knockback: 185 }, fighter.facing);
    burst(fighter.x, fighter.y, fighter.char.accent, 28);
    playSound("ko", 0.35);
  }
}

function damageFighter(attacker, victim, move, dir) {
  if (!attacker || victim.gone || victim.respawn > 0 || victim.invuln > 0) return;

  // A counter is checked before shields so a well-timed special beats a jab.
  if (victim.counterTimer > 0 && attacker.id && attacker.id !== victim.id) {
    victim.counterTimer = 0;
    const counter = victim.char.specials.find((special) => special.type === "counter");
    if (counter) {
      burst(victim.x, victim.y, "#ffffff", 16);
      playSound("swing", 0.55);
      const counterDir = Math.sign(attacker.x - victim.x) || victim.facing;
      damageFighter(
        victim,
        attacker,
        { damage: counter.damage, knockback: counter.knockback },
        counterDir,
      );
      return;
    }
  }

  const blocking = victim.guardHeld && victim.shield > 0 && victim.hitstun <= 0;
  const victimPassive = victim.char.passive?.type;
  const attackerPassive = attacker.char.passive?.type;
  let damage = move.damage ?? 0;
  let knockback = move.knockback ?? 100;

  if (victimPassive === "glass") damage *= 1.12;
  if (attackerPassive === "glass") damage *= 1.1;
  if (victimPassive === "armor") knockback *= 0.85;

  if (blocking) {
    damage *= 0.35;
    knockback *= 0.45;
    victim.shield = Math.max(0, victim.shield - damage * 2.4);
    if (victim.shield <= 0) breakShield(victim);
  }

  victim.damage = Math.min(999, victim.damage + damage);
  const power = (knockback + victim.damage * 4.2) / victim.char.stats.weight;
  victim.vx = dir * power;
  victim.vy = -220 - Math.min(340, power * 0.32);
  victim.grounded = false;
  victim.hitstun = blocking ? 0.14 : HITSTUN;
  victim.lastHitBy = attacker.id ?? null;
  victim.flash = 0.18;
  victim.sinceHit = 0;
  victim.slowTimer = Math.max(victim.slowTimer, move.slow ?? 0);
  attacker.hits += 1;

  if (attacker.id && attackerPassive === "vampire" && damage > 0) {
    attacker.damage = Math.max(0, attacker.damage - Math.max(0.8, damage * 0.15));
  }

  if (attacker.id && victimPassive === "thorns" && damage > 0) {
    attacker.damage = Math.min(999, attacker.damage + Math.max(1, damage * 0.15));
    attacker.flash = 0.12;
  }

  playSound(blocking ? "hit" : damage >= 10 ? "hurt" : "hit", blocking ? 0.35 : 0.55);
  burst(victim.x, victim.y, attacker.char.accent, blocking ? 5 : 10);
}

function ko(fighter) {
  fighter.stocks -= 1;
  const credit = fighter.lastHitBy ? fighters.get(fighter.lastHitBy) : null;
  if (credit && credit !== fighter) {
    credit.kos += 1;
    if (credit.char.passive?.type === "scavenger") {
      credit.damage = Math.max(0, credit.damage - 18);
      credit.shield = Math.min(credit.shieldMax, credit.shield + 30);
      burst(credit.x, credit.y, "#7cffb2", 14);
    }
  }

  hub?.log(
    "trash ko",
    fighter.char.id,
    `stocks=${fighter.stocks}`,
    `by=${credit && credit !== fighter ? credit.char.id : "stage"}`,
  );
  playSound("ko", 0.6);
  burst(fighter.x, Math.min(fighter.y, FLOOR_Y), "#ffd23f", 26);

  if (fighter.stocks <= 0) {
    fighter.gone = true;
    fighter.respawn = 0;
  } else {
    fighter.respawn = RESPAWN_DELAY;
    fighter.damage = 0;
    fighter.shield = fighter.shieldMax;
    fighter.invuln = 0;
    fighter.guardHeld = false;
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

  const aim = aims.get(fighter.id);
  const aimLength = Math.hypot(aim?.x ?? 0, aim?.y ?? 0);
  const aimX = aimLength > 0.3 ? aim.x / aimLength : fighter.facing;
  const aimY = aimLength > 0.3 ? aim.y / aimLength : 0;
  playSound("swing", 0.25);

  switch (move.type) {
    case "bolt":
    case "beam":
    case "wave":
      projectiles.push({
        kind: "shot",
        owner: fighter.id,
        x: fighter.x + fighter.facing * 24,
        y: fighter.y - 2,
        vx: aimX * move.speed,
        vy: aimY * move.speed,
        life: move.type === "beam" ? 1.2 : 1.7,
        radius: move.type === "beam" ? 7 : 9,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      burst(fighter.x + fighter.facing * 20, fighter.y, fighter.char.accent, 4);
      break;

    case "boomerang":
      projectiles.push({
        kind: "boomerang",
        owner: fighter.id,
        x: fighter.x + fighter.facing * 24,
        y: fighter.y - 2,
        vx: aimX * move.speed,
        vy: aimY * move.speed,
        life: 1.7,
        age: 0,
        returnAfter: 0.45,
        returning: false,
        hitIds: new Set(),
        radius: 10,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      break;

    case "bomb":
      projectiles.push({
        kind: "bomb",
        owner: fighter.id,
        x: fighter.x + fighter.facing * 22,
        y: fighter.y - 8,
        vx: aimX * (move.speed ?? 330),
        vy: aimY * 170 - 310,
        gravity: 940,
        life: 2.5,
        radius: 10,
        blastRadius: move.radius ?? 86,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      break;

    case "dash":
      fighter.vx = fighter.facing * (move.speed ?? 520);
      fighter.dashTimer = 0.22;
      fighter.dashHit = new Set();
      if (fighter.char.passive?.type === "oil") {
        slicks.push({
          owner: fighter.id,
          x: fighter.x,
          y: fighter.y + FIGHTER_R - 2,
          dir: fighter.facing,
          life: 5,
          damage: 4,
          knockback: 90,
          color: fighter.char.accent,
          hit: new Set(),
        });
      }
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

    case "counter":
      fighter.counterTimer = move.window ?? 0.5;
      burst(fighter.x, fighter.y, "#ffffff", 8);
      break;

    case "pull":
      vortices.push({
        owner: fighter.id,
        x: fighter.x + fighter.facing * 105,
        y: fighter.y,
        radius: move.radius ?? 120,
        life: move.duration ?? 1.2,
        duration: move.duration ?? 1.2,
        damage: move.damage,
        knockback: move.knockback,
        color: fighter.char.accent,
      });
      break;

    case "slam":
      fighter.slamTimer = 0.7;
      fighter.slamMove = move;
      fighter.vy = -540;
      fighter.grounded = false;
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
      playSound("select", 0.3);
      break;
  }

  fighter.cds[slot] = move.cooldown;
}

function nearestOpponent(fighter) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const other of fighters.values()) {
    if (other === fighter || other.gone || other.respawn > 0) continue;
    const distance = Math.abs(other.x - fighter.x) + Math.abs(other.y - fighter.y) * 0.7;
    if (distance < nearestDistance) {
      nearest = other;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function cpuJump(fighter) {
  const jumpPower = fighter.char.stats.jump * (fighter.char.passive?.type === "spring" ? 1.12 : 1);
  if (fighter.grounded) {
    fighter.vy = -jumpPower;
    fighter.grounded = false;
  } else if (fighter.airJumps > 0) {
    fighter.airJumps -= 1;
    fighter.vy = -jumpPower * 0.92;
  }
}

function driveCpu(fighter, dt) {
  const brain = fighter.cpu;
  if (!brain) return;

  brain.jumpCd = Math.max(0, brain.jumpCd - dt);
  brain.specialCd = Math.max(0, brain.specialCd - dt);

  const target = nearestOpponent(fighter);
  if (!target) {
    axes.set(fighter.id, { x: 0, y: 0 });
    return;
  }

  const dx = target.x - fighter.x;
  const dy = target.y - fighter.y;
  const main = stage.platforms.find((platform) => platform.main);
  let move = Math.abs(dx) > 58 ? Math.sign(dx) : 0;

  // Keep grounded bots from casually walking off the main ledge while they
  // are still learning the stage. They can still jump or be knocked off.
  if (fighter.grounded && main) {
    if (fighter.x < main.x + 42) move = 1;
    if (fighter.x > main.x + main.w - 42) move = -1;
  }

  axes.set(fighter.id, { x: move, y: 0 });
  const aimLength = Math.max(1, Math.hypot(dx, dy));
  aims.set(fighter.id, { x: dx / aimLength, y: dy / aimLength });

  if (brain.jumpCd <= 0 && (target.y < fighter.y - 52 || Math.abs(dx) > 130)) {
    if (fighter.grounded || fighter.airJumps > 0) {
      cpuJump(fighter);
      brain.jumpCd = 0.55 + Math.random() * 1.1;
    }
  }

  if (
    fighter.attackCd <= 0 &&
    Math.abs(dx) <= fighter.char.attack.reach + 16 &&
    Math.abs(dy) <= fighter.char.attack.arc
  ) {
    fighter.attackTimer = 0.16;
    fighter.attackCd = fighter.char.attack.cooldown;
    fighter.attackHit = false;
  }

  if (brain.specialCd <= 0 && Math.abs(dx) < 300) {
    const slot = Math.random() < 0.55 ? 0 : 1;
    if (fighter.cds[slot] <= 0) useSpecial(fighter, slot);
    brain.specialCd = 1.4 + Math.random() * 2.4;
  }

  // Nudge a bot out of a corner if it has been on the same platform without
  // a target in reach for a while.
  if (fighter.grounded && Math.abs(dx) < 40 && Math.abs(dy) > 90 && brain.jumpCd <= 0) {
    cpuJump(fighter);
    brain.jumpCd = 0.8;
  }
}

function platformsNow() {
  const stagePlatforms = stage.platforms.map((platform, index) => {
    if (!platform.move) return platform;
    const phase = stageTime * (platform.move.speed ?? 1) + index * 1.7;
    return {
      ...platform,
      x: platform.x + Math.sin(phase) * (platform.move.x ?? 0),
      y: platform.y + Math.cos(phase) * (platform.move.y ?? 0),
    };
  });
  for (const platform of respawnPlatforms) {
    if (platform.life > 0) stagePlatforms.push(platform);
  }
  return stagePlatforms;
}

function hazardState() {
  const hazard = stage.hazard;
  if (!hazard) return null;

  const cycle = Math.floor(stageTime / hazard.interval);
  const local = stageTime - cycle * hazard.interval;
  const warningStart = Math.max(0, hazard.interval - hazard.warning - hazard.duration);
  const activeStart = warningStart + hazard.warning;
  const phase = local >= activeStart ? "active" : local >= warningStart ? "warning" : "idle";
  const targets = hazard.targets ?? [WIDTH / 2];
  return {
    hazard,
    cycle,
    phase,
    local,
    target: targets[Math.abs(cycle) % targets.length],
  };
}

function triggerHazard(state) {
  const hazard = state.hazard;

  if (hazard.type === "junk") {
    for (let offset = -1; offset <= 1; offset += 1) {
      debris.push({
        x: state.target + offset * 58,
        y: -24 - Math.abs(offset) * 28,
        vy: 190 + Math.abs(offset) * 40,
        life: 4,
        damage: hazard.damage,
        knockback: hazard.knockback,
        color: "#b8a06a",
        icon: (state.cycle * 3 + offset + 5 + JUNK_ICONS.length) % JUNK_ICONS.length,
        size: 36 + Math.abs(offset) * 4,
      });
    }
  } else if (hazard.type === "geyser") {
    aoe(HAZARD_SOURCE, state.target, FLOOR_Y - 26, 100, hazard, 1);
    burst(state.target, FLOOR_Y - 30, "#ff7ad9", 26);
    playSound("ko", 0.28);
  } else if (hazard.type === "toxin") {
    aoe(HAZARD_SOURCE, WIDTH / 2, HEIGHT / 2, 148, hazard, 1);
    burst(WIDTH / 2, HEIGHT / 2, "#d4ff6b", 30);
    playSound("hurt", 0.3);
  } else if (hazard.type === "compactor") {
    const fromLeft = state.cycle % 2 === 0;
    const dir = fromLeft ? 1 : -1;
    for (const fighter of fighters.values()) {
      if (fighter.gone || fighter.respawn > 0) continue;
      const nearWall = fromLeft ? fighter.x < 170 : fighter.x > WIDTH - 170;
      fighter.vx += dir * (nearWall ? 360 : 120);
      if (nearWall) damageFighter(HAZARD_SOURCE, fighter, hazard, dir);
    }
    burst(fromLeft ? 24 : WIDTH - 24, HEIGHT / 2, "#ff9b5c", 24);
    playSound("swing", 0.35);
  }
}

function simulate(dt) {
  if (phase !== "fight") return;

  stageTime += dt;
  for (let index = respawnPlatforms.length - 1; index >= 0; index -= 1) {
    respawnPlatforms[index].life -= dt;
    if (respawnPlatforms[index].life <= 0) respawnPlatforms.splice(index, 1);
  }

  const hazard = hazardState();
  if (hazard?.phase === "active" && hazard.cycle !== lastHazardCycle) {
    lastHazardCycle = hazard.cycle;
    triggerHazard(hazard);
  }

  const platforms = platformsNow();

  for (const fighter of fighters.values()) {
    if (fighter.gone) continue;

    if (fighter.flash > 0) fighter.flash = Math.max(0, fighter.flash - dt);
    if (fighter.invuln > 0) fighter.invuln = Math.max(0, fighter.invuln - dt);
    if (fighter.attackCd > 0) fighter.attackCd = Math.max(0, fighter.attackCd - dt);
    if (fighter.cds[0] > 0) fighter.cds[0] = Math.max(0, fighter.cds[0] - dt);
    if (fighter.cds[1] > 0) fighter.cds[1] = Math.max(0, fighter.cds[1] - dt);
    if (fighter.counterTimer > 0) fighter.counterTimer = Math.max(0, fighter.counterTimer - dt);
    if (fighter.dropTimer > 0) fighter.dropTimer = Math.max(0, fighter.dropTimer - dt);
    if (fighter.slowTimer > 0) fighter.slowTimer = Math.max(0, fighter.slowTimer - dt);
    fighter.sinceHit += dt;

    if (fighter.respawn > 0) {
      fighter.respawn = Math.max(0, fighter.respawn - dt);
      if (fighter.respawn === 0) {
        const spawn = makeRespawnPlatform(fighter);
        fighter.x = spawn.x;
        fighter.y = spawn.y;
        fighter.vx = 0;
        fighter.vy = 0;
        fighter.invuln = SPAWN_INVULN;
        fighter.grounded = false;
      }
      continue;
    }

    if (fighter.isCPU && fighter.hitstun <= 0) driveCpu(fighter, dt);

    if (fighter.char.passive?.type === "regen" && fighter.sinceHit > 4 && fighter.damage > 0) {
      fighter.damage = Math.max(0, fighter.damage - 4 * dt);
    }

    const guarding = fighter.guardHeld && fighter.shield > 0 && fighter.hitstun <= 0;
    if (guarding) {
      fighter.shield = Math.max(0, fighter.shield - 28 * dt);
      if (fighter.shield === 0) breakShield(fighter);
    } else {
      const recharge = fighter.char.passive?.type === "bulwark" ? 26 : 16;
      fighter.shield = Math.min(fighter.shieldMax, fighter.shield + recharge * dt);
    }

    if (fighter.hitstun > 0) {
      fighter.hitstun = Math.max(0, fighter.hitstun - dt);
    } else {
      const axis = fighter.online ? axes.get(fighter.id) : null;
      const passive = fighter.char.passive?.type;
      const rush = passive === "rush" ? 1 + Math.min(0.28, (fighter.damage / 300) * 0.28) : 1;
      const slow = fighter.slowTimer > 0 ? 0.55 : 1;
      const target =
        axis && !guarding
          ? Math.max(-1, Math.min(1, axis.x)) * fighter.char.stats.speed * rush * slow
          : 0;
      fighter.vx += (target - fighter.vx) * Math.min(1, dt * 16);
    }
    if (Math.abs(fighter.vx) > 14) fighter.facing = Math.sign(fighter.vx);

    const gravityScale = fighter.char.passive?.type === "float" ? 0.8 : 1;
    const maxFall = fighter.char.passive?.type === "float" ? 1080 : 1400;
    fighter.vy = Math.min(maxFall, fighter.vy + GRAVITY * gravityScale * dt);
    if (stage.wind && fighter.hitstun <= 0) fighter.vx += stage.wind * dt;

    const previousY = fighter.y;
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;
    fighter.grounded = false;
    let standingPush = 0;

    if (fighter.dropTimer <= 0) {
      for (const platform of platforms) {
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
          if (platform.bounce && fighter.vy > 240) {
            fighter.vy = -platform.bounce;
            fighter.grounded = false;
            fighter.airJumps = fighter.char.stats.airJumps;
            burst(fighter.x, fighter.y + FIGHTER_R, stage.trim, 10);
            playSound("jump", 0.3);
          } else {
            fighter.vy = 0;
            fighter.grounded = true;
            fighter.airJumps = fighter.char.stats.airJumps;
            standingPush = platform.push ?? 0;
          }
        }
      }
    }

    if (stage.solidFloor !== false && fighter.y + FIGHTER_R >= FLOOR_Y) {
      fighter.y = FLOOR_Y - FIGHTER_R;
      fighter.vy = 0;
      fighter.grounded = true;
      fighter.airJumps = fighter.char.stats.airJumps;
    }

    if (standingPush !== 0 && fighter.grounded) fighter.x += standingPush * dt;

    if (fighter.slamTimer > 0) {
      fighter.slamTimer = Math.max(0, fighter.slamTimer - dt);
      if (fighter.grounded && fighter.slamMove) {
        const slam = fighter.slamMove;
        aoe(fighter, fighter.x, fighter.y, slam.radius ?? 100, slam, fighter.facing);
        burst(fighter.x, fighter.y + FIGHTER_R, fighter.char.accent, 24);
        playSound("ko", 0.3);
        fighter.slamTimer = 0;
        fighter.slamMove = null;
      }
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
              const move =
                fighter.char.specials.find((special) => special.type === "dash") ??
                fighter.char.specials[0];
              damageFighter(fighter, other, move, fighter.facing);
            }
          }
        }
      }
    }

    if (fighter.x < -50 || fighter.x > WIDTH + 50 || fighter.y > HEIGHT + 70) ko(fighter);
  }

  for (let index = slicks.length - 1; index >= 0; index -= 1) {
    const slick = slicks[index];
    slick.life -= dt;
    const attacker = fighters.get(slick.owner);
    if (attacker) {
      for (const fighter of fighters.values()) {
        if (fighter.gone || fighter.respawn > 0 || fighter.id === slick.owner) continue;
        if (slick.hit.has(fighter.id)) continue;
        if (
          Math.abs(fighter.x - slick.x) < 48 &&
          Math.abs(fighter.y + FIGHTER_R - slick.y) < 34
        ) {
          slick.hit.add(fighter.id);
          damageFighter(attacker, fighter, slick, slick.dir);
          burst(slick.x, slick.y, slick.color, 8);
        }
      }
    }
    if (slick.life <= 0) slicks.splice(index, 1);
  }

  for (let index = vortices.length - 1; index >= 0; index -= 1) {
    const vortex = vortices[index];
    vortex.life -= dt;
    for (const fighter of fighters.values()) {
      if (fighter.gone || fighter.respawn > 0 || fighter.id === vortex.owner) continue;
      const dx = vortex.x - fighter.x;
      const dy = vortex.y - fighter.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      if (distance > vortex.radius) continue;
      const pull = (1 - distance / vortex.radius) * 720;
      fighter.vx += (dx / distance) * pull * dt;
      fighter.vy += (dy / distance) * pull * 0.28 * dt;
      fighter.grounded = false;
    }

    if (vortex.life > 0) continue;
    const attacker = fighters.get(vortex.owner);
    if (attacker) aoe(attacker, vortex.x, vortex.y, vortex.radius * 0.8, vortex, 1);
    burst(vortex.x, vortex.y, vortex.color, 24);
    vortices.splice(index, 1);
  }

  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const shot = projectiles[index];
    if (shot.age !== undefined) shot.age += dt;
    shot.life -= dt;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    if (shot.gravity) shot.vy += shot.gravity * dt;

    const attacker = fighters.get(shot.owner);

    if (shot.kind === "bomb") {
      const onPlatform = platforms.some(
        (platform) =>
          shot.x >= platform.x - 8 &&
          shot.x <= platform.x + platform.w + 8 &&
          shot.y + shot.radius >= platform.y &&
          shot.y - shot.radius <= platform.y + 12 &&
          shot.vy > 0,
      );
      if (shot.life <= 0 || shot.y + shot.radius >= FLOOR_Y || onPlatform) {
        if (attacker) {
          aoe(attacker, shot.x, Math.min(shot.y, FLOOR_Y - 8), shot.blastRadius, shot, Math.sign(shot.vx) || 1);
        }
        burst(shot.x, Math.min(shot.y, FLOOR_Y - 8), shot.color, 24);
        playSound("ko", 0.35);
        projectiles.splice(index, 1);
      }
      continue;
    }

    if (shot.kind === "boomerang") {
      if (!shot.returning && shot.age >= shot.returnAfter) shot.returning = true;
      if (shot.returning && attacker) {
        const dx = attacker.x - shot.x;
        const dy = attacker.y - shot.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        shot.vx = (dx / distance) * 620;
        shot.vy = (dy / distance) * 620;
        if (distance < 34) {
          projectiles.splice(index, 1);
          continue;
        }
      }

      let hitSomething = false;
      for (const fighter of fighters.values()) {
        if (fighter.id === shot.owner || fighter.gone || fighter.respawn > 0) continue;
        if (shot.hitIds.has(fighter.id)) continue;
        if (Math.hypot(fighter.x - shot.x, fighter.y - shot.y) <= FIGHTER_R + shot.radius) {
          if (attacker) damageFighter(attacker, fighter, shot, Math.sign(shot.vx) || 1);
          shot.hitIds.add(fighter.id);
          hitSomething = true;
          break;
        }
      }

      if (hitSomething && shot.returning) {
        shot.life = Math.min(shot.life, 0.45);
      }
      if (shot.life <= 0 || shot.x < -80 || shot.x > WIDTH + 80) {
        projectiles.splice(index, 1);
      }
      continue;
    }

    let hitSomething = false;
    for (const fighter of fighters.values()) {
      if (fighter.id === shot.owner || fighter.gone || fighter.respawn > 0) continue;
      if (Math.hypot(fighter.x - shot.x, fighter.y - shot.y) <= FIGHTER_R + shot.radius) {
        if (attacker) {
          damageFighter(attacker, fighter, shot, Math.sign(shot.vx) || attacker.facing);
        }
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

  for (let index = debris.length - 1; index >= 0; index -= 1) {
    const junk = debris[index];
    junk.life -= dt;
    junk.vy += GRAVITY * 0.7 * dt;
    junk.y += junk.vy * dt;

    if (junk.life <= 0 || junk.y >= FLOOR_Y - 8 || junk.y > HEIGHT + 40) {
      aoe(HAZARD_SOURCE, junk.x, Math.min(junk.y, FLOOR_Y - 8), 48, junk, 1);
      burst(junk.x, Math.min(junk.y, FLOOR_Y - 8), junk.color, 16);
      debris.splice(index, 1);
    }
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
      hub?.log("trash state", state || "no fighters");
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

  if (phase === "select") {
    drawSelect(now);
    return;
  }

  if (phase === "stage") {
    drawStageSelect(now);
    return;
  }

  if (phase === "countdown") {
    drawStageSelect(now);
    drawCountdown(now);
    return;
  }

  drawFight(now);
  if (phase === "results") drawResults(now);
}

function paintBackdrop(scene) {
  const look = STAGE_LOOKS[scene.id] ?? DEFAULT_STAGE_LOOK;
  const image = ART[look.image];
  const imageReady = Boolean(image?.complete && image.naturalWidth > 0);

  const sky = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  sky.addColorStop(0, scene.sky[0]);
  sky.addColorStop(1, scene.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (imageReady) {
    drawBackdropImage(image, look);
    ctx.fillStyle = look.tint;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  for (let index = 0; index < 10; index += 1) {
    ctx.beginPath();
    ctx.arc(45 + index * 101, 42 + (index % 4) * 37, 18 + (index % 3) * 9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  if (imageReady) ctx.globalAlpha = 0.34;

  if (scene.theme === "dump") {
    ctx.fillStyle = "rgba(5, 8, 13, 0.55)";
    for (let index = 0; index < 7; index += 1) {
      const x = 20 + index * 143;
      const height = 55 + (index % 3) * 34;
      ctx.fillRect(x, FLOOR_Y - height, 82, height);
      ctx.fillStyle = "rgba(120, 140, 160, 0.16)";
      ctx.fillRect(x + 9, FLOOR_Y - height + 12, 24, 18);
      ctx.fillStyle = "rgba(5, 8, 13, 0.55)";
    }
    ctx.fillStyle = "rgba(184, 160, 106, 0.22)";
    for (let index = 0; index < 12; index += 1) {
      ctx.beginPath();
      ctx.ellipse(40 + index * 82, FLOOR_Y - 8 - (index % 3) * 9, 18, 25, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (scene.theme === "conveyor") {
    ctx.strokeStyle = "rgba(124, 255, 178, 0.12)";
    ctx.lineWidth = 2;
    for (let index = 0; index < 6; index += 1) {
      ctx.beginPath();
      ctx.moveTo(0, 110 + index * 58);
      ctx.lineTo(WIDTH, 110 + index * 58);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(6, 16, 22, 0.7)";
    for (let index = 0; index < 4; index += 1) {
      const x = 80 + index * 260;
      ctx.fillRect(x, 200, 105, 150);
      ctx.fillStyle = "rgba(124, 255, 178, 0.15)";
      ctx.fillRect(x + 14, 218, 77, 9);
      ctx.fillStyle = "rgba(6, 16, 22, 0.7)";
    }
  } else if (scene.theme === "marsh") {
    ctx.fillStyle = "rgba(4, 20, 12, 0.45)";
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    for (let x = 0; x <= WIDTH; x += 80) {
      ctx.lineTo(x, FLOOR_Y - 30 - Math.sin(x / 90) * 23);
    }
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.lineTo(0, HEIGHT);
    ctx.fill();
    for (let index = 0; index < 16; index += 1) {
      const x = (index * 73 + (stageTime * 1000) / 80) % WIDTH;
      const y = 180 + ((index * 47) % 180);
      ctx.strokeStyle = "rgba(212, 255, 107, 0.14)";
      ctx.beginPath();
      ctx.arc(x, y, 4 + (index % 3) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (scene.theme === "neon") {
    ctx.fillStyle = "rgba(8, 5, 14, 0.7)";
    for (let index = 0; index < 9; index += 1) {
      const x = index * 112 - 20;
      const height = 70 + ((index * 53) % 170);
      ctx.fillRect(x, FLOOR_Y - height, 82, height);
    }
    ctx.strokeStyle = "rgba(255, 122, 217, 0.35)";
    ctx.lineWidth = 2;
    for (let index = 0; index < 5; index += 1) {
      ctx.strokeRect(55 + index * 185, 185 + (index % 2) * 42, 90, 44);
    }
  } else if (scene.theme === "compactor") {
    ctx.fillStyle = "rgba(10, 7, 5, 0.8)";
    ctx.fillRect(0, 0, 78, HEIGHT);
    ctx.fillRect(WIDTH - 78, 0, 78, HEIGHT);
    ctx.strokeStyle = "rgba(255, 155, 92, 0.22)";
    ctx.lineWidth = 3;
    for (let index = 0; index < 12; index += 1) {
      ctx.beginPath();
      ctx.moveTo(0, index * 52);
      ctx.lineTo(78, index * 52 + 38);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(WIDTH - 78, index * 52);
      ctx.lineTo(WIDTH, index * 52 + 38);
      ctx.stroke();
    }
  } else if (scene.theme === "landfill") {
    ctx.fillStyle = "rgba(12, 8, 4, 0.55)";
    for (let hill = 0; hill < 4; hill += 1) {
      ctx.beginPath();
      ctx.ellipse(90 + hill * 280, FLOOR_Y - 12, 220, 95 + hill * 15, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 207, 92, 0.2)";
    ctx.lineWidth = 2;
    for (let index = 0; index < 6; index += 1) {
      const x = 60 + index * 170 + Math.sin((stageTime * 1000) / 900 + index) * 12;
      ctx.beginPath();
      ctx.moveTo(x, 95 + (index % 3) * 24);
      ctx.lineTo(x + 26, 90 + (index % 3) * 24);
      ctx.stroke();
    }
  }

  ctx.restore();
  paintBackGlow(look);
  drawStageProps(look);
  paintVignette();
}

function drawBackdropImage(image, look) {
  const scale = Math.max(WIDTH / image.naturalWidth, HEIGHT / image.naturalHeight) * 1.04;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const drift = Math.sin(stageTime * 0.1) * (look.drift ?? 8);
  const x = (WIDTH - width) / 2 + drift;
  const y = (HEIGHT - height) / 2;

  ctx.save();
  if (look.flip) {
    ctx.translate(WIDTH, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

function paintBackGlow(look) {
  const glow = ctx.createRadialGradient(WIDTH / 2, 146, 24, WIDTH / 2, 146, 430);
  glow.addColorStop(0, look.glow ?? "rgba(255, 210, 63, 0.12)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function paintVignette() {
  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 190, WIDTH / 2, HEIGHT / 2, 650);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.52)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawJunkIcon(index, x, y, size, rotation = 0, alpha = 1, anchor = "center") {
  const image = ART.junk;
  if (!image?.complete || image.naturalWidth === 0) return false;

  const icon = JUNK_ICONS[index % JUNK_ICONS.length];
  if (!icon) return false;
  const width = (icon.w / JUNK_HEIGHT) * size;
  const top = anchor === "bottom" ? -size : -size / 2;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, icon.x, 0, icon.w, JUNK_HEIGHT, -width / 2, top, width, size);
  ctx.restore();
  return true;
}

function drawStageProps(look) {
  for (const prop of look.props ?? []) {
    drawJunkIcon(prop.icon, prop.x, prop.y, prop.size, prop.rot, prop.alpha, "bottom");
  }
}

function drawSelectTitle() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `400 11px ${DISPLAY_FONT}`;
  ctx.fillStyle = "#ffd23f";
  ctx.fillText("THE DUMPSERVERSE PRESENTS", WIDTH / 2, 22);

  ctx.font = `400 38px ${DISPLAY_FONT}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(4, 4, 10, 0.92)";
  ctx.strokeText("CHOOSE YOUR FIGHTER", WIDTH / 2, 63);
  const fill = ctx.createLinearGradient(0, 25, 0, 68);
  fill.addColorStop(0, "#fff5b8");
  fill.addColorStop(0.48, "#ffd23f");
  fill.addColorStop(1, "#ff8a3d");
  ctx.fillStyle = fill;
  ctx.fillText("CHOOSE YOUR FIGHTER", WIDTH / 2, 63);

  ctx.font = `600 10px ui-monospace, monospace`;
  ctx.fillStyle = "rgba(244, 244, 251, 0.62)";
  ctx.fillText(
    `${ROSTER.length} FIGHTERS  ·  UP TO 10 AT ONCE  ·  PASSIVE INCLUDED`,
    WIDTH / 2,
    83,
  );
  ctx.restore();
}

function drawSelect(now) {
  paintBackdrop(STAGES[selectedStageIndex] ?? STAGES[0]);

  const topShade = ctx.createLinearGradient(0, 0, 0, 132);
  topShade.addColorStop(0, "rgba(5, 5, 12, 0.86)");
  topShade.addColorStop(0.62, "rgba(5, 5, 12, 0.42)");
  topShade.addColorStop(1, "rgba(5, 5, 12, 0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, WIDTH, 132);
  drawSelectTitle();

  const columns = 5;
  const cardW = 166;
  const cardH = 70;
  const gapX = 10;
  const gapY = 4;
  const startX = (WIDTH - (columns * cardW + (columns - 1) * gapX)) / 2;
  const startY = 90;

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

    const cardFill = ctx.createLinearGradient(x, y, x, y + cardH);
    cardFill.addColorStop(0, picker ? "rgba(31, 28, 43, 0.94)" : "rgba(20, 20, 31, 0.9)");
    cardFill.addColorStop(1, "rgba(8, 8, 14, 0.88)");
    ctx.save();
    ctx.shadowColor = picker ? picker.color : "transparent";
    ctx.shadowBlur = picker ? 16 : 0;
    ctx.fillStyle = cardFill;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 12);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = character.color;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.roundRect(x + 10, y + 1, cardW - 20, 3, 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = picker ? picker.color : "rgba(255, 255, 255, 0.11)";
    ctx.lineWidth = picker ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 12);
    ctx.stroke();

    drawFighterPortrait(character, x + 25, y + 26, 15);

    ctx.textAlign = "left";
    ctx.fillStyle = "#f4f4fb";
    ctx.font = "700 11px ui-rounded, system-ui, sans-serif";
    ctx.fillText(character.name.slice(0, 17), x + 47, y + 23);

    ctx.fillStyle = "#9a9ab0";
    ctx.font = "500 8.5px ui-rounded, system-ui, sans-serif";
    ctx.fillText(character.role.slice(0, 24), x + 47, y + 35);

    ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
    ctx.beginPath();
    ctx.roundRect(x + 9, y + 39, cardW - 18, 15, 5);
    ctx.fill();
    ctx.fillStyle = character.accent;
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.fillText(character.passive.label.toUpperCase(), x + 15, y + 50);

    ctx.fillStyle = "#6f6f88";
    ctx.font = "600 8px ui-monospace, monospace";
    ctx.fillText(`${character.stats.weight.toFixed(2)}w · ${character.stats.airJumps}j · ${character.attack.name.slice(0, 13)}`, x + 11, y + 63);

    if (picker) {
      ctx.fillStyle = picker.color;
      ctx.font = "700 8px ui-rounded, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(picker.name.slice(0, 11), x + cardW - 9, y + 63);
    }
  });

  const bottomShade = ctx.createLinearGradient(0, HEIGHT - 74, 0, HEIGHT);
  bottomShade.addColorStop(0, "rgba(5, 5, 12, 0)");
  bottomShade.addColorStop(1, "rgba(5, 5, 12, 0.84)");
  ctx.fillStyle = bottomShade;
  ctx.fillRect(0, HEIGHT - 74, WIDTH, 74);

  const players = connectedPlayers();
  ctx.textAlign = "left";
  ctx.font = "600 12px ui-rounded, system-ui, sans-serif";
  let chipX = 30;
  let chipY = HEIGHT - 42;
  for (const player of players) {
    const chosen = picks.has(player.id) ? ROSTER[picks.get(player.id)].name : "choosing…";
    const label = `${player.name} · ${chosen}`;
    const width = ctx.measureText(label).width + 34;
    if (chipX + width > WIDTH - 30) {
      chipX = 30;
      chipY -= 30;
    }
    ctx.fillStyle = "rgba(8, 8, 15, 0.82)";
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, width, 26, 13);
    ctx.fill();
    ctx.strokeStyle = `${player.color}55`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(chipX + 13, chipY + 13, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f4f4fb";
    ctx.fillText(label, chipX + 24, chipY + 17);
    chipX += width + 10;
  }

  if (players.length === 0) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#c8c8d8";
    ctx.font = `400 14px ${DISPLAY_FONT}`;
    ctx.fillText("OPEN THE JOIN LINK TO PICK YOUR FIGHTER", WIDTH / 2, HEIGHT - 24);
  }

  const sweep = (now / 18) % WIDTH;
  ctx.fillStyle = "rgba(255, 210, 63, 0.04)";
  ctx.fillRect(sweep, 0, 40, HEIGHT);
}

function drawStageSelect(now) {
  const preview = STAGES[selectedStageIndex] ?? STAGES[0];
  paintBackdrop(preview);

  ctx.fillStyle = "rgba(4, 5, 12, 0.78)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = "center";
  ctx.font = `400 11px ${DISPLAY_FONT}`;
  ctx.fillStyle = "#ffd23f";
  ctx.fillText("THE DUMPSERVERSE PRESENTS", WIDTH / 2, 25);

  ctx.lineJoin = "round";
  ctx.font = `400 36px ${DISPLAY_FONT}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(4, 4, 10, 0.92)";
  ctx.strokeText("CHOOSE YOUR STAGE", WIDTH / 2, 64);
  const heading = ctx.createLinearGradient(0, 28, 0, 70);
  heading.addColorStop(0, "#fff5b8");
  heading.addColorStop(0.5, "#ffd23f");
  heading.addColorStop(1, "#ff8a3d");
  ctx.fillStyle = heading;
  ctx.fillText("CHOOSE YOUR STAGE", WIDTH / 2, 64);

  ctx.font = "600 10px ui-monospace, monospace";
  ctx.fillStyle = "rgba(244, 244, 251, 0.65)";
  ctx.fillText("PURE PLATFORMS  ·  OPEN LEDGES  ·  NO STAGE HAZARDS", WIDTH / 2, 84);

  stageSelectHitboxes.length = 0;
  const columns = 3;
  const cardW = 270;
  const cardH = 152;
  const gapX = 18;
  const gapY = 14;
  const startX = (WIDTH - (columns * cardW + (columns - 1) * gapX)) / 2;
  const startY = 104;

  STAGES.forEach((candidate, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = startX + column * (cardW + gapX);
    const y = startY + row * (cardH + gapY);
    const selected = index === selectedStageIndex;
    stageSelectHitboxes.push({ x, y, w: cardW, h: cardH, index });

    ctx.save();
    ctx.shadowColor = selected ? candidate.trim : "transparent";
    ctx.shadowBlur = selected ? 22 : 0;
    const fill = ctx.createLinearGradient(x, y, x, y + cardH);
    fill.addColorStop(0, selected ? "rgba(36, 34, 49, 0.97)" : "rgba(18, 18, 28, 0.94)");
    fill.addColorStop(1, "rgba(8, 8, 14, 0.9)");
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 13);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = selected ? candidate.trim : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 13);
    ctx.stroke();

    ctx.fillStyle = selected ? candidate.trim : candidate.platform;
    ctx.fillRect(x + 1, y + 1, cardW - 2, 3);

    ctx.textAlign = "left";
    ctx.fillStyle = "#f4f4fb";
    ctx.font = `400 16px ${DISPLAY_FONT}`;
    ctx.fillText(candidate.name.toUpperCase(), x + 14, y + 26);
    ctx.fillStyle = selected ? "#ffd23f" : "#9a9ab0";
    ctx.font = "600 9px ui-rounded, system-ui, sans-serif";
    ctx.fillText(candidate.modifier, x + 14, y + 42);

    drawMiniStage(candidate, x + 14, y + 51, cardW - 28, 69);

    ctx.fillStyle = selected ? candidate.trim : "rgba(255, 255, 255, 0.35)";
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(selected ? "SELECTED" : "CLICK TO SELECT", x + cardW - 14, y + cardH - 12);
    if (selected) {
      const pulse = 0.55 + Math.sin(now / 180) * 0.25;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 4, cardW + 8, cardH + 8, 17);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  });

  const fightersReady = connectedPlayers().length + cpuCount;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(244, 244, 251, 0.8)";
  ctx.font = `400 11px ${DISPLAY_FONT}`;
  ctx.fillText(
    `${fightersReady} FIGHTER${fightersReady === 1 ? "" : "S"} READY  ·  ${cpuCount} CPU${cpuCount === 1 ? "" : "S"}  ·  THEN PRESS START FIGHT`,
    WIDTH / 2,
    HEIGHT - 18,
  );
}

function drawMiniStage(preview, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.clip();

  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, preview.sky[0]);
  sky.addColorStop(1, preview.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);

  ctx.globalAlpha = 0.24;
  ctx.fillStyle = preview.trim;
  ctx.beginPath();
  ctx.arc(x + w * 0.72, y + h * 0.28, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  for (const platform of preview.platforms) {
    const px = x + (platform.x / WIDTH) * w;
    const py = y + ((platform.y - 120) / (HEIGHT - 120)) * h;
    const pw = Math.max(8, (platform.w / WIDTH) * w);
    ctx.fillStyle = platform.main ? preview.trim : preview.platform;
    ctx.globalAlpha = platform.main ? 0.95 : 0.8;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, platform.main ? 6 : 4, 2);
    ctx.fill();
    if (platform.main) {
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = preview.platform;
      ctx.fillRect(px, py + 6, pw, 5);
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.stroke();
}

function drawCountdown(now) {
  const seconds = Math.max(1, Math.ceil((countdownEndsAt - now) / 1000));
  ctx.fillStyle = "rgba(6, 6, 12, 0.78)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const pulse = 1 + Math.sin(now / 120) * 0.025;
  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT / 2 + 8);
  ctx.scale(pulse, pulse);
  ctx.textAlign = "center";
  ctx.strokeStyle = "rgba(255, 210, 63, 0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 142, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 210, 63, 0.08)";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 164, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.font = `400 132px ${DISPLAY_FONT}`;
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(4, 4, 10, 0.95)";
  ctx.strokeText(String(seconds), WIDTH / 2, HEIGHT / 2 + 56);
  const fill = ctx.createLinearGradient(0, HEIGHT / 2 - 60, 0, HEIGHT / 2 + 60);
  fill.addColorStop(0, "#fff5b8");
  fill.addColorStop(1, "#ff8a3d");
  ctx.fillStyle = fill;
  ctx.fillText(String(seconds), WIDTH / 2, HEIGHT / 2 + 56);
  ctx.fillStyle = "#f4f4fb";
  ctx.font = `400 14px ${DISPLAY_FONT}`;
  ctx.fillText("GET READY TO TAKE OUT THE TRASH", WIDTH / 2, HEIGHT / 2 + 92);
}

function drawHazard(now) {
  const state = hazardState();
  if (!state || state.phase === "idle") return;

  const warning = state.phase === "warning";
  const pulse = warning ? 0.25 + Math.sin(now / 65) * 0.12 : 0.62;

  if (state.hazard.type === "junk") {
    ctx.save();
    ctx.globalAlpha = pulse + 0.2;
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    ctx.beginPath();
    ctx.moveTo(state.target, 80);
    ctx.lineTo(state.target, FLOOR_Y - 5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "900 20px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("!", state.target, FLOOR_Y - 22);
    ctx.restore();
  } else if (state.hazard.type === "geyser") {
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = "#ff7ad9";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(state.target, FLOOR_Y - 2, 98, 17, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (!warning) {
      const column = ctx.createLinearGradient(0, FLOOR_Y, 0, 250);
      column.addColorStop(0, "rgba(255, 122, 217, 0.55)");
      column.addColorStop(1, "rgba(255, 122, 217, 0)");
      ctx.fillStyle = column;
      ctx.fillRect(state.target - 58, 230, 116, FLOOR_Y - 230);
    }
    ctx.restore();
  } else if (state.hazard.type === "toxin") {
    ctx.save();
    ctx.globalAlpha = pulse;
    const gas = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 20, WIDTH / 2, HEIGHT / 2, 160);
    gas.addColorStop(0, "rgba(212, 255, 107, 0.36)");
    gas.addColorStop(1, "rgba(124, 255, 107, 0)");
    ctx.fillStyle = gas;
    ctx.beginPath();
    ctx.arc(WIDTH / 2, HEIGHT / 2, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (state.hazard.type === "compactor") {
    const fromLeft = state.cycle % 2 === 0;
    const width = warning ? 24 : 92;
    ctx.save();
    ctx.globalAlpha = pulse + 0.25;
    ctx.fillStyle = "#2a211c";
    ctx.fillRect(fromLeft ? 0 : WIDTH - width, 0, width, HEIGHT);
    ctx.strokeStyle = "#ff9b5c";
    ctx.lineWidth = 4;
    ctx.strokeRect(fromLeft ? 0 : WIDTH - width, 0, width, HEIGHT);
    ctx.fillStyle = "#ffd23f";
    for (let y = 30; y < HEIGHT; y += 56) {
      ctx.fillRect(fromLeft ? 10 : WIDTH - width + 10, y, width - 20, 12);
    }
    ctx.restore();
  }
}

function drawFight(now) {
  paintBackdrop(stage);
  const platforms = platformsNow();

  if (stage.wind) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
    ctx.lineWidth = 1;
    for (let index = 0; index < 14; index += 1) {
      const x = (index * 89 + now / 11) % WIDTH;
      const y = 115 + ((index * 47) % 260);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 34, y - 5);
      ctx.stroke();
    }
  }

  for (const platform of platforms) {
    if (platform.respawn) {
      const glow = ctx.createRadialGradient(
        platform.x + platform.w / 2,
        platform.y + 8,
        8,
        platform.x + platform.w / 2,
        platform.y + 8,
        90,
      );
      glow.addColorStop(0, `${platform.color}55`);
      glow.addColorStop(1, `${platform.color}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(platform.x - 70, platform.y - 50, platform.w + 140, 140);
    }

    const platformHeight = platform.main ? 18 : 14;
    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    ctx.beginPath();
    ctx.roundRect(platform.x + 5, platform.y + 8, platform.w, platformHeight, 7);
    ctx.fill();

    const surface = ctx.createLinearGradient(0, platform.y, 0, platform.y + platformHeight);
    surface.addColorStop(0, stage.platform);
    surface.addColorStop(1, "rgba(0, 0, 0, 0.78)");
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.roundRect(platform.x, platform.y, platform.w, platformHeight, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = stage.trim;
    ctx.globalAlpha = 0.86;
    ctx.beginPath();
    ctx.roundRect(platform.x + 3, platform.y, platform.w - 6, 3, 1.5);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (platform.main) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
      ctx.fillRect(platform.x + 14, platform.y + platformHeight + 7, platform.w - 28, 7);
    }
    for (const boltX of [platform.x + 12, platform.x + platform.w - 12]) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.beginPath();
      ctx.arc(boltX, platform.y + 8, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (platform.respawn) {
      ctx.strokeStyle = platform.color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(platform.x, platform.y, platform.w, platformHeight, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (platform.bounce) {
      ctx.strokeStyle = stage.trim;
      ctx.lineWidth = 2;
      for (let arrow = 0; arrow < 4; arrow += 1) {
        const x = platform.x + 30 + arrow * (platform.w / 4.5);
        ctx.beginPath();
        ctx.moveTo(x, platform.y + 28);
        ctx.lineTo(x + 7, platform.y + 19);
        ctx.lineTo(x + 14, platform.y + 28);
        ctx.stroke();
      }
    } else if (platform.push) {
      ctx.fillStyle = stage.trim;
      ctx.globalAlpha = 0.55;
      for (let arrow = 0; arrow < 5; arrow += 1) {
        const x = platform.x + 24 + arrow * (platform.w / 5.2);
        const dir = Math.sign(platform.push);
        ctx.beginPath();
        ctx.moveTo(x, platform.y + 26);
        ctx.lineTo(x + 12 * dir, platform.y + 20);
        ctx.lineTo(x, platform.y + 14);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  if (stage.solidFloor !== false) {
    const floor = ctx.createLinearGradient(0, FLOOR_Y, 0, HEIGHT);
    floor.addColorStop(0, stage.platform);
    floor.addColorStop(0.32, stage.floor);
    floor.addColorStop(1, "#050508");
    ctx.fillStyle = floor;
    ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);
    ctx.fillStyle = stage.trim;
    ctx.globalAlpha = 0.82;
    ctx.fillRect(0, FLOOR_Y, WIDTH, 3);
    ctx.globalAlpha = 0.16;
    ctx.fillRect(0, FLOOR_Y + 3, WIDTH, 9);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
    ctx.lineWidth = 2;
    for (let x = 22; x < WIDTH; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, FLOOR_Y + 10);
      ctx.lineTo(x + 20, HEIGHT);
      ctx.stroke();
    }
    for (let x = 14; x < WIDTH; x += 96) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
      ctx.fillRect(x, FLOOR_Y + 16, 42, 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.arc(x + 4, FLOOR_Y + 16, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const slick of slicks) {
    ctx.globalAlpha = Math.min(0.85, slick.life * 0.3);
    ctx.fillStyle = slick.color;
    ctx.beginPath();
    ctx.ellipse(slick.x, slick.y + 4, 42, 11 + Math.sin(now / 90) * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd23f";
    ctx.beginPath();
    ctx.ellipse(slick.x, slick.y - 3, 12, 17, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const vortex of vortices) {
    ctx.save();
    ctx.translate(vortex.x, vortex.y);
    ctx.rotate(now / 220);
    ctx.globalAlpha = Math.min(0.8, vortex.life * 0.8);
    ctx.strokeStyle = vortex.color;
    ctx.lineWidth = 3;
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, vortex.radius * (0.3 + ring * 0.22), ring * 1.7, ring * 1.7 + Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  for (const mine of mines) {
    ctx.globalAlpha = mine.arm > 0 ? 0.45 : 0.9;
    ctx.fillStyle = mine.color;
    ctx.beginPath();
    ctx.arc(mine.x, mine.y, 7 + Math.sin(now / 120) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  for (const shot of projectiles) {
    if (shot.kind === "bomb") {
      ctx.fillStyle = "#242430";
      ctx.beginPath();
      ctx.arc(shot.x, shot.y, shot.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath();
      ctx.arc(shot.x + 6, shot.y - 11, 3, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    if (shot.kind === "boomerang") {
      ctx.save();
      ctx.translate(shot.x, shot.y);
      ctx.rotate(now / 90 + shot.age * 8);
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, 0, shot.radius + 2, -Math.PI * 0.8, Math.PI * 0.4);
      ctx.stroke();
      ctx.restore();
      continue;
    }

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

  drawHazard(now);

  for (const fighter of fighters.values()) {
    if (fighter.gone || fighter.respawn > 0) continue;
    drawFighter(fighter, now);
  }

  for (const junk of debris) {
    const drewSprite = drawJunkIcon(
      junk.icon ?? 3,
      junk.x,
      junk.y,
      junk.size ?? 38,
      junk.y / 55,
      1,
    );
    if (!drewSprite) {
      ctx.save();
      ctx.translate(junk.x, junk.y);
      ctx.rotate(junk.y / 55);
      ctx.fillStyle = junk.color;
      ctx.beginPath();
      ctx.roundRect(-15, -18, 30, 36, 9);
      ctx.fill();
      ctx.restore();
    }
  }

  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life * 2);
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawHud();

  if (stageTime < 3.2) {
    const fade = Math.min(1, stageTime * 2, (3.2 - stageTime) * 2);
    ctx.globalAlpha = Math.max(0, fade);
    const introTop = fighters.size > 4 ? 120 : 98;
    const intro = ctx.createLinearGradient(0, introTop, 0, introTop + 76);
    intro.addColorStop(0, "rgba(9, 9, 16, 0.92)");
    intro.addColorStop(1, "rgba(9, 9, 16, 0.58)");
    ctx.fillStyle = intro;
    ctx.beginPath();
    ctx.roundRect(WIDTH / 2 - 276, introTop, 552, 76, 16);
    ctx.fill();
    ctx.strokeStyle = `${stage.trim}88`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = stage.trim;
    ctx.font = `400 22px ${DISPLAY_FONT}`;
    ctx.fillText(stage.name.toUpperCase(), WIDTH / 2, introTop + 33);
    ctx.fillStyle = "#d8d8e8";
    ctx.font = "600 12px ui-rounded, system-ui, sans-serif";
    ctx.fillText(stage.modifier, WIDTH / 2, introTop + 56);
    ctx.globalAlpha = 1;
  }
}

// Which sprite clip a fighter's current state should show.
function spriteClip(fighter) {
  if (fighter.hitstun > 0 || fighter.flash > 0) return "hurt";
  if (fighter.attackTimer > 0) return "attack";
  if (fighter.counterTimer > 0 || fighter.dashTimer > 0 || fighter.slamTimer > 0) return "special";
  if (!fighter.grounded) return fighter.vy < 0 ? "jump" : "fall";
  if (Math.abs(fighter.vx) > 26) return "run";
  return "idle";
}

function spriteFrameCell(art, frames, now, seed, clip) {
  if (!frames || frames.length === 0) return null;
  const fps = CLIP_FPS[clip] ?? 8;
  const index = Math.floor((now / 1000) * fps + seed * 7) % frames.length;
  const columns = art.columns ?? 8;
  const cell = art.cell;
  const frame = frames[index];
  return {
    sx: (frame % columns) * cell,
    sy: Math.floor(frame / columns) * cell,
    size: cell,
  };
}

function drawFighterSprite(fighter, art, now) {
  const clip = spriteClip(fighter);
  const sprite = spriteFrameCell(art, art.clips[clip] ?? art.clips.idle, now, fighter.animSeed, clip);
  if (!sprite) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (fighter.flash > 0) ctx.filter = "brightness(2.4) saturate(0.2)";
  ctx.scale(fighter.facing, 1);
  // The atlas puts the fighter's feet at 94% of the cell height.
  ctx.drawImage(
    art.image,
    sprite.sx,
    sprite.sy,
    sprite.size,
    sprite.size,
    -sprite.size / 2,
    FIGHTER_R - sprite.size * 0.94,
    sprite.size,
    sprite.size,
  );
  ctx.restore();
}

function drawFighterPortrait(character, cx, cy, radius) {
  const art = character.sprite ? FIGHTER_ART[character.sprite] : null;
  if (art?.image.complete && art.image.naturalWidth > 0) {
    const frames = art.clips.idle ?? [0];
    const cell = art.cell;
    const columns = art.columns ?? 8;
    const size = radius * 2.8;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      art.image,
      (frames[0] % columns) * cell,
      Math.floor(frames[0] / columns) * cell,
      cell,
      cell,
      cx - size / 2,
      cy - size / 2,
      size,
      size,
    );
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.shadowColor = character.color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = character.color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(9, 9, 15, 0.6)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  drawEmblem(character.emblem, cx, cy, radius / 2, "#0b0b12");
}

/** The procedural look for fighters without a spritesheet. */
function drawFighterShape(fighter, character) {
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
    case "titan":
      ctx.beginPath();
      ctx.arc(0, 2, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.fillRect(-12, -4, 24, 5);
      break;
    case "bag":
      ctx.beginPath();
      ctx.moveTo(-13, -20);
      ctx.quadraticCurveTo(-24, -2, -16, 22);
      ctx.quadraticCurveTo(0, 28, 16, 22);
      ctx.quadraticCurveTo(24, -2, 13, -20);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.moveTo(-9, -19);
      ctx.lineTo(0, -29);
      ctx.lineTo(9, -19);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-4, 8, 8, 9);
      break;
    case "fungus":
      ctx.fillStyle = character.color;
      ctx.beginPath();
      ctx.roundRect(-9, -5, 18, 25, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.ellipse(0, -12, 22, 11, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-10, -17, 3, 0, Math.PI * 2);
      ctx.arc(8, -20, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "slime":
      ctx.beginPath();
      ctx.moveTo(-22, 22);
      ctx.quadraticCurveTo(-21, -10, 0, -18);
      ctx.quadraticCurveTo(22, -10, 22, 22);
      ctx.quadraticCurveTo(0, 29, -22, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.arc(-11, 8, 4, 0, Math.PI * 2);
      ctx.arc(12, 13, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "bubble":
      ctx.globalAlpha *= 0.82;
      for (const [bx, by, radius] of [[-10, -12, 13], [11, -5, 10], [-13, 9, 9], [10, 13, 7]]) {
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha /= 0.82;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(-13, -15, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "fryer":
      ctx.beginPath();
      ctx.roundRect(-17, -14, 34, 35, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.fillRect(-11, -5, 22, 12);
      ctx.strokeStyle = character.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, -14, 12, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#2a1708";
      ctx.fillRect(-9, 1, 5, 4);
      ctx.fillRect(4, 1, 5, 4);
      break;
    case "box":
      ctx.beginPath();
      ctx.roundRect(-17, -18, 34, 39, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.fillRect(-3, -18, 6, 13);
      ctx.fillRect(-17, -18, 12, 8);
      ctx.fillRect(5, -18, 12, 8);
      ctx.fillStyle = "#3a2716";
      ctx.fillRect(-10, -4, 7, 4);
      ctx.fillRect(3, -4, 7, 4);
      break;
    case "diva":
      ctx.beginPath();
      ctx.moveTo(-16, -11);
      ctx.lineTo(16, -11);
      ctx.lineTo(22, 22);
      ctx.lineTo(-22, 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.arc(0, -18, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-12, -22);
      ctx.lineTo(-8, -32);
      ctx.lineTo(-2, -24);
      ctx.lineTo(2, -34);
      ctx.lineTo(8, -24);
      ctx.lineTo(12, -32);
      ctx.lineTo(12, -21);
      ctx.closePath();
      ctx.fill();
      break;
    case "forklift":
      ctx.beginPath();
      ctx.roundRect(-17, -8, 30, 28, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.fillRect(10, -27, 5, 35);
      ctx.fillRect(15, 2, 16, 4);
      ctx.fillRect(15, 9, 16, 4);
      ctx.fillStyle = "#16161f";
      ctx.beginPath();
      ctx.arc(-10, 23, 6, 0, Math.PI * 2);
      ctx.arc(9, 23, 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "fry":
      ctx.save();
      ctx.rotate(-0.16);
      ctx.beginPath();
      ctx.roundRect(-10, -28, 20, 54, 10);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = character.accent;
      for (const [sx, sy] of [[-5, -19], [7, -11], [-7, 1], [5, 11], [-3, 20]]) {
        ctx.fillRect(sx, sy, 2, 2);
      }
      break;
    case "compost":
      ctx.beginPath();
      ctx.moveTo(-23, 23);
      ctx.quadraticCurveTo(-20, -18, 0, -24);
      ctx.quadraticCurveTo(22, -18, 23, 23);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      for (const [leafX, leafY, angle] of [[-14, -11, -0.6], [10, -16, 0.5], [16, 3, 1.1]]) {
        ctx.save();
        ctx.translate(leafX, leafY);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(-6, -17);
      ctx.quadraticCurveTo(0, -29, 4, -20);
      ctx.stroke();
      break;
    case "noodle":
      ctx.strokeStyle = character.color;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      for (let strand = -1; strand <= 1; strand += 1) {
        ctx.beginPath();
        ctx.moveTo(strand * 5, -10);
        ctx.bezierCurveTo(strand * 18, 0, strand * -12, 10, strand * 8, 26);
        ctx.stroke();
      }
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.arc(0, -20, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#101018";
      ctx.fillRect(-5, -23, 3, 3);
      ctx.fillRect(3, -23, 3, 3);
      break;
    case "moth":
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.ellipse(-15, -5, 15, 21, -0.35, 0, Math.PI * 2);
      ctx.ellipse(15, -5, 15, 21, 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = character.color;
      ctx.beginPath();
      ctx.ellipse(0, 1, 7, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = character.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-3, -19);
      ctx.quadraticCurveTo(-13, -31, -17, -25);
      ctx.moveTo(3, -19);
      ctx.quadraticCurveTo(13, -31, 17, -25);
      ctx.stroke();
      break;
    case "cup":
      ctx.beginPath();
      ctx.moveTo(-14, -17);
      ctx.lineTo(14, -17);
      ctx.lineTo(10, 25);
      ctx.lineTo(-10, 25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = character.accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(17, -1, 9, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-5, -17);
      ctx.lineTo(-2, -7);
      ctx.lineTo(-7, 2);
      ctx.stroke();
      break;
    case "ranger":
      ctx.beginPath();
      ctx.roundRect(-15, -13, 30, 36, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.ellipse(0, -19, 23, 6, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-14, -20, 28, 4);
      ctx.fillStyle = "#101018";
      ctx.fillRect(-7, -5, 5, 4);
      ctx.fillRect(3, -5, 5, 4);
      break;
    case "crown":
      ctx.beginPath();
      ctx.moveTo(-18, -8);
      ctx.lineTo(18, -8);
      ctx.lineTo(24, 24);
      ctx.lineTo(-24, 24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = character.accent;
      ctx.beginPath();
      ctx.moveTo(-15, -17);
      ctx.lineTo(-12, -34);
      ctx.lineTo(-4, -24);
      ctx.lineTo(0, -38);
      ctx.lineTo(6, -24);
      ctx.lineTo(14, -34);
      ctx.lineTo(15, -17);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, -8, 3, 0, Math.PI * 2);
      ctx.fill();
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
}

function drawFighter(fighter, now) {
  const character = fighter.char;
  ctx.save();
  ctx.translate(fighter.x, fighter.y);
  ctx.globalAlpha = fighter.online ? 1 : 0.4;
  if (fighter.invuln > 0) ctx.globalAlpha *= 0.55 + 0.45 * Math.sin(now / 45);

  if (fighter.grounded) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.beginPath();
    ctx.ellipse(0, FIGHTER_R + 10, 24, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const aura = ctx.createRadialGradient(0, 0, 4, 0, 0, FIGHTER_R + 18);
  aura.addColorStop(0, `${character.color}33`);
  aura.addColorStop(1, `${character.color}00`);
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(0, 0, FIGHTER_R + 18, 0, Math.PI * 2);
  ctx.fill();

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

  if (fighter.invuln > 0) {
    ctx.strokeStyle = `${character.color}aa`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, FIGHTER_R + 17, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const art = character.sprite ? FIGHTER_ART[character.sprite] : null;
  const artReady = Boolean(art?.image.complete && art.image.naturalWidth > 0);

  if (artReady) {
    drawFighterSprite(fighter, art, now);
  } else {
    drawFighterShape(fighter, character);
  }

  const aim = fighter.isCPU ? null : aims.get(fighter.id);
  if (aim && Math.hypot(aim.x, aim.y) > 0.3) {
    ctx.strokeStyle = "rgba(159, 232, 255, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(aim.x * 38, aim.y * 38);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#9fe8ff";
    ctx.beginPath();
    ctx.arc(aim.x * 38, aim.y * 38, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  if (fighter.counterTimer > 0) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, FIGHTER_R + 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (fighter.attackTimer > 0) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(fighter.facing * 26, 0, 18, -Math.PI / 2, Math.PI / 2, fighter.facing < 0);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  ctx.font = "700 11px ui-rounded, system-ui, sans-serif";
  const label = fighter.name.slice(0, 12);
  const labelWidth = ctx.measureText(label).width + 14;
  ctx.fillStyle = "rgba(5, 5, 11, 0.68)";
  ctx.beginPath();
  ctx.roundRect(-labelWidth / 2, -FIGHTER_R - 32, labelWidth, 16, 8);
  ctx.fill();
  ctx.fillStyle = fighter.gone ? "#6b6b7f" : "#f4f4fb";
  ctx.fillText(label, 0, -FIGHTER_R - 20);

  ctx.font = `400 12px ${DISPLAY_FONT}`;
  const damage = `${Math.round(fighter.damage)}%`;
  const damageWidth = ctx.measureText(damage).width + 14;
  ctx.fillStyle = fighter.damage > 90 ? "rgba(80, 8, 14, 0.8)" : "rgba(5, 5, 11, 0.62)";
  ctx.beginPath();
  ctx.roundRect(-damageWidth / 2, FIGHTER_R + 4, damageWidth, 18, 9);
  ctx.fill();
  ctx.fillStyle = fighter.damage > 90 ? "#ff8a8a" : "#d6d6e4";
  ctx.fillText(damage, 0, FIGHTER_R + 17);
  ctx.restore();
}

function drawHud() {
  const entries = [...fighters.values()];
  const crowded = entries.length > 4;
  const columns = crowded ? 5 : Math.max(1, entries.length);
  const panelW = crowded ? 184 : 218;
  const panelH = 44;
  const gap = crowded ? 6 : 8;
  const startX = crowded ? 8 : 16;

  entries.forEach((fighter, index) => {
    const x = startX + (index % columns) * (panelW + gap);
    const y = 16 + Math.floor(index / columns) * (panelH + 7);

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "rgba(5, 5, 11, 0.78)";
    ctx.beginPath();
    ctx.roundRect(x, y, panelW, panelH, 10);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = fighter.gone ? "rgba(255, 255, 255, 0.08)" : `${fighter.char.color}66`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, panelW, panelH, 10);
    ctx.stroke();

    ctx.fillStyle = fighter.char.color;
    ctx.beginPath();
    ctx.roundRect(x + 7, y + 8, 3, panelH - 16, 1.5);
    ctx.fill();

    ctx.fillStyle = fighter.gone ? "#6b6b7f" : "#f4f4fb";
    ctx.font = "700 11px ui-rounded, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(fighter.name.slice(0, crowded ? 15 : 18), x + 17, y + 16);

    ctx.fillStyle = "#ffd23f";
    for (let stock = 0; stock < Math.max(0, fighter.stocks); stock += 1) {
      ctx.beginPath();
      ctx.arc(x + 20 + stock * 9, y + 28, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = fighter.damage > 90 ? "#ff6b6b" : "rgba(255, 255, 255, 0.72)";
    ctx.font = `400 16px ${DISPLAY_FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(fighter.damage)}%`, x + panelW - 11, y + 24);

    const shieldWidth = panelW - 30;
    ctx.fillStyle = "rgba(120, 210, 255, 0.18)";
    ctx.beginPath();
    ctx.roundRect(x + 17, y + 34, shieldWidth, 3, 1.5);
    ctx.fill();
    ctx.fillStyle = "#78d2ff";
    ctx.beginPath();
    ctx.roundRect(x + 17, y + 34, shieldWidth * Math.max(0, fighter.shield / fighter.shieldMax), 3, 1.5);
    ctx.fill();
  });

  ctx.fillStyle = "rgba(5, 5, 11, 0.58)";
  ctx.beginPath();
  ctx.roundRect(WIDTH / 2 - 166, HEIGHT - 32, 332, 22, 11);
  ctx.fill();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
  ctx.font = `400 10px ${DISPLAY_FONT}`;
  ctx.fillText(`${stage.name.toUpperCase()}  ·  ROUND ${matchNumber}`, WIDTH / 2, HEIGHT - 17);
}

function drawResults(now) {
  const shade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  shade.addColorStop(0, "rgba(5, 5, 12, 0.9)");
  shade.addColorStop(0.58, "rgba(5, 5, 12, 0.8)");
  shade.addColorStop(1, "rgba(5, 5, 12, 0.92)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const standings = [...fighters.values()]
    .map((fighter) => ({
      fighter,
      score: fighter.stocks * 10000 + fighter.kos * 500 + Math.max(0, 900 - Math.round(fighter.damage)),
    }))
    .sort((a, b) => b.score - a.score);

  const winner = standings[0]?.fighter;
  if (winner) {
    const spotlight = ctx.createRadialGradient(WIDTH / 2, 158, 10, WIDTH / 2, 158, 310);
    spotlight.addColorStop(0, `${winner.char.color}33`);
    spotlight.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spotlight;
    ctx.fillRect(0, 0, WIDTH, 350);
  }

  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.font = `400 40px ${DISPLAY_FONT}`;
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(4, 4, 10, 0.9)";
  ctx.strokeText("TRASH RESULTS", WIDTH / 2, 80);
  const heading = ctx.createLinearGradient(0, 48, 0, 86);
  heading.addColorStop(0, "#fff5b8");
  heading.addColorStop(1, "#ff8a3d");
  ctx.fillStyle = heading;
  ctx.fillText("TRASH RESULTS", WIDTH / 2, 80);

  if (winner) {
    ctx.fillStyle = winner.char.color;
    ctx.font = `400 10px ${DISPLAY_FONT}`;
    ctx.fillText("WINNER", WIDTH / 2, 110);
    ctx.fillStyle = "#f4f4fb";
    ctx.font = "800 23px ui-rounded, system-ui, sans-serif";
    ctx.fillText(`${winner.name} wins as ${winner.char.name}`, WIDTH / 2, 138);
  }

  const columns = standings.length > 6 ? 2 : 1;
  const cardW = columns === 2 ? 286 : 572;
  standings.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = columns === 2 ? (column === 0 ? WIDTH / 2 - 296 : WIDTH / 2 + 10) : WIDTH / 2 - 286;
    const y = 188 + row * 52;
    const fighter = entry.fighter;
    ctx.save();
    ctx.shadowColor = index === 0 ? "rgba(255, 210, 63, 0.2)" : "transparent";
    ctx.shadowBlur = index === 0 ? 14 : 0;
    ctx.fillStyle = index === 0 ? "rgba(255, 210, 63, 0.14)" : "rgba(255, 255, 255, 0.055)";
    ctx.beginPath();
    ctx.roundRect(x, y - 30, cardW, 42, 10);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = index === 0 ? "rgba(255, 210, 63, 0.38)" : "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = fighter.color;
    ctx.beginPath();
    ctx.roundRect(x + 6, y - 25, 3, 31, 1.5);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = index === 0 ? "#ffd23f" : "#9a9ab0";
    ctx.font = `400 14px ${DISPLAY_FONT}`;
    ctx.fillText(`#${index + 1}`, x + 28, y - 4);

    ctx.fillStyle = "#f4f4fb";
    ctx.font = `${columns === 2 ? "700 12px" : "700 15px"} ui-rounded, system-ui, sans-serif`;
    const label = `${fighter.name} · ${fighter.char.name}`.slice(0, columns === 2 ? 22 : 40);
    ctx.fillText(label, x + 66, y - 4);

    ctx.textAlign = "right";
    ctx.fillStyle = "#9a9ab0";
    ctx.font = `600 ${columns === 2 ? 9 : 11}px ui-monospace, monospace`;
    ctx.fillText(
      `${Math.max(0, fighter.stocks)} STOCKS  ·  ${fighter.kos} KO${fighter.kos === 1 ? "" : "S"}`,
      x + cardW - 10,
      y - 4,
    );
  });

  const seconds = Math.max(0, Math.ceil((resultsUntil - now) / 1000));
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(244, 244, 251, 0.7)";
  ctx.font = `400 11px ${DISPLAY_FONT}`;
  ctx.fillText(`NEXT SELECT IN ${seconds}S  ·  OR PRESS REMATCH`, WIDTH / 2, HEIGHT - 26);
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

function handleStart() {
  if (phase === "stage") beginCountdown();
  else forceStart();
}

function chooseStage(event) {
  if (phase !== "stage" || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * HEIGHT;
  const hit = stageSelectHitboxes.find(
    (box) => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h,
  );
  if (!hit) return;
  selectedStageIndex = hit.index;
  stage = STAGES[selectedStageIndex] ?? STAGES[0];
  playSound("select", 0.35);
  setStatus(`Stage: ${stage.name} — press Start fight`);
  setHostButtons();
}

if (refs.start) refs.start.addEventListener("click", handleStart);
if (refs.rematch) refs.rematch.addEventListener("click", beginSelect);
if (refs.addCpu) refs.addCpu.addEventListener("click", () => setCpuCount(cpuCount + 1));
if (refs.removeCpu) refs.removeCpu.addEventListener("click", () => setCpuCount(cpuCount - 1));
if (canvas) canvas.addEventListener("click", chooseStage);

defineGame({
  onStart(context) {
    hub = context;
    running = true;
    stage = STAGES[selectedStageIndex] ?? STAGES[0];
    matchNumber = 0;
    spawnCursor = 0;
    stageTime = 0;
    lastHazardCycle = -1;
    last = performance.now();
    lastBeat = last;
    hiddenAt = 0;
    accumulator = 0;
    context.log("trash loaded", `roster=${ROSTER.length}`, `stages=${STAGES.length}`);
    beginSelect();
    raf = requestAnimationFrame(frame);
  },

  onPlayerJoin(player) {
    if (phase === "select") {
      hub?.setUI(player.id, rosterUI());
      setHostButtons();
      maybeAutoStart();
    } else if (phase === "stage") {
      hub?.setUI(player.id, rosterUI());
      setHostButtons();
      setStatus("Choose a stage — late joiners can still pick a fighter");
    } else if (phase === "fight") {
      hub?.setUI(player.id, ui.waiting("Spectating — you are in the next match"));
      hub?.log("trash spectator", player.name);
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
    if (phase === "stage") hub?.setUI(player.id, rosterUI());
  },

  onPlayerLeave(player) {
    const fighter = fighters.get(player.id);
    if (fighter) fighter.online = false;
    axes.set(player.id, { x: 0, y: 0 });
    aims.set(player.id, { x: 0, y: 0 });
    setHostButtons();
  },

  onPlayerRemoved(player) {
    fighters.delete(player.id);
    picks.delete(player.id);
    axes.delete(player.id);
    aims.delete(player.id);
    if (phase === "fight") checkLastStanding();
    if (phase === "select") maybeAutoStart();
    setHostButtons();
  },

  onInput(player, input) {
    if (input.k === "choice") {
      if (input.id !== "roster" || (phase !== "select" && phase !== "stage")) return;
      const chosen = ROSTER.findIndex((character) => character.id === input.v[0]);
      const index = chosen >= 0 ? chosen : randomIndex();
      picks.set(player.id, index);
      hub?.setUI(player.id, pickedUI(ROSTER[index]));
      hub?.log("trash pick", `${player.name} ${ROSTER[index].id}`);
      playSound("select", 0.35);
      if (phase === "select") maybeAutoStart();
      return;
    }

    const fighter = fighters.get(player.id);
    if (!fighter || phase !== "fight" || fighter.gone) return;

    if (input.k === "axis") {
      if (input.id === "move") axes.set(player.id, { x: input.x, y: input.y });
      if (input.id === "aim") aims.set(player.id, { x: input.x, y: input.y });
      return;
    }

    if (input.k === "release") {
      if (input.id === "guard") fighter.guardHeld = false;
      return;
    }

    if (input.k !== "press") return;
    if (fighter.hitstun > 0 || fighter.respawn > 0) return;

    switch (input.id) {
      case "jump": {
        const jumpPower =
          fighter.char.stats.jump * (fighter.char.passive?.type === "spring" ? 1.12 : 1);
        if (fighter.grounded) {
          fighter.vy = -jumpPower;
          fighter.grounded = false;
          burst(fighter.x, fighter.y + FIGHTER_R, fighter.char.accent, 4);
          playSound("jump", 0.35);
        } else if (fighter.airJumps > 0) {
          fighter.airJumps -= 1;
          fighter.vy = -jumpPower * 0.92;
          burst(fighter.x, fighter.y + FIGHTER_R, fighter.char.accent, 6);
          playSound("jump", 0.28);
        }
        break;
      }
      case "attack":
        if (fighter.attackCd <= 0) {
          fighter.attackTimer = 0.16;
          fighter.attackCd = fighter.char.attack.cooldown;
          fighter.attackHit = false;
          playSound("swing", 0.3);
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
      case "drop":
        if (fighter.grounded && fighter.y < FLOOR_Y - FIGHTER_R - 4) {
          fighter.dropTimer = 0.24;
          fighter.grounded = false;
          fighter.vy = Math.max(fighter.vy, 180);
        }
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
