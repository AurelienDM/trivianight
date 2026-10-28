import { networkInterfaces } from 'os';

export function listLanIpv4(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        out.push(iface.address);
      }
    }
  }
  return out;
}

/** Prefer non-link-local (avoid 169.254.*) */
export function preferLanIp(ips: string[] = listLanIpv4()): string | null {
  const preferred = ips.find((ip) => !ip.startsWith('169.254.'));
  return preferred ?? ips[0] ?? null;
}
