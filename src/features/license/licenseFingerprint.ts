export function seedFromLicenseKey(key: string): number {
  const tail = key.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "glimpse";
  let seed = 0;
  for (let i = 0; i < tail.length; i += 1) {
    seed = (Math.imul(seed, 31) + tail.charCodeAt(i)) >>> 0;
  }
  return seed || 1;
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededDotField(
  key: string | null | undefined,
  rows: number,
  cols: number,
  density = 0.34,
): Set<number> {
  const seed = seedFromLicenseKey(key ?? "glimpse");
  const rand = mulberry32(seed);
  const total = rows * cols;
  const active = new Set<number>();
  for (let i = 0; i < total; i += 1) {
    if (rand() < density) active.add(i);
  }
  return active;
}
