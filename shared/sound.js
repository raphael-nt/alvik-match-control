// Match sounds taken from the VEX Unofficial Timer : the 3 2 1 countdown and the end sound.
// sounds/timer.mp3 is a recording of the reference timer (credit in README). Clips are cut at play time
// with the Web Audio API. If the file cannot load, short generated tones are used instead.
// Browsers keep sound off until the person taps the page : call unlock() from a tap or click.

const CLIP_COUNT = [0.47, 3.33];   // 3, 2, 1 beeps and the start sound as one piece, [start, length] in seconds
const CLIP_END = [62.55, 2.45];
// Inside the countdown clip : when 3, 2 and 1 sound, and when the start sound plays (ms from the first beep)
const BEEPS = [0, 810, 1530];
export const COUNT_GO = 2350;

const bytes = fetch(new URL("./sounds/timer.mp3", import.meta.url)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
let ac = null, out = null, buf = null, loading = null, countSrc = null, countFor = null, fallbackT = [];

function ctx() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); out = ac.createGain(); out.gain.value = 1; out.connect(ac.destination); } catch (e) { return null; } }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}
function load() {
  if (loading) return loading;
  const a = ctx(); if (!a) return Promise.resolve(null);
  loading = bytes.then((b) => b && new Promise((ok, no) => a.decodeAudioData(b, ok, no))).then((x) => (buf = x || null)).catch(() => null);
  return loading;
}
// Call from a tap or click so the browser allows sound
export function unlock() { ctx(); load(); }
export const ready = () => !!(ac && ac.state === "running");

// Short effect tone on the same audio output (also the fallback when the recording is missing)
export function tone(freq, ms, at = 0, gain = 0.16, type = "square") {
  const a = ctx(); if (!a) return;
  const t0 = a.currentTime + at, d = ms / 1000, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.setValueAtTime(gain, t0 + Math.max(0.02, d - 0.04)); g.gain.linearRampToValueAtTime(0, t0 + d);
  o.connect(g).connect(out); o.start(t0); o.stop(t0 + d + 0.02);
}

// Big countdown digit, changing on the beeps of the recording. leftMs is the time left until GO.
export function countDigit(leftMs) {
  const e = COUNT_GO - leftMs;
  return e < BEEPS[1] ? 3 : e < BEEPS[2] ? 2 : 1;
}

// Play the countdown so its start sound lands exactly on GO. Safe to call every frame :
// it starts once per countdown (key, usually go_at) and joins in the middle when the page opens late.
export function countdown(key, leftMs) {
  if (countFor === key) return;
  const a = ctx(); if (!a || a.state !== "running") return;
  stopCount(); countFor = key;
  const lead = (leftMs - COUNT_GO) / 1000;   // seconds until the first beep (negative when it already passed)
  if (buf) {
    const src = a.createBufferSource(); src.buffer = buf; src.connect(out);
    if (lead >= 0) src.start(a.currentTime + lead, CLIP_COUNT[0], CLIP_COUNT[1]);
    else if (-lead < CLIP_COUNT[1]) src.start(a.currentTime, CLIP_COUNT[0] - lead, CLIP_COUNT[1] + lead);
    else return;
    countSrc = src;
    return;
  }
  // No recording : beeps at the same moments, then a higher start tone on GO
  [...BEEPS.map((b) => [b, 880, 160]), [COUNT_GO, 1320, 600]].forEach(([b, f, ms]) => {
    const at = lead + b / 1000; if (at >= 0) fallbackT.push(setTimeout(() => tone(f, ms), at * 1000));
  });
}
// Stop the countdown sound, for example after a false start
export function stopCount() {
  if (countSrc) { try { countSrc.stop(); } catch (e) {} countSrc = null; }
  fallbackT.forEach(clearTimeout); fallbackT = [];
  countFor = null;
}
// End of the game : time up or the clock stopped
export function endSound() {
  const a = ctx(); if (!a || a.state !== "running") return;
  if (buf) {
    const src = a.createBufferSource(), g = a.createGain(), t0 = a.currentTime, [s, len] = CLIP_END;
    src.buffer = buf; src.connect(g).connect(out);
    g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(1, t0 + len - 0.06); g.gain.linearRampToValueAtTime(0, t0 + len);   // short fade so the cut does not click
    src.start(t0, s, len);
  } else { tone(196, 1300, 0, 0.2, "sawtooth"); tone(247, 1300, 0, 0.12, "sawtooth"); }
}
