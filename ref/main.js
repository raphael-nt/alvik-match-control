import { paintNet, rpc, connect, onChange, event, fields, field, match, openGame, gamesOf, gameNo, sideName, teamName, fieldLeft, fieldPhaseLabel, fmtMs, fmtTime, esc, $, toast, beep, netBadge, raf, previewDecide, REASON_TH, METHOD_TH, S, T, matches } from "../shared/common.js";

const L = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
let device = L("a2dev"); if (!device) { device = crypto.randomUUID(); L("a2dev", device); }
let pin = L("a2pin") || "";
let cur = null;          // { no, session }
let lastOp = null;       // ใช้ปุ่มย้อน
let wake = null;
const app = $("app");

const q = (o) => ({ p_pin: pin, p_device: device, p_field: cur?.no, p_session: cur?.session, ...o });
async function act(fn) { try { return await fn(); } catch (e) { if (e.code === "forbidden" && /session/.test(e.message)) { cur = null; L("a2field", null); toast("คิวนี้เปลี่ยนแล้ว เลือกสนามใหม่", true); render(true); } else toast(e.message || "ส่งไม่สำเร็จ ลองอีกครั้ง", true); } }
const vib = () => { try { navigator.vibrate && navigator.vibrate(18); } catch (e) {} };

// ---------- หน้าใส่ PIN ----------
function loginView(err) {
  app.innerHTML = `<div class="login"><h1>กรรมการ</h1><p class="muted">ใส่ PIN ที่ได้จากผู้จัด</p>
    <input id="pin" inputmode="numeric" autocomplete="off" aria-label="PIN" maxlength="12">
    ${err ? `<p style="color:var(--red)">${esc(err)}</p>` : ""}
    <button class="btn primary" id="go" style="min-height:56px;font-size:20px">เข้าสู่ระบบ</button>${netBadge()}</div>`;
  const go = async () => { const v = $("pin").value.trim(); if (!v) return; try { const ok = await rpc("a2_ref_login", { p_pin: v }); if (ok) { pin = v; L("a2pin", v); render(true); } else loginView("PIN ไม่ถูกต้อง"); } catch (e) { loginView(e.message); } };
  $("go").onclick = go; $("pin").onkeydown = (e) => e.key === "Enter" && go(); $("pin").focus();
}

// ---------- เลือกสนาม ----------
function listView() {
  const ev = event();
  const cards = fields().map((f) => {
    const m = f.match_code ? match(f.match_code) : null;
    const doneM = m && m.status === "done";
    const nextSched = matches().filter((x) => x.sched_field === f.no && x.sched_at && x.status !== "done" && x.code !== f.match_code).sort((a, b) => a.sched_at.localeCompare(b.sched_at))[0];
    let body, dis = true;
    if (!m) body = `<h3>สนาม ${f.no}</h3><span class="m muted">รอแอดมินเปิดคิว</span>`;
    else if (doneM) body = `<h3>สนาม ${f.no}</h3><span class="m">คู่ ${m.code} จบแล้ว</span><span class="muted">รอคิวถัดไป</span>`;
    else { dis = false; body = `<h3>สนาม ${f.no} คู่ ${m.code}</h3><span class="m">${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</span><span class="muted">${esc(fieldPhaseLabel(f))}</span>`; }
    if ((!m || doneM) && nextSched) body += `<span class="muted">คู่ถัดไป ${nextSched.code} นัด ${fmtTime(nextSched.sched_at)}${nextSched.auto_open ? " (เปิดเอง)" : ""}</span>`;
    return `<button class="fcard${dis ? "" : " open"}" data-f="${f.no}" ${dis ? "disabled" : ""}>${body}</button>`;
  }).join("");
  app.innerHTML = `<div class="bar"><b>เลือกสนาม</b><span class="sp"></span>${netBadge()}<button class="btn" id="out">ออก</button></div>
    <div class="wrap"><div class="flist">${cards}</div><p class="muted" style="margin-top:14px">สนามจะกดได้เมื่อแอดมินเปิดคิวแล้วเท่านั้น</p></div>`;
  $("out").onclick = () => { pin = ""; L("a2pin", null); L("a2field", null); cur = null; render(true); };
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => claim(+b.dataset.f)));
}
async function claim(no) {
  try { const session = await rpc("a2_ref_claim", { p_pin: pin, p_device: device, p_field: no }); cur = { no, session }; L("a2field", String(no)); lastOp = null; render(true); keepAwake(); }
  catch (e) { toast(e.message, true); }
}
async function keepAwake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (e) {} }

