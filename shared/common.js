// Shared library for all pages: live data, clock and display helpers
export const SB_URL = "https://sylaqdubfjgmaxhtrrnk.supabase.co";
export const SB_KEY = "sb_publishable_9x3-7C7fLbQZBDtkk8YAGw_P1XclMv8";
export const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PK = { a2_event: "id", a2_team: "seed", a2_match: "code", a2_game: "id", a2_field: "no", a2_tiebreak: "grp", a2_group: "grp", a2_mark: "id" };
const OPT = { marks: false };
export const useMarks = () => { OPT.marks = true; };
export const T = { a2_event: new Map(), a2_team: new Map(), a2_match: new Map(), a2_game: new Map(), a2_field: new Map(), a2_tiebreak: new Map(), a2_group: new Map(), a2_mark: new Map() };
export const S = { standings: [], ranking: [], net: "wait", offset: 0, ready: false };

const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
let pending = 0;
const notify = () => { if (pending) return; pending = setTimeout(() => { pending = 0; listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }, 16); };

const EMPTY = Object.freeze([]);
let _cTeams = null, _tSize = -1, _cMatches = null, _mSize = -1, _cGroups = null, _gSize = -1;
let _cFields = null, _fSize = -1, _fCnt = -1, _cGames = null, _gaSize = -1, _cTable = null, _stRef = null;
function invalidateData(table) {
  if (!table || table === "a2_team") _cTeams = null;
  if (!table || table === "a2_match") _cMatches = null;
  if (!table || table === "a2_group") _cGroups = null;
  if (!table || table === "a2_field" || table === "a2_event") _cFields = null;
  if (!table || table === "a2_game") _cGames = null;
}
function invalidateStandings() { _cTable = null; }

export const event = () => T.a2_event.get(1) || { name: "", setup_ms: 60000, game_ms: 90000, field_count: 2, tv_mode: "auto" };
export const teamsArr = () => {
  if (_cTeams && _tSize === T.a2_team.size) return _cTeams;
  _tSize = T.a2_team.size;
  return (_cTeams = [...T.a2_team.values()].sort((a, b) => a.seed - b.seed));
};
export const matches = () => {
  if (_cMatches && _mSize === T.a2_match.size) return _cMatches;
  _mSize = T.a2_match.size;
  return (_cMatches = [...T.a2_match.values()].sort((a, b) => a.order_no - b.order_no));
};
export const match = (c) => T.a2_match.get(c);
export const fields = () => {
  const cnt = event().field_count;
  if (_cFields && _fSize === T.a2_field.size && _fCnt === cnt) return _cFields;
  _fSize = T.a2_field.size; _fCnt = cnt;
  return (_cFields = [...T.a2_field.values()].filter((f) => f.no <= cnt).sort((a, b) => a.no - b.no));
};
export const field = (n) => T.a2_field.get(n);
export const groups = () => {
  if (_cGroups && _gSize === T.a2_group.size) return _cGroups;
  _gSize = T.a2_group.size;
  return (_cGroups = [...T.a2_group.values()].sort((a, b) => a.grp.localeCompare(b.grp)));
};
export const teamAbsent = (seed) => !!T.a2_team.get(seed)?.absent;
export const gamesOf = (code) => {
  if (!_cGames || _gaSize !== T.a2_game.size) {
    _gaSize = T.a2_game.size;
    _cGames = new Map();
    for (const g of T.a2_game.values()) {
      if (g.status === "void") continue;
      let arr = _cGames.get(g.match_code);
      if (!arr) _cGames.set(g.match_code, (arr = []));
      arr.push(g);
    }
    for (const arr of _cGames.values()) arr.sort((a, b) => a.idx - b.idx);
  }
  return _cGames.get(code) || EMPTY;
};
export const openGame = (code) => {
  const gs = gamesOf(code);
  for (let i = gs.length - 1; i >= 0; i--) {
    const st = gs[i].status;
    if (st === "ready" || st === "live" || st === "review") return gs[i];
  }
  return null;
};
export const gameNo = (code, g) => {
  let n = 0;
  for (const x of gamesOf(code)) { if (x.idx <= g.idx && x.status !== "replay") n++; }
  return n;
};
export const teamName = (seed) => { if (seed == null) return ""; const t = T.a2_team.get(seed); return t && t.name ? t.name : "Team " + seed; };
export const srcLabel = (src) => (!src ? "" : src.seed ? "Seed " + src.seed : src.g ? `${["", "1st", "2nd", "3rd"][src.p] || src.p + "th"} Group ${src.g}` : src.w ? "Winner " + src.w : src.l ? "Loser " + src.l : "");
export const sideName = (m, side) => { const s = side === "red" ? m.red_seed : m.blue_seed; return s != null ? teamName(s) : srcLabel(side === "red" ? m.red_src : m.blue_src); };
export const tableOf = (grp) => {
  if (!_cTable || _stRef !== S.standings) {
    _stRef = S.standings;
    _cTable = new Map();
    for (const r of S.standings) {
      let arr = _cTable.get(r.grp);
      if (!arr) _cTable.set(r.grp, (arr = []));
      arr.push(r);
    }
    for (const arr of _cTable.values()) arr.sort((a, b) => a.pos - b.pos);
  }
  return _cTable.get(grp) || EMPTY;
};
export const STATUS_TH = { locked: "รอผล", ready: "พร้อม", queued: "อยู่ในสนาม", live: "กำลังแข่ง", done: "จบแล้ว" };
export const METHOD_TH = { full: "จอดครบเร็วกว่า (6.1)", count: "จอดได้มากกว่า (6.2)", lift: "ยกแท่นแรกก่อน (6.3)", exit: "ออกจากกรอบแดงก่อน (6.4)", judge: "กรรมการตัดสิน" };

