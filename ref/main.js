// Referee page v3: single field, central clock, checklist by criteria (docs/DESIGN_v3.md section 4)
import { fsSupported, toggleFs, useMarks, connect, onChange, paintNet, rpc, loadAll, S, T, event, field, match, matches, openGame, gamesOf, gameNo, sideName, teamName, marksOf, clockV3, decideV3, fmtMs1, fmtMs, fmtTime, PHASE_EN, RULE_EN, RULE_TH, esc, $, toast, beep, netBadge, raf, now } from "../shared/common.js";
import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { listDocs, showDoc, closeX, docRows } from "../shared/docs.js";
// Fullscreen button shows only where the browser supports it (not on iPhone Safari)
const fsOk = fsSupported();

useMarks();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const L = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
let device = L("a2dev"); if (!device) { device = uid(); L("a2dev", device); }
let pin = L("a2pin") || "";
let ctl = null;            // { control, session }
let wake = null;
let reviewOk = { held: false, seen: false };
let finished = null;       // { code, winner } shows Match finished briefly
const app = $("app");
const vib = () => { try { navigator.vibrate && navigator.vibrate(18); } catch (e) {} };

// ---------- Offline queue (design 7.6) ----------
let Q = []; try { Q = JSON.parse(L("a2q") || "[]"); } catch (e) { Q = []; }
const saveQ = () => L("a2q", JSON.stringify(Q));
let flushing = false;
async function flush() {
  if (flushing || !Q.length) return; flushing = true;
  try {
    while (Q.length) {
      const it = Q[0];
      try { const r = await rpc(it.fn, { p_pin: pin, p_device: device, p_session: ctl?.session, ...it.args }); if (r && r.id) T.a2_game.set(r.id, r); }
      catch (e) {
        if (/fetch|network|Failed/i.test(e.message || "") || !e.code) break;   // network down, retry next round
        toast(e.message, true);                                                  // server rejected, drop this item
      }
      Q.shift(); saveQ();
    }
  } finally { flushing = false; render(true); }
}
setInterval(flush, 2000);
function enqueue(fn, args) { Q.push({ fn, args }); saveQ(); render(true); flush(); }

// Events of this game, including ones still waiting to send
function marksView(gid) {
  const srv = marksOf(gid).filter((m) => !m.voided && m.kind !== "false_start");
  const undone = new Set(Q.filter((i) => i.fn === "a2_ref_undo").map((i) => i.args.p_id));
  const pend = Q.filter((i) => i.fn === "a2_ref_mark" && i.args.p_game === gid).map((i) => ({ id: i.args.p_id, kind: i.args.p_kind, side: i.args.p_side, t_ms: i.args.p_t_ms, pending: true }));
  return [...srv.filter((m) => !pend.some((p) => p.id === m.id)), ...pend].filter((m) => !undone.has(m.id));
}
function summary(g) {
  const ms = marksView(g.id), one = (k) => ms.find((m) => m.kind === k);
  const cnt = (k, s) => ms.filter((m) => m.kind === k && m.side === s).length;
  const park = (s) => Math.max(0, Math.min(3, cnt("park", s) - cnt("unpark", s)));
  const c = one("complete");
  return { ...g, exit: one("exit_first"), lift: one("lift_first"), complete: c, exit_side: one("exit_first")?.side, lift_side: one("lift_first")?.side, complete_side: c?.side,
    red_parked: c && (c.side === "red" || c.side === "both") ? 3 : park("red"), blue_parked: c && (c.side === "blue" || c.side === "both") ? 3 : park("blue"),
    red_retries: cnt("retry", "red"), blue_retries: cnt("retry", "blue"), marks: ms };
}
function mark(g, kind, side) {
  const f = field(1), ck = clockV3(f);
  enqueue("a2_ref_mark", { p_game: g.id, p_id: uid(), p_kind: kind, p_side: side, p_t_ms: Math.round(ck.elapsed) });
  vib(); if (kind === "complete") beep(520, 600); else beep(990, 60);
}
function undo(g) {
  const ms = marksView(g.id).filter((x) => x.kind !== "complete"); const last = ms[ms.length - 1]; if (!last) return;
  const qi = Q.findIndex((i) => i.fn === "a2_ref_mark" && i.args.p_id === last.id);
  if (qi >= 0) { Q.splice(qi, 1); saveQ(); render(true); } else enqueue("a2_ref_undo", { p_id: last.id });
  vib();
}
// Clock and flow actions re-read the data right away: realtime updates can arrive seconds late,
// and a stale screen makes the referee tap twice
const FLOW = new Set(["a2_ref_stop", "a2_ref_clock", "a2_ref_setup", "a2_ref_go", "a2_ref_false_start", "a2_ref_confirm", "a2_ref_judge", "a2_ref_pattern", "a2_ref_check"]);
async function call(fn, args) { try { const r = await rpc(fn, { p_pin: pin, p_device: device, p_session: ctl?.session, ...args }); vib(); if (FLOW.has(fn)) loadAll().catch(() => {}); return r; } catch (e) { if (e.code === "forbidden") { ctl = null; claim(); } toast(e.message || "ส่งไม่สำเร็จ", true); throw e; } }

