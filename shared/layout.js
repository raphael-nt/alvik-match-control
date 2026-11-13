// Dashboard Live screen layout. Panels are placed in a 1920x1080 stage, edited in Admin > Dashboard.
export const STAGE = { w: 1920, h: 1080 };
export const PANELS = [
  ["info", "Match info"], ["red", "Red team"], ["clock", "Clock"], ["blue", "Blue team"], ["bracket", "Bracket"], ["upnext", "Up next"],
];
export const DEFAULT_LIVE = {
  info: { x: 40, y: 112, w: 1840, h: 56, on: true },
  red: { x: 40, y: 184, w: 540, h: 520, on: true },
  clock: { x: 600, y: 184, w: 720, h: 520, on: true },
  blue: { x: 1340, y: 184, w: 540, h: 520, on: true },
  bracket: { x: 40, y: 724, w: 1460, h: 330, on: true },
  upnext: { x: 1520, y: 724, w: 360, h: 330, on: true },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
// Merge a stored layout with defaults and keep every panel inside the stage
export function liveLayout(stored) {
  const out = {};
  PANELS.forEach(([k]) => {
    const d = DEFAULT_LIVE[k], s = (stored && stored[k]) || {};
    const w = clamp(s.w ?? d.w, 80, STAGE.w), h = clamp(s.h ?? d.h, 40, STAGE.h);
    out[k] = { x: clamp(s.x ?? d.x, 0, STAGE.w - w), y: clamp(s.y ?? d.y, 0, STAGE.h - h), w, h, on: s.on ?? d.on };
  });
  return out;
}