export const fmtMs = (ms) => { if (ms == null) return "-"; const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
export const parseMs = (t) => { t = String(t || "").trim(); if (!t) return null; const m = t.match(/^(\d+):(\d{1,2})$/); if (m) return (+m[1] * 60 + +m[2]) * 1000; if (/^\d+$/.test(t)) return +t * 1000; return NaN; };
export const fmtTime = (iso) => { if (!iso) return ""; const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (id) => document.getElementById(id);

// ---------- Clock ----------
export const now = () => Date.now() + S.offset;
export async function syncClock() {
  let best = null;
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now(); const { data, error } = await sb.rpc("a2_now"); const t1 = Date.now();
    if (error || data == null) continue; const rtt = t1 - t0;
    if (!best || rtt < best.rtt) best = { rtt, off: Number(data) - (t0 + t1) / 2 };
  }
  if (best) { S.offset = best.off; S.rtt = best.rtt; }
}
export function fieldLeft(f) {
  const ev = event();
  if (!f) return 0;
  if (f.running && f.ends_at) return Math.max(0, Date.parse(f.ends_at) - now());
  if (f.left_ms != null) return f.left_ms;
  return f.phase === "game" ? ev.game_ms : ev.setup_ms;
}
export const PHASE_TH = { idle: "รอเริ่ม", setup: "Setup", game: "แข่ง", over: "หมดเวลา" };
export function fieldPhaseLabel(f) {
  if (!f.match_code) return "ว่าง";
  if (f.phase === "setup" && !f.running && f.left_ms === 0) return "Setup เสร็จ";
  if (!f.running && f.left_ms > 0 && (f.phase === "setup" || f.phase === "game")) return PHASE_TH[f.phase] + " หยุดชั่วคราว";
  return PHASE_TH[f.phase] || f.phase;
}

// ---------- v2 result preview (display only, the database decides) ----------
export function previewDecide(g) {
  const rf = g.red_parked >= 3, bf = g.blue_parked >= 3;
  const W = (side, method) => ({ side, method });
  if (rf !== bf) return W(rf ? "red" : "blue", "full");
  if (rf && bf) { if (g.red_full_ms != null && g.blue_full_ms != null && g.red_full_ms !== g.blue_full_ms) return W(g.red_full_ms < g.blue_full_ms ? "red" : "blue", "full"); }
  else if (g.red_parked !== g.blue_parked) return W(g.red_parked > g.blue_parked ? "red" : "blue", "count");
  const cmp = (a, b, m) => { if (a == null && b == null) return null; if (b == null) return W("red", m); if (a == null) return W("blue", m); if (a !== b) return W(a < b ? "red" : "blue", m); return undefined; };
  let r = cmp(g.red_lift_ms, g.blue_lift_ms, "lift"); if (r) return r;
  r = cmp(g.red_exit_ms, g.blue_exit_ms, "exit"); if (r) return r;
  return r === undefined || (g.red_exit_ms != null || g.blue_exit_ms != null) ? { need: "replay" } : { need: "judge" };
}
export const REASON_TH = { replay: "ผลเท่ากันทุกอย่าง ต้องแข่งใหม่ด้วยแบบสนามเดิม (FAQ 34)", judge: "ไม่มีทีมไหนออกจากกรอบแดง กรรมการต้องตัดสิน (FAQ 35)" };

// ---------- Load and subscribe to data ----------
let _lastLoad = 0, _loadSeq = 0;
export async function loadAll() {
  const seq = ++_loadSeq;
  const q = (t) => sb.from(t).select("*");
  const [ev, tm, ma, ga, fi, tb, st, rk, gr] = await Promise.all([q("a2_event"), q("a2_team"), q("a2_match"), q("a2_game"), q("a2_field"), q("a2_tiebreak"), sb.from("a2_v_standings").select("*"), sb.from("a2_v_ranking").select("*"), q("a2_group")]);
  const mk = OPT.marks ? await q("a2_mark") : { data: [] };
  const err = [ev, tm, ma, ga, fi, tb, st, rk, gr, mk].find((r) => r.error);
  if (err) throw err.error;
  if (seq !== _loadSeq) return;
  const fill = (name, rows) => { const m = T[name]; m.clear(); rows.forEach((r) => m.set(r[PK[name]], r)); };
  fill("a2_event", ev.data); fill("a2_team", tm.data); fill("a2_match", ma.data); fill("a2_game", ga.data); fill("a2_field", fi.data); fill("a2_tiebreak", tb.data); fill("a2_group", gr.data); fill("a2_mark", mk.data);
  invalidateData(); invalidateStandings();
  S.standings = st.data; S.ranking = rk.data.sort((a, b) => a.pos - b.pos); S.ready = true;
  _lastLoad = Date.now();
  notify();
}
let stT = 0, _derSeq = 0;
function reloadDerived() {
  clearTimeout(stT);
  stT = setTimeout(async () => {
    const seq = ++_derSeq;
    const [st, rk] = await Promise.all([sb.from("a2_v_standings").select("*"), sb.from("a2_v_ranking").select("*")]);
    if (seq !== _derSeq) return;
    if (!st.error) { invalidateStandings(); S.standings = st.data; }
    if (!rk.error) S.ranking = rk.data.sort((a, b) => a.pos - b.pos);
    notify();
  }, 120);
}
export function paintNet() { const s = S.net; document.querySelectorAll("[data-net]").forEach((e) => { e.className = "netdot " + s; e.querySelector("b").textContent = { on: "Online", wait: "Connecting", err: "Offline" }[s]; }); }
function setNet(s) { S.net = s; paintNet(); notify(); }
export function connect() {
  let ch = null;
  const open = async () => {
    setNet("wait");
    if (ch) { try { sb.removeChannel(ch); } catch (e) {} }
    ch = sb.channel("a2-" + Math.random().toString(36).slice(2, 8));
    for (const t of Object.keys(PK).filter((x) => x !== "a2_mark" || OPT.marks)) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => {
        const row = p.eventType === "DELETE" ? p.old : p.new, m = T[t];
        if (p.eventType === "DELETE") m.delete(row[PK[t]]); else m.set(row[PK[t]], { ...(m.get(row[PK[t]]) || {}), ...row });
        invalidateData(t);
        if (t === "a2_match" || t === "a2_game" || t === "a2_tiebreak" || t === "a2_group") reloadDerived();
        notify();
      });
    }
    ch.subscribe(async (st) => {
      if (st === "SUBSCRIBED") { try { await loadAll(); await syncClock(); setNet("on"); } catch (e) { setNet("err"); } }
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { setNet("err"); setTimeout(open, 3000); }
    });
  };
  open();
  // Poll less aggressively when realtime is healthy; keep fast fallback if offline or stale
  setInterval(() => {
    if (document.hidden) return;
    if (S.net !== "on" || Date.now() - _lastLoad > 120000) loadAll().catch(() => {});
  }, 15000);
  setInterval(() => sb.rpc("a2_tick").then(() => {}), 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - _lastLoad > 15000) loadAll().catch(() => {}); });
}
export async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) { const e = new Error((error.message || "").replace(/^[a-z_]+:\s*/i, "")); e.code = (error.message || "").split(":")[0]; throw e; }
  return data;
}
export function toast(msg, bad) {
  document.querySelectorAll(".toast").forEach((x) => x.remove());
  const d = document.createElement("div"); d.className = "toast" + (bad ? " bad" : ""); d.textContent = msg; d.setAttribute("role", "status");
  document.body.appendChild(d); setTimeout(() => d.remove(), bad ? 4500 : 2200);
}
export function beep(f = 880, ms = 160) {
  try { const a = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)()); const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.value = 0.15; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + ms / 1000); } catch (e) {}
}
export const netBadge = () => `<span class="netdot wait" data-net><i></i><b>กำลังเชื่อม</b></span>`;
export function raf(fn) { const loop = () => { fn(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }

// ---------- v3 single field, central clock ----------
export const marksOf = (gid) => [...T.a2_mark.values()].filter((m) => m.game_id === gid).sort((a, b) => a.created_at.localeCompare(b.created_at));
// Returns { phase, ms (shown value), elapsed (since GO), count (countdown seconds) }
export function clockV3(f) {
  const ev = event(), gm = ev.game_ms || 90000;
  if (!f || !f.match_code) return { phase: "empty", ms: gm, elapsed: 0 };
  const t = now();
  switch (f.phase) {
    case "setup": return f.running === false ? { phase: "setup", paused: true, ms: f.left_ms || 0, elapsed: 0 } : { phase: "setup", ms: f.ends_at ? Math.max(0, Date.parse(f.ends_at) - t) : 0, elapsed: 0 };
    case "ready": return { phase: "ready", ms: gm, elapsed: 0 };
    case "countdown": {
      const left = Date.parse(f.go_at) - t;
      if (left > 0) return { phase: "countdown", ms: gm, elapsed: 0, count: Math.ceil(left / 1000) };
      const el = Math.min(gm, -left); return { phase: el >= gm ? "over" : "game", ms: gm - el, elapsed: el };
    }
    case "game": { if (f.running === false) { const el = gm - (f.left_ms || 0); return { phase: "game", paused: true, ms: f.left_ms || 0, elapsed: el }; }
      const el = Math.min(gm, Math.max(0, t - Date.parse(f.go_at))); return { phase: el >= gm ? "over" : "game", ms: gm - el, elapsed: el }; }
    case "stopped": return { phase: "stopped", ms: gm - (f.stop_ms || 0), elapsed: f.stop_ms || 0 };
    case "over": return { phase: "over", ms: 0, elapsed: gm };
    default: return { phase: "idle", ms: gm, elapsed: 0 };
  }
}
export const PHASE_EN = { empty: "Waiting", idle: "Idle", setup: "Setup", ready: "Ready", countdown: "Countdown", game: "Live", stopped: "Stopped", over: "Time up" };
export const fmtMs1 = (ms) => { if (ms == null) return "-"; const d = Math.max(0, Math.floor(ms / 100)); const s = Math.floor(d / 10); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + "." + (d % 10); };
// v3 decider, mirrors a2_decide in the database (preview only)
export function decideV3(g) {
  if (!g) return { need: "judge" };
  if (g.complete_side === "red" || g.complete_side === "blue") return { side: g.complete_side, method: "full" };
  if (g.red_parked !== g.blue_parked) return { side: g.red_parked > g.blue_parked ? "red" : "blue", method: "count" };
  if (g.lift_side) return g.lift_side === "both" ? { need: "replay" } : { side: g.lift_side, method: "lift" };
  if (g.exit_side) return g.exit_side === "both" ? { need: "replay" } : { side: g.exit_side, method: "exit" };
  return { need: "judge" };
}
export const RULE_EN = { full: "Rule 6.1 mission complete", count: "Rule 6.2 more stands parked", lift: "Rule 6.3 first lift", exit: "Rule 6.4 left red box first", judge: "Referee decision (FAQ 35)" };
export const RULE_TH = { full: "ทำภารกิจครบ 3 แท่นก่อน (6.1)", count: "จอดแท่นได้มากกว่าเมื่อหมดเวลา (6.2)", lift: "ยกแท่นแรกได้ก่อน (6.3)", exit: "ออกพ้นกรอบแดงก่อน (6.4)", judge: "กรรมการตัดสิน (FAQ 35)" };

// ---------- Fullscreen (Admin, Dashboard, Referee) ----------
export const fsSupported = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
export const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
export function toggleFs() {
  const d = document, el = d.documentElement;
  if (isFs()) return (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  return (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
}
export const FS_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