// ---------- Referee device claim ----------
async function claim() {
  if (!pin) return;
  try { ctl = await rpc("a2_ref_claim", { p_pin: pin, p_device: device }); keepAwake(); }
  catch (e) { if (e.code === "forbidden" && /pin/.test(e.message)) { pin = ""; L("a2pin", null); } ctl = null; }
  render(true);
}
async function keepAwake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch (e) {} }

// ---------- Components ----------
const bar = (m, g) => `<div class="bar"><b>Referee</b>${m ? `<span class="bm">${esc(m.code)}${g ? ` Game ${gameNo(m.code, g)} of ${m.bo}` : ""}</span>` : ""}<span class="sp"></span>${fsOk ? `<button class="ib" data-fs aria-label="Full screen" title="Full screen"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>` : ""}${pin ? `<button class="ib" data-sheet="bracket" aria-label="Bracket" title="Bracket"><svg viewBox="0 0 24 24"><path d="M3 5h5v4H3zM3 15h5v4H3zM8 7h3v10H8M11 12h4M15 10h6v4h-6z"/></svg></button>${event().docs_ref !== false ? `<button class="ib" data-sheet="docs" aria-label="Documents" title="Rules and FAQ"><svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6"/></svg></button>` : ""}` : ""}${Q.length ? `<span class="qbadge">Saved on this phone, sending (${Q.length})</span>` : ""}${netBadge()}</div>`;
const teams = (m) => `<div class="teams"><div class="tm side-r"><i>RED</i><b>${esc(sideName(m, "red"))}</b><em>${m.red_wins}</em></div><div class="tm side-b"><i>BLUE</i><b>${esc(sideName(m, "blue"))}</b><em>${m.blue_wins}</em></div></div>`;
const clockBox = () => `<button type="button" class="clock tap" id="clock" data-stop><div class="t" id="ct">1:30.0</div><div class="l" id="cl"></div></button>`;
const sideBtns = (key, both) => `<div class="pair"><button class="btn red big" data-mk="${key}" data-s="red">RED</button><button class="btn blue big" data-mk="${key}" data-s="blue">BLUE</button></div>${both ? `<button class="btn same" data-mk="${key}" data-s="both">Same time</button>` : ""}`;
const sideTxt = (s) => (s === "both" ? "Same time" : s === "red" ? "RED first" : "BLUE first");

// ---------- Views ----------
function loginView(err) {
  app.innerHTML = `<div class="login"><h1>Referee</h1><p class="muted">ใส่ PIN ที่ได้จากผู้จัด</p>
    <input id="pin" inputmode="numeric" autocomplete="off" aria-label="PIN" maxlength="12">
    ${err ? `<p class="err">${esc(err)}</p>` : ""}
    <button class="btn primary big" id="go">Sign in</button>${netBadge()}</div>`;
  const go = async () => { const v = $("pin").value.trim(); if (!v) return; try { if (await rpc("a2_ref_login", { p_pin: v })) { pin = v; L("a2pin", v); claim(); } else loginView("PIN ไม่ถูกต้อง"); } catch (e) { loginView(e.message); } };
  $("go").onclick = go; $("pin").onkeydown = (e) => { if (e.key === "Enter") go(); }; // block body: returning false from onkeydown cancels the key $("pin").focus();
}
function waitingView() {
  const nx = matches().filter((m) => m.status === "ready").sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no)[0];
  app.innerHTML = `${bar()}<div class="wrap center">
    ${finished ? `<div class="banner done"><h3>Match finished</h3><div>${esc(finished.code)} ผู้ชนะ ${esc(finished.winner)}</div></div>` : ""}
    <h2>Waiting for next match</h2><p class="muted">แอดมินเรียกคู่ขึ้นสนามแล้ว หน้านี้จะเปลี่ยนเอง</p>
    ${nx ? `<div class="card"><div class="muted">Up next</div><h3>${esc(nx.code)}</h3><div>${esc(sideName(nx, "red"))} vs ${esc(sideName(nx, "blue"))}</div>${nx.sched_at ? `<div class="muted">${fmtTime(nx.sched_at)}</div>` : ""}</div>` : ""}
    <button class="btn" id="out">Sign out</button></div>`;
  $("out").onclick = () => { rpc("a2_ref_release", { p_pin: pin, p_device: device }).catch(() => {}); pin = ""; L("a2pin", null); ctl = null; render(true); };
}
function viewOnly(m) {
  app.innerHTML = `${bar(m)}<div class="wrap center"><h2>View only</h2><p>มีเครื่องกรรมการอื่นใช้อยู่ ถ้าเครื่องนั้นเสีย ให้แอดมินกด "Transfer referee" แล้วหน้านี้จะรับสิทธิ์เอง</p>${teams(m)}${clockBox()}</div>`;
}