// ---------- หน้ากดคะแนน ----------
function fieldView() {
  const f = field(cur.no), m = f && f.match_code ? match(f.match_code) : null;
  if (!f || !m || f.session !== cur.session) { cur = null; L("a2field", null); return listView(); }
  const gs = gamesOf(m.code), g = openGame(m.code), lastDone = gs.filter((x) => x.status === "done").pop();
  const ev = event();
  const matchDone = m.status === "done";
  const gn = g ? gameNo(m.code, g) : gs.length;
  const replayMark = g && gs.some((x) => x.status === "replay" && x.idx === g.idx - 1) ? " แข่งใหม่" : "";
  const live = g && g.status === "live", review = g && g.status === "review", ready = g && g.status === "ready";
  let banner = "";
  if (matchDone) {
    banner = `<div class="banner done"><h3>จบคู่ ${m.code}</h3><div>ผู้ชนะ ${esc(teamName(m.winner_seed))} (${m.red_wins}-${m.blue_wins})</div><div class="muted">รอแอดมินเปิดคิวถัดไป หน้านี้จะเปลี่ยนเอง</div></div>`;
  } else if (review) {
    if (g.need === "judge") banner = `<div class="banner"><h3>กรรมการตัดสิน</h3><div>${REASON_TH.judge}</div><div class="row" style="margin-top:10px"><button class="btn red" data-judge="red" style="min-height:60px">${esc(sideName(m, "red"))} ชนะ</button><button class="btn blue" data-judge="blue" style="min-height:60px">${esc(sideName(m, "blue"))} ชนะ</button></div></div>`;
    else { const p = previewDecide(g); const txt = p.side ? `${esc(sideName(m, p.side))} ชนะ ${METHOD_TH[p.method]}` : REASON_TH[p.need];
      banner = `<div class="banner"><h3>ตรวจผลเกม ${gn}</h3><div>${txt}</div><div class="muted">ผิดแก้ตัวเลขด้านล่างได้ แล้วกดยืนยันผล</div><button class="btn primary" id="confirm" style="width:100%;min-height:60px;margin-top:10px;font-size:20px">ยืนยันผล</button></div>`; }
  }
  const ph = f.phase, run = f.running;
  let ctl = "";
  if (!matchDone && ready) {
    const setupDone = ph === "setup" && !run && f.left_ms === 0;
    if (ph === "idle") ctl = `<button class="btn" data-t="start_setup" ${g.pattern ? "" : "disabled"}>เริ่ม Setup ${fmtMs(ev.setup_ms)}</button><button class="btn primary" data-t="start_game" ${g.pattern ? "" : "disabled"}>เริ่มเกมเลย</button>`;
    else if (ph === "setup" && run) ctl = `<button class="btn" data-t="pause">หยุดเวลา</button><button class="btn primary" data-t="start_game">ข้าม Setup เริ่มเกม</button>`;
    else if (ph === "setup" && !run && !setupDone) ctl = `<button class="btn" data-t="resume">เดินต่อ</button><button class="btn" data-t="reset">รีเซ็ต</button>`;
    else if (setupDone) ctl = `<button class="btn primary" data-t="start_game" style="grid-column:1/-1">เริ่มเกม</button>`;
  } else if (live) {
    ctl = run ? `<button class="btn" data-t="pause">หยุดเวลา</button><button class="btn danger hold" data-hold="reset">ยกเลิกเกม (กดค้าง)<i></i></button>` : `<button class="btn" data-t="resume">เดินต่อ</button><button class="btn danger hold" data-hold="reset">ยกเลิกเกม (กดค้าง)<i></i></button>`;
  }
  const lockSide = !(live || review);
  const side = (s, cls) => {
    const parked = g ? g[s + "_parked"] : 0, lift = g ? g[s + "_lift_ms"] : null, ex = g ? g[s + "_exit_ms"] : null, full = g ? g[s + "_full_ms"] : null;
    return `<div class="side ${cls}${lockSide ? " lock" : ""}"><h3>${s === "red" ? "แดง" : "น้ำเงิน"} ${esc(sideName(m, s))}</h3>
      <div class="cnt">${parked}<small> แท่น</small></div><div class="muted" style="text-align:center;min-height:22px">${full != null ? "ครบ " + fmtMs(full) : ""}</div>
      <div class="pm"><button class="btn" data-op="parked_dec" data-s="${s}" aria-label="ลดแท่น">-</button><button class="btn ${s === "red" ? "red" : "blue"}" data-op="parked_inc" data-s="${s}" ${parked >= 3 ? "disabled" : ""}>+1 แท่น</button></div>
      <button class="btn stamp${lift != null ? " set" : ""}" data-op="${lift != null ? "" : "lift"}" data-s="${s}" ${lift != null ? `data-clear="clear_lift"` : ""}><span>ยกแท่นแรก</span><b>${lift != null ? fmtMs(lift) : "กด"}</b></button>
      <button class="btn stamp${ex != null ? " set" : ""}" data-op="${ex != null ? "" : "exit"}" data-s="${s}" ${ex != null ? `data-clear="clear_exit"` : ""}><span>ออกกรอบแดง</span><b>${ex != null ? fmtMs(ex) : "กด"}</b></button></div>`;
  };
  app.innerHTML = `<div class="bar"><button class="btn" id="back">สนาม</button><b>สนาม ${f.no} คู่ ${m.code}</b><span class="sp"></span>${netBadge()}</div>
  <div class="wrap">${banner}
    ${!matchDone && g ? `<div class="pat"><span class="muted">เกม ${gn} จาก Bo${m.bo}${replayMark}<br>แบบสนาม</span>${[1, 2, 3].map((n) => `<button class="btn${g.pattern === n ? " on" : ""}" data-pat="${n}" ${ready ? "" : "disabled"}>${n}</button>`).join("")}</div>` : ""}
    ${matchDone ? "" : `<div class="clock" id="clock"><div class="t" id="ct">0:00</div><div class="l" id="cl"></div></div><div class="tctl">${ctl}</div>`}
    ${matchDone ? "" : `<div class="sides">${side("red", "side-r")}${side("blue", "side-b")}</div>`}
    ${!matchDone && g ? `<div class="foot"><button class="btn" id="undo" ${lastOp ? "" : "disabled"}>ย้อน</button><button class="btn primary hold" ${live || review ? "" : "disabled"} data-hold="finish">จบเกม (กดค้าง)<i></i></button></div>` : ""}
    <p class="muted" style="text-align:center;margin-top:10px">คู่ ${m.code} ${m.red_wins}-${m.blue_wins} ${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</p>
  </div>`;
  bindField(m, g);
  tickClock();
}
function bindField(m, g) {
  $("back").onclick = async () => { try { await rpc("a2_ref_release", { p_pin: pin, p_device: device, p_field: cur.no }); } catch (e) {} cur = null; L("a2field", null); render(true); };
  app.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => act(async () => { await rpc("a2_ref_timer", q({ p_action: b.dataset.t })); vib(); beep(b.dataset.t === "start_game" ? 1040 : 660, 220); })));
  app.querySelectorAll("[data-pat]").forEach((b) => (b.onclick = () => act(async () => { const r = await rpc("a2_ref_op", q({ p_game: g.id, p_op: "pattern", p_arg: +b.dataset.pat })); T.a2_game.set(r.id, r); vib(); render(true); })));
  app.querySelectorAll("[data-op]").forEach((b) => {
    const op = b.dataset.op, s = b.dataset.s, clear = b.dataset.clear;
    if (clear) { holdBind(b, () => doOp(g, clear, s)); return; }
    b.onclick = () => doOp(g, op, s, true);
  });
  const c = $("confirm"); if (c) c.onclick = () => act(async () => { const r = await rpc("a2_ref_finish", q({ p_game: g.id })); vib(); toast(r === "judge" ? "ต้องให้กรรมการตัดสิน" : r === "replay" ? "เสมอ แข่งใหม่ด้วยแบบสนามเดิม" : (r === "red" ? "แดง" : "น้ำเงิน") + " ชนะเกมนี้"); });
  app.querySelectorAll("[data-judge]").forEach((b) => (b.onclick = () => act(async () => { await rpc("a2_ref_judge", q({ p_game: g.id, p_side: b.dataset.judge })); vib(); })));
  app.querySelectorAll("[data-hold]").forEach((b) => holdBind(b, () => act(async () => {
    if (b.dataset.hold === "finish") { const r = await rpc("a2_ref_finish", q({ p_game: g.id })); toast(r === "judge" ? "ต้องให้กรรมการตัดสิน" : r === "replay" ? "เสมอ แข่งใหม่ด้วยแบบสนามเดิม" : "บันทึกผลแล้ว"); }
    else await rpc("a2_ref_timer", q({ p_action: "reset" }));
    vib();
  })));
  const u = $("undo"); if (u) u.onclick = () => { if (!lastOp) return; const inv = { parked_inc: "parked_dec", parked_dec: "parked_inc", lift: "clear_lift", exit: "clear_exit" }[lastOp.op]; const l = lastOp; lastOp = null; doOp(g, inv, l.s); };
}
async function doOp(g, op, s, remember) {
  await act(async () => {
    const r = await rpc("a2_ref_op", q({ p_game: g.id, p_op: op, p_side: s }));
    T.a2_game.set(r.id, r); vib();
    lastOp = remember ? { op, s } : null; render(true);
  });
}
function holdBind(btn, fn) {
  let t = 0, st = 0; const bar = btn.querySelector("i");
  const stop = () => { clearTimeout(t); st = 0; if (bar) { bar.style.transition = "none"; bar.style.width = "0"; } };
  const start = (e) => { e.preventDefault(); stop(); st = 1; if (bar) { bar.style.transition = "width 900ms linear"; bar.style.width = "100%"; } t = setTimeout(() => { stop(); fn(); }, 900); };
  btn.addEventListener("pointerdown", start); ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

let lastBeep = -1;
function tickClock() {
  if (!cur) return; const f = field(cur.no); const ct = $("ct"); if (!f || !ct) return;
  const left = fieldLeft(f), s = Math.ceil(left / 1000);
  ct.textContent = fmtMs(left); $("cl").textContent = fieldPhaseLabel(f);
  const c = $("clock"); c.classList.toggle("run", !!f.running); c.classList.toggle("warn", f.phase === "game" && left <= 10000 && left > 0);
  if (f.running && s <= 3 && s > 0 && s !== lastBeep) { lastBeep = s; beep(660, 100); } if (!f.running || s > 3) lastBeep = -1;
}

let key = "";
function render(force) {
  let k;
  if (!S.ready) k = "load";
  else if (!pin) k = "login";
  else if (!cur) k = "list" + JSON.stringify([fields().map((f) => [f.no, f.match_code, f.phase, f.running, f.session]), matches().map((m) => [m.code, m.status, m.sched_at, m.sched_field, m.auto_open, m.red_seed, m.blue_seed])]);
  else { const f = field(cur.no), m = f && f.match_code && match(f.match_code), g = m && openGame(m.code);
    k = "field" + JSON.stringify([f && f.session, f && f.phase, f && f.running, f && f.left_ms, m && m.status, m && m.red_wins, m && m.blue_wins, g && [g.id, g.version, g.status, g.need], m && [m.red_seed, m.blue_seed], lastOp && 1]); }
  if (!force && k === key) { paintNet(); return; }
  key = k;
  if (!S.ready) { app.innerHTML = `<div class="login"><p class="muted">กำลังโหลด</p>${netBadge()}</div>`; }
  else if (!pin) loginView();
  else if (!cur) { const sf = +L("a2field"); if (sf && !render.tried) { render.tried = 1; claim(sf).finally(() => { render.tried = 0; if (!cur) { L("a2field", null); render(true); } }); return; } listView(); }
  else fieldView();
  paintNet();
}
onChange(() => render());
connect();
raf(tickClock);
setInterval(() => { if (cur && S.ready) rpc("a2_ref_heartbeat", q({})).catch((e) => { if (e.code === "forbidden") { cur = null; render(true); } }); }, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && cur) keepAwake(); });
render();
