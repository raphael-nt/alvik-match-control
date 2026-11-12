// ไลบรารีกลางของทั้ง 3 เว็บ ข้อมูลสด นาฬิกา และตัวช่วยแสดงผล
export const SB_URL = "https://sylaqdubfjgmaxhtrrnk.supabase.co";
export const SB_KEY = "sb_publishable_9x3-7C7fLbQZBDtkk8YAGw_P1XclMv8";
export const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PK = { a2_event: "id", a2_team: "seed", a2_match: "code", a2_game: "id", a2_field: "no", a2_tiebreak: "grp" };
export const T = { a2_event: new Map(), a2_team: new Map(), a2_match: new Map(), a2_game: new Map(), a2_field: new Map(), a2_tiebreak: new Map() };
export const S = { standings: [], ranking: [], net: "wait", offset: 0, ready: false };

const listeners = new Set();
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
let pending = 0;
const notify = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }); };

export const event = () => T.a2_event.get(1) || { name: "", setup_ms: 60000, game_ms: 90000, field_count: 2, tv_mode: "auto" };
export const teamsArr = () => [...T.a2_team.values()].sort((a, b) => a.seed - b.seed);
export const matches = () => [...T.a2_match.values()].sort((a, b) => a.order_no - b.order_no);
export const match = (c) => T.a2_match.get(c);
export const fields = () => [...T.a2_field.values()].filter((f) => f.no <= event().field_count).sort((a, b) => a.no - b.no);
export const field = (n) => T.a2_field.get(n);
export const gamesOf = (code) => [...T.a2_game.values()].filter((g) => g.match_code === code && g.status !== "void").sort((a, b) => a.idx - b.idx);
export const openGame = (code) => gamesOf(code).filter((g) => ["ready", "live", "review"].includes(g.status)).pop() || null;
export const gameNo = (code, g) => gamesOf(code).filter((x) => x.idx <= g.idx && x.status !== "replay").length;
export const teamName = (seed) => { if (seed == null) return ""; const t = T.a2_team.get(seed); return t && t.name ? t.name : "ทีม " + seed; };
export const srcLabel = (src) => (src && src.seed ? "ลำดับ " + src.seed : src ? "ที่ " + src.p + " สาย " + src.g : "");
export const sideName = (m, side) => { const s = side === "red" ? m.red_seed : m.blue_seed; return s != null ? teamName(s) : srcLabel(side === "red" ? m.red_src : m.blue_src); };
export const tableOf = (grp) => S.standings.filter((r) => r.grp === grp).sort((a, b) => a.pos - b.pos);
export const STATUS_TH = { locked: "รอผล", ready: "พร้อม", queued: "อยู่ในสนาม", live: "กำลังแข่ง", done: "จบแล้ว" };
export const METHOD_TH = { full: "จอดครบเร็วกว่า (6.1)", count: "จอดได้มากกว่า (6.2)", lift: "ยกแท่นแรกก่อน (6.3)", exit: "ออกจากกรอบแดงก่อน (6.4)", judge: "กรรมการตัดสิน" };

export const fmtMs = (ms) => { if (ms == null) return "-"; const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
export const parseMs = (t) => { t = String(t || "").trim(); if (!t) return null; const m = t.match(/^(\d+):(\d{1,2})$/); if (m) return (+m[1] * 60 + +m[2]) * 1000; if (/^\d+$/.test(t)) return +t * 1000; return NaN; };
export const fmtTime = (iso) => { if (!iso) return ""; const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const $ = (id) => document.getElementById(id);

// ---------- นาฬิกา ----------
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

// ---------- ตัวทำนายผลเกม (ใช้แสดงผลล่วงหน้าเท่านั้น ผลจริงตัดสินที่ฐานข้อมูล) ----------
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

// ---------- โหลดและติดตามข้อมูล ----------
export async function loadAll() {
  const q = (t) => sb.from(t).select("*");
  const [ev, tm, ma, ga, fi, tb, st, rk] = await Promise.all([q("a2_event"), q("a2_team"), q("a2_match"), q("a2_game"), q("a2_field"), q("a2_tiebreak"), sb.from("a2_v_standings").select("*"), sb.from("a2_v_ranking").select("*")]);
  const err = [ev, tm, ma, ga, fi, tb, st, rk].find((r) => r.error);
  if (err) throw err.error;
  const fill = (name, rows) => { const m = T[name]; m.clear(); rows.forEach((r) => m.set(r[PK[name]], r)); };
  fill("a2_event", ev.data); fill("a2_team", tm.data); fill("a2_match", ma.data); fill("a2_game", ga.data); fill("a2_field", fi.data); fill("a2_tiebreak", tb.data);
  S.standings = st.data; S.ranking = rk.data.sort((a, b) => a.pos - b.pos); S.ready = true;
  notify();
}
let stT = 0;
async function reloadDerived() {
  clearTimeout(stT);
  stT = setTimeout(async () => {
    const [st, rk] = await Promise.all([sb.from("a2_v_standings").select("*"), sb.from("a2_v_ranking").select("*")]);
    if (!st.error) S.standings = st.data; if (!rk.error) S.ranking = rk.data.sort((a, b) => a.pos - b.pos); notify();
  }, 120);
}
export function paintNet() { const s = S.net; document.querySelectorAll("[data-net]").forEach((e) => { e.className = "netdot " + s; e.querySelector("b").textContent = { on: "ออนไลน์", wait: "กำลังเชื่อม", err: "หลุดการเชื่อมต่อ" }[s]; }); }
function setNet(s) { S.net = s; paintNet(); notify(); }
export function connect() {
  let ch = null;
  const open = async () => {
    setNet("wait");
    if (ch) { try { sb.removeChannel(ch); } catch (e) {} }
    ch = sb.channel("a2-" + Math.random().toString(36).slice(2, 8));
    for (const t of Object.keys(PK)) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => {
        const row = p.eventType === "DELETE" ? p.old : p.new, m = T[t];
        if (p.eventType === "DELETE") m.delete(row[PK[t]]); else m.set(row[PK[t]], { ...(m.get(row[PK[t]]) || {}), ...row });
        if (t === "a2_match" || t === "a2_game" || t === "a2_tiebreak") reloadDerived();
        notify();
      });
    }
    ch.subscribe(async (st) => {
      if (st === "SUBSCRIBED") { try { await loadAll(); await syncClock(); setNet("on"); } catch (e) { setNet("err"); } }
      else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT" || st === "CLOSED") { setNet("err"); setTimeout(open, 3000); }
    });
  };
  open();
  setInterval(() => loadAll().catch(() => {}), 30000);
  setInterval(() => sb.rpc("a2_tick").then(() => {}), 8000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadAll().catch(() => {}); });
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