function matchView(f, m, g) {
  const ck = clockV3(f), ph = ck.phase;
  const replay = gamesOf(m.code).some((x) => x.status === "replay" && x.idx === g.idx - 1);
  let body = "";
  if (ph === "idle") {
    body = `<section><h3>Field pattern</h3><div class="pat">${[1, 2, 3].map((n) => `<button class="btn${g.pattern === n ? " on" : ""}" data-pat="${n}" ${replay ? "disabled" : ""}>${n}</button>`).join("")}<button class="btn" data-pat="r" ${replay ? "disabled" : ""}>Random</button></div>
      ${replay ? `<p class="muted">เกมแข่งใหม่ ใช้แบบสนามเดิม (FAQ 34)</p>` : `<p class="muted">สุ่มก่อนเริ่ม Setup สองทีมใช้แบบเดียวกัน (2.3)</p>`}</section>
      <button class="btn primary big" data-fl="start" ${g.pattern ? "" : "disabled"}>Start setup ${fmtMs(event().setup_ms)}</button>
      <div class="row"><button class="btn" id="absent">Team absent</button></div>
      ${m.absent_req ? `<p class="warn">ส่งคำขอแพ้บายฝั่ง ${m.absent_req.toUpperCase()} แล้ว รอแอดมินอนุมัติ <button class="btn small" id="absentx">Cancel</button></p>` : ""}`;
  } else if (ph === "setup" || ph === "ready") {
    const c = f.checks || {}, all = c.red_in && c.blue_in && c.stands;
    const ck1 = (k, t, h) => `<label class="chk"><input type="checkbox" data-ck="${k}" ${c[k] ? "checked" : ""}><span>${t}<small>${h}</small></span></label>`;
    body = `${clockBox()}<section><h3>Pre-start checklist</h3>
      ${ck1("red_in", "Red robot fully inside red box", "ทุกส่วนอยู่ในกรอบแดง ทับเส้นได้ (FAQ 3)")}
      ${ck1("blue_in", "Blue robot fully inside red box", "ทุกส่วนอยู่ในกรอบแดง ทับเส้นได้ (FAQ 3)")}
      ${ck1("stands", `Stands placed as pattern ${g.pattern}, both sides`, "กลางแท่นตรงจุด ขอบขนานเส้นสนาม (FAQ 4)")}</section>
      <button class="btn primary huge" id="go" ${ph === "ready" && all ? "" : "disabled"}>Start</button>
      ${ph === "setup" ? `<p class="muted center">ปุ่ม Start กดได้เมื่อ Setup จบและติ๊กครบ แตะที่เวลาเพื่อหยุด แล้วเลือกเล่นต่อหรือข้าม</p>` : ""}`;
  } else if (ph === "countdown") {
    body = `<div class="count" id="count">3</div><button class="btn danger hold" data-hold="false_start">False start (hold)<i></i></button>`;
  } else if (ph === "game") {
    body = liveBody(g, f);
  } else body = reviewBody(f, m, g);
  app.innerHTML = `${bar(m, g)}<div class="wrap">${teams(m)}<p class="muted center">Pattern ${g.pattern || "-"} · ${PHASE_EN[ph]}</p>${body}</div>`;
  bindMatch(f, m, g);
  tickClock();
}

