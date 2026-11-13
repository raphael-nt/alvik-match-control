import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { PANELS, STAGE, DEFAULT_LIVE, liveLayout } from "../shared/layout.js";
import { listDocs, showDoc, fileToB64, docRows } from "../shared/docs.js";
import { build as buildFormat, validate as validateFormat, defaults as fmtDefaults, STAGE_EN } from "../shared/format.js";
import { useMarks, marksOf, clockV3, fmtMs1, PHASE_EN, decideV3, RULE_EN, RULE_TH, field, connect, fsSupported, toggleFs, FS_ICON, onChange, event, matches, groups, loadAll, match, gamesOf, openGame, gameNo, sideName, teamName, teamsArr, tableOf, fmtMs, parseMs, fmtTime, esc, $, now, rpc, toast, netBadge, raf, paintNet, S, T, STATUS_TH, METHOD_TH, previewDecide, REASON_TH, sb } from "../shared/common.js";

useMarks();
const fields = () => [field(1)].filter(Boolean);   // v3 single field
const app = $("app"), dlg = $("dlg");
const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} return null; };
const lstore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
let pw = store("a2pw") || "", authed = false, started = false, hasSetup = null;
let tab = lstore("a2tab") || "home";
const TABS = [["home", "Overview"], ["queue", "Queue"], ["schedule", "Schedule"], ["groups", "Standings"], ["matches", "Matches"], ["teams", "Teams"], ["tv", "Dashboard"], ["settings", "Settings"], ["log", "Log"]];
const ROUND = STAGE_EN;
const ST_EN = { locked: "Locked", ready: "Ready", queued: "On field", live: "Live", done: "Finished" };

// ---------- Admin RPC ----------
async function adm(name, args) {
  try { return await rpc(name, { p_pw: pw, ...args }); }
  catch (e) { if (e.code === "forbidden") { logout(true); } throw e; }
}
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r; }
  catch (e) { toast(e.message || "ทำรายการไม่สำเร็จ", true); return undefined; }
}
function logout(expired) { pw = ""; authed = false; store("a2pw", null); if (expired) toast("รหัสผ่านไม่ถูกต้องหรือถูกเปลี่ยนแล้ว", true); drawLogin(); }

// ---------- Sign in and first-time setup ----------
async function drawLogin() {
  if (hasSetup === null) { try { hasSetup = await rpc("a2_has_setup"); } catch (e) { hasSetup = true; } }
  const first = !hasSetup;
  app.innerHTML = `<form class="login" id="lf"><img src="../shared/irap.png" alt="" style="height:44px;justify-self:start">
    <h1>${first ? "ตั้งรหัสผ่านครั้งแรก" : "เข้าสู่หน้าแอดมิน"}</h1>
    ${first ? `<p class="muted">ตั้งรหัสผ่านแอดมินและ PIN ของกรรมการ ทำได้ครั้งเดียว ให้ผู้จัดงานเป็นคนตั้งเอง</p>` : ""}
    <label>รหัสผ่านแอดมิน<input id="pw" type="password" autocomplete="${first ? "new-password" : "current-password"}" required minlength="${first ? 6 : 1}"></label>
    ${first ? `<label>PIN กรรมการ (ตัวเลข 4 ถึง 8 หลัก)<input id="pin" inputmode="numeric" pattern="[0-9]{4,8}" required></label>` : ""}
    <button class="btn primary" type="submit">${first ? "ตั้งค่าและเข้าสู่ระบบ" : "เข้าสู่ระบบ"}</button><div class="warn" id="le" hidden></div></form>`;
  $("lf").onsubmit = async (e) => {
    e.preventDefault(); const v = $("pw").value, le = $("le"); le.hidden = true;
    try {
      if (first) { await rpc("a2_setup", { p_pw: v, p_pin: $("pin").value }); hasSetup = true; }
      const ok = await rpc("a2_admin_login", { p_pw: v });
      if (!ok) throw new Error("รหัสผ่านไม่ถูกต้อง");
      pw = v; store("a2pw", v); start();
    } catch (er) { le.textContent = er.message; le.hidden = false; }
  };
  $("pw").focus();
}
async function start() {
  authed = true;
  if (!started) { started = true; connect(); onChange(render); raf(clocks); }
  shell(); render();
}
async function boot() {
  if (pw) { try { if (await rpc("a2_admin_login", { p_pw: pw })) return start(); } catch (e) {} pw = ""; store("a2pw", null); }
  drawLogin();
}

