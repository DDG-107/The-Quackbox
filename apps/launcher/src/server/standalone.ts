import { loadConfig } from "./config.js";
import { startHubServer } from "./http.js";
import { listLanAddresses } from "./lan.js";
import type { Room } from "./room.js";

const config = loadConfig();
const logInputs = process.env.QUACKBOX_DEBUG_INPUT === "1";

function stamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

function printRoster(room: Room): void {
  const players = room.players;
  if (players.length === 0) {
    console.log(`${stamp()}  lobby empty — waiting for phones\n`);
    return;
  }

  console.log(`${stamp()}  room ${room.code} — ${room.connectedCount}/${players.length} connected`);
  for (const player of players) {
    const dot = player.connected ? "●" : "○";
    const state = player.connected ? "" : " (reconnecting)";
    console.log(`          ${dot} ${player.name}${state}  ${player.color}`);
  }
  console.log("");
}

const server = await startHubServer(config, {
  handlers: {
    onPlayerJoin(player) {
      console.log(`${stamp()}  + ${player.name} joined`);
    },
    onPlayerLeave(player) {
      const seconds = Math.round(config.graceMs / 1000);
      console.log(`${stamp()}  ~ ${player.name} dropped, holding the slot for ${seconds}s`);
    },
    onPlayerRejoin(player) {
      console.log(`${stamp()}  ↺ ${player.name} reconnected`);
    },
    onPlayerRemoved(player) {
      console.log(`${stamp()}  - ${player.name} removed`);
    },
    onLobbyChange: printRoster,
    onInput(player, input) {
      if (logInputs) console.log(`${stamp()}  ${player.name} ${input.id}:${input.k}`);
    },
  },
});

const joinQuery = `?room=${config.roomCode}`;
const lan = listLanAddresses();

console.log("");
console.log("  ┌──────────────────────────────────────────────┐");
console.log("  │  The QuackBox hub                            │");
console.log("  └──────────────────────────────────────────────┘");
console.log("");
console.log(`  room code   ${config.roomCode}`);
console.log(`  controller  ${server.localUrl}/${joinQuery}`);
for (const entry of lan) {
  console.log(`  LAN         http://${entry.address}:${server.port}/${joinQuery}  (${entry.iface})`);
}
if (lan.length === 0) {
  console.log("  LAN         no LAN address found — phones will not reach this hub");
}
console.log(`  health      ${server.localUrl}/health`);
console.log(
  `  assets      ${server.hasController ? "apps/controller/dist (built)" : "not built — run: corepack pnpm build"}`,
);
console.log("");

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    console.log("\n  closing hub…");
    void server.close().then(() => process.exit(0));
  });
}