// Simple mode (rules off): only the winner of each game
function simpleView(m, g) {
  const done = gamesOf(m.code).filter((x) => x.status === "done");
  const last = done[done.length - 1];
  app.innerHTML = `${bar(m, g)}<div class="wrap">${teams(m)}
    <section class="center"><h3 style="justify-content:center">Game ${gameNo(m.code, g)} of ${m.bo}</h3><p class="hint">กดค้างที่สีของฝั่งที่ชนะเกมนี้</p>
      <div class="pair"><button class="btn red big hold" style="min-height:120px" data-win="red">RED wins<i></i></button><button class="btn blue big hold" style="min-height:120px" data-win="blue">BLUE wins<i></i></button></div></section>
    ${last ? `<p class="muted center">Last game: ${last.winner.toUpperCase()} won game ${gameNo(m.code, last)}. แก้ผลได้ที่แอดมิน</p>` : ""}
    <div class="row"><button class="btn" id="absent">Team absent</button></div>
    ${m.absent_req ? `<p class="warn">ส่งคำขอแพ้บายฝั่ง ${m.absent_req.toUpperCase()} แล้ว รอแอดมินอนุมัติ <button class="btn small" id="absentx">Cancel</button></p>` : ""}</div>`;
  app.querySelectorAll("[data-win]").forEach((b) => holdBind(b, 600, () => call("a2_ref_winner", { p_game: g.id, p_side: b.dataset.win }).then(() => { beep(990, 200); afterGame(m.code); }).catch(() => {})));
  const ab = $("absent"); if (ab) ab.onclick = () => { const sd = prompt("ทีมที่ไม่มา พิมพ์ red หรือ blue"); if (sd === "red" || sd === "blue") call("a2_ref_absent", { p_side: sd }).catch(() => {}); };
  const ax = $("absentx"); if (ax) ax.onclick = () => call("a2_ref_absent", { p_side: null }).catch(() => {});
}