// ---------- Shell ----------
function shell() {
  app.innerHTML = `<div class="top"><img src="../shared/irap.png" alt=""><b id="evn"></b><span class="sp"></span>${netBadge()}${fsSupported() ? `<button class="btn small fsb" id="fsb" aria-label="Full screen" title="Full screen">${FS_ICON}</button>` : ""}<button class="btn small" id="lo">Sign out</button></div>
    <nav class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${k === tab ? "on" : ""}">${t}</button>`).join("")}</nav><div class="main" id="mn"></div>`;
  $("lo").onclick = () => logout(false);
  const fb = $("fsb"); if (fb) fb.onclick = () => toggleFs()?.catch?.(() => {});
  app.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; lstore("a2tab", tab); app.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b)); lastKey = ""; formTab = ""; render(true); };
  paintNet();
}

// ---------- Render ----------
let lastKey = "", formTab = "";
if (!TABS.some((t) => t[0] === tab)) tab = "home";
const FORM_TABS = ["schedule", "teams", "settings", "tv"];   // tabs with inputs, redrawn only on tab switch or after save
function render(force) {
  if (!authed || !S.ready) { if (authed) { const mn = $("mn"); if (mn && !mn.innerHTML) mn.innerHTML = `<p class="muted">กำลังโหลดข้อมูล</p>`; } return; }
  const ev = event(); const en = $("evn"); if (en && en.textContent !== ev.name) en.textContent = ev.name || "Alvik";
  paintNet();
  if (FORM_TABS.includes(tab)) { if (formTab !== tab || force === "again") { formTab = tab; $("mn").innerHTML = VIEW[tab](); afterForm(); if (tab === "tv") paintLay(); } updateDlgBanner(); return; }
  const k = tab + JSON.stringify([ev, [...T.a2_team.values()].map((t) => [t.name, t.absent]), matches().map((m) => [m.code, m.status, m.red_wins, m.blue_wins, m.red_seed, m.blue_seed, m.field_no, m.sched_at, m.auto_open, m.walkover, m.forfeit, m.absent_req]), fields().map((f) => [f.no, f.match_code, f.phase, f.checks, f.stop_ms, f.ref_seen && Math.floor(Date.parse(f.ref_seen) / 10000)]), [...T.a2_game.values()].map((g) => [g.id, g.version]), T.a2_mark.size, S.standings, [...T.a2_tiebreak.values()], tab === "log" ? logRows.length : 0]);
  if (k === lastKey) { updateDlgBanner(); return; }
  lastKey = k; $("mn").innerHTML = VIEW[tab](); fitBrackets($("mn")); if (tab === "tv") paintLay(); updateDlgBanner();
}
const redraw = () => { lastKey = ""; formTab = ""; render(); };

// ---------- Overview tab ----------
const upNext = () => matches().filter((m) => m.status === "ready" && m.field_no == null).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no);
const refOnline = (f) => f && f.ref_seen && Date.now() - Date.parse(f.ref_seen) < 30000;
function clockBox(f) {
  const m = f && f.match_code ? match(f.match_code) : null;
  if (!m) return `<div class="ck empty"><div class="ckh"><b>Field</b><span>Empty</span></div><div class="ckt" data-clk>1:30.0</div></div>`;
  const g = openGame(m.code);
  return `<div class="ck st-${m.status}"><div class="ckh"><b>${m.code}</b><span>${g ? "Game " + gameNo(m.code, g) + " of " + m.bo : ""}${g?.pattern ? " · Pattern " + g.pattern : ""}</span><span class="dot${refOnline(f) ? " on" : ""}" title="Referee ${refOnline(f) ? "online" : "offline"}"></span></div>
    <div class="ckv"><span class="r">${esc(sideName(m, "red"))}</span><b>${m.red_wins}-${m.blue_wins}</b><span class="b">${esc(sideName(m, "blue"))}</span></div>
    <div class="ckt" data-clk>1:30.0</div><div class="ckp muted" data-ph></div></div>`;
}
function homeView() {
  const rq = upNext().slice(0, 6).map((m) => `<div class="rq"><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span class="muted">${m.sched_at ? fmtTime(m.sched_at) + (m.auto_open ? " auto" : "") : ""}</span><span></span><button class="btn small primary" data-act="open" data-c="${m.code}">Call</button></div>`).join("") || `<p class="muted">ยังไม่มีคู่ที่พร้อม</p>`;
  return `<div class="home"><div class="card hbk">${bracketHtml({ clickable: true })}</div>
    <div class="hbot"><div class="card"><div class="h2"><h2>Up next</h2><span>กดชิปคู่ในตารางสายเพื่อดูหรือแก้ผล</span></div>${rq}</div><div>${clockBox(field(1))}</div></div></div>`;
}

// ---------- Queue tab (single queue, single field) ----------
function flowBtns(f) {
  const b = (a, t, c = "") => `<button class="btn ${c}" data-act="timer" data-a="${a}">${t}</button>`;
  const ph = f.phase;
  if (ph === "idle") return b("setup_start", "Start setup", "primary") + b("setup_skip", "Skip setup");
  if (ph === "setup") return b("setup_skip", "Skip setup");
  if (ph === "ready") return b("go", "Start (3 2 1)", "primary");
  if (ph === "countdown" || ph === "game") return b("false_start", "False start", "danger");
  return "";
}
function queueView() {
  const f = field(1), m = f && f.match_code ? match(f.match_code) : null, nx = upNext();
  let card;
  if (!m) card = `<div class="card fc"><div class="h2"><h2>On field</h2><span>Empty</span></div>
    ${nx.length ? `<button class="btn primary big" data-act="open" data-c="${nx[0].code}">Call next match  ${nx[0].code}  ${esc(sideName(nx[0], "red"))} vs ${esc(sideName(nx[0], "blue"))}</button>` : `<p class="muted">ไม่มีคู่ที่พร้อม</p>`}</div>`;
  else {
    const g = openGame(m.code), done = m.status === "done", c = f.checks || {};
    card = `<div class="card fc st-${m.status}"><div class="h2"><h2>On field  ${m.code}</h2><span class="pill ${m.status}">${ST_EN[m.status]}</span><span>Referee ${refOnline(f) ? "online" : "offline"}</span></div>
      <div class="vs"><span>${ROUND[m.stage]}${m.grp ? " Group " + m.grp : ""}</span><span class="r">${esc(sideName(m, "red"))}</span><span class="sc">${m.red_wins} - ${m.blue_wins}</span><span class="b">${esc(sideName(m, "blue"))}</span></div>
      <div class="muted">${done ? "Match finished · ผู้ชนะ " + esc(teamName(m.winner_seed)) : (g ? "Game " + gameNo(m.code, g) + " of " + m.bo : "") + (g?.pattern ? " · Pattern " + g.pattern : " · ยังไม่เลือกแบบสนาม")}${!done && ["setup", "ready"].includes(f.phase) ? ` · Checklist ${["red_in", "blue_in", "stands"].filter((k) => c[k]).length}/3` : ""}</div>
      ${m.absent_req ? `<div class="warn">กรรมการขอแพ้บายฝั่ง ${m.absent_req.toUpperCase()} (${esc(sideName(m, m.absent_req))}) <button class="btn small danger" data-act="approve" data-c="${m.code}" data-s="${m.absent_req}">Approve</button> <button class="btn small" data-act="reject" data-c="${m.code}">Reject</button></div>` : ""}
      <div class="t" data-clk>1:30.0</div><div class="muted" data-ph></div>
      <div class="btns">${done ? (nx.length ? `<button class="btn primary" data-act="open" data-c="${nx[0].code}">Call next match ${nx[0].code}</button>` : "") : flowBtns(f)}
        <button class="btn" data-act="edit" data-c="${m.code}">Event log</button><button class="btn" data-act="transfer">Transfer referee</button><button class="btn danger" data-act="close" data-c="${m.code}">Clear field</button></div>
      <p class="muted" style="margin:6px 0 0">ปุ่ม Start ของแอดมินข้าม Checklist ได้ ใช้เมื่อเครื่องกรรมการมีปัญหา</p></div>`;
  }
  const rows = matches().map((x) => `<tr class="${f && f.match_code === x.code ? "sel" : ""}"><td><b>${x.code}</b></td><td>${esc(sideName(x, "red"))} vs ${esc(sideName(x, "blue"))}</td><td class="num">${x.status === "locked" ? "" : x.red_wins + "-" + x.blue_wins}</td><td><span class="pill ${x.status}">${ST_EN[x.status]}</span></td><td class="muted">${x.sched_at ? fmtTime(x.sched_at) + (x.auto_open ? " auto" : "") : ""}</td>
    <td>${x.status === "ready" && x.field_no == null ? `<button class="btn small primary" data-act="open" data-c="${x.code}">Call</button>` : ""} <button class="btn small" data-act="edit" data-c="${x.code}">Open</button></td></tr>`).join("");
  return `<div class="cols"><div class="stack">${card}</div><div><div class="h2"><h2>Order</h2><span>เรียกได้ทีละคู่ คู่บนสนามต้องจบหรือถูกเอาลงก่อน</span></div><div class="tw"><table class="tbl"><thead><tr><th>Match</th><th>Teams</th><th class="num">Score</th><th>Status</th><th>Time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
}

