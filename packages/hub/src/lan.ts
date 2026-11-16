import { networkInterfaces } from "node:os";

/**
 * Adapters that look like a LAN but never reach a phone. Skipping them keeps
 * the printed join URL (and later the QR code) on the right network.
 */
const VIRTUAL_ADAPTERS = [
  /^lo/i,
  /loopback/i,
  /vethernet/i,
  /vmware/i,
  /virtualbox/i,
  /hyper-v/i,
  /docker/i,
  /^br-/i,
  /^veth/i,
  /tailscale/i,
  /zerotier/i,
  /wireguard/i,
  /^utun/i,
  /^awdl/i,
  /^llw/i,
  /wsl/i,
  /bluetooth/i,
  /teredo/i,
  /isatap/i,
  /npcap/i,
];

export interface LanAddress {
  iface: string;
  address: string;
}

function rank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

/** Every IPv4 address a phone on the same network could reach, best first. */
export function listLanAddresses(): LanAddress[] {
  const found: LanAddress[] = [];

  for (const [iface, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (VIRTUAL_ADAPTERS.some((pattern) => pattern.test(iface))) continue;
      found.push({ iface, address: entry.address });
    }
  }

  return found.sort(
    (a, b) => rank(a.address) - rank(b.address) || a.iface.localeCompare(b.iface),
  );
}

export function pickLanAddress(preferredInterface?: string): LanAddress | null {
  const addresses = listLanAddresses();
  if (preferredInterface) {
    const match = addresses.find((entry) => entry.iface === preferredInterface);
    if (match) return match;
  }
  return addresses[0] ?? null;
}