// KNOCKOUT tag when a side has 3 stands parked or was given Mission complete
const ko = (s, side) => (s[side + "_parked"] >= 3 || s.complete_side === side || s.complete_side === "both" ? `<em class="ko">KNOCKOUT</em>` : "");
function liveBody(g) {
  const s = summary(g);
  const row = (no, title, rule, hint, key, done, both) => `<section class="crit${done ? " done" : ""}"><h3><span>${no}</span>${title} <small>(${rule})</small></h3>${hint ? `<p class="hint">${hint}</p>` : ""}
    ${done ? `<div class="res ${done.side === "red" ? "c-r" : done.side === "blue" ? "c-b" : ""}">${sideTxt(done.side)} <b>${fmtMs1(done.t_ms)}</b>${done.pending ? " <i>sending</i>" : ""}</div>` : sideBtns(key, both)}</section>`;
  const next = !s.exit ? 1 : !s.lift ? 2 : 3;
  const p = decideV3(s);
  return `${clockBox()}
    ${row(1, "Left red box first", "5.3", "ทุกส่วนพ้นกรอบแดง", "exit_first", s.exit, true).replace('class="crit', `class="crit${next === 1 ? " next" : ""}`)}
    ${row(2, "First lift", "5.1", "4 legs off the floor", "lift_first", s.lift, true).replace('class="crit', `class="crit${next === 2 ? " next" : ""}`)}
    <section class="crit${next === 3 ? " next" : ""}"><h3><span>3</span>Stands parked now <small>(5.4)</small></h3><p class="hint">Pushed or dragged in does not count · หลุดจากช่องให้ลด</p>
      <div class="park"><div class="c-r"><button class="btn" data-mk="unpark" data-s="red" ${s.red_parked ? "" : "disabled"}>-</button><b>${s.red_parked}${ko(s, "red")}</b><button class="btn red" data-mk="park" data-s="red" ${s.red_parked >= 3 ? "disabled" : ""}>+</button></div>
      <div class="c-b"><button class="btn" data-mk="unpark" data-s="blue" ${s.blue_parked ? "" : "disabled"}>-</button><b>${s.blue_parked}${ko(s, "blue")}</b><button class="btn blue" data-mk="park" data-s="blue" ${s.blue_parked >= 3 ? "disabled" : ""}>+</button></div></div></section>
    <section class="crit"><h3><span>4</span>Knockout <small>(6.1 Mission complete)</small></h3><p class="hint">แท่นที่ 3 จอดสำเร็จ กดค้างแล้วเวลาหยุดทันที (FAQ 33)</p>
      <div class="pair"><button class="btn red big hold" data-hold="complete" data-s="red">RED<i></i></button><button class="btn blue big hold" data-hold="complete" data-s="blue">BLUE<i></i></button></div></section>
    <section class="foot"><div class="retry">Retry <button class="btn red small" data-mk="retry" data-s="red">R ${s.red_retries}</button><button class="btn blue small" data-mk="retry" data-s="blue">B ${s.blue_retries}</button></div>
      <button class="btn" id="undo" ${s.marks.some((x) => x.kind !== "complete") ? "" : "disabled"}>Undo</button></section>
    <p class="pred">If time ends now: ${p.side ? `<b class="${p.side === "red" ? "c-r" : "c-b"}">${p.side.toUpperCase()}</b> ${RULE_EN[p.method]}` : p.need === "replay" ? "Replay (FAQ 34)" : "Referee decides (FAQ 35)"}</p>
    <button class="btn danger hold" data-hold="false_start">False start (hold)<i></i></button>`;
}

function reviewBody(f, m, g) {
  const s = summary(g), p = g.need === "judge" ? { need: "judge" } : decideV3(s);
  const stopped = f.phase === "stopped";
  const ln = (t, v) => `<div class="ln"><span>${t}</span><span>${v}</span></div>`;
  const ev = (x) => (x ? `<b class="${x.side === "red" ? "c-r" : x.side === "blue" ? "c-b" : ""}">${sideTxt(x.side).replace(" first", "")}</b> ${fmtMs1(x.t_ms)}` : "-");
  const canEndCount = true;   // scores stay editable after the clock stops; the stop itself cannot be undone
  let act;
  if (g.need === "judge") act = `<p>${RULE_TH.judge} ไม่มีทีมไหนออกจากกรอบแดง</p><div class="pair"><button class="btn red big" data-judge="red">RED wins</button><button class="btn blue big" data-judge="blue">BLUE wins</button></div>`;
  else {
    const ok = !Q.length;
    const label = p.side ? "Confirm result" : p.need === "replay" ? `Replay with pattern ${g.pattern}` : "Referee decides";
    act = `<button class="btn primary huge" id="confirm" ${ok ? "" : "disabled"}>${label}</button>${Q.length ? `<p class="muted center">รอส่งข้อมูลให้ครบก่อน</p>` : ""}`;
  }
  return `<div class="clock"><div class="t">${stopped ? fmtMs1(f.stop_ms) : "1:30.0"}</div><div class="l">${stopped ? "Stopped at (from GO)" : "Time up"}</div></div>
    <section class="sum">
      ${ln("Left red box first", ev(s.exit))}${ln("First lift", ev(s.lift))}
      <div class="ln"><span>Stands at end</span><span class="park mini">
        ${canEndCount ? `<button class="btn small" data-mk="unpark" data-s="red" ${s.red_parked ? "" : "disabled"}>-</button>` : ""}<b class="c-r">${s.red_parked}${ko(s, "red")}</b>${canEndCount ? `<button class="btn small" data-mk="park" data-s="red" ${s.red_parked >= 3 ? "disabled" : ""}>+</button>` : ""}
        ${canEndCount ? `<button class="btn small" data-mk="unpark" data-s="blue" ${s.blue_parked ? "" : "disabled"}>-</button>` : ""}<b class="c-b">${s.blue_parked}${ko(s, "blue")}</b>${canEndCount ? `<button class="btn small" data-mk="park" data-s="blue" ${s.blue_parked >= 3 ? "disabled" : ""}>+</button>` : ""}</span></div>
      ${ln("Knockout", ev(s.complete))}${ln("Retries", `<b class="c-r">${s.red_retries}</b> <b class="c-b">${s.blue_retries}</b>`)}
      ${!s.exit && !s.lift ? `<div class="row">${["red", "blue"].map((x) => `<button class="btn small" data-mk="exit_first" data-s="${x}">+ ${x.toUpperCase()} left box</button>`).join("")}</div>` : ""}
    </section>
    <section class="result"><div class="muted">Result</div><h2>${p.side ? `<span class="${p.side === "red" ? "c-r" : "c-b"}">${p.side.toUpperCase()} wins</span>` : p.need === "replay" ? "Tie, replay" : "Referee decides"}</h2>
      <div>${p.side ? RULE_EN[p.method] + " · " + RULE_TH[p.method] : p.need === "replay" ? "ผลเท่ากันทุกอย่าง แข่งใหม่ทันทีแบบสนามเดิม (FAQ 34)" : "ไม่มีทีมไหนออกจากกรอบแดง (FAQ 35)"}</div></section>
    ${act}`;
}

function bindMatch(f, m, g) {
  app.querySelectorAll("[data-pat]").forEach((b) => (b.onclick = () => call("a2_ref_pattern", { p_game: g.id, p_n: b.dataset.pat === "r" ? null : +b.dataset.pat }).then((r) => { T.a2_game.set(r.id, r); render(true); }).catch(() => {})));
  app.querySelectorAll("[data-fl]").forEach((b) => (b.onclick = () => call("a2_ref_setup", { p_action: b.dataset.fl }).then(() => beep(660, 200)).catch(() => {})));
  app.querySelectorAll("[data-ck]").forEach((b) => (b.onchange = () => call("a2_ref_check", { p_item: b.dataset.ck, p_on: b.checked }).then((r) => { const x = field(1); if (x) x.checks = r; render(true); }).catch(() => render(true))));
  const go = $("go"); if (go) go.onclick = () => { go.disabled = true; call("a2_ref_go", {}).catch(() => {}); };
  const ab = $("absent"); if (ab) ab.onclick = () => { const s = prompt("ทีมที่ไม่มา พิมพ์ red หรือ blue"); if (s === "red" || s === "blue") call("a2_ref_absent", { p_side: s }).catch(() => {}); };
  const ax = $("absentx"); if (ax) ax.onclick = () => call("a2_ref_absent", { p_side: null }).catch(() => {});
  app.querySelectorAll("[data-mk]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.mk, sd = b.dataset.s, live = clockV3(field(1)).phase === "game";
    if (k === "park" && live && summary(g)[sd + "_parked"] === 2) {
      if (await ask(`${sd.toUpperCase()} จอดครบ 3 แท่น`, "Knockout แล้วหยุดเวลาทันที", "Knockout")) mark(g, "complete", sd);
      return;
    }
    mark(g, k, sd);
  }));
  app.querySelectorAll("[data-hold]").forEach((b) => holdBind(b, b.dataset.hold === "complete" ? 500 : 1000, () => {
    if (b.dataset.hold === "complete") mark(g, "complete", b.dataset.s);
    else { Q = Q.filter((i) => !(i.fn === "a2_ref_mark" && i.args.p_game === g.id)); saveQ(); call("a2_ref_false_start", {}).then(() => beep(300, 500)).catch(() => {}); }
  }));
  const u = $("undo"); if (u) u.onclick = () => undo(g);
  const c = $("confirm"); if (c) c.onclick = () => { c.disabled = true; call("a2_ref_confirm", { p_game: g.id }).then((r) => { reviewOk = { held: false, seen: false }; toast(r === "replay" ? "เสมอ แข่งใหม่แบบสนามเดิม" : r === "judge" ? "กรรมการต้องตัดสิน" : r.toUpperCase() + " wins"); afterGame(m.code); }).catch(() => {}); };
  app.querySelectorAll("[data-judge]").forEach((b) => (b.onclick = () => call("a2_ref_judge", { p_game: g.id, p_side: b.dataset.judge }).then(() => { reviewOk = { held: false, seen: false }; afterGame(m.code); }).catch(() => {})));
}
function afterGame(code) { setTimeout(() => { const m = match(code); if (m && m.status === "done") { finished = { code, winner: teamName(m.winner_seed) }; setTimeout(() => { finished = null; render(true); }, 15000); } render(true); }, 600); }
function holdBind(btn, ms, fn) {
  let t = 0; const bar = btn.querySelector("i");
  const stop = () => { clearTimeout(t); if (bar) { bar.style.transition = "none"; bar.style.width = "0"; } };
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); stop(); if (bar) { bar.style.transition = `width ${ms}ms linear`; bar.style.width = "100%"; } t = setTimeout(() => { stop(); fn(); }, ms); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ---------- Clock and sound ----------
let lastSec = null, lastPh = null, _ctEl = null, _rCt = "", _rCl = "", _rPaused = null, _rWarn = null, _rCnt = "";
function tickClock() {
  const f = field(1); if (!f) return; const ck = clockV3(f);
  const ct = $("ct");
  if (ct) {
    if (ct !== _ctEl) { _ctEl = ct; _rCt = _rCl = ""; _rPaused = _rWarn = null; }
    const ctTxt = fmtMs1(ck.ms);
    const clTxt = ck.paused ? "Paused, tap for options" : ck.phase === "setup" || ck.phase === "game" ? PHASE_EN[ck.phase] + ", tap to pause" : PHASE_EN[ck.phase];
    const isPaused = !!ck.paused, isWarn = ck.phase === "game" && ck.ms <= 10000;
    if (ctTxt !== _rCt) { _rCt = ctTxt; ct.textContent = ctTxt; }
    if (clTxt !== _rCl) { _rCl = clTxt; $("cl").textContent = clTxt; }
    if (isPaused !== _rPaused) { _rPaused = isPaused; $("clock").classList.toggle("paused", isPaused); }
    if (isWarn !== _rWarn) { _rWarn = isWarn; $("clock").classList.toggle("warn", isWarn); }
  }
  const cn = $("count");
  if (cn && ck.count) {
    const cntTxt = String(ck.count);
    if (cn.textContent !== cntTxt) { _rCnt = cntTxt; cn.textContent = cntTxt; }
  }
  const sec = ck.phase === "countdown" ? ck.count : ck.phase === "game" ? Math.ceil(ck.ms / 1000) : null;
  const pPh = lastPh, pSec = lastSec; lastPh = ck.phase; lastSec = sec;
  if (ck.phase === "countdown" && sec !== pSec) beep(880, 120);
  if (ck.phase === "game" && pPh === "countdown") beep(1320, 700);
  if (ck.phase === "game" && sec <= 5 && sec > 0 && sec !== pSec) beep(880, 90);
  if (ck.phase === "over" && pPh === "game") beep(440, 900);
  if (pPh === "setup" && ck.phase === "ready") beep(660, 400);
  // Time is up: ask the server to advance now instead of waiting for the 8 s tick
  if (((ck.phase === "setup" && ck.ms <= 0) || (f.phase === "game" && ck.phase === "over")) && Date.now() - (tickClock.t || 0) > 1500) { tickClock.t = Date.now(); rpc("a2_tick").catch(() => {}); }
  if (pPh && ck.phase !== pPh && (ck.phase === "game" || ck.phase === "over")) render(true);
}

// ---------- render ----------
let key = "";
function render(force) {
  const f = field(1), m = f && f.match_code ? match(f.match_code) : null, g = m ? openGame(m.code) : null;
  const ph = f ? clockV3(f).phase : "";
  const k = JSON.stringify([S.ready, event().rules_mode, event().docs_ref, !!pin, ctl, f && [f.match_code, f.phase, f.session, f.checks, f.stop_ms], m && [m.status, m.red_wins, m.blue_wins, m.absent_req, m.red_seed, m.blue_seed], g && [g.id, g.version, g.status, g.need, g.pattern], g && marksOf(g.id).map((x) => x.id + x.voided), Q.length, reviewOk, finished, ph]);
  if (!force && k === key) { paintNet(); return; }
  key = k;
  if (!S.ready) app.innerHTML = `<div class="login"><p class="muted">Loading</p>${netBadge()}</div>`;
  else if (!pin) loginView();
  else if (!m || m.status === "done" || !g) { if (ctl && f && ctl.session !== f.session && f.session) claim(); waitingView(); }
  else if (!ctl || (ctl.control && ctl.session !== f.session)) { claim(); viewOnly(m); }
  else if (!ctl.control) viewOnly(m);
  else if (event().rules_mode === false) simpleView(m, g);
  else matchView(f, m, g);
  paintNet();
}
onChange(() => render());
connect();
raf(tickClock);
setInterval(() => { if (pin && S.ready) rpc("a2_ref_heartbeat", { p_pin: pin, p_device: device }).then((ok) => { if (!ok || (ctl && !ctl.control)) claim(); }).catch(() => {}); }, 10000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && pin) keepAwake(); });
render();

// ---------- Bracket and documents sheet (opened from the top bar icons) ----------
// The bracket starts scaled to fit the screen; + and - zoom in steps and the sheet scrolls. Live updates keep zoom and scroll.
let sheet = "", zoom = 0, bkHtml = "";
const sheetClose = closeX.replace("data-xclose", 'data-sheet=""');
function bracketScale(el) {
  const box = el.querySelector(".sh-b"), bk = el.querySelector("[data-bk]"); if (!box || !bk) return;
  const W = +bk.dataset.w, H = +bk.dataset.h, fit = Math.min((box.clientWidth - 16) / W, (box.clientHeight - 16) / H);
  const k = zoom ? Math.max(fit, Math.min(1.5, zoom)) : fit, st = bk.firstElementChild;
  bk.style.width = W * k + "px"; bk.style.height = H * k + "px"; st.style.transform = `scale(${k})`;
  const z = el.querySelector("[data-zv]"); if (z) z.textContent = Math.round((k / fit) * 100) + "%";
}
function paintBracket(el) {
  const html = bracketHtml({}); if (html === bkHtml && el.querySelector("[data-bk]")) return;
  bkHtml = html; const box = el.querySelector(".sh-b"), x = box.scrollLeft, y = box.scrollTop;
  box.innerHTML = html; bracketScale(el); box.scrollLeft = x; box.scrollTop = y;
}
function paintSheet() {
  let el = $("sheet");
  if (!sheet) { if (el) el.remove(); bkHtml = ""; return; }
  if (!el) { el = document.createElement("div"); el.id = "sheet"; document.body.append(el); }
  if (sheet === "bracket") {
    el.innerHTML = `<div class="sh-h"><b>Bracket</b><span class="zm"><button class="ib dark" data-zoom="-1" aria-label="Zoom out">−</button><span data-zv>100%</span><button class="ib dark" data-zoom="1" aria-label="Zoom in">+</button></span>${sheetClose}</div><div class="sh-b bkbox"></div>`;
    bkHtml = ""; paintBracket(el);
  } else {
    el.innerHTML = `<div class="sh-h"><b>Rules and FAQ</b>${sheetClose}</div><div class="sh-b" id="shdocs"><p class="muted">Loading</p></div>`;
    listDocs({ p_pin: pin }).then((d) => { const b = $("shdocs"); if (b) b.innerHTML = docRows(d, false); }).catch((e) => { const b = $("shdocs"); if (b) b.innerHTML = `<p class="err">${esc(e.message)}</p>`; });
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sheet]"); if (b) { sheet = b.dataset.sheet; zoom = 0; paintSheet(); return; }
  const z = e.target.closest("[data-zoom]");
  if (z) { const el = $("sheet"), bk = el.querySelector("[data-bk]"), cur = parseFloat(bk.firstElementChild.style.transform.slice(6)) || 1; zoom = cur * (z.dataset.zoom === "1" ? 1.25 : 0.8); bracketScale(el); return; }
  const d = e.target.closest("[data-doc]"); if (d) showDoc(+d.dataset.doc, { p_pin: pin }, d.dataset.t);
});
// Keep the bracket current while it is open, and close the documents sheet if the admin turns it off
onChange(() => { const el = $("sheet"); if (el && sheet === "bracket") paintBracket(el); if (sheet === "docs" && event().docs_ref === false) { sheet = ""; paintSheet(); } });
addEventListener("resize", () => { const el = $("sheet"); if (el && sheet === "bracket") bracketScale(el); });

// ---------- Choice popup and tap-the-clock control ----------
// opts: [[key, label, primary?], ...]. Resolves with the key, or "" when cancelled
function choose(title, text, opts) {
  return new Promise((done) => {
    const d = document.createElement("div"); d.className = "pop ask";
    d.innerHTML = `<div class="ask-card"><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="ask-btns">${opts.map(([k, l, pr]) => `<button class="btn big${pr === "danger" ? " danger" : pr ? " primary" : ""}" data-a="${k}">${esc(l)}</button>`).join("")}<button class="btn big" data-a="">ยกเลิก</button></div></div>`;
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (!b && e.target !== d) return; d.remove(); done(b ? b.dataset.a : ""); });
    document.body.append(d);
  });
}
const ask = async (title, text, okLabel) => (await choose(title, text, [["1", okLabel || "ยืนยัน", true]])) === "1";
const clockAct = (a) => call("a2_ref_clock", { p_action: a }).then(() => beep(a === "resume" ? 990 : 440, 300)).catch(() => {});
document.addEventListener("click", async (e) => {
  if (!e.target.closest("[data-stop]") || !pin || !ctl?.control) return;
  const ck = clockV3(field(1));
  if (ck.phase === "setup" && !ck.paused) { if (await ask("หยุดเวลา Setup", "หยุดนับเวลา Setup ไว้ก่อน", "หยุดเวลา")) clockAct("pause"); }
  else if (ck.phase === "setup") {
    const k = await choose("Setup หยุดอยู่", "เล่นต่อจากเวลาที่เหลือ หรือข้ามไปขั้น Ready", [["resume", "เล่นต่อ", true], ["skip", "ข้าม Setup"]]);
    if (k === "resume") clockAct("resume"); else if (k === "skip") call("a2_ref_setup", { p_action: "skip" }).catch(() => {});
  }
  else if (ck.phase === "game" && !ck.paused) { if (await ask("หยุดเวลาเกม", "หยุดเวลาไว้ก่อน กดเวลาอีกครั้งเพื่อเล่นต่อหรือจบเกม", "หยุดเวลา")) clockAct("pause"); }
  else if (ck.phase === "game") {
    const k = await choose("เกมหยุดอยู่", "เล่นต่อจากเวลาที่เหลือ หรือจบเกมตอนนี้ (จบแล้วย้อนไม่ได้ ตัดสินตามข้อ 6.2 ถึง 6.4)", [["resume", "เล่นต่อ", true], ["end", "จบเกม", "danger"]]);
    if (k) clockAct(k);
  }
});
document.addEventListener("click", (e) => { if (e.target.closest("[data-fs]")) toggleFs()?.catch?.(() => {}); });