// ---------- Schedule tab ----------
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hm = (iso) => iso ? fmtTime(iso) : "";
function scheduleView() {
  const nf = 1, first = matches().find((m) => m.sched_at);
  const day = first ? (() => { const d = new Date(first.sched_at); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })() : todayStr();
  return `<div class="h2"><h2>Schedule</h2><span>ระบบเปิดคิวให้เองเมื่อถึงเวลา โดยต้องรู้ผู้เล่นครบและสนามว่าง ยังเปิดก่อนเวลาเองได้เสมอ</span></div>
   <div class="card" style="margin-bottom:14px"><div class="form" style="max-width:none"><div class="gf" style="grid-template-columns:repeat(5,minmax(0,1fr))">
     <label>วันแข่ง<input type="date" id="sd" value="${day}"></label><label>เวลาเริ่มคู่แรก<input type="time" id="s0" value="09:00"></label>
     <label>ห่างกันรอบละ (นาที)<input type="number" id="si" min="1" value="12"></label><label>เปิดอัตโนมัติ<select id="sa"><option value="1">เปิด</option><option value="0">ปิด</option></select></label>
     <button class="btn primary" data-act="autofill" style="align-self:end">Auto fill</button></div>
     <p class="muted" style="margin:0">เติมตามลำดับคู่ คู่ละช่วงเวลา จากนั้นแก้รายคู่ได้ แล้วกดบันทึก</p></div></div>
   <div class="tw"><table class="tbl"><thead><tr><th>Match</th><th>Teams</th><th>Time</th><th>Auto call</th><th></th></tr></thead><tbody>${matches().map((m) => `<tr data-sc="${m.code}"><td><b>${m.code}</b></td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td>
     <td>${m.status === "done" ? `<span class="muted">${hm(m.sched_at)} จบแล้ว</span>` : `<input type="time" data-k="at" value="${hm(m.sched_at)}">`}</td>
     <td>${m.status === "done" ? "" : `<input type="checkbox" data-k="auto" ${m.auto_open ? "checked" : ""} aria-label="เปิดอัตโนมัติ ${m.code}">`}</td><td>${m.sched_at && m.status !== "done" ? `<button class="btn small" data-act="clearsc">ล้าง</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
   <div class="btns"><button class="btn primary" data-act="savesc">Save schedule</button></div>`;
}
function readSchedule() {
  const day = $("sd")?.value || todayStr(), out = [];
  document.querySelectorAll("tr[data-sc]").forEach((tr) => {
    const code = tr.dataset.sc, m = match(code); if (m.status === "done") return;
    const t = tr.querySelector('[data-k="at"]').value, a = tr.querySelector('[data-k="auto"]').checked;
    out.push({ code, at: t ? new Date(day + "T" + t + ":00").toISOString() : null, auto: !!(t && a) });
  });
  return out;
}
function autofill() {
  const day = $("sd").value || todayStr(), t0 = $("s0").value, iv = Math.max(1, +$("si").value || 12), nf = 1, auto = $("sa").value === "1";
  if (!t0) return toast("ใส่เวลาเริ่มคู่แรกก่อน", true);
  const base = new Date(day + "T" + t0 + ":00").getTime(); let i = 0;
  document.querySelectorAll("tr[data-sc]").forEach((tr) => {
    if (!["locked", "ready"].includes(match(tr.dataset.sc).status)) return;
    const slot = Math.floor(i / nf), d = new Date(base + slot * iv * 60000); i++;
    tr.querySelector('[data-k="at"]').value = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    tr.querySelector('[data-k="auto"]').checked = auto;
  });
  toast("เติมแล้ว ตรวจสอบแล้วกดบันทึก");
}

// ---------- Standings tab ----------
function groupsView() {
  const n = groups().length || 1, cols = innerWidth < 760 ? 1 : n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  return `<div class="grid5 stand" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${groups().map((gr) => { const G = gr.grp;
    const rows = tableOf(G), tiedAny = rows.some((r) => r.tied), seeds = rows.filter((r) => r.seed != null).map((r) => r.seed), tb = T.a2_tiebreak.get(G);
    return `<div><div class="h2"><h2>Group ${G}</h2><span>${ROUND[gr.stage] || ""} · top ${gr.adv} advance</span></div>
      <div class="tw"><table class="tbl"><thead><tr><th>#</th><th>Team</th><th class="num">W-L</th><th class="num">Games</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.tied ? "tied" : ""}"><td>${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) : "รอผล"}${r.how ? `<div class="muted" style="font-size:13px">${esc(r.how)}</div>` : ""}</td><td class="num">${r.mw}-${r.ml}</td><td class="num">${r.gw}-${r.gl}</td>
        <td>${r.tied && i > 0 && rows[i - 1].tied && r.seed != null ? `<button class="btn small" data-act="tbup" data-g="${G}" data-s="${r.seed}">ขึ้น</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${tiedAny ? `<div class="warn">มีทีมเสมอกันทุกเกณฑ์ กดขึ้นเพื่อให้ทีมนั้นอยู่เหนือทีมข้างบน</div>` : ""}${tb ? `<div class="btns"><button class="btn small" data-act="tbclear" data-g="${G}">ล้างการตัดสินลำดับ</button></div>` : ""}</div>`;
  }).join("")}</div>`;
}

// ---------- Matches tab ----------
const matchesView = () => `<div class="h2"><h2>Matches</h2><span>แก้ผลรายเกมได้ทุกคู่ แม้จบแล้ว ระบบคำนวณอันดับและผู้ชนะใหม่ให้เอง</span></div>
  <div class="tw"><table class="tbl"><thead><tr><th>Match</th><th>Round</th><th>Teams</th><th class="num">Score</th><th>Status</th><th></th></tr></thead><tbody>${matches().map((m) => `<tr><td><b>${m.code}</b></td><td>${ROUND[m.stage]}${m.grp ? " สาย " + m.grp : ""} Bo${m.bo}</td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td><td class="num">${m.red_wins}-${m.blue_wins}</td><td><span class="pill ${m.status}">${ST_EN[m.status]}</span></td><td><button class="btn small" data-act="edit" data-c="${m.code}">Open</button></td></tr>`).join("")}</tbody></table></div>`;

// ---------- Match dialog ----------
let dlgCode = "", dlgSig = "";
const sigOf = (c) => JSON.stringify([match(c), gamesOf(c), gamesOf(c).map((g) => marksOf(g.id).map((x) => x.id + x.voided + x.t_ms))]);
const KIND = { exit_first: "Left red box first", lift_first: "First lift", park: "Stand parked +1", unpark: "Stand parked -1", complete: "Mission complete", retry: "Retry", false_start: "False start" };
const GST = { ready: "Not started", live: "Live", review: "Review", done: "Done", replay: "Tie, replayed", void: "Void" };
function gameBlock(m, g) {
  const n = gameNo(m.code, g), pv = g.need === "judge" ? { need: "judge" } : decideV3(g), mk = marksOf(g.id);
  const res = g.winner ? `${g.winner.toUpperCase()} wins · ${RULE_EN[g.method] || g.method || ""}${g.decided_by === "admin" ? " (admin)" : ""}` : pv.side ? `ถ้ารับรองตอนนี้ ${pv.side.toUpperCase()} ชนะ · ${RULE_EN[pv.method]}` : pv.need === "replay" ? "เสมอ แข่งใหม่ (FAQ 34)" : "กรรมการต้องตัดสิน (FAQ 35)";
  const row = (x) => `<tr class="${x.voided ? "void" : ""}" data-mid="${x.id}"><td class="num mono">${fmtMs1(x.t_ms)}</td><td>${KIND[x.kind] || x.kind}</td><td class="${x.side === "red" ? "r" : x.side === "blue" ? "b" : ""}">${x.side ? (x.side === "both" ? "Same time" : x.side.toUpperCase()) : ""}</td><td class="muted">${x.source}${x.voided ? " · void" : ""}</td>
    <td>${x.kind === "false_start" ? "" : x.voided ? `<button class="btn small" data-act="mk" data-op="unvoid">Restore</button>` : `<button class="btn small" data-act="mkedit">Edit time</button> <button class="btn small danger" data-act="mk" data-op="void">Delete</button>`}</td></tr>`;
  return `<div class="card st-${g.status === "done" ? "done" : g.status === "live" ? "live" : "ready"}" data-g="${g.id}" data-v="${g.version}"><div class="h2"><h2>Game ${g.status === "replay" ? "(replayed)" : n}</h2><span class="pill">${GST[g.status] || g.status}</span><span>${esc(res)}</span></div>
    <div class="muted">Pattern ${g.pattern || "-"} · Stands RED ${g.red_parked} BLUE ${g.blue_parked} · Retry R${g.red_retries || 0} B${g.blue_retries || 0}</div>
    <div class="tw"><table class="tbl evl"><thead><tr><th class="num">Time</th><th>Event</th><th>Side</th><th>Source</th><th></th></tr></thead><tbody>${mk.map(row).join("") || `<tr><td colspan="5" class="muted">ยังไม่มีเหตุการณ์</td></tr>`}</tbody></table></div>
    <div class="gf" style="grid-template-columns:repeat(4,minmax(0,1fr))"><label>Event<select data-n="kind">${Object.entries(KIND).filter(([k]) => k !== "false_start").map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
      <label>Side<select data-n="side"><option value="red">RED</option><option value="blue">BLUE</option><option value="both">Same time</option></select></label>
      <label>Time (m:ss.s)<input data-n="t" placeholder="0:12.5"></label><button class="btn" data-act="mkadd">Add event</button></div>
    <div class="btns"><label class="muted">Pattern <select data-k="pattern"><option value="">-</option>${[1, 2, 3].map((i) => `<option ${g.pattern === i ? "selected" : ""}>${i}</option>`).join("")}</select></label><button class="btn" data-act="gsave">Save pattern</button>
      ${g.status === "review" || g.status === "done" ? `<button class="btn primary" data-act="gauto">Decide by rules</button>` : ""}
      <button class="btn red" data-act="gwin" data-w="red">RED wins</button><button class="btn blue" data-act="gwin" data-w="blue">BLUE wins</button>
      ${g.winner ? `<button class="btn" data-act="gwin" data-w="">Clear winner</button>` : ""}<button class="btn danger" data-act="gvoid">Void game</button></div></div>`;
}
const parseT = (v) => { v = String(v || "").trim(); if (!v) return 0; const m = v.match(/^(\d+):(\d{1,2})(?:\.(\d))?$/); if (m) return (+m[1] * 60 + +m[2]) * 1000 + (+m[3] || 0) * 100; if (/^\d+(\.\d)?$/.test(v)) return Math.round(+v * 1000); return NaN; };
function dlgHtml(code) {
  const m = match(code), gs = gamesOf(code), free = !field(1)?.match_code || match(field(1).match_code)?.status === "done";
  dlgSig = sigOf(code);
  return `<div class="dh"><h2>คู่ ${m.code}  ${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}  <span class="muted">${m.red_wins}-${m.blue_wins}</span></h2><span class="pill ${m.status}">${ST_EN[m.status]}</span><button class="btn" data-act="dclose">Close</button></div>
   <div class="db">${m.walkover ? `<div class="warn">ชนะบาย ${esc(sideName(m, m.walkover === "red" ? "blue" : "red"))} ชนะ เพราะ ${esc(sideName(m, m.walkover))} ไม่มา ${m.forfeit ? "" : "(ตั้งทีมนี้เป็นไม่มาไว้ในแท็บทีม)"}</div>` : ""}<div class="warn" id="dwarn" hidden>ข้อมูลคู่นี้เพิ่งเปลี่ยนจากที่อื่น <button class="btn small" data-act="dreload">โหลดใหม่</button> </div>
   ${gs.length ? gs.map((g) => gameBlock(m, g)).join("") : `<p class="muted">ยังไม่มีเกมในคู่นี้ ${m.status === "locked" ? "คู่นี้ยังรอผลคู่ก่อนหน้า" : "เกมแรกจะถูกสร้างตอนเปิดคิว หรือกดเพิ่มเกมด้านล่าง"}</p>`}
   <div class="btns"><button class="btn" data-act="gadd" ${m.status === "locked" ? "disabled" : ""}>Add game</button>${!gs.length && m.status !== "done" ? `<button class="btn" data-act="swap">Swap sides</button>` : ""}
   ${(m.red_seed != null && m.blue_seed != null && m.status !== "done") || m.forfeit ? ["red", "blue"].map((sd) => `<button class="btn danger" data-act="ff" data-s="${sd}">${esc(sideName(m, sd))} absent (forfeit)</button>`).join("") : ""}${m.forfeit ? `<button class="btn" data-act="ff" data-s="">Cancel forfeit</button>` : ""}
   ${m.status === "ready" && free ? `<button class="btn primary" data-act="open" data-c="${m.code}" data-keep="1">Call to field</button>` : ""}</div></div>`;
}
function openDlg(code) { dlgCode = code; dlg.innerHTML = dlgHtml(code); if (!dlg.open) dlg.showModal(); }
function updateDlgBanner() { if (!dlg.open || !dlgCode) return; const w = $("dwarn"); if (w) w.hidden = sigOf(dlgCode) === dlgSig; }
dlg.addEventListener("close", () => { dlgCode = ""; });
function readGame(card) { const v = card.querySelector('[data-k="pattern"]').value; return { pattern: v ? +v : null }; }

// ---------- Teams tab ----------
const curFormat = () => ({ ...fmtDefaults(), ...(event().format || {}) });
const FMT_FIELDS = [["groups", "Groups", 1, 8], ["size", "Teams per group", 2, 8], ["advance", "Advance per group", 1, 8]];
function readFormat() { const f = {}; FMT_FIELDS.forEach(([k]) => (f[k] = +$("f_" + k).value)); ["bo_group", "bo_ko", "bo_final"].forEach((k) => (f[k] = +$("f_" + k).value)); return f; }
function fmtSummary(f) {
  const err = validateFormat(f); if (err.length) return `<div class="warn">${err.map(esc).join("<br>")}</div>`;
  const b = buildFormat(f), ko = b.matches.filter((m) => !m.grp), st = [...new Set(ko.map((m) => STAGE_EN[m.stage]))];
  return `<p class="muted" style="margin:6px 0 0">${b.format.teams} teams · ${b.matches.length - ko.length} group matches${ko.length ? ` · knockout ${ko.length} matches (${st.join(", ")})` : " · no knockout, group winner is champion"}</p>`;
}
function teamsView() {
  const t = teamsArr(), draw = event().tv_mode === "draw", f = curFormat(), played = [...T.a2_game.values()].some((g) => g.status !== "void");
  const num = (k, label, a, z) => `<label>${label}<input id="f_${k}" type="number" min="${a}" max="${z}" value="${f[k]}" data-fmt></label>`;
  const bo = (k, label) => `<label>${label}<select id="f_${k}" data-fmt>${[1, 3, 5, 7].map((n) => `<option value="${n}" ${f[k] === n ? "selected" : ""}>Bo${n}</option>`).join("")}</select></label>`;
  const r1 = groups().filter((g) => g.stage === "r1");
  return `<div class="h2"><h2>Format</h2><span>ตั้งจำนวนสายและทีม แล้วกด Apply ระบบสร้างคู่ในสาย สายแพ้คัดออก และตารางสายให้เอง</span></div>
   <div class="card"><div class="gf" style="grid-template-columns:repeat(6,minmax(0,1fr))">${FMT_FIELDS.map(([k, l, a, z]) => num(k, l, a, z)).join("")}${bo("bo_group", "Group Bo")}${bo("bo_ko", "Knockout Bo")}${bo("bo_final", "Final Bo")}</div>
     <div id="fsum">${fmtSummary(f)}</div>
     <div class="btns"><button class="btn primary" data-act="fmtapply" ${played ? "disabled" : ""}>Apply format</button>${played ? `<span class="muted">มีผลการแข่งแล้ว ต้อง Reset ในแท็บ Settings ก่อนเปลี่ยนรูปแบบ</span>` : `<span class="muted">Apply จะสร้างคู่ใหม่ทั้งหมด เวลานัดเดิมจะหาย ชื่อทีมยังอยู่</span>`}</div></div>
   <div class="h2" style="margin-top:20px"><h2>Teams</h2><span>เลขหน้าชื่อคือลำดับ ทีมอยู่สายตามตำแหน่ง ใช้ Shuffle เพื่อจับสาย</span></div>
   <div class="teams">${r1.map((g) => `<div class="card grp"><h2>Group ${g.grp}</h2>${g.srcs.map((x) => { const sd = x.seed, tm = t.find((y) => y.seed === sd); return `<div><span class="muted">${sd}</span><input data-seed="${sd}" value="${esc(tm?.name || "")}" placeholder="Team ${sd}" maxlength="40"><label class="ab"><input type="checkbox" data-abs="${sd}" ${tm?.absent ? "checked" : ""}>Absent</label></div>`; }).join("")}</div>`).join("")}</div>
   <div class="btns"><button class="btn primary" data-act="saveteams">Save teams</button><button class="btn" data-act="shuffle">Shuffle</button></div>
   <div class="h2" style="margin-top:24px"><h2>Draw on Dashboard</h2><span>${draw ? "Dashboard อยู่ในโหมด Draw" : "บันทึกชื่อทีมก่อน แล้วกดเริ่ม Dashboard จะเผยชื่อทีมทีละทีม"}</span></div>
   <div class="btns"><button class="btn primary" data-act="drawstart">Start draw</button><button class="btn" data-act="tvauto">Back to Auto</button></div>`;
}

// ---------- Dashboard tab ----------
function tvView() {
  lay = liveLayout(event().dash_layout?.live);
  const ev = event(), M = [["auto", "Auto", "มีคู่บนสนามใช้ Live ไม่มีใช้ Bracket จบคู่ชิงขึ้น Champion เอง"], ["live", "Live", "นาฬิกาใหญ่ รอบที่แข่ง และตารางสายย่อ"], ["bracket", "Bracket", "ตารางสายเต็มจอ พร้อม Up next"], ["standings", "Standings", "ตารางคะแนนทุกสาย"], ["schedule", "Schedule", "ลำดับคู่ เวลานัด สถานะ"], ["draw", "Draw", "เผยชื่อทีมทีละทีม"], ["champion", "Champion", "ใช้ได้เมื่อจบคู่ชิง"]];
  return `<div class="h2"><h2>Dashboard mode</h2><span>เปลี่ยนแล้วจอเปลี่ยนตามทันที ปกติใช้ Auto</span></div>
   <div class="grid5">${M.map(([k, t, d]) => `<div class="card ${ev.tv_mode === k ? "st-ready" : ""}"><h2>${t}${ev.tv_mode === k ? ` <span class="pill ready">On</span>` : ""}</h2><p class="muted">${d}</p><button class="btn ${ev.tv_mode === k ? "" : "primary"}" data-act="tvmode" data-m="${k}" ${ev.tv_mode === k ? "disabled" : ""}>Use</button></div>`).join("")}</div>
   <div class="h2" style="margin-top:22px"><h2>Live layout</h2><span>ลากเพื่อย้าย ลากมุมขวาล่างเพื่อลดขยาย ติ๊กเพื่อซ่อนหรือแสดง แล้วกด Save layout</span></div>
   <div class="card"><div class="layc">${PANELS.map(([k, t]) => `<label class="chk2"><input type="checkbox" data-layon="${k}" ${lay[k].on ? "checked" : ""}>${t}</label>`).join("")}</div>
     <div class="lay" id="lay"></div>
     <div class="btns"><button class="btn primary" data-act="laysave">Save layout</button><button class="btn" data-act="layundo">Undo changes</button><button class="btn" data-act="layreset">Reset to default</button><a class="btn" href="../dashboard/" target="_blank" rel="noopener">Open Dashboard</a></div></div>`;
}
// ---------- Live layout editor ----------
let lay = null, drag = null;
const LAB = Object.fromEntries(PANELS);
// Sample content per panel so the editor shows what the Live screen will contain (follows rules mode)
function layMock(k) {
  const rules = event().rules_mode !== false;
  const tm = (s, n) => `<div class="mk-t ${s === "red" ? "side-r" : "side-b"}"><div class="n">${n}</div></div>`;
  return {
    info: `<div class="mk-i"><span>Group stage</span><span>Group <b>A</b></span><span>Match <b>A1</b></span><span>Game <b>1 of 3</b></span>${rules ? `<span>Pattern <b>2</b></span>` : ""}</div>`,
    red: tm("red", "Sample Team A"), blue: tm("blue", "Sample Team B"),
    clock: `<div class="mk-c">${rules ? `<div class="t">1:30.0</div><div class="p">Running</div>` : `<div class="t">1-0</div><div class="p">Game 1 of 3</div>`}</div>`,
    bracket: `<div class="mk-b">${bracketHtml({ dark: true, compact: true })}</div>`,
    upnext: `<div class="mk-u"><h3>Up next</h3><div><b>A2</b><span>Team C vs Team D</span></div><div><b>B1</b><span>Team E vs Team F</span></div><div><b>B2</b><span>Team G vs Team H</span></div></div>`,
  }[k];
}
function paintLay() {
  const el = $("lay"); if (!el || !lay) return;
  el.innerHTML = PANELS.filter(([k]) => lay[k].on).map(([k]) => { const p = lay[k];
    return `<div class="lbx lbx-${k}" data-lk="${k}" style="left:${(p.x / STAGE.w) * 100}%;top:${(p.y / STAGE.h) * 100}%;width:${(p.w / STAGE.w) * 100}%;height:${(p.h / STAGE.h) * 100}%">${layMock(k)}<div class="ltag"><b>${LAB[k]}</b><span>${p.w}×${p.h}</span></div><i data-rs="${k}" title="Resize"></i></div>`; }).join("") + `<div class="lhead">Header (fixed)</div>`;
  el.style.setProperty("--sc", el.clientWidth / STAGE.w); fitLayBracket();
  document.querySelectorAll("[data-layon]").forEach((c) => (c.checked = lay[c.dataset.layon].on));
}
// Real bracket scaled the same way the Dashboard does: fit the panel width and height (minus 8px padding each side)
function fitLayBracket() {
  const el = $("lay"), bk = el && el.querySelector(".mk-b [data-bk]"); if (!bk) return;
  bk.dataset.maxh = Math.max(1, (lay.bracket.h - 16) * (el.clientWidth / STAGE.w)); fitBrackets(el);
}
document.addEventListener("pointerdown", (e) => {
  const box = e.target.closest("[data-lk]"); if (!box || !lay) return;
  const k = box.dataset.lk, rect = $("lay").getBoundingClientRect(), sc = rect.width / STAGE.w;
  drag = { k, rs: !!e.target.closest("[data-rs]"), sx: e.clientX, sy: e.clientY, o: { ...lay[k] }, sc, el: box };
  box.setPointerCapture(e.pointerId); e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const snap = (v) => Math.round(v / 10) * 10, dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc, o = drag.o, p = lay[drag.k];
  if (drag.rs) { p.w = Math.max(80, Math.min(STAGE.w - o.x, snap(o.w + dx))); p.h = Math.max(40, Math.min(STAGE.h - o.y, snap(o.h + dy))); }
  else { p.x = Math.max(0, Math.min(STAGE.w - o.w, snap(o.x + dx))); p.y = Math.max(0, Math.min(STAGE.h - o.h, snap(o.y + dy))); }
  const st = drag.el.style; st.left = (p.x / STAGE.w) * 100 + "%"; st.top = (p.y / STAGE.h) * 100 + "%"; st.width = (p.w / STAGE.w) * 100 + "%"; st.height = (p.h / STAGE.h) * 100 + "%";
  drag.el.querySelector(".ltag span").textContent = p.w + "×" + p.h;
  if (drag.k === "bracket" && drag.rs) fitLayBracket();
});
document.addEventListener("pointerup", () => (drag = null));
document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.layon && lay) { lay[e.target.dataset.layon].on = e.target.checked; paintLay(); } });


// ---------- Settings tab ----------
function settingsView() {
  const ev = event(), base = new URL("../", location.href).href;
  const link = (p, t, d) => `<div class="lk"><div data-qr="${base}${p}/"></div><div><b>${t}</b><div class="muted">${d}</div><code>${base}${p}/</code><div class="btns"><button class="btn small" data-act="copy" data-u="${base}${p}/">คัดลอกลิงก์</button><a class="btn small" style="text-decoration:none" href="${base}${p}/" target="_blank" rel="noopener">เปิด</a></div></div></div>`;
  return `<div class="cols"><div class="stack"><div class="card"><div class="h2"><h2>Name</h2></div><div class="form">
     <label>ชื่องาน แสดงบนหัว Dashboard และหน้าแอดมิน<input id="en" value="${esc(ev.name)}" maxlength="80"></label>
     <button class="btn primary" data-act="savename">Save name</button></div></div>
    <div class="card"><div class="h2"><h2>Smart Logistics Challenge mode</h2><span class="pill ${ev.rules_mode !== false ? "ready" : "locked"}">${ev.rules_mode !== false ? "On" : "Off"}</span></div>
     <p class="muted" style="margin:0 0 10px">${ev.rules_mode !== false ? "เปิด: กรรมการใช้ Setup, Checklist, นาฬิกา 1:30 และกดเกณฑ์ตามกติกาข้อ 6" : "ปิด: กรรมการกดแค่ว่าใครชนะแต่ละเกม ไม่มีนาฬิกาและ Checklist"}</p>
     <label class="switch"><input type="checkbox" id="rm" ${ev.rules_mode !== false ? "checked" : ""}><span></span><b>Use Smart Logistics Challenge rules</b></label></div>
    <div class="card"><div class="h2"><h2>Timing</h2><span>ใช้เมื่อเปิดโหมดกติกา</span></div><div class="form">
     <div class="two"><label>เวลา Setup (วินาที)<input id="es" type="number" min="0" value="${Math.round(ev.setup_ms / 1000)}"></label><label>เวลาแข่งต่อเกม (วินาที)<input id="eg" type="number" min="10" value="${Math.round(ev.game_ms / 1000)}"></label></div>
     <label>นับถอยหลังก่อน GO (วินาที)<input id="ec" type="number" min="0" max="10" value="${Math.round((ev.countdown_ms ?? 3000) / 1000)}"></label>
     <button class="btn primary" data-act="saveev">Save</button></div></div>
    <div class="card"><div class="h2"><h2>Password and PIN</h2></div><div class="form"><div class="two"><label>รหัสผ่านแอดมินใหม่<input id="np" type="password" autocomplete="new-password" minlength="6"></label><label>PIN กรรมการใหม่<input id="ni" inputmode="numeric" pattern="[0-9]{4,8}"></label></div>
     <button class="btn" data-act="savepw">เปลี่ยน (กรอกเฉพาะช่องที่ต้องการเปลี่ยน)</button></div></div>
    <div class="card"><div class="h2"><h2>Documents</h2><span>กติกา FAQ และไฟล์อื่น</span></div>
     <label class="switch"><input type="checkbox" id="dref" ${ev.docs_ref !== false ? "checked" : ""}><span></span><b>Referees can open documents</b></label>
     <div id="doclist" class="doclist"><p class="muted">Loading</p></div>
     <div class="form" style="margin-top:12px"><div class="two"><label>ชื่อเอกสาร<input id="dt" maxlength="80" placeholder="เช่น กติกา, FAQ"></label><label>ไฟล์ (PDF หรือรูป ไม่เกิน 10 MB)<input id="df" type="file" accept=".pdf,image/*"></label></div>
     <button class="btn primary" data-act="docadd">Upload</button></div></div>
    <div class="card"><div class="h2"><h2>Data</h2></div><div class="btns"><button class="btn" data-act="export">ดาวน์โหลดผลทั้งหมด (JSON)</button></div>
     <div class="form" style="margin-top:14px"><label>เริ่มงานใหม่ ลบผลและเกมทั้งหมด (พิมพ์ รีเซ็ต เพื่อยืนยัน)<input id="rc" placeholder="รีเซ็ต"></label><button class="btn danger" data-act="reset">ลบผลทั้งหมดและเริ่มใหม่</button><span class="muted">ชื่อทีมและการตั้งค่าไม่ถูกลบ</span></div></div></div>
   <div class="card links"><div class="h2"><h2>Links</h2></div>${link("dashboard", "Dashboard", "เปิดบนโน้ตบุ๊กที่ต่อจอ แล้วแตะเต็มจอเพื่อเปิดเสียง")}${link("ref", "Referee", "เครื่องกรรมการ 1 เครื่อง ต้องใช้ PIN")}${link("admin", "Admin", "สำหรับผู้จัดเท่านั้น")}</div></div>`;
}
async function loadDocs() {
  const el = $("doclist"); if (!el) return;
  try { el.innerHTML = docRows(await listDocs({ p_pw: pw }), true); } catch (e) { el.innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
}
function afterForm() {
  if (formTab === "settings") loadDocs();
  document.querySelectorAll("[data-qr]").forEach((d) => { try { const q = window.qrcode(0, "M"); q.addData(d.dataset.qr); q.make(); d.innerHTML = q.createSvgTag({ scalable: true, margin: 2 }); d.firstChild.style.cssText = "width:110px;height:110px"; } catch (e) {} });
}

// ---------- Log tab ----------
let logRows = [], logF = "";
const AL = { "queue.call": "Call match", "queue.clear": "Clear field", "ref.transfer": "Transfer referee", "flow.setup_start": "Start setup", "flow.setup_skip": "Skip setup", "flow.go": "Start", "flow.false_start": "False start", "flow.reset": "Reset game", "game.confirm": "Confirm result", "match.absent_req": "Absent request", "mark.undo": "Undo", "mark.add": "Admin add event", "mark.void": "Admin delete event", "mark.unvoid": "Admin restore event", "mark.edit": "Admin edit event", "mark.exit_first": "Left red box first", "mark.lift_first": "First lift", "mark.park": "Stand +1", "mark.unpark": "Stand -1", "mark.complete": "Mission complete", "mark.retry": "Retry", "queue.assign": "เปิดคิว", "queue.unassign": "ปิดคิว", "game.patch": "แก้ผลเกม", "game.add": "เพิ่มเกม", "game.void": "ลบเกม", "event.update": "แก้ตั้งค่า", "schedule.set": "ตั้งเวลา", reset: "รีเซ็ต", "group.tiebreak": "ตัดสินอันดับ", "teams.set": "แก้ชื่อทีม", "match.swap": "สลับฝั่ง", "match.forfeit": "แพ้บาย", "team.absent": "ทีมไม่มา",
  "timer.start_setup": "เริ่ม Setup", "timer.start_game": "เริ่มแข่ง", "timer.pause": "หยุดนาฬิกา", "timer.resume": "เล่นต่อ", "timer.reset": "รีเซ็ตนาฬิกา",
  "game.pattern": "เลือกแบบสนาม", "game.parked_inc": "จอดเพิ่ม", "game.parked_dec": "จอดลด", "game.lift": "ยกแท่นแรก", "game.exit": "ออกจากกรอบแดง", "game.clear_lift": "ล้างยกแท่น", "game.clear_exit": "ล้างออกกรอบ", "game.finish": "จบเกม", "game.judge": "กรรมการตัดสิน" };
const actorTh = (a) => (a === "admin" ? "แอดมิน" : a === "system:auto" ? "ระบบ เปิดคิวตามเวลา" : String(a).startsWith("ref:") ? "Referee" : a);
function logView() {
  return `<div class="h2"><h2>Log</h2><select id="lgf" data-act-change="lgf"><option value="">All</option><option value="admin" ${logF === "admin" ? "selected" : ""}>Admin</option><option value="ref" ${logF === "ref" ? "selected" : ""}>Referee</option></select><button class="btn small" data-act="logload">Reload</button></div><div class="tw"><table class="tbl"><thead><tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>กับ</th></tr></thead><tbody>${logRows.filter((r) => !logF || (logF === "ref" ? String(r.actor).startsWith("ref:") : r.actor === logF)).map((r) => `<tr><td class="num">${new Date(r.at).toLocaleTimeString("th-TH")}</td><td>${esc(actorTh(r.actor))}</td><td>${esc(AL[r.action] || r.action)}</td><td>${esc(r.target || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>`;
}
async function loadLog() { logRows = (await act(() => adm("a2_adm_audit", { p_limit: 200 }))) || []; redraw(); }

const VIEW = { home: homeView, queue: queueView, schedule: scheduleView, groups: groupsView, matches: matchesView, teams: teamsView, tv: tvView, settings: settingsView, log: logView };

// ---------- Clock ----------
function clocks() {
  const f = field(1); if (!f) return; const ck = clockV3(f);
  document.querySelectorAll("[data-clk]").forEach((el) => { el.textContent = ck.phase === "countdown" ? String(ck.count) : ck.phase === "stopped" ? fmtMs1(ck.elapsed) : fmtMs1(ck.ms); el.classList.toggle("warn", ck.phase === "game" && ck.ms <= 10000); });
  document.querySelectorAll("[data-ph]").forEach((el) => { el.textContent = PHASE_EN[ck.phase] + (ck.phase === "stopped" ? " (Mission complete)" : ""); });
}

// ---------- Button handlers ----------
const H = {
  async open(b) {
    const c = b.dataset.c, M = match(c);
    if (!confirm(`Call ${c} to field\n${sideName(M, "red")} vs ${sideName(M, "blue")}`)) return;
    await act(() => adm("a2_adm_call", { p_code: c }), `เรียก ${c} ขึ้นสนามแล้ว`);
    if (dlg.open && dlgCode === c) dlg.innerHTML = dlgHtml(c);
  },
  async close(b) {
    const M = match(b.dataset.c);
    if (!confirm(M.status === "done" ? "Clear field" : `เอาคู่ ${M.code} ลงจากสนามทั้งที่ยังไม่จบ\nเกมที่ยังไม่เริ่มจะถูกลบ`)) return;
    await act(() => adm("a2_adm_clear", {}), "Field cleared");
  },
  async timer(b) {
    const a = b.dataset.a;
    if (a === "false_start" && !confirm("False start ลบเหตุการณ์ทั้งหมดของรอบนี้ แล้วกลับไป Ready")) return;
    if (a === "go" && !confirm("เริ่มนับถอยหลัง 3 2 1 แทนกรรมการ")) return;
    await act(() => adm("a2_adm_timer", { p_action: a }));
  },
  async transfer() { if (!confirm("ปลดเครื่องกรรมการเดิม เครื่องที่เปิดหน้า Referee อยู่จะรับสิทธิ์แทนภายใน 10 วินาที")) return; await act(() => adm("a2_adm_ref_transfer", {}), "Referee released"); },
  async approve(b) { const m = match(b.dataset.c), sd = b.dataset.s; if (!confirm(`${sideName(m, sd)} ไม่มา ให้ ${sideName(m, sd === "red" ? "blue" : "red")} ชนะบาย ${Math.ceil(m.bo / 2)}-0`)) return; await act(() => adm("a2_adm_forfeit", { p_code: b.dataset.c, p_side: sd }), "Forfeit approved"); },
  async reject(b) { await act(() => adm("a2_adm_forfeit", { p_code: b.dataset.c, p_side: null }), "Request rejected"); },
  async mk(b) {
    const card = b.closest("[data-g]"), id = b.closest("[data-mid]").dataset.mid;
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: b.dataset.op, p_id: id }), "Updated"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  async mkedit(b) {
    const card = b.closest("[data-g]"), id = b.closest("[data-mid]").dataset.mid, v = prompt("เวลาใหม่ นับจาก GO (เช่น 0:12.5)"); if (v == null) return;
    const t = parseT(v); if (Number.isNaN(t)) return toast("รูปแบบเวลา 0:12.5", true);
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: "edit", p_id: id, p_t_ms: t }), "Updated"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  async mkadd(b) {
    const card = b.closest("[data-g]"), q = (n) => card.querySelector(`[data-n="${n}"]`).value, t = parseT(q("t"));
    if (Number.isNaN(t)) return toast("รูปแบบเวลา 0:12.5", true);
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: "add", p_kind: q("kind"), p_side: q("side"), p_t_ms: t }), "Event added"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  edit(b) { openDlg(b.dataset.c); },
  dclose() { dlg.close(); },
  dreload() { dlg.innerHTML = dlgHtml(dlgCode); },
  async gsave(b) { const card = b.closest("[data-g]"); let p; try { p = readGame(card); } catch (e) { return toast(e.message, true); } await act(() => adm("a2_adm_game", { p_game: +card.dataset.g, p, p_version: +card.dataset.v }), "บันทึกแล้ว"); dlg.innerHTML = dlgHtml(dlgCode); },
  async gauto(b) { const card = b.closest("[data-g]"); let p; try { p = readGame(card); } catch (e) { return toast(e.message, true); } p.auto = true; await act(() => adm("a2_adm_game", { p_game: +card.dataset.g, p, p_version: +card.dataset.v }), "บันทึกและตัดสินแล้ว"); dlg.innerHTML = dlgHtml(dlgCode); },
  async gwin(b) {
    const card = b.closest("[data-g]"), m = match(dlgCode), w = b.dataset.w;
    if (w && !confirm(`ให้ ${sideName(m, w)} ชนะเกมนี้ ระบบจะนับผลคู่และอันดับใหม่`)) return;
    let p; try { p = readGame(card); } catch (e) { return toast(e.message, true); } p.winner = w;
    await act(() => adm("a2_adm_game", { p_game: +card.dataset.g, p, p_version: +card.dataset.v }), w ? "บันทึกผู้ชนะแล้ว" : "ล้างผู้ชนะแล้ว"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  async gvoid(b) { const card = b.closest("[data-g]"); if (!confirm("ลบเกมนี้ ผลที่นับไปแล้วจะถูกคำนวณใหม่")) return; await act(() => adm("a2_adm_game_void", { p_game: +card.dataset.g }), "ลบเกมแล้ว"); dlg.innerHTML = dlgHtml(dlgCode); },
  async gadd() { await act(() => adm("a2_adm_game_add", { p_code: dlgCode }), "เพิ่มเกมแล้ว"); dlg.innerHTML = dlgHtml(dlgCode); },
  async swap() { if (!confirm("สลับฝั่งแดงกับน้ำเงินของคู่นี้")) return; await act(() => adm("a2_adm_swap", { p_code: dlgCode }), "สลับแล้ว"); dlg.innerHTML = dlgHtml(dlgCode); },
  async ff(b) {
    const m = match(dlgCode), sd = b.dataset.s;
    if (sd && !confirm(`${sideName(m, sd)} ไม่มา ให้ ${sideName(m, sd === "red" ? "blue" : "red")} ชนะบาย (${Math.ceil(m.bo / 2)}-0)`)) return;
    await act(() => adm("a2_adm_forfeit", { p_code: dlgCode, p_side: sd || null }), sd ? "บันทึกแพ้บายแล้ว" : "ยกเลิกแพ้บายแล้ว"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  autofill() { autofill(); },
  clearsc(b) { const tr = b.closest("tr"); tr.querySelector('[data-k="at"]').value = ""; tr.querySelector('[data-k="auto"]').checked = false; },
  async savesc() { const items = readSchedule(); if (await act(() => adm("a2_adm_schedule", { p_items: items }), "บันทึกเวลาแล้ว") !== undefined) { formTab = ""; render(); } },
  async tbup(b) {
    const G = b.dataset.g, s = +b.dataset.s, seeds = tableOf(G).filter((r) => r.seed != null).map((r) => r.seed), i = seeds.indexOf(s);
    if (i > 0) { [seeds[i - 1], seeds[i]] = [seeds[i], seeds[i - 1]]; await act(() => adm("a2_adm_tiebreak", { p_grp: G, p_seeds: seeds }), "ปรับลำดับแล้ว"); }
  },
  async tbclear(b) { await act(() => adm("a2_adm_tiebreak", { p_grp: b.dataset.g, p_seeds: null }), "ล้างแล้ว"); },
  async saveteams() { const names = Array.from({ length: teamsArr().length }, (_, i) => document.querySelector(`[data-seed="${i + 1}"]`).value.trim()); await act(() => adm("a2_adm_teams", { p_names: names }), "บันทึกชื่อทีมแล้ว"); },
  shuffle() { const els = [...document.querySelectorAll("[data-seed]")], v = els.map((e) => e.value); for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [v[i], v[j]] = [v[j], v[i]]; } els.forEach((e, i) => (e.value = v[i])); toast("สลับแล้ว ยังไม่ได้บันทึก"); },
  async fmtapply() {
    const f = readFormat(), err = validateFormat(f); if (err.length) return toast(err[0], true);
    const b = buildFormat(f);
    if (!confirm(`Apply format: ${f.groups} groups × ${f.size} teams, ${f.advance} advance per group\nสร้างคู่ใหม่ ${b.matches.length} คู่ แทนของเดิมทั้งหมด`)) return;
    if (await act(() => adm("a2_adm_format", { p_format: b.format, p_groups: b.groups, p_matches: b.matches }), "Format applied") !== undefined) { await loadAll(); formTab = ""; render(); }
  },
  async drawstart() { await act(() => adm("a2_adm_event", { p: { tv_mode: "draw", draw_state: { start: Math.round(now()) + 2500 } } }), "Draw started"); formTab = ""; render(); },
  async tvauto() { await act(() => adm("a2_adm_event", { p: { tv_mode: "auto" } }), "Dashboard on Auto"); formTab = ""; render(); },
  async tvmode(b) { await act(() => adm("a2_adm_event", { p: { tv_mode: b.dataset.m } }), "Dashboard mode changed"); formTab = ""; render(); },
  async laysave() { await act(() => adm("a2_adm_event", { p: { dash_layout: { ...(event().dash_layout || {}), live: lay } } }), "Layout saved"); },
  layreset() { lay = liveLayout(null); paintLay(); },
  layundo() { lay = liveLayout(event().dash_layout?.live); paintLay(); },
  async docadd() {
    const f = $("df").files[0], title = $("dt").value.trim() || (f && f.name.replace(/\.[^.]+$/, ""));
    if (!f) return toast("เลือกไฟล์ก่อน", true);
    if (f.size > 10 * 1024 * 1024) return toast("ไฟล์ใหญ่เกิน 10 MB", true);
    const b = $("df"); b.disabled = true;
    const ok = await act(async () => adm("a2_adm_doc_add", { p_title: title, p_file_name: f.name, p_mime: f.type || "application/octet-stream", p_data: await fileToB64(f) }), "Uploaded");
    b.disabled = false; if (ok !== undefined) { $("dt").value = ""; b.value = ""; loadDocs(); }
  },
  async savename() { const name = $("en").value.trim(); if (!name) return toast("ใส่ชื่องานก่อน", true); await act(() => adm("a2_adm_event", { p: { name } }), "Name saved"); },
  async saveev() {
    const p = { setup_ms: Math.max(0, +$("es").value) * 1000, game_ms: Math.max(10, +$("eg").value) * 1000, countdown_ms: Math.max(0, Math.min(10, +$("ec").value)) * 1000 };
    await act(() => adm("a2_adm_event", { p }), "บันทึกแล้ว");
  },
  async savepw() {
    const np = $("np").value, ni = $("ni").value, p = {};
    if (np) { if (np.length < 6) return toast("รหัสผ่านต้องยาวอย่างน้อย 6 ตัว", true); p.new_pw = np; }
    if (ni) { if (!/^\d{4,8}$/.test(ni)) return toast("PIN ต้องเป็นตัวเลข 4 ถึง 8 หลัก", true); p.new_pin = ni; }
    if (!np && !ni) return toast("ยังไม่ได้กรอกอะไร", true);
    if (!confirm("เปลี่ยนแล้วกรรมการต้องใช้ PIN ใหม่ในการเข้าครั้งต่อไป")) return;
    if (await act(() => adm("a2_adm_event", { p }), "เปลี่ยนแล้ว") !== undefined) { if (np) { pw = np; store("a2pw", np); } $("np").value = ""; $("ni").value = ""; }
  },
  copy(b) { navigator.clipboard?.writeText(b.dataset.u).then(() => toast("คัดลอกแล้ว"), () => toast("คัดลอกไม่ได้ ลองลากคลุมลิงก์", true)); },
  export() {
    const data = { exported_at: new Date().toISOString(), event: event(), teams: teamsArr(), matches: matches(), games: [...T.a2_game.values()], marks: [...T.a2_mark.values()], standings: S.standings, ranking: S.ranking };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "alvik-result-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async reset() { if ($("rc").value.trim() !== "รีเซ็ต") return toast("พิมพ์ รีเซ็ต ให้ตรงก่อน", true); if (!confirm("ลบผลและเกมทั้งหมด ย้อนกลับไม่ได้ ดาวน์โหลด JSON ไว้แล้วหรือยัง")) return; await act(() => adm("a2_adm_reset", {}), "รีเซ็ตแล้ว"); $("rc").value = ""; },
  logload() { loadLog(); },
};
document.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (!b || b.disabled) return; const f = H[b.dataset.act]; if (f) f(b); });
document.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
document.addEventListener("click", async (e) => {
  const o = e.target.closest("[data-doc]"), d = e.target.closest("[data-docdel]");
  if (o) showDoc(+o.dataset.doc, { p_pw: pw }, o.dataset.t);
  if (d && confirm(`ลบเอกสาร ${d.dataset.t}`)) { if ((await act(() => adm("a2_adm_doc_del", { p_id: +d.dataset.docdel }), "Deleted")) !== undefined) loadDocs(); }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "lgf") { logF = e.target.value; redraw(); }
  if (e.target.id === "dref") {
    const on = e.target.checked;
    if ((await act(() => adm("a2_adm_event", { p: { docs_ref: on } }), on ? "Referees can open documents" : "Documents hidden from referees")) === undefined) e.target.checked = !on;
  }
  if (e.target.id === "rm") {
    const on = e.target.checked, f = field(1), busy = f && f.match_code && ["setup", "ready", "countdown", "game", "stopped", "over"].includes(f.phase);
    if (busy && !confirm("มีเกมกำลังดำเนินอยู่ เปลี่ยนโหมดตอนนี้ กรรมการจะเห็นหน้าใหม่ทันที")) { e.target.checked = !on; return; }
    if ((await act(() => adm("a2_adm_event", { p: { rules_mode: on } }), on ? "Rules mode on" : "Rules mode off")) === undefined) e.target.checked = !on; else { formTab = ""; render(); }
  }
});
document.addEventListener("input", (e) => { if (e.target.matches("[data-fmt]")) { const el = $("fsum"); if (el) el.innerHTML = fmtSummary(readFormat()); } });
document.addEventListener("change", async (e) => {
  const c = e.target.closest("[data-abs]"); if (!c) return;
  const seed = +c.dataset.abs, on = c.checked;
  if (on && !confirm(`${teamName(seed)} ไม่มา แพ้บายทุกคู่ที่เหลือ`)) { c.checked = false; return; }
  if ((await act(() => adm("a2_adm_absent", { p_seed: seed, p_absent: on }), on ? "ตั้งเป็นไม่มาแล้ว" : "ยกเลิกไม่มาแล้ว")) === undefined) c.checked = !on;
});
document.addEventListener("click", (e) => { if (e.target.closest('[data-tab="log"]')) loadLog(); });

boot();
