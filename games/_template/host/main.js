import { defineGame, ui } from "/sdk/index.js";

// A cartridge is a normal web page that talks to the hub through this SDK.
// Nothing here can see the network, the launcher or the other phones.

const TAP_UI = ui.buttons([{ id: "tap", label: "Hello!", style: "big" }]);
const taps = new Map();
let hub = null;

defineGame({
  onStart(context) {
    hub = context;
    taps.clear();
    context.log("template started with", context.players.size, "players");
    context.setUI("all", TAP_UI);
    render();
  },

  onPlayerJoin(player) {
    taps.set(player.id, 0);
    hub?.setUI(player.id, TAP_UI);
    render();
  },

  onPlayerRejoin(player) {
    hub?.setUI(player.id, TAP_UI);
  },

  onPlayerRemoved(player) {
    taps.delete(player.id);
    render();
  },

  onInput(player, input) {
    if (input.k !== "press" || input.id !== "tap") return;
    taps.set(player.id, (taps.get(player.id) ?? 0) + 1);
    render();
  },

  onStop() {
    hub = null;
  },
});

function render() {
  const total = [...taps.values()].reduce((sum, score) => sum + score, 0);
  document.querySelector("#players").textContent = String(hub?.players.size ?? taps.size);
  document.querySelector("#total").textContent = String(total);
}
