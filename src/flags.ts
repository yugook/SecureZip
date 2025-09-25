export type Flags = {
  // Whether to show the Status Bar button
  enableStatusBarButton: boolean;
  // Example hook for percentage rollout (not wired to any feature yet)
  exportDefaultOnPercent?: number; // 0..100
};

// Build-time injected flags via esbuild `define`.
// This symbol is replaced at build time; at runtime in dev it may be undefined.
 
declare const __BUILD_FLAGS__: Partial<Flags> | undefined;

export const defaultFlags: Flags = {
  enableStatusBarButton: true,
  exportDefaultOnPercent: 100,
};

// Simple deterministic hash for rollout bucketing
export function hashToPercent(input: string, salt = 'securezip'): number {
  let h = 5381;
  const str = `${salt}:${input}`;
  for (let i = 0; i < str.length; i++) {
    // djb2
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  // Normalize to 0..99
  return Math.abs(h) % 100;
}

export function resolveFlags(opts: {
  build?: Partial<Flags>;
  settings?: Partial<Flags>;
  machineId?: string;
}): Flags {
  const merged: Flags = {
    ...defaultFlags,
    ...(opts.build ?? {}),
    ...(opts.settings ?? {}),
  };

  // Example of percentage rollout: if exportDefaultOnPercent < 100,
  // we can decide defaults based on machineId bucket. Users can override via settings.
  if (
    typeof merged.exportDefaultOnPercent === 'number' &&
    merged.exportDefaultOnPercent >= 0 &&
    merged.exportDefaultOnPercent < 100 &&
    opts.machineId
  ) {
    const bucket = hashToPercent(opts.machineId);
    // This is an example of how you'd flip a default based on rollout.
    // No feature is forced here; settings override remains respected above.
    // You can apply this pattern to any future flag's default.
    // (Left as a utility; not changing enableStatusBarButton here.)
  }

  return merged;
}

