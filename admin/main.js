import { setLang } from "../shared/lang.js";
import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { PANELS, STAGE, DEFAULT_LIVE, liveLayout } from "../shared/layout.js";
import { listDocs, showDoc, fileToB64, docRows } from "../shared/docs.js";
import { BOS, STAGE_CHOICES, build as buildFormat, buildGroupMatches, defaultKoRound, defaults as fmtDefaults, materializeCustom, normalize as fmtNormalize, parseSrcKey, qualifiers, reletter, resolveRoundGroupSlots, roundQualifiers, srcKey, stageLabel, validate as validateFormat } from "../shared/format.js";
import { roundList, useMarks, marksOf, clockV3, fmtMs1, PHASE_EN, decideV3, RULE_EN, RULE_TH, field, connect, fsSupported, toggleFs, FS_ICON, onChange, event, matches, groups, loadAll, match, gamesOf, openGame, gameNo, sideName, teamName, teamsArr, tableOf, srcLabel, grpName, fmtMs, parseMs, fmtTime, esc, $, now, rpc, toast, netBadge, raf, paintNet, S, T, STATUS_TH, METHOD_TH, previewDecide, REASON_TH, sb, BK_MODES, bracketSetting, bracketMode } from "../shared/common.js";

// Admin is in Thai; the Dashboard keeps English for the TV
setLang("th");
useMarks();
const fields = () => [field(1)].filter(Boolean);   // v3 single field
const app = $("app"), dlg = $("dlg");
const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} return null; };
const lstore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
let pw = store("a2pw") || "", authed = false, started = false, hasSetup = null;
let tab = lstore("a2tab") || "home";
const TABS = [["home", "ภาพรวม"], ["queue", "คิว"], ["schedule", "ตารางเวลา"], ["groups", "ตารางคะแนน"], ["matches", "รายการคู่"], ["teams", "ทีม"], ["tv", "จอ Dashboard"], ["settings", "ตั้งค่า"], ["log", "บันทึก"]];
const ST_EN = { locked: "รอผล", ready: "พร้อม", queued: "บนสนาม", live: "กำลังแข่ง", done: "จบแล้ว" };
const sideTh = (s) => (s === "red" ? "แดง" : s === "blue" ? "น้ำเงิน" : s === "both" ? "พร้อมกัน" : s || "");
const PH_TH = { empty: "ว่าง", idle: "รอเริ่ม", setup: "Setup", ready: "พร้อม", countdown: "นับถอยหลัง", game: "กำลังแข่ง", stopped: "หยุด", over: "หมดเวลา" };
const BK_TH = { auto: "อัตโนมัติ", practice: "คู่ซ้อม", comp: "การแข่งจริง" };
const PANEL_TH = { info: "ข้อมูลคู่", red: "ทีมแดง", clock: "นาฬิกา", blue: "ทีมน้ำเงิน", bracket: "ตารางสาย", upnext: "คู่ถัดไป" };

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
  app.innerHTML = `<div class="hdr"><div class="top"><img src="../shared/irap.png" alt=""><b id="evn"></b><span class="sp"></span>${netBadge()}${fsSupported() ? `<button class="btn small fsb" id="fsb" aria-label="เต็มจอ" title="เต็มจอ">${FS_ICON}</button>` : ""}<button class="btn small" id="lo">ออกจากระบบ</button></div>
    <nav class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${k === tab ? "on" : ""}">${t}</button>`).join("")}</nav></div><div class="main" id="mn"></div>`;
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
  const k = tab + JSON.stringify([ev, [...T.a2_team.values()].map((t) => [t.name, t.absent]), matches().map((m) => [m.code, m.status, m.red_wins, m.blue_wins, m.red_seed, m.blue_seed, m.field_no, m.sched_at, m.auto_open, m.walkover, m.forfeit, m.absent_req, m.bo, m.order_no]), fields().map((f) => [f.no, f.match_code, f.phase, f.checks, f.stop_ms, f.ref_seen && Math.floor(Date.parse(f.ref_seen) / 10000)]), [...T.a2_game.values()].map((g) => [g.id, g.version]), T.a2_mark.size, S.standings, [...T.a2_tiebreak.values()], tab === "log" ? logRows.length : 0]);
  if (k === lastKey) { updateDlgBanner(); return; }
  lastKey = k; $("mn").innerHTML = VIEW[tab](); fitBrackets($("mn")); if (tab === "tv") paintLay(); if (tab === "queue") mountTools(); updateDlgBanner();
}
const redraw = () => { lastKey = ""; formTab = ""; render(); };

// ---------- Overview tab ----------
const upNext = () => matches().filter((m) => m.status === "ready" && m.field_no == null).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no);
const refOnline = (f) => f && f.ref_seen && Date.now() - Date.parse(f.ref_seen) < 30000;
function clockBox(f) {
  const m = f && f.match_code ? match(f.match_code) : null;
  if (!m) return `<div class="ck empty"><div class="ckh"><b>สนาม</b><span>ว่าง</span></div><div class="ckt" data-clk>1:30.0</div></div>`;
  const g = openGame(m.code);
  return `<div class="ck st-${m.status}"><div class="ckh"><b>${m.code}</b><span>${g ? "เกม " + gameNo(m.code, g) + " จาก " + m.bo : ""}${g?.pattern ? ", แบบสนาม " + g.pattern : ""}</span><span class="dot${refOnline(f) ? " on" : ""}" title="เครื่องกรรมการ${refOnline(f) ? "ออนไลน์" : "ออฟไลน์"}"></span></div>
    <div class="ckv"><span class="r">${esc(sideName(m, "red"))}</span><b>${m.red_wins}-${m.blue_wins}</b><span class="b">${esc(sideName(m, "blue"))}</span></div>
    <div class="ckt" data-clk>1:30.0</div><div class="ckp muted" data-ph></div></div>`;
}
function homeView() {
  const rq = upNext().slice(0, 6).map((m) => `<div class="rq"><b>${m.code}</b><span>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</span><span class="muted">${m.sched_at ? fmtTime(m.sched_at) + (m.auto_open ? " อัตโนมัติ" : "") : ""}</span><span></span><button class="btn small primary" data-act="open" data-c="${m.code}">เรียก</button></div>`).join("") || `<p class="muted">ยังไม่มีคู่ที่พร้อม</p>`;
  return `${alertsHtml()}<div class="home"><div class="card hbk">${bracketHtml({ clickable: true })}</div>
    <div class="hbot"><div class="card"><div class="h2"><h2>คู่ถัดไป</h2><span>กดชิปคู่ในตารางสายเพื่อดูหรือแก้ผล</span></div>${rq}</div><div>${clockBox(field(1))}</div></div></div>`;
}

// ---------- Things waiting for the admin, shown on top of Overview and Queue ----------
function alertsHtml() {
  const out = [], f = field(1), onField = f && f.match_code ? match(f.match_code) : null, ev = event();
  matches().filter((m) => m.absent_req).forEach((m) => out.push(`<div class="al warn">คู่ ${m.code} : กรรมการขอให้ฝั่ง${sideTh(m.absent_req)} (${esc(sideName(m, m.absent_req))}) แพ้บาย
    <button class="btn small danger" data-act="approve" data-c="${m.code}" data-s="${m.absent_req}">อนุมัติ</button><button class="btn small" data-act="reject" data-c="${m.code}">ไม่อนุมัติ</button></div>`));
  const tied = [...new Set(S.standings.filter((r) => r.tied).map((r) => r.grp))];
  if (tied.length) out.push(`<div class="al warn">กลุ่ม ${tied.join(", ")} มีทีมคะแนนเท่ากันทุกอย่าง ต้องจัดลำดับเองก่อนทีมจะเข้ารอบต่อ <button class="btn small" data-act="gotab" data-t="groups">ไปจัดลำดับ</button></div>`);
  if (onField && onField.status !== "done" && !refOnline(f)) out.push(`<div class="al">เครื่องกรรมการไม่ได้ออนไลน์ ถ้าเครื่องเสียให้กดย้ายเครื่องกรรมการ แล้วเปิดหน้ากรรมการในเครื่องใหม่ <button class="btn small" data-act="transfer">ย้ายเครื่องกรรมการ</button></div>`);
  if (ev.notice_on && ev.notice) out.push(`<div class="al info">กำลังประกาศบนจอ : ${esc(ev.notice)} <button class="btn small" data-act="noticehide">ซ่อนประกาศ</button></div>`);
  return out.length ? `<div class="alerts">${out.join("")}</div>` : "";
}
// A match can still change Bo while no game of it has started
const boEditable = (m) => m.status !== "done" && !m.forfeit && !gamesOf(m.code).some((g) => g.status !== "void" && g.status !== "ready");
function rowTools(x, f) {
  const out = [];
  if (x.status === "ready" && x.field_no == null) out.push(`<button class="btn small primary" data-act="open" data-c="${x.code}">เรียก</button>`);
  if ((x.status === "ready" || x.status === "locked") && x.field_no == null) out.push(`<button class="btn small" data-act="postpone" data-c="${x.code}" title="ย้ายไปท้ายคิว">ไว้ทีหลัง</button>`);
  if (boEditable(x)) out.push(`<select class="sm" data-bo-code="${x.code}" title="เปลี่ยน Bo">${[1, 3, 5, 7].map((n) => `<option value="${n}" ${x.bo === n ? "selected" : ""}>Bo${n}</option>`).join("")}</select>`);
  if (x.red_seed != null && x.blue_seed != null && x.status !== "done") out.push(`<select class="sm" data-ff-code="${x.code}" title="ทีมไม่มา"><option value="">ทีมไม่มา...</option><option value="red">${esc(sideName(x, "red"))} ไม่มา</option><option value="blue">${esc(sideName(x, "blue"))} ไม่มา</option></select>`);
  if (x.forfeit) out.push(`<button class="btn small" data-act="ffundo" data-c="${x.code}">ยกเลิกแพ้บาย</button>`);
  out.push(`<button class="btn small" data-act="edit" data-c="${x.code}">เปิด</button>`);
  return out.join(" ");
}
// On-site tools card. Kept as one DOM node so typing is not lost when live data redraws the Queue tab
let toolsEl = null;
function toolsHtml() {
  const ev = event(), t = teamsArr(), left = (sd) => matches().filter((m) => m.status !== "done" && (m.red_seed === sd || m.blue_seed === sd)).length;
  return `<div class="card tools"><div class="h2"><h2>เครื่องมือหน้างาน</h2></div>
    <div class="tl"><b>เปลี่ยน Bo คู่ที่ยังไม่เริ่มทั้งหมด</b><span class="muted">ใช้เมื่อเวลาไม่พอ คู่ที่เริ่มแข่งแล้วไม่เปลี่ยน</span>
      <div class="row"><select id="boall">${[1, 3, 5, 7].map((n) => `<option value="${n}">Bo${n}</option>`).join("")}</select><button class="btn" data-act="boall">เปลี่ยนทั้งหมด</button></div></div>
    <div class="tl"><b>ทีมถอนตัว หรือกลับมาแข่ง</b><span class="muted">ถอนตัว : คู่ที่เหลือของทีมนี้แพ้บายทั้งหมด กลับมาแข่ง : ยกเลิกแพ้บายของคู่ที่ยังไม่จบ</span>
      <div class="row"><select id="wdteam">${t.map((x) => `<option value="${x.seed}">${esc(teamName(x.seed))}${x.absent ? " (ถอนตัวอยู่)" : ""} เหลือ ${left(x.seed)} คู่</option>`).join("")}</select>
      <button class="btn danger" data-act="withdraw">ถอนตัว</button><button class="btn" data-act="comeback">กลับมาแข่ง</button></div></div>
    <div class="tl"><b>ประกาศบนจอ Dashboard</b><span class="muted">${ev.notice_on && ev.notice ? "ตอนนี้แสดงอยู่" : "ตอนนี้ไม่ได้แสดง"}</span>
      <div class="row"><input id="ntext" maxlength="200" placeholder="เช่น พักเที่ยง กลับมาแข่ง 13:00" value="${esc(ev.notice || "")}"><button class="btn primary" data-act="noticeshow">แสดง</button><button class="btn" data-act="noticehide">ซ่อน</button></div></div></div>`;
}
function mountTools() {
  const host = $("qtools"); if (!host) return;
  if (!toolsEl) { toolsEl = document.createElement("div"); toolsEl.innerHTML = toolsHtml(); }
  host.replaceWith(toolsEl);
}
const refreshTools = () => { if (toolsEl) toolsEl.innerHTML = toolsHtml(); };

// ---------- Queue tab (single queue, single field) ----------
function flowBtns(f) {
  const b = (a, t, c = "") => `<button class="btn ${c}" data-act="timer" data-a="${a}">${t}</button>`;
  const ph = f.phase;
  if (ph === "idle") return b("setup_start", "เริ่ม Setup", "primary") + b("setup_skip", "ข้าม Setup");
  if (ph === "setup") return b("setup_skip", "ข้าม Setup");
  if (ph === "ready") return b("go", "เริ่มแข่ง (3 2 1)", "primary");
  if (ph === "countdown" || ph === "game") return b("false_start", "ออกตัวก่อน (False start)", "danger");
  return "";
}
function queueView() {
  const f = field(1), m = f && f.match_code ? match(f.match_code) : null, nx = upNext();
  let card;
  if (!m) card = `<div class="card fc"><div class="h2"><h2>บนสนาม</h2><span>ว่าง</span></div>
    ${nx.length ? `<button class="btn primary big" data-act="open" data-c="${nx[0].code}">เรียกคู่ถัดไป  ${nx[0].code}  ${esc(sideName(nx[0], "red"))} พบ ${esc(sideName(nx[0], "blue"))}</button>` : `<p class="muted">ไม่มีคู่ที่พร้อม</p>`}</div>`;
  else {
    const g = openGame(m.code), done = m.status === "done", c = f.checks || {};
    card = `<div class="card fc st-${m.status}"><div class="h2"><h2>บนสนาม  ${m.code}</h2><span class="pill ${m.status}">${ST_EN[m.status]}</span><span>เครื่องกรรมการ${refOnline(f) ? "ออนไลน์" : "ออฟไลน์"}</span></div>
      <div class="vs"><span>${stageLabel(m.stage)}${m.grp ? " " + esc(grpName(m.grp)) : ""}</span><span class="r">${esc(sideName(m, "red"))}</span><span class="sc">${m.red_wins} - ${m.blue_wins}</span><span class="b">${esc(sideName(m, "blue"))}</span></div>
      <div class="muted">${done ? "จบคู่แล้ว ผู้ชนะ " + esc(teamName(m.winner_seed)) : (g ? "เกม " + gameNo(m.code, g) + " จาก " + m.bo : "") + (g?.pattern ? ", แบบสนาม " + g.pattern : ", ยังไม่เลือกแบบสนาม")}${!done && ["setup", "ready"].includes(f.phase) ? `, Checklist ${["red_in", "blue_in", "stands"].filter((k) => c[k]).length}/3` : ""}</div>
      <div class="t" data-clk>1:30.0</div><div class="muted" data-ph></div>
      <div class="btns">${done ? (nx.length ? `<button class="btn primary" data-act="open" data-c="${nx[0].code}">เรียกคู่ถัดไป ${nx[0].code}</button>` : "") : flowBtns(f)}
        <button class="btn" data-act="edit" data-c="${m.code}">บันทึกเหตุการณ์</button><button class="btn" data-act="transfer">ย้ายเครื่องกรรมการ</button><button class="btn danger" data-act="close" data-c="${m.code}">เอาลงจากสนาม</button></div>
      <p class="muted" style="margin:6px 0 0">ปุ่มเริ่มแข่งของแอดมินข้าม Checklist ได้ ใช้เมื่อเครื่องกรรมการมีปัญหา</p></div>`;
  }
  const rows = matches().map((x) => `<tr class="${f && f.match_code === x.code ? "sel" : ""}"><td><b>${x.code}</b></td><td>${esc(sideName(x, "red"))} พบ ${esc(sideName(x, "blue"))}</td><td class="num">${x.status === "locked" ? "" : x.red_wins + "-" + x.blue_wins}</td><td><span class="pill ${x.status}">${ST_EN[x.status]}</span></td><td class="muted">${x.sched_at ? fmtTime(x.sched_at) + (x.auto_open ? " อัตโนมัติ" : "") : ""}</td>
    <td class="rt">${rowTools(x, f)}</td></tr>`).join("");
  return `${alertsHtml()}<div class="cols"><div class="stack">${card}<div id="qtools"></div></div><div><div class="h2"><h2>ลำดับคิว</h2><span>เรียกได้ทีละคู่ "ไว้ทีหลัง" ย้ายคู่ไปท้ายคิว เปลี่ยน Bo ได้จนกว่าคู่นั้นจะเริ่มแข่ง</span></div><div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>ทีม</th><th class="num">สกอร์</th><th>สถานะ</th><th>เวลา</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
}

// ---------- Schedule tab ----------
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hm = (iso) => iso ? fmtTime(iso) : "";
// Schedule settings are kept per browser so the admin does not retype them
const SC_DEF = { day: "", start: "09:00", auto: true, mins: {}, breaks: [{ at: "12:00", min: 60, label: "พักเที่ยง" }],
  pday: "", pstart: "09:00", pmin: 10, pgames: 2, pbo: 1, pabsent: [] };
let sc = (() => { try { return { ...SC_DEF, ...JSON.parse(localStorage.getItem("a2sched") || "{}") }; } catch (e) { return { ...SC_DEF }; } })();
const scSave = () => { try { localStorage.setItem("a2sched", JSON.stringify(sc)); } catch (e) {} };
const DEF_MIN = { r1: 12, r2: 12, r3: 12, r4: 12, practice: 10, r64: 15, r32: 15, r16: 15, qf: 15, sf: 15, third: 15, final: 20 };
const isPractice = (m) => m.stage === "practice";
// Teams ticked as present for the practice day (kept per browser)
const practiceTeams = () => teamsArr().map((t) => t.seed).filter((sd) => !(sc.pabsent || []).includes(sd));
const compMatches = () => matches().filter((m) => !isPractice(m));
const pracMatches = () => matches().filter(isPractice);
const dayOf = (iso) => { const d = new Date(iso); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hhmm = (ms) => { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
// Stage order as matches appear, so the per-stage minute fields follow the format
const stagesInUse = () => [...new Set(compMatches().map((m) => m.stage))];
const minOf = (st) => +(sc.mins[st] ?? DEF_MIN[st] ?? 12);
// Give each item a start time from t0, one after another; a match that would run into a break starts after it
function timeline(day, start, items, durOf) {
  const at = (hm) => new Date(day + "T" + hm + ":00").getTime();
  const brs = sc.breaks.filter((x) => x.at && +x.min > 0).map((x) => ({ s: at(x.at), e: at(x.at) + x.min * 60000 })).sort((x, y) => x.s - y.s);
  let t = at(start); const out = [];
  items.forEach((it) => {
    const d = durOf(it) * 60000;
    for (const br of brs) if (t < br.e && t + d > br.s) t = br.e;
    out.push({ it, t }); t += d;
  });
  return out;
}
function breaksHtml() {
  return `<div class="tl"><b>ช่วงพัก</b><span class="muted">ใช้ทั้งวันแข่งและวันซ้อม คู่ที่จะคาบเกี่ยวช่วงพักจะเลื่อนไปเริ่มหลังพัก</span>
    ${sc.breaks.map((x, i) => `<div class="row"><input type="time" value="${esc(x.at)}" data-brk="${i}" data-bk="at"><input type="number" min="5" step="5" value="${x.min}" data-brk="${i}" data-bk="min" style="max-width:90px"><span class="muted">นาที</span>
      <input value="${esc(x.label || "")}" placeholder="ชื่อช่วงพัก" data-brk="${i}" data-bk="label"><button class="btn small" data-act="brdel" data-i="${i}">ลบ</button></div>`).join("")}
    <div class="row"><button class="btn small" data-act="bradd">+ เพิ่มช่วงพัก</button></div></div>`;
}
function scheduleView() {
  const first = compMatches().find((m) => m.sched_at), pfirst = pracMatches().find((m) => m.sched_at);
  if (!sc.day) sc.day = first ? dayOf(first.sched_at) : todayStr();
  if (!sc.pday) sc.pday = pfirst ? dayOf(pfirst.sched_at) : todayStr();
  const stages = stagesInUse(), present = practiceTeams(), nT = present.length;
  const prows = pracMatches().map((m) => `<tr><td><b>${m.code}</b></td><td>${m.sched_at ? hm(m.sched_at) : ""}</td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td><td>Bo${m.bo}</td><td><span class="pill ${m.status}">${ST_EN[m.status]}</span></td></tr>`).join("");
  return `<div class="h2"><h2>ตารางเวลา</h2><span>จัดเวลาแข่งและวันซ้อม เวลาพักไม่นับเป็นเวลาคิว พิมพ์หรือบันทึกเป็น PDF ได้</span></div>
   <div class="card tools sched"><div class="tl"><b>ตารางแข่ง</b>
     <div class="gf" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
       <label>วันแข่ง<input type="date" data-sc="day" value="${sc.day}"></label><label>เวลาเริ่มคู่แรก<input type="time" data-sc="start" value="${sc.start}"></label>
       ${stages.map((st) => `<label>${esc(stageLabel(st))} (นาทีต่อคู่)<input type="number" min="1" value="${minOf(st)}" data-scmin="${st}"></label>`).join("")}
       <label>เรียกขึ้นสนามเองเมื่อถึงเวลา<select data-sc="auto"><option value="1" ${sc.auto ? "selected" : ""}>เปิด</option><option value="0" ${sc.auto ? "" : "selected"}>ปิด</option></select></label></div>
     <div class="row"><button class="btn primary" data-act="autofill">จัดเวลาอัตโนมัติ</button><span class="muted">นาทีต่อคู่รวมเวลาเปลี่ยนคู่แล้ว เติมลงตารางด้านล่าง ตรวจแล้วกดบันทึกเวลา</span></div></div>
     ${breaksHtml()}</div>
   <div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>รอบ</th><th>ทีม</th><th>เวลา</th><th>เรียกอัตโนมัติ</th><th></th></tr></thead><tbody>${compMatches().map((m) => `<tr data-sc="${m.code}"><td><b>${m.code}</b></td><td class="muted">${esc(stageLabel(m.stage))} Bo${m.bo}</td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td>
     <td>${m.status === "done" ? `<span class="muted">${hm(m.sched_at)} จบแล้ว</span>` : `<input type="time" data-k="at" value="${hm(m.sched_at)}">`}</td>
     <td>${m.status === "done" ? "" : `<input type="checkbox" data-k="auto" ${m.auto_open ? "checked" : ""} aria-label="เปิดอัตโนมัติ ${m.code}">`}</td><td>${m.sched_at && m.status !== "done" ? `<button class="btn small" data-act="clearsc">ล้าง</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
   <div class="btns"><button class="btn primary" data-act="savesc">บันทึกเวลา</button><select id="pdfstage" class="sm"><option value="">ทุกรอบ</option>${stages.map((st) => `<option value="${esc(st)}">${esc(stageLabel(st))}</option>`).join("")}</select>
     <label class="chk2"><input type="checkbox" id="pdfnp">ขึ้นหน้าใหม่ทุกรอบ</label><button class="btn" data-act="pdfcomp">พิมพ์ / PDF ตารางแข่ง</button></div>

   <div class="h2" style="margin-top:26px"><h2>วันซ้อม</h2><span>จับคู่ซ้อมแข่งจริง กรรมการใช้หน้าเดิม ผลไม่นับเข้าตารางคะแนนหรือสายแข่ง</span></div>
   <div class="card tools sched"><div class="tl">
     <div class="gf" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">
       <label>วันซ้อม<input type="date" data-sc="pday" value="${sc.pday}"></label><label>เวลาเริ่ม<input type="time" data-sc="pstart" value="${sc.pstart}"></label>
       <label>ทีมละกี่คู่<input type="number" min="1" max="${Math.max(1, nT - 1)}" value="${sc.pgames}" data-sc="pgames"></label>
       <label>Bo<select data-sc="pbo">${[1, 3, 5].map((n) => `<option value="${n}" ${+sc.pbo === n ? "selected" : ""}>Bo${n}</option>`).join("")}</select></label>
       <label>นาทีต่อคู่<input type="number" min="1" value="${sc.pmin}" data-sc="pmin"></label></div>
     <div class="tl"><b>ทีมที่มาซ้อม</b><span class="muted">เอาติ๊กออกถ้าทีมไม่มา จะจับคู่เฉพาะทีมที่มา (ไม่กระทบการแข่งจริง)</span>
       <div class="pteams">${teamsArr().map((t) => `<label class="chk2"><input type="checkbox" data-pteam="${t.seed}" ${(sc.pabsent || []).includes(t.seed) ? "" : "checked"}>${esc(teamName(t.seed))}</label>`).join("")}</div></div>
     <div class="row"><span class="muted">${nT} ทีม ทีมละ ${sc.pgames} คู่ รวม ${(nT * sc.pgames) % 2 ? "ไม่ลงตัว (จำนวนทีม × คู่ ต้องเป็นเลขคู่)" : (nT * sc.pgames) / 2 + " คู่"}</span></div>
     <div class="row"><button class="btn primary" data-act="pracgen">สุ่มคู่ซ้อมและจัดเวลา</button><button class="btn" data-act="pdfprac" ${prows ? "" : "disabled"}>พิมพ์ / PDF ตารางซ้อม</button><button class="btn danger" data-act="pracclear" ${prows ? "" : "disabled"}>ล้างการซ้อม</button></div></div></div>
   ${prows ? `<div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>เวลา</th><th>ทีม</th><th>Bo</th><th>สถานะ</th></tr></thead><tbody>${prows}</tbody></table></div>` : `<p class="muted">ยังไม่มีคู่ซ้อม</p>`}`;
}
function readSchedule() {
  const day = sc.day || todayStr(), out = [];
  document.querySelectorAll("tr[data-sc]").forEach((tr) => {
    const code = tr.dataset.sc, m = match(code); if (!m || m.status === "done") return;
    const t = tr.querySelector('[data-k="at"]').value, a = tr.querySelector('[data-k="auto"]').checked;
    out.push({ code, at: t ? new Date(day + "T" + t + ":00").toISOString() : null, auto: !!(t && a) });
  });
  return out;
}
function autofill() {
  if (!sc.start) return toast("ใส่เวลาเริ่มคู่แรกก่อน", true);
  const rows = [...document.querySelectorAll("tr[data-sc]")].filter((tr) => ["locked", "ready"].includes(match(tr.dataset.sc)?.status));
  timeline(sc.day || todayStr(), sc.start, rows, (tr) => minOf(match(tr.dataset.sc).stage)).forEach(({ it, t }) => {
    it.querySelector('[data-k="at"]').value = hhmm(t); it.querySelector('[data-k="auto"]').checked = !!sc.auto;
  });
  toast("จัดเวลาแล้ว ตรวจแล้วกดบันทึกเวลา");
}
// Printable schedule in a new window; the browser print dialog saves it as PDF.
// One section per round (each can start on a new page), red and blue teams in their own columns
function printSchedule(title, list, day, newPage) {
  const w = window.open("", "_blank"); if (!w) return toast("เบราว์เซอร์บล็อกหน้าต่างใหม่", true);
  const at = (hm) => new Date(day + "T" + hm + ":00").getTime();
  const brs = sc.breaks.filter((x) => x.at && +x.min > 0).map((x) => ({ s: at(x.at), x })).sort((a, b) => a.s - b.s);
  const used = new Set(), stages = [...new Set(list.map((m) => m.stage))];
  const rnd = (st) => (st === "practice" ? "คู่ซ้อม" : stageLabel(st));
  const sections = stages.map((st) => {
    const rows = [];
    list.filter((m) => m.stage === st).forEach((m) => {
      const t = m.sched_at ? Date.parse(m.sched_at) : null;
      brs.forEach((b, i) => { if (t != null && !used.has(i) && b.s <= t) { used.add(i); rows.push(`<tr class="br"><td>${esc(b.x.at)}</td><td colspan="4">${esc(b.x.label || "พัก")} ${b.x.min} นาที</td></tr>`); } });
      rows.push(`<tr><td>${t != null ? hhmm(t) : "-"}</td><td><b>${esc(m.code)}</b>${m.grp ? `<div class="g">${esc(grpName(m.grp))}</div>` : ""}</td><td class="r">${esc(sideName(m, "red"))}</td><td class="b">${esc(sideName(m, "blue"))}</td><td>Bo${m.bo}</td></tr>`);
    });
    return `<section${newPage ? ' class="np"' : ""}><h2>${esc(rnd(st))} <span>${list.filter((m) => m.stage === st).length} คู่</span></h2>
      <table><thead><tr><th style="width:70px">เวลา</th><th style="width:90px">คู่</th><th>ทีมแดง</th><th>ทีมน้ำเงิน</th><th style="width:50px">Bo</th></tr></thead><tbody>${rows.join("")}</tbody></table></section>`;
  }).join("");
  w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:system-ui,sans-serif;margin:24px;color:#16191B}h1{font-size:20px;margin:0 0 4px}p.d{margin:0 0 10px;color:#5D6663}
    h2{font-size:16px;margin:18px 0 6px}h2 span{font-weight:400;color:#5D6663;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}th,td{border:1px solid #C9CFCC;padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#F1F3F2}
    td.r{border-left:5px solid #CF3A2E}td.b{border-left:5px solid #2457C5}.g{font-size:11px;color:#5D6663}
    tr.br td{background:#FFF4CC;font-weight:600}section.np+section.np{break-before:page}@page{size:A4;margin:12mm}</style></head><body>
    <h1>${esc(event().name || "Alvik")} : ${esc(title)}</h1><p class="d">${esc(day)}</p>${sections}
    <script>setTimeout(()=>print(),300)<\/script></body></html>`);
  w.document.close();
}

// ---------- Standings tab ----------
function groupsView() {
  const n = groups().length || 1, cols = innerWidth < 760 ? 1 : n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  return `<div class="grid5 stand" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${groups().map((gr) => { const G = gr.grp;
    const rows = tableOf(G), tiedAny = rows.some((r) => r.tied), seeds = rows.filter((r) => r.seed != null).map((r) => r.seed), tb = T.a2_tiebreak.get(G);
    return `<div><div class="h2"><h2>${esc(grpName(G))}</h2><span>${stageLabel(gr.stage)} เข้ารอบ ${gr.adv} ทีม</span></div>
      <div class="tw"><table class="tbl"><thead><tr><th>#</th><th>ทีม</th><th class="num">ชนะ-แพ้</th><th class="num">เกม</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.tied ? "tied" : ""}"><td>${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) : "รอผล"}${r.how ? `<div class="muted" style="font-size:13px">${esc(r.how)}</div>` : ""}</td><td class="num">${r.mw}-${r.ml}</td><td class="num">${r.gw}-${r.gl}</td>
        <td>${r.tied && i > 0 && rows[i - 1].tied && r.seed != null ? `<button class="btn small" data-act="tbup" data-g="${G}" data-s="${r.seed}">ขึ้น</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${tiedAny ? `<div class="warn">มีทีมเสมอกันทุกเกณฑ์ กดขึ้นเพื่อให้ทีมนั้นอยู่เหนือทีมข้างบน</div>` : ""}${tb ? `<div class="btns"><button class="btn small" data-act="tbclear" data-g="${G}">ล้างการตัดสินลำดับ</button></div>` : ""}</div>`;
  }).join("")}</div>`;
}

// ---------- Matches tab ----------
const matchesView = () => `<div class="h2"><h2>รายการคู่</h2><span>แก้ผลรายเกมได้ทุกคู่ แม้จบแล้ว ระบบคำนวณอันดับและผู้ชนะใหม่ให้เอง</span></div>
  <div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>รอบ</th><th>ทีม</th><th class="num">สกอร์</th><th>สถานะ</th><th></th></tr></thead><tbody>${matches().map((m) => `<tr><td><b>${m.code}</b></td><td>${stageLabel(m.stage)}${m.grp ? " สาย " + m.grp : ""} Bo${m.bo}</td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td><td class="num">${m.red_wins}-${m.blue_wins}</td><td><span class="pill ${m.status}">${ST_EN[m.status]}</span></td><td><button class="btn small" data-act="edit" data-c="${m.code}">เปิด</button></td></tr>`).join("")}</tbody></table></div>`;

// ---------- Match dialog ----------
let dlgCode = "", dlgSig = "";
const sigOf = (c) => JSON.stringify([match(c), gamesOf(c), gamesOf(c).map((g) => marksOf(g.id).map((x) => x.id + x.voided + x.t_ms))]);
const KIND = { exit_first: "ออกจากกรอบแดงก่อน", lift_first: "ยกแท่นแรก", park: "จอดแท่น +1", unpark: "จอดแท่น -1", complete: "ภารกิจสำเร็จ (Mission complete)", retry: "Retry", false_start: "ออกตัวก่อน (False start)" };
const GST = { ready: "ยังไม่เริ่ม", live: "กำลังแข่ง", review: "รอรับรองผล", done: "จบแล้ว", replay: "เสมอ แข่งใหม่", void: "ยกเลิก" };
function gameBlock(m, g) {
  const n = gameNo(m.code, g), pv = g.need === "judge" ? { need: "judge" } : decideV3(g), mk = marksOf(g.id);
  const res = g.winner ? `${sideTh(g.winner)}ชนะ, ${RULE_TH[g.method] || g.method || ""}${g.decided_by === "admin" ? " (แอดมิน)" : ""}` : pv.side ? `ถ้ารับรองตอนนี้ ${sideTh(pv.side)}ชนะ, ${RULE_TH[pv.method]}` : pv.need === "replay" ? "เสมอ แข่งใหม่ (FAQ 34)" : "กรรมการต้องตัดสิน (FAQ 35)";
  const row = (x) => `<tr class="${x.voided ? "void" : ""}" data-mid="${x.id}"><td class="num mono">${fmtMs1(x.t_ms)}</td><td>${KIND[x.kind] || x.kind}</td><td class="${x.side === "red" ? "r" : x.side === "blue" ? "b" : ""}">${x.side ? sideTh(x.side) : ""}</td><td class="muted">${x.source}${x.voided ? " (ลบแล้ว)" : ""}</td>
    <td>${x.kind === "false_start" ? "" : x.voided ? `<button class="btn small" data-act="mk" data-op="unvoid">กู้คืน</button>` : `<button class="btn small" data-act="mkedit">แก้เวลา</button> <button class="btn small danger" data-act="mk" data-op="void">ลบ</button>`}</td></tr>`;
  return `<div class="card st-${g.status === "done" ? "done" : g.status === "live" ? "live" : "ready"}" data-g="${g.id}" data-v="${g.version}"><div class="h2"><h2>เกม ${g.status === "replay" ? "(แข่งใหม่)" : n}</h2><span class="pill">${GST[g.status] || g.status}</span><span>${esc(res)}</span></div>
    <div class="muted">แบบสนาม ${g.pattern || "-"}, จอดแท่น แดง ${g.red_parked} น้ำเงิน ${g.blue_parked}, Retry แดง ${g.red_retries || 0} น้ำเงิน ${g.blue_retries || 0}</div>
    <div class="tw"><table class="tbl evl"><thead><tr><th class="num">เวลา</th><th>เหตุการณ์</th><th>ฝั่ง</th><th>ที่มา</th><th></th></tr></thead><tbody>${mk.map(row).join("") || `<tr><td colspan="5" class="muted">ยังไม่มีเหตุการณ์</td></tr>`}</tbody></table></div>
    <div class="gf" style="grid-template-columns:repeat(4,minmax(0,1fr))"><label>เหตุการณ์<select data-n="kind">${Object.entries(KIND).filter(([k]) => k !== "false_start").map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
      <label>ฝั่ง<select data-n="side"><option value="red">แดง</option><option value="blue">น้ำเงิน</option><option value="both">พร้อมกัน</option></select></label>
      <label>เวลา (m:ss.s)<input data-n="t" placeholder="0:12.5"></label><button class="btn" data-act="mkadd">เพิ่มเหตุการณ์</button></div>
    <div class="btns"><label class="muted">แบบสนาม <select data-k="pattern"><option value="">-</option>${[1, 2, 3].map((i) => `<option ${g.pattern === i ? "selected" : ""}>${i}</option>`).join("")}</select></label><button class="btn" data-act="gsave">บันทึกแบบสนาม</button>
      ${g.status === "review" || g.status === "done" ? `<button class="btn primary" data-act="gauto">ตัดสินตามกติกา</button>` : ""}
      <button class="btn red" data-act="gwin" data-w="red">แดงชนะ</button><button class="btn blue" data-act="gwin" data-w="blue">น้ำเงินชนะ</button>
      ${g.winner ? `<button class="btn" data-act="gwin" data-w="">ล้างผู้ชนะ</button>` : ""}<button class="btn danger" data-act="gvoid">ลบเกม</button></div></div>`;
}
const parseT = (v) => { v = String(v || "").trim(); if (!v) return 0; const m = v.match(/^(\d+):(\d{1,2})(?:\.(\d))?$/); if (m) return (+m[1] * 60 + +m[2]) * 1000 + (+m[3] || 0) * 100; if (/^\d+(\.\d)?$/.test(v)) return Math.round(+v * 1000); return NaN; };
function dlgHtml(code) {
  const m = match(code), gs = gamesOf(code), free = !field(1)?.match_code || match(field(1).match_code)?.status === "done";
  dlgSig = sigOf(code);
  return `<div class="dh"><h2>คู่ ${m.code}  ${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}  <span class="muted">${m.red_wins}-${m.blue_wins}</span></h2><span class="pill ${m.status}">${ST_EN[m.status]}</span><button class="btn" data-act="dclose">ปิด</button></div>
   <div class="db">${m.walkover ? `<div class="warn">ชนะบาย ${esc(sideName(m, m.walkover === "red" ? "blue" : "red"))} ชนะ เพราะ ${esc(sideName(m, m.walkover))} ไม่มา ${m.forfeit ? "" : "(ตั้งทีมนี้เป็นไม่มาไว้ในแท็บทีม)"}</div>` : ""}<div class="warn" id="dwarn" hidden>ข้อมูลคู่นี้เพิ่งเปลี่ยนจากที่อื่น <button class="btn small" data-act="dreload">โหลดใหม่</button> </div>
   ${gs.length ? gs.map((g) => gameBlock(m, g)).join("") : `<p class="muted">ยังไม่มีเกมในคู่นี้ ${m.status === "locked" ? "คู่นี้ยังรอผลคู่ก่อนหน้า" : "เกมแรกจะถูกสร้างตอนเปิดคิว หรือกดเพิ่มเกมด้านล่าง"}</p>`}
   <div class="btns"><button class="btn" data-act="gadd" ${m.status === "locked" ? "disabled" : ""}>เพิ่มเกม</button>${!gs.length && m.status !== "done" ? `<button class="btn" data-act="swap">สลับฝั่ง</button>` : ""}
   ${(m.red_seed != null && m.blue_seed != null && m.status !== "done") || m.forfeit ? ["red", "blue"].map((sd) => `<button class="btn danger" data-act="ff" data-s="${sd}">${esc(sideName(m, sd))} ไม่มา (แพ้บาย)</button>`).join("") : ""}${m.forfeit ? `<button class="btn" data-act="ff" data-s="">ยกเลิกแพ้บาย</button>` : ""}
   ${m.status === "ready" && free ? `<button class="btn primary" data-act="open" data-c="${m.code}" data-keep="1">เรียกขึ้นสนาม</button>` : ""}</div></div>`;
}
function openDlg(code) { dlgCode = code; dlg.innerHTML = dlgHtml(code); if (!dlg.open) dlg.showModal(); }
function updateDlgBanner() { if (!dlg.open || !dlgCode) return; const w = $("dwarn"); if (w) w.hidden = sigOf(dlgCode) === dlgSig; }
dlg.addEventListener("close", () => { dlgCode = ""; });
function readGame(card) { const v = card.querySelector('[data-k="pattern"]').value; return { pattern: v ? +v : null }; }

// ---------- Teams tab ----------
// Format being edited. Starts from the stored format and is only saved by Apply format
let fmt = null;
const curFormat = () => fmtNormalize(event().format);
const fmtEdit = () => (fmt ||= structuredClone(curFormat()));
const koOf = (f) => f.rounds.find((r) => r.type === "ko") || null;
const totalGroupsCount = (f) => f.rounds.filter((r) => r.type === "groups").reduce((s, r) => s + r.groups.length, 0);
const slotLabel = (k) => (!k ? "บาย" : srcLabel(parseSrcKey(k)) || k);
const boOpts = (cur) => BOS.map((n) => `<option value="${n}" ${+cur === n ? "selected" : ""}>Bo${n}</option>`).join("");
const stageOpts = (cur) => [...new Set([...STAGE_CHOICES, ...(cur ? [cur] : [])])].map((s) => `<option value="${esc(s)}" ${s === cur ? "selected" : ""}>${esc(stageLabel(s))}</option>`).join("");

function clearDownstream(f, afterRoundIdx) {
  f.rounds.forEach((r, idx) => {
    if (idx <= afterRoundIdx) return;
    if (r.type === "groups") r.groups.forEach((g) => { g.srcs = null; });
    else if (r.type === "ko") { r.slots = null; r.links = null; }
  });
}

function fmtSummary(f, built = null) {
  const err = validateFormat(f, built);
  if (err.length) return `<div class="warn">${err.map(esc).join("<br>")}</div>`;
  const b = built || buildFormat(f), gm = b.matches.filter((m) => m.grp), ko = b.matches.filter((m) => !m.grp), st = [...new Set(ko.map((m) => stageLabel(m.stage)))];
  return `<p class="muted" style="margin:6px 0 0">${b.format.teams} ทีม, คู่ในกลุ่ม ${gm.length} คู่${ko.length ? `, คู่นอกกลุ่ม ${ko.length} คู่ (${st.join(", ")})` : ", ไม่มีรอบแพ้คัดออก"}</p>`;
}

function groupRoundHtml(f, r, rIdx) {
  const totG = totalGroupsCount(f), prev = rIdx > 0 ? f.rounds[rIdx - 1] : null;
  const rows = r.groups.map((g, gi) => `<tr><td><b>${g.grp}</b></td>
    <td><input type="number" min="2" max="64" value="${g.size}" data-ri="${rIdx}" data-gi="${gi}" data-gk="size"></td>
    <td><input type="number" min="0" max="${g.size}" value="${g.adv}" data-ri="${rIdx}" data-gi="${gi}" data-gk="adv"></td>
    <td>${r.groups.length > 1 ? `<button class="btn small" data-act="fgdel" data-ri="${rIdx}" data-i="${gi}">ลบ</button>` : ""}</td></tr>`).join("");
  let slotsHtml = "";
  if (prev) {
    const prevQ = roundQualifiers(prev), rSize = r.groups.reduce((s, g) => s + (g.size > 0 ? g.size : 0), 0);
    if (prevQ.length >= 2 && rSize === prevQ.length) {
      const buckets = resolveRoundGroupSlots(f, rIdx), opts = prevQ.map(srcKey), custom = r.groups.some((g) => Array.isArray(g.srcs));
      slotsHtml = `<div class="fsub"><div class="h3"><span>การวางสาย (${custom ? "กำหนดเอง" : "อัตโนมัติ"})</span><button class="btn small" data-act="rauto" data-ri="${rIdx}">วางอัตโนมัติ</button></div>
        <div class="fslots-grp">${r.groups.map((g, gi) => `<div class="fslots-row"><b>กลุ่ม ${g.grp} :</b>${(buckets[gi] || []).map((k, si) =>
          `<select data-rslot="${rIdx}:${gi}:${si}">${opts.map((o) => `<option value="${esc(o)}" ${o === k ? "selected" : ""}>${esc(slotLabel(o))}</option>`).join("")}</select>`).join("")}</div>`).join("")}</div></div>`;
    } else if (prevQ.length >= 2) {
      slotsHtml = `<div class="muted" style="margin-top:8px">ปรับจำนวนช่องรวมในกลุ่ม (${rSize}) ให้เท่ากับทีมที่ผ่านจาก ${stageLabel(prev.id)} (${prevQ.length}) ก่อน จึงจะแก้การวางสายได้</div>`;
    }
  }
  return `<div class="fround"><div class="fh"><h3>${stageLabel(r.id)}</h3>
    <label>Bo <select data-rgbo="${rIdx}">${boOpts(r.bo)}</select></label>
    ${f.rounds.length > 1 ? `<button class="btn small" data-act="frdel" data-ri="${rIdx}">ลบรอบ</button>` : ""}</div>
    <table class="tbl fg"><thead><tr><th>กลุ่ม</th><th>ทีม</th><th>เข้ารอบ</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="btns"><button class="btn small" data-act="fgadd" data-ri="${rIdx}" ${totG >= 26 ? "disabled" : ""}>+ เพิ่มกลุ่ม</button></div>
    ${slotsHtml}</div>`;
}

function koRoundHtml(f, ko, built = null) {
  const b = built || buildFormat(f);
  const subs = b.koStages.map((st) => {
    const opts = [...(st.allowBye ? [""] : []), ...st.options], pairs = [];
    for (let i = 0; i < st.slots.length; i += 2) pairs.push([i, st.slots[i], st.slots[i + 1]]);
    const sel = (i, v) => `<select data-kos="${st.stage}:${i}" data-sub="${st.subIdx}">${opts.map((k) => `<option value="${esc(k)}" ${k === (v || "") ? "selected" : ""}>${esc(slotLabel(k))}</option>`).join("")}</select>`;
    return `<div class="fsub"><div class="fh"><b>${esc(st.label)}</b>
      <label>Bo <select data-kobo="${st.stage}">${boOpts(st.bo)}</select></label>
      <span class="muted">${st.custom ? "กำหนดเอง" : "อัตโนมัติ"}</span>
      <button class="btn small" data-act="fslotauto" data-st="${st.stage}">จัดอัตโนมัติ</button></div>
      <div class="slots">${pairs.map(([i, red, blue]) => `<div class="pr">${sel(i, red)}<span>พบ</span>${sel(i + 1, blue)}</div>`).join("")}</div></div>`;
  }).join("");
  return `<div class="fround"><div class="fh"><h3>รอบแพ้คัดออก</h3>
    <label class="chk2"><input type="checkbox" data-kothird="1" ${ko.third ? "checked" : ""}>มีคู่ชิงอันดับที่ 3</label>
    ${b.koStages.length ? `<button class="btn small" data-act="fslotauto" data-st="">จัดใหม่ทุกช่อง</button>` : ""}
    ${f.rounds.length > 1 ? `<button class="btn small" data-act="frdelko">ลบรอบแพ้คัดออก</button>` : ""}</div>
    ${subs || `<div class="muted">ต้องมีทีมผ่านจากรอบก่อนอย่างน้อย 2 ทีม</div>`}</div>`;
}

let _cSrcCache = null;
function customSrcItems(f) {
  if (_cSrcCache && _cSrcCache.f === f) return _cSrcCache.items;
  const items = [];
  for (let s = 1; s <= f.teams; s++) { const k = "s" + s; items.push({ k, code: "", html: `<option value="${esc(k)}">${esc(slotLabel(k))}</option>` }); }
  (f.customGroups || []).forEach((g) => { for (let p = 1; p <= g.srcs.length; p++) { const k = g.grp + p; items.push({ k, code: "", html: `<option value="${esc(k)}">${esc(slotLabel(k))}</option>` }); } });
  (f.customMatches || []).forEach((m) => {
    if (!m.code) return;
    items.push({ k: "w:" + m.code, code: m.code, html: `<option value="${esc("w:" + m.code)}">${esc(slotLabel("w:" + m.code))}</option>` });
    items.push({ k: "l:" + m.code, code: m.code, html: `<option value="${esc("l:" + m.code)}">${esc(slotLabel("l:" + m.code))}</option>` });
  });
  _cSrcCache = { f, items };
  return items;
}
function customSrcOpts(f, excludeCode, curVal) {
  const items = customSrcItems(f);
  const parts = [`<option value="">เลือก</option>`];
  let found = !curVal;
  for (const it of items) {
    if (excludeCode && it.code === excludeCode) continue;
    if (it.k === curVal) found = true;
    parts.push(it.html);
  }
  if (!found) parts.splice(1, 0, `<option value="${esc(curVal)}">${esc(slotLabel(curVal))}</option>`);
  return parts.join("");
}
function slimSrcOpt(curVal) {
  const v = curVal || "";
  return `<option value="${esc(v)}" selected>${esc(v ? slotLabel(v) : "เลือก")}</option>`;
}

function customFormatHtml(f) {
  _cSrcCache = null;
  const cGrps = f.customGroups || [], cMs = f.customMatches || [];
  const gRows = cGrps.map((g, gi) => `<tr>
    <td><input maxlength="1" style="width:46px" value="${esc(g.grp)}" data-cgi="${gi}" data-cgk="grp"></td>
    <td><select data-cgi="${gi}" data-cgk="stage">${stageOpts(g.stage)}</select></td>
    <td><input type="number" min="0" max="${g.srcs.length}" style="width:64px" value="${g.adv}" data-cgi="${gi}" data-cgk="adv"></td>
    <td><div class="fslots-row">${g.srcs.map((k, si) => `<select data-cgslot="${gi}:${si}" data-csrc="1">${slimSrcOpt(k)}</select>`).join("")}
      <button class="btn small" data-act="cgslotadd" data-i="${gi}">+ช่อง</button>
      ${g.srcs.length > 1 ? `<button class="btn small" data-act="cgslotdel" data-i="${gi}">-ช่อง</button>` : ""}</div></td>
    <td><button class="btn small" data-act="cgrr" data-i="${gi}">สร้างคู่พบกันหมด</button> <button class="btn small" data-act="cgdel" data-i="${gi}">ลบ</button></td></tr>`).join("");
  const gSelOpts = (cur) => `<option value="">ไม่มี</option>` + cGrps.map((g) => `<option value="${g.grp}" ${g.grp === cur ? "selected" : ""}>กลุ่ม ${g.grp}</option>`).join("");
  const mRows = cMs.map((m, mi) => `<tr><td class="num">${mi + 1}</td>
    <td><input maxlength="8" style="width:82px" value="${esc(m.code)}" data-cmi="${mi}" data-cmk="code"></td>
    <td><select data-cmi="${mi}" data-cmk="stage">${stageOpts(m.stage)}</select></td>
    <td><select data-cmi="${mi}" data-cmk="grp">${gSelOpts(m.grp || "")}</select></td>
    <td><select data-cmi="${mi}" data-cmk="bo">${boOpts(m.bo)}</select></td>
    <td><select data-cmi="${mi}" data-cmk="red" data-csrc="1">${slimSrcOpt(m.red)}</select></td>
    <td><select data-cmi="${mi}" data-cmk="blue" data-csrc="1">${slimSrcOpt(m.blue)}</select></td>
    <td><button class="btn small" data-act="cmup" data-i="${mi}" ${mi === 0 ? "disabled" : ""}>ขึ้น</button>
      <button class="btn small" data-act="cmdn" data-i="${mi}" ${mi === cMs.length - 1 ? "disabled" : ""}>ลง</button>
      <button class="btn small danger" data-act="cmdel" data-i="${mi}">ลบ</button></td></tr>`).join("");
  return `<div class="fround"><div class="fh"><h3>กลุ่มที่กำหนดเอง</h3><button class="btn small" data-act="cgadd" ${cGrps.length >= 26 ? "disabled" : ""}>+ เพิ่มกลุ่ม</button></div>
    ${cGrps.length ? `<div class="tw"><table class="tbl ctbl"><thead><tr><th>กลุ่ม</th><th>รอบ</th><th>เข้ารอบ</th><th>ช่องทีม</th><th></th></tr></thead><tbody>${gRows}</tbody></table></div>` : `<div class="muted">ยังไม่มีกลุ่ม</div>`}</div>
    <div class="fround"><div class="fh"><h3>คู่ที่กำหนดเอง (${cMs.length})</h3><button class="btn small" data-act="cmadd" ${cMs.length >= 400 ? "disabled" : ""}>+ เพิ่มคู่</button></div>
    <div class="tw"><table class="tbl ctbl"><thead><tr><th>#</th><th>รหัส</th><th>รอบ</th><th>กลุ่ม</th><th>Bo</th><th>แดง</th><th>น้ำเงิน</th><th></th></tr></thead><tbody>${mRows}</tbody></table></div></div>`;
}

// ---------- Quick setup : the few settings most events need. Details stay in a collapsed section ----------
let fmtDetOpen = false;
// ---------- Pool format : one pool with random pairings, top teams drawn into groups, then cross semifinals ----------
const POOL_DEF = { mode: "pool", games: 4, adv: 6, groups2: 2, adv2: 2, bo_pool: 3, bo_group: 3, bo_ko: 3, bo_final: 5, third: false };
// Random pairings where every team plays exactly k different opponents. n * k must be even
function poolPairs(n, k) {
  for (let tries = 0; tries < 3000; tries++) {
    const stubs = []; for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) stubs.push(i);
    for (let i = stubs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [stubs[i], stubs[j]] = [stubs[j], stubs[i]]; }
    const seen = new Set(), pairs = []; let ok = true;
    for (let i = 0; i < stubs.length; i += 2) {
      const a = Math.min(stubs[i], stubs[i + 1]), b = Math.max(stubs[i], stubs[i + 1]);
      if (a === b || seen.has(a + ":" + b)) { ok = false; break; }
      seen.add(a + ":" + b); pairs.push([a, b]);
    }
    if (!ok) continue;
    // Order into rounds so a team does not play twice in a row where possible, and alternate red and blue
    const order = [], left = pairs.slice(), plays = Array(n).fill(0), last = new Set();
    while (left.length) {
      left.sort((x, y) => (last.has(x[0]) + last.has(x[1])) - (last.has(y[0]) + last.has(y[1])) || (plays[x[0]] + plays[x[1]]) - (plays[y[0]] + plays[y[1]]));
      const [a, b] = left.shift(); plays[a]++; plays[b]++; last.clear(); last.add(a); last.add(b);
      order.push([a, b]);
    }
    return balanceSides(order, n);
  }
  return null;
}
// Choose red and blue so every team plays both sides as evenly as possible.
// The pairs form trails : walking them and giving the team we come from red makes red and blue equal
// for every team when each plays an even number of matches, and differ by one when it is odd.
function balanceSides(pairs, n) {
  const adj = Array.from({ length: n }, () => []), used = pairs.map(() => false), out = pairs.map((p) => p.slice());
  pairs.forEach(([a, b], i) => { adj[a].push(i); adj[b].push(i); });
  const starts = [...Array(n).keys()].sort((x, y) => (adj[y].length % 2) - (adj[x].length % 2));   // odd degree first
  for (const s of starts) {
    let v = s;
    for (;;) {
      const i = adj[v].find((e) => !used[e]); if (i === undefined) break;
      used[i] = true; const [a, b] = pairs[i], w = a === v ? b : a;
      out[i] = [v, w]; v = w;
    }
  }
  return out;
}
function poolCheck(q) {
  const n = +q.teams, k = +q.games, A = +q.adv, G = +q.groups2, a2 = +q.adv2;
  if (n < 3) return "ต้องมีอย่างน้อย 3 ทีม";
  if (k < 1 || k > n - 1) return `เล่นได้ 1 ถึง ${n - 1} ครั้ง`;
  if ((n * k) % 2) return `${n} ทีมเล่นเท่ากันได้เฉพาะจำนวนครั้งที่เป็นเลขคู่ เช่น ${[2, 4, 6].filter((x) => x <= n - 1).join(", ")}`;
  if (A < 2 || A > n) return "ทีมที่เข้ารอบสองต้องเป็น 2 ถึงจำนวนทีม";
  if (G < 1 || A < G * 2) return "แต่ละกลุ่มรอบสองต้องมีอย่างน้อย 2 ทีม";
  if (![1, 2, 4].includes(G * a2)) return "ทีมที่ไปรอบรองรวมต้องเป็น 2 หรือ 4 ทีม";
  return "";
}
function poolFormat(q) {
  const n = Math.trunc(+q.teams), err = poolCheck(q);
  const f = { teams: n, rounds: [], customGroups: [], customMatches: [], quick: { ...q, err }, labels: { A: "Qualifying" } };
  if (err) return f;
  const pairs = poolPairs(n, +q.games); if (!pairs) { f.quick.err = "สุ่มคู่ไม่สำเร็จ ลองกดสุ่มใหม่"; return f; }
  f.customGroups.push({ grp: "A", stage: "r1", adv: +q.adv, srcs: [...Array(n).keys()].map((i) => "s" + (i + 1)) });
  pairs.forEach(([a, b], i) => f.customMatches.push({ code: "A" + (i + 1), stage: "r1", grp: "A", bo: +q.bo_pool, red: "s" + (a + 1), blue: "s" + (b + 1) }));
  // Draw the qualifying places into the second round groups at random, sizes as even as possible
  const places = [...Array(+q.adv).keys()].map((i) => "A" + (i + 1));
  for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
  const G = +q.groups2, letters = [...Array(G).keys()].map((i) => String.fromCharCode(66 + i));
  letters.forEach((L, gi) => {
    const srcs = places.filter((_, i) => i % G === gi);
    f.customGroups.push({ grp: L, stage: "r2", adv: +q.adv2, srcs });
    f.labels[L] = G === 1 ? "Final group" : "QF" + (gi + 1);
    buildGroupMatches(L, "r2", srcs.map(parseSrcKey), +q.bo_group).forEach((m) => f.customMatches.push({ code: m.code, stage: "r2", grp: L, bo: +q.bo_group, red: srcKey(m.red_src), blue: srcKey(m.blue_src) }));
  });
  // Knockout from the second round : 4 teams cross (1st of one group meets 2nd of the other), 2 teams go straight to the final
  const Q = []; for (let p = 1; p <= +q.adv2; p++) letters.forEach((L) => Q.push(L + p));
  if (Q.length === 4) {
    // Q is [1st of each group..., 2nd of each group...] : the best place meets the weakest, so two groups cross
    f.customMatches.push({ code: "SF1", stage: "sf", grp: null, bo: +q.bo_ko, red: Q[0], blue: Q[3] });
    f.customMatches.push({ code: "SF2", stage: "sf", grp: null, bo: +q.bo_ko, red: Q[1], blue: Q[2] });
    if (q.third) f.customMatches.push({ code: "3P", stage: "third", grp: null, bo: +q.bo_ko, red: "l:SF1", blue: "l:SF2" });
    f.customMatches.push({ code: "F", stage: "final", grp: null, bo: +q.bo_final, red: "w:SF1", blue: "w:SF2" });
  } else if (Q.length === 2) f.customMatches.push({ code: "F", stage: "final", grp: null, bo: +q.bo_final, red: Q[0], blue: Q[1] });
  return f;
}
function poolFieldsHtml(q, bo) {
  return `<label>เล่นคนละกี่ครั้ง<input type="number" min="1" max="63" value="${q.games}" data-q="games"></label>
    <label>เข้ารอบสอง<input type="number" min="2" max="64" value="${q.adv}" data-q="adv"></label>
    <label>กลุ่มรอบสอง<input type="number" min="1" max="8" value="${q.groups2}" data-q="groups2"></label>
    <label>เข้ารองชนะเลิศกลุ่มละ<input type="number" min="1" max="4" value="${q.adv2}" data-q="adv2"></label>
    <label>Bo รอบแรก${bo("bo_pool")}</label><label>Bo รอบสอง${bo("bo_group")}</label>
    <label>Bo รองชนะเลิศ${bo("bo_ko")}</label><label>Bo รอบชิง${bo("bo_final")}</label>
    <label class="chk2"><input type="checkbox" data-q="third" ${q.third ? "checked" : ""}>มีชิงที่ 3</label>
    <div style="align-self:end"><button class="btn small" data-act="fpoolshuffle">สุ่มคู่ใหม่</button></div>
    ${q.err ? `<div class="warn" style="grid-column:1/-1">${esc(q.err)}</div>` : ""}`;
}

// Read the quick values back from the current format; "advanced" when the format has more than one group round or custom matches
function quickOf(f) {
  if (f.quick && f.quick.mode === "pool" && Array.isArray(f.customMatches)) return { ...POOL_DEF, ...f.quick, teams: f.teams };
  const g = f.rounds.filter((r) => r.type === "groups"), ko = koOf(f), bo = ko ? ko.bo_by_stage || {} : {};
  const mode = Array.isArray(f.customMatches) || g.length > 1 ? "advanced" : g.length && ko ? "gko" : g.length ? "g" : "ko";
  const g0 = g[0];
  return { mode, teams: f.teams, groups: g0 ? g0.groups.length : 2, adv: g0 ? Math.max(0, ...g0.groups.map((x) => x.adv)) : 2,
    bo_group: g0 ? g0.bo : 3, bo_ko: bo.sf || bo.qf || 3, bo_final: bo.final || 5, third: !!(ko && ko.third) };
}
// Rebuild the format from quick values. Teams are spread as evenly as possible (10 teams in 3 groups : 4, 3, 3)
function quickApply(q) {
  if (q.mode === "pool") { fmt = poolFormat({ ...POOL_DEF, ...q }); return; }
  const teams = Math.max(2, Math.min(64, Math.trunc(+q.teams || 2)));
  const rounds = [];
  if (q.mode !== "ko") {
    const G = Math.max(1, Math.min(Math.floor(teams / 2), 26, Math.trunc(+q.groups || 1)));
    const base = Math.floor(teams / G), extra = teams % G;
    const groups = [...Array(G).keys()].map((i) => { const size = base + (i < extra ? 1 : 0); return { grp: "A", size, adv: q.mode === "g" ? 0 : Math.max(1, Math.min(size, Math.trunc(+q.adv || 1))), srcs: null }; });
    rounds.push({ id: "r1", type: "groups", bo: +q.bo_group || 3, groups });
  }
  if (q.mode !== "g") rounds.push(defaultKoRound({ bo_ko: +q.bo_ko || 3, bo_final: +q.bo_final || 5, third: !!q.third }));
  fmt = reletter({ teams, rounds, customGroups: null, customMatches: null });
}
function quickHtml(f, built) {
  const q = quickOf(f), sel = (k, opts) => `<select data-q="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(q[k]) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select>`;
  const bo = (k) => sel(k, BOS.map((n) => [n, "Bo" + n]));
  if (q.mode === "advanced") return `<div class="fquick"><p class="muted" style="margin:0">รูปแบบนี้ตั้งแบบละเอียดไว้ (หลายรอบกลุ่ม หรือจัดคู่เอง) แก้ได้ในส่วน "ตั้งค่าละเอียด" ด้านล่าง หรือเลือกแบบง่ายใหม่ <button class="btn small" data-act="fquickreset">เริ่มแบบง่ายใหม่</button></p></div>`;
  // Who gets a bye in the first knockout round, so the admin sees it before applying
  const st0 = built && built.koStages && built.koStages[0], byes = st0 ? (() => { const out = []; for (let i = 0; i < st0.slots.length; i += 2) { const a = st0.slots[i], b = st0.slots[i + 1]; if (a && !b) out.push(a); if (b && !a) out.push(b); } return out; })() : [];
  return `<div class="fquick">
    <label>รูปแบบ${sel("mode", [["gko", "แบ่งกลุ่ม แล้วแพ้คัดออก"], ["pool", "รวมสุ่มคู่ แล้วกลุ่ม แล้วรองชนะเลิศ"], ["ko", "แพ้คัดออกล้วน"], ["g", "แบ่งกลุ่มอย่างเดียว"]])}</label>
    <label>จำนวนทีม<input type="number" min="2" max="64" value="${q.teams}" data-q="teams"></label>
    ${q.mode === "pool" ? poolFieldsHtml(q, bo) : ""}
    ${q.mode !== "ko" && q.mode !== "pool" ? `<label>จำนวนกลุ่ม<input type="number" min="1" max="26" value="${q.groups}" data-q="groups"></label>` : ""}
    ${q.mode === "gko" ? `<label>เข้ารอบกลุ่มละ<input type="number" min="1" max="64" value="${q.adv}" data-q="adv"></label>` : ""}
    ${q.mode !== "ko" && q.mode !== "pool" ? `<label>Bo รอบกลุ่ม${bo("bo_group")}</label>` : ""}
    ${q.mode !== "g" && q.mode !== "pool" ? `<label>Bo แพ้คัดออก${bo("bo_ko")}</label><label>Bo รอบชิง${bo("bo_final")}</label>
      <label class="chk2"><input type="checkbox" data-q="third" ${q.third ? "checked" : ""}>มีชิงที่ 3</label>` : ""}
  </div>
  ${byes.length ? `<p class="muted" style="margin:6px 0 0">ได้บายข้ามรอบแรก : ${byes.map((k) => esc(slotLabel(k))).join(", ")}</p>` : ""}`;
}

// Preview of the bracket this format would create, drawn from the built format before it is applied
let fmtPrevOpen = true;
function fmtPreviewHtml(f) {
  let html = "";
  try { if (!validateFormat(f).length) { const b = buildFormat(f); if (b.matches.length) html = bracketHtml({ data: { groups: b.groups, matches: b.matches } }); } } catch (e) { html = ""; }
  return `<details class="fprev" ${fmtPrevOpen ? "open" : ""}><summary>ตัวอย่างตารางแข่ง</summary>${html || `<p class="muted">แก้รูปแบบให้ถูกต้องก่อน จึงจะแสดงตัวอย่างได้</p>`}</details>`;
}

// The whole format card; redrawn after every change
function fmtCard(played) {
  const f = fmtEdit(), isCustom = Array.isArray(f.customMatches), ko = koOf(f), gRounds = f.rounds.filter((r) => r.type === "groups");
  const topBar = `<div class="fh">
    ${isCustom ? `<label>จำนวนทีม <input type="number" min="2" max="64" value="${f.teams}" data-fk="teams" style="width:76px"></label>
      <button class="btn small" data-act="fmtauto">กลับไปใช้ตัวสร้างอัตโนมัติ</button>`
      : `${!gRounds.length ? `<label>จำนวนทีม <input type="number" min="2" max="64" value="${f.teams}" data-fk="teams" style="width:76px"></label>` : ""}
      <button class="btn small" data-act="fraddg" ${totalGroupsCount(f) >= 26 ? "disabled" : ""}>+ รอบแบ่งกลุ่ม</button>
      ${!ko ? `<button class="btn small" data-act="fraddko">+ รอบแพ้คัดออก</button>` : ""}
      <button class="btn small" data-act="fmtcustom">จัดคู่เอง</button>`}</div>`;
  const built = isCustom ? null : buildFormat(f);
  const body = isCustom ? customFormatHtml(f) : f.rounds.map((r, ri) => (r.type === "groups" ? groupRoundHtml(f, r, ri) : koRoundHtml(f, r, built))).join("");
  return `<div class="card fmtc">${quickHtml(f, built)}<div id="fsum">${fmtSummary(f, built)}</div>
    ${fmtPreviewHtml(f)}
    <details class="fdet" ${fmtDetOpen ? "open" : ""}><summary>ตั้งค่าละเอียด : ขนาดแต่ละกลุ่ม หลายรอบกลุ่ม จัดคู่และสายเอง</summary>${topBar}${body}</details>
    <div class="btns"><button class="btn primary" data-act="fmtapply" ${played ? "disabled" : ""}>ใช้รูปแบบนี้</button><button class="btn" data-act="fmtundo">ยกเลิกการแก้</button>${played ? `<span class="muted">มีผลการแข่งแล้ว ต้องล้างผลในแท็บตั้งค่าก่อนเปลี่ยนรูปแบบ</span>` : `<span class="muted">กดใช้รูปแบบนี้จะสร้างคู่ใหม่ทั้งหมด เวลานัดเดิมจะหาย ชื่อทีมยังอยู่</span>`}</div></div>`;
}
function redrawFmt() { const el = document.querySelector(".fmtc"); if (el) { el.outerHTML = fmtCard([...T.a2_game.values()].some((g) => g.status !== "void" && !isPractice(match(g.match_code) || {}))); const n = document.querySelector(".fmtc"); if (n) fitBrackets(n); } }
function teamsView() {
  const t = teamsArr(), draw = event().tv_mode === "draw", played = [...T.a2_game.values()].some((g) => g.status !== "void" && !isPractice(match(g.match_code) || {}));
  const r1 = groups().filter((g) => g.stage === "r1" && g.srcs?.every((x) => x && x.seed != null));
  const cols = r1.length ? r1 : [{ grp: "", srcs: t.map((x) => ({ seed: x.seed })) }];
  return `<div class="h2"><h2>รูปแบบการแข่ง</h2><span>เพิ่มหรือลดรอบกลุ่ม ปรับขนาดแต่ละกลุ่มไม่เท่ากันได้ แก้สายการแข่งได้ทุกรอบ หรือกำหนดแมตช์เองทั้งหมด</span></div>
   ${fmtCard(played)}
   <div class="h2" style="margin-top:20px"><h2>ทีม</h2><span>เลขหน้าชื่อคือลำดับ ทีมอยู่สายตามตำแหน่ง กดสุ่มลำดับเพื่อจับสาย</span></div>
   <div class="teams">${cols.map((g) => `<div class="card grp"><h2>${g.grp ? esc(grpName(g.grp)) : "ทีม (ตามลำดับ)"}</h2>${g.srcs.map((x) => { const sd = x.seed, tm = t.find((y) => y.seed === sd); return `<div><span class="muted">${sd}</span><input data-seed="${sd}" value="${esc(tm?.name || "")}" placeholder="ทีม ${sd}" maxlength="40"><label class="ab"><input type="checkbox" data-abs="${sd}" ${tm?.absent ? "checked" : ""}>ไม่มา</label></div>`; }).join("")}</div>`).join("")}</div>
   <div class="btns"><button class="btn primary" data-act="saveteams">บันทึกชื่อทีม</button><button class="btn" data-act="shuffle">สุ่มลำดับ</button></div>
   <div class="h2" style="margin-top:24px"><h2>จับสายสด</h2><span>${isLiveDraw() ? "กำลังจับสาย ลากชื่อไปวางที่หมายเลข หรือแตะชื่อแล้วแตะหมายเลข จอ Dashboard ขึ้นชื่อทันที" : draw ? "จอ Dashboard อยู่ในโหมดจับสาย" : "เตรียมรายชื่อไว้ก่อน กดเริ่มแล้วค่อยวางชื่อทีละทีมระหว่างงาน"}</span></div>
   ${drawPanel()}`;
}

// ---------- Live draw ----------
// Prepared names live in event.draw_state.pool. Placing a name on number N saves it as team N's name,
// so the matches, the referee page and the Dashboard show it right away.
const isLiveDraw = () => !!(event().draw_state && event().draw_state.live);
const seedNames = () => teamsArr().slice().sort((a, b) => a.seed - b.seed).map((t) => t.name || "");
function drawLeft() {
  const left = [...((event().draw_state && event().draw_state.pool) || [])];
  seedNames().filter(Boolean).forEach((n) => { const i = left.indexOf(n); if (i >= 0) left.splice(i, 1); });
  return left;
}
let drawPick = null, drawBusy = false;   // name picked by a tap, waiting for a number
function drawPanel() {
  const ds = event().draw_state || {};
  if (!ds.live) {
    const prep = (ds.pool && ds.pool.length ? ds.pool : seedNames().filter(Boolean)).join("\n");
    return `<div class="card drawp"><label>รายชื่อที่เตรียมไว้ (บรรทัดละ 1 ทีม)<textarea id="dpool" rows="${Math.max(6, teamsArr().length)}">${esc(prep)}</textarea></label>
      <p class="muted">กดเริ่มแล้วชื่อทีมทั้ง ${teamsArr().length} หมายเลขจะว่าง จอ Dashboard เปลี่ยนเป็นตารางคู่ของรอบแรก แล้วค่อยวางชื่อทีละทีม</p>
      <div class="btns"><button class="btn primary" data-act="dlstart">เริ่มจับสายสด</button>${event().tv_mode === "draw" ? `<button class="btn" data-act="tvauto">กลับไปโหมดอัตโนมัติ</button>` : ""}</div></div>`;
  }
  const left = drawLeft(), t = teamsArr().slice().sort((a, b) => a.seed - b.seed);
  const chip = (n, inSlot) => `<button type="button" class="chip${drawPick === n ? " on" : ""}${inSlot ? " in" : ""}" draggable="true" data-dname="${esc(n)}">${esc(n)}</button>`;
  return `<div class="card drawp live"><div class="dgrid">
    <div class="dpool"><h3>ยังไม่ได้วาง (${left.length})</h3><div class="chips">${left.map((n) => chip(n)).join("") || `<p class="muted">วางครบทุกชื่อแล้ว</p>`}</div>
      <div class="dadd"><input id="dnew" maxlength="40" placeholder="เพิ่มชื่อทีม"><button class="btn small" data-act="dladd">เพิ่ม</button></div></div>
    <div class="dslots">${t.map((x) => `<div class="dslot${x.name ? " full" : ""}${drawPick && !x.name ? " ready" : ""}" data-dslot="${x.seed}"><b>${x.seed}</b><div>${x.name ? chip(x.name, true) : `<span class="muted">วางชื่อที่นี่</span>`}</div>${x.name ? `<button class="btn small" data-act="dlclear" data-s="${x.seed}" aria-label="เอาชื่อออกจากหมายเลข ${x.seed}">เอาออก</button>` : ""}</div>`).join("")}</div></div>
    <div class="btns"><button class="btn primary" data-act="dlend">จบการจับสาย</button><button class="btn" data-act="dlreset">ล้างทุกหมายเลข</button></div></div>`;
}
function drawRedraw() { formTab = ""; render(); }
async function drawSave(names) {
  if (drawBusy) return false; drawBusy = true;
  try { const r = await act(() => adm("a2_adm_teams", { p_names: names })); if (r === undefined) return false; await loadAll().catch(() => {}); return true; }
  finally { drawBusy = false; drawRedraw(); }
}
// Put a name on a number : it leaves any number it was on, and the name already there goes back to the pool
function drawPlace(name, seed) {
  const names = seedNames();
  if (names[seed - 1] === name) { drawPick = null; drawRedraw(); return; }
  names.forEach((n, i) => { if (n === name) names[i] = ""; });
  names[seed - 1] = name; drawPick = null;
  drawSave(names);
}
document.addEventListener("dragstart", (e) => { const c = e.target.closest && e.target.closest("[data-dname]"); if (!c) return; e.dataTransfer.setData("text/plain", c.dataset.dname); e.dataTransfer.effectAllowed = "move"; });
document.addEventListener("dragover", (e) => { const s = e.target.closest && e.target.closest("[data-dslot]"); if (!s) return; e.preventDefault(); s.classList.add("over"); });
document.addEventListener("dragleave", (e) => { const s = e.target.closest && e.target.closest("[data-dslot]"); if (s && !s.contains(e.relatedTarget)) s.classList.remove("over"); });
document.addEventListener("drop", (e) => {
  const s = e.target.closest && e.target.closest("[data-dslot]"); if (!s) return;
  e.preventDefault(); s.classList.remove("over");
  const n = e.dataTransfer.getData("text/plain"); if (n) drawPlace(n, +s.dataset.dslot);
});
// Tap a name, then tap a number (phones and tablets have no drag and drop)
document.addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest(".drawp.live") || e.target.closest("[data-act]")) return;
  const c = e.target.closest("[data-dname]");
  if (c) { drawPick = drawPick === c.dataset.dname ? null : c.dataset.dname; drawRedraw(); return; }
  const s = e.target.closest("[data-dslot]");
  if (s && drawPick) drawPlace(drawPick, +s.dataset.dslot);
});

// ---------- Dashboard tab ----------
const roundTitleTh = (r) => { const gs = [...new Set(r.ms.map((m) => m.grp).filter(Boolean))]; return gs.length ? gs.map((g) => grpName(g)).join(" และ ") : r.key === "practice" ? "คู่ซ้อม" : r.key === "final" && r.ms.some((m) => m.stage === "third") ? "ชิงชนะเลิศและชิงที่ 3" : stageLabel(r.key); };
function tvView() {
  lay = liveLayout(event().dash_layout?.live);
  const ev = event(), M = [["auto", "อัตโนมัติ", "มีคู่บนสนามใช้หน้าถ่ายทอดสด ไม่มีใช้ตารางสาย จบคู่ชิงขึ้นหน้าแชมป์เอง"], ["live", "ถ่ายทอดสด", "นาฬิกาใหญ่ รอบที่แข่ง และตารางสายย่อ"], ["bracket", "ตารางสาย", "ตารางสายเต็มจอ พร้อมคู่ถัดไป"], ["standings", "ตารางคะแนน", "ตารางคะแนนทุกสาย"], ["schedule", "ตารางเวลา", "ลำดับคู่ เวลานัด สถานะ"], ["rounds", "ตารางคู่รายรอบ", "คู่ทั้งหมดของรอบเดียว แดงและน้ำเงินตามฝั่ง พร้อมผลรายเกม"], ["draw", "จับสาย", "เผยชื่อทีมทีละทีม หรือตารางจับสายสด"], ["champion", "แชมป์", "ใช้ได้เมื่อจบคู่ชิง"]];
  return `<div class="h2"><h2>โหมดจอ Dashboard</h2><span>เปลี่ยนแล้วจอเปลี่ยนตามทันที ปกติใช้อัตโนมัติ</span></div>
   <div class="grid5">${M.map(([k, t, d]) => `<div class="card ${ev.tv_mode === k ? "st-ready" : ""}"><h2>${t}${ev.tv_mode === k ? ` <span class="pill ready">ใช้อยู่</span>` : ""}</h2><p class="muted">${d}</p><button class="btn ${ev.tv_mode === k ? "" : "primary"}" data-act="tvmode" data-m="${k}" ${ev.tv_mode === k ? "disabled" : ""}>ใช้</button></div>`).join("")}</div>
   <div class="h2" style="margin-top:22px"><h2>รอบในตารางคู่รายรอบ</h2><span>อัตโนมัติจะแสดงรอบของคู่บนสนาม ถ้าไม่มีใช้รอบของคู่ถัดไป</span></div>
   <div class="card"><div class="btns">${[["auto", "อัตโนมัติ"], ...roundList().map((r) => [r.key, roundTitleTh(r)])].map(([k, t]) => { const on = (ev.dash_layout?.rnd || "auto") === k; return `<button class="btn ${on ? "" : "primary"}" data-act="rndshow" data-m="${esc(k)}" ${on ? "disabled" : ""}>${esc(t)}</button>`; }).join("")}</div></div>
   <div class="h2" style="margin-top:22px"><h2>ตารางสายแสดง</h2><span>ใช้กับตารางสายทุกจอ อัตโนมัติจะแสดงคู่ซ้อมจนกว่าซ้อมจบหรือเริ่มแข่งจริง ตอนนี้แสดง${bracketMode() === "practice" ? "คู่ซ้อม" : "การแข่งจริง"}</span></div>
   <div class="card"><div class="btns">${BK_MODES.map(([k, t]) => `<button class="btn ${bracketSetting() === k ? "" : "primary"}" data-act="bkshow" data-m="${k}" ${bracketSetting() === k ? "disabled" : ""}>${BK_TH[k] || t}</button>`).join("")}</div></div>
   <div class="h2" style="margin-top:22px"><h2>ผังจอถ่ายทอดสด</h2><span>ลากเพื่อย้าย ลากมุมขวาล่างเพื่อลดขยาย ติ๊กเพื่อซ่อนหรือแสดง แล้วกดบันทึกผัง</span></div>
   <div class="card"><div class="layc">${PANELS.map(([k, t]) => `<label class="chk2"><input type="checkbox" data-layon="${k}" ${lay[k].on ? "checked" : ""}>${PANEL_TH[k] || t}</label>`).join("")}</div>
     <div class="lay" id="lay"></div>
     <div class="btns"><button class="btn primary" data-act="laysave">บันทึกผัง</button><button class="btn" data-act="layundo">ยกเลิกการแก้</button><button class="btn" data-act="layreset">กลับค่าเริ่มต้น</button><a class="btn" href="../dashboard/" target="_blank" rel="noopener">เปิดจอ Dashboard</a></div></div>`;
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
    return `<div class="lbx lbx-${k}" data-lk="${k}" style="left:${(p.x / STAGE.w) * 100}%;top:${(p.y / STAGE.h) * 100}%;width:${(p.w / STAGE.w) * 100}%;height:${(p.h / STAGE.h) * 100}%">${layMock(k)}<div class="ltag"><b>${PANEL_TH[k] || LAB[k]}</b><span>${p.w}×${p.h}</span></div><i data-rs="${k}" title="ปรับขนาด"></i></div>`; }).join("") + `<div class="lhead">หัวจอ (คงที่)</div>`;
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
  return `<div class="cols"><div class="stack"><div class="card"><div class="h2"><h2>ชื่องาน</h2></div><div class="form">
     <label>ชื่องาน แสดงบนหัว Dashboard และหน้าแอดมิน<input id="en" value="${esc(ev.name)}" maxlength="80"></label>
     <button class="btn primary" data-act="savename">บันทึกชื่อ</button></div></div>
    <div class="card"><div class="h2"><h2>โหมดกติกา Smart Logistics Challenge</h2><span class="pill ${ev.rules_mode !== false ? "ready" : "locked"}">${ev.rules_mode !== false ? "เปิด" : "ปิด"}</span></div>
     <p class="muted" style="margin:0 0 10px">${ev.rules_mode !== false ? "เปิด : กรรมการใช้ Setup, Checklist, นาฬิกา 1:30 และกดเกณฑ์ตามกติกาข้อ 6" : "ปิด : กรรมการกดแค่ว่าใครชนะแต่ละเกม ไม่มีนาฬิกาและ Checklist"}</p>
     <label class="switch"><input type="checkbox" id="rm" ${ev.rules_mode !== false ? "checked" : ""}><span></span><b>ใช้กติกา Smart Logistics Challenge</b></label></div>
    <div class="card"><div class="h2"><h2>เวลา</h2><span>ใช้เมื่อเปิดโหมดกติกา</span></div><div class="form">
     <div class="two"><label>เวลา Setup (วินาที)<input id="es" type="number" min="0" value="${Math.round(ev.setup_ms / 1000)}"></label><label>เวลาแข่งต่อเกม (วินาที)<input id="eg" type="number" min="10" value="${Math.round(ev.game_ms / 1000)}"></label></div>
     <label>นับถอยหลังก่อน GO (วินาที)<input id="ec" type="number" min="0" max="10" value="${Math.round((ev.countdown_ms ?? 3000) / 1000)}"></label>
     <button class="btn primary" data-act="saveev">บันทึก</button></div></div>
    <div class="card"><div class="h2"><h2>รหัสผ่านและ PIN</h2></div><div class="form"><div class="two"><label>รหัสผ่านแอดมินใหม่<input id="np" type="password" autocomplete="new-password" minlength="6"></label><label>PIN กรรมการใหม่<input id="ni" inputmode="numeric" pattern="[0-9]{4,8}"></label></div>
     <button class="btn" data-act="savepw">เปลี่ยน (กรอกเฉพาะช่องที่ต้องการเปลี่ยน)</button></div></div>
    <div class="card"><div class="h2"><h2>เอกสาร</h2><span>กติกา FAQ และไฟล์อื่น</span></div>
     <label class="switch"><input type="checkbox" id="dref" ${ev.docs_ref !== false ? "checked" : ""}><span></span><b>กรรมการเปิดดูเอกสารได้</b></label>
     <div id="doclist" class="doclist"><p class="muted">กำลังโหลด</p></div>
     <div class="form" style="margin-top:12px"><div class="two"><label>ชื่อเอกสาร<input id="dt" maxlength="80" placeholder="เช่น กติกา, FAQ"></label><label>ไฟล์ (PDF หรือรูป ไม่เกิน 10 MB)<input id="df" type="file" accept=".pdf,image/*"></label></div>
     <button class="btn primary" data-act="docadd">อัปโหลด</button></div></div>
    <div class="card"><div class="h2"><h2>ข้อมูล</h2></div><div class="btns"><button class="btn" data-act="export">ดาวน์โหลดผลทั้งหมด (JSON)</button></div>
     <div class="form" style="margin-top:14px"><label>ล้างเฉพาะผลการแข่ง เก็บชื่อทีม ตารางคู่ และเวลานัดไว้ ใช้หลังกดลองระบบ<select id="rrs"><option value="all">ทุกคู่ (คู่ซ้อมและคู่แข่งจริง)</option><option value="practice">เฉพาะคู่ซ้อม</option><option value="comp">เฉพาะคู่แข่งจริง</option></select></label><button class="btn" data-act="resetres">ล้างเฉพาะผล</button></div>
     <div class="form" style="margin-top:14px"><label>เริ่มงานใหม่ ลบผลและเกมทั้งหมด (พิมพ์ รีเซ็ต เพื่อยืนยัน)<input id="rc" placeholder="รีเซ็ต"></label><button class="btn danger" data-act="reset">ลบผลทั้งหมดและเริ่มใหม่</button><span class="muted">ชื่อทีมและการตั้งค่าไม่ถูกลบ แต่เวลานัดทุกคู่จะถูกล้าง</span></div></div></div>
   <div class="card links"><div class="h2"><h2>ลิงก์</h2></div>${link("dashboard", "Dashboard", "เปิดบนโน้ตบุ๊กที่ต่อจอ แล้วแตะเต็มจอเพื่อเปิดเสียง")}${link("ref", "กรรมการ", "เครื่องกรรมการ 1 เครื่อง ต้องใช้ PIN")}${link("admin", "แอดมิน", "สำหรับผู้จัดเท่านั้น")}</div></div>`;
}
async function loadDocs() {
  const el = $("doclist"); if (!el) return;
  try { el.innerHTML = docRows(await listDocs({ p_pw: pw }), true); } catch (e) { el.innerHTML = `<p class="warn">${esc(e.message)}</p>`; }
}
function afterForm() {
  const fc = document.querySelector(".fmtc"); if (fc) fitBrackets(fc);
  if (formTab === "settings") loadDocs();
  document.querySelectorAll("[data-qr]").forEach((d) => { try { const q = window.qrcode(0, "M"); q.addData(d.dataset.qr); q.make(); d.innerHTML = q.createSvgTag({ scalable: true, margin: 2 }); d.firstChild.style.cssText = "width:110px;height:110px"; } catch (e) {} });
}

// ---------- Log tab ----------
let logRows = [], logF = "";
const AL = { "queue.call": "เรียกคู่", "queue.clear": "เอาลงจากสนาม", "ref.transfer": "ย้ายเครื่องกรรมการ", "flow.setup_start": "เริ่ม Setup", "flow.setup_skip": "ข้าม Setup", "flow.go": "เริ่มแข่ง", "flow.false_start": "ออกตัวก่อน", "flow.reset": "รีเซ็ตเกม", "game.confirm": "รับรองผล", "match.absent_req": "ขอแพ้บาย", "mark.undo": "ย้อนกลับ", "mark.add": "แอดมินเพิ่มเหตุการณ์", "mark.void": "แอดมินลบเหตุการณ์", "mark.unvoid": "แอดมินกู้เหตุการณ์", "mark.edit": "แอดมินแก้เหตุการณ์", "mark.exit_first": "ออกจากกรอบแดงก่อน", "mark.lift_first": "ยกแท่นแรก", "mark.park": "จอดแท่น +1", "mark.unpark": "จอดแท่น -1", "mark.complete": "ภารกิจสำเร็จ", "mark.retry": "Retry", "reset.results": "ล้างเฉพาะผล", "practice.set": "ตั้งคู่ซ้อม", "match.postpone": "ไว้ทีหลัง", "queue.assign": "เปิดคิว", "queue.unassign": "ปิดคิว", "game.patch": "แก้ผลเกม", "game.add": "เพิ่มเกม", "game.void": "ลบเกม", "event.update": "แก้ตั้งค่า", "schedule.set": "ตั้งเวลา", reset: "รีเซ็ต", "group.tiebreak": "ตัดสินอันดับ", "teams.set": "แก้ชื่อทีม", "match.swap": "สลับฝั่ง", "match.forfeit": "แพ้บาย", "team.absent": "ทีมไม่มา",
  "timer.start_setup": "เริ่ม Setup", "timer.start_game": "เริ่มแข่ง", "timer.pause": "หยุดนาฬิกา", "timer.resume": "เล่นต่อ", "timer.reset": "รีเซ็ตนาฬิกา",
  "game.pattern": "เลือกแบบสนาม", "game.parked_inc": "จอดเพิ่ม", "game.parked_dec": "จอดลด", "game.lift": "ยกแท่นแรก", "game.exit": "ออกจากกรอบแดง", "game.clear_lift": "ล้างยกแท่น", "game.clear_exit": "ล้างออกกรอบ", "game.finish": "จบเกม", "game.judge": "กรรมการตัดสิน" };
const actorTh = (a) => (a === "admin" ? "แอดมิน" : a === "system:auto" ? "ระบบ เปิดคิวตามเวลา" : String(a).startsWith("ref:") ? "กรรมการ" : a);
function logView() {
  return `<div class="h2"><h2>บันทึกการทำงาน</h2><select id="lgf" data-act-change="lgf"><option value="">ทั้งหมด</option><option value="admin" ${logF === "admin" ? "selected" : ""}>แอดมิน</option><option value="ref" ${logF === "ref" ? "selected" : ""}>กรรมการ</option></select><button class="btn small" data-act="logload">โหลดใหม่</button></div><div class="tw"><table class="tbl"><thead><tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>กับ</th></tr></thead><tbody>${logRows.filter((r) => !logF || (logF === "ref" ? String(r.actor).startsWith("ref:") : r.actor === logF)).map((r) => `<tr><td class="num">${new Date(r.at).toLocaleTimeString("th-TH")}</td><td>${esc(actorTh(r.actor))}</td><td>${esc(AL[r.action] || r.action)}</td><td>${esc(r.target || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>`;
}
async function loadLog() { logRows = (await act(() => adm("a2_adm_audit", { p_limit: 200 }))) || []; redraw(); }

const VIEW = { home: homeView, queue: queueView, schedule: scheduleView, groups: groupsView, matches: matchesView, teams: teamsView, tv: tvView, settings: settingsView, log: logView };

// ---------- Clock ----------
function clocks() {
  const f = field(1); if (!f) return; const ck = clockV3(f);
  const clkTxt = ck.phase === "countdown" ? String(ck.count) : ck.phase === "stopped" ? fmtMs1(ck.elapsed) : fmtMs1(ck.ms);
  const warn = ck.phase === "game" && ck.ms <= 10000;
  const phTxt = PH_TH[ck.phase] + (ck.phase === "stopped" ? " (ภารกิจสำเร็จ)" : "");
  document.querySelectorAll("[data-clk]").forEach((el) => {
    if (el._clk !== clkTxt) { el._clk = clkTxt; el.textContent = clkTxt; }
    if (el._warn !== warn) { el._warn = warn; el.classList.toggle("warn", warn); }
  });
  document.querySelectorAll("[data-ph]").forEach((el) => {
    if (el._ph !== phTxt) { el._ph = phTxt; el.textContent = phTxt; }
  });
}

// ---------- Button handlers ----------
const H = {
  async open(b) {
    const c = b.dataset.c, M = match(c);
    if (!confirm(`เรียก ${c} ขึ้นสนาม\n${sideName(M, "red")} พบ ${sideName(M, "blue")}`)) return;
    await act(() => adm("a2_adm_call", { p_code: c }), `เรียก ${c} ขึ้นสนามแล้ว`);
    if (dlg.open && dlgCode === c) dlg.innerHTML = dlgHtml(c);
  },
  async close(b) {
    const M = match(b.dataset.c);
    if (!confirm(M.status === "done" ? "เอาคู่นี้ลงจากสนาม" : `เอาคู่ ${M.code} ลงจากสนามทั้งที่ยังไม่จบ\nเกมที่ยังไม่เริ่มจะถูกลบ`)) return;
    await act(() => adm("a2_adm_clear", {}), "เอาลงจากสนามแล้ว");
  },
  async timer(b) {
    const a = b.dataset.a;
    if (a === "false_start" && !confirm("ออกตัวก่อน ลบเหตุการณ์ทั้งหมดของรอบนี้ แล้วกลับไปสถานะพร้อม")) return;
    if (a === "go" && !confirm("เริ่มนับถอยหลัง 3 2 1 แทนกรรมการ")) return;
    await act(() => adm("a2_adm_timer", { p_action: a }));
  },
  async transfer() { if (!confirm("ปลดเครื่องกรรมการเดิม เครื่องที่เปิดหน้ากรรมการอยู่จะรับสิทธิ์แทนภายใน 10 วินาที")) return; await act(() => adm("a2_adm_ref_transfer", {}), "ปลดเครื่องกรรมการแล้ว"); },
  async approve(b) { const m = match(b.dataset.c), sd = b.dataset.s; if (!confirm(`${sideName(m, sd)} ไม่มา ให้ ${sideName(m, sd === "red" ? "blue" : "red")} ชนะบาย ${Math.ceil(m.bo / 2)}-0`)) return; await act(() => adm("a2_adm_forfeit", { p_code: b.dataset.c, p_side: sd }), "อนุมัติแพ้บายแล้ว"); },
  async postpone(b) { if (await act(() => adm("a2_adm_postpone", { p_code: b.dataset.c }), `ย้าย ${b.dataset.c} ไปท้ายคิวแล้ว`) !== undefined) { await loadAll(); redraw(); } },
  async ffundo(b) { await act(() => adm("a2_adm_forfeit", { p_code: b.dataset.c, p_side: null }), "ยกเลิกแพ้บายแล้ว"); },
  async boall() {
    const bo = +$("boall").value, n = matches().filter(boEditable).length;
    if (!confirm(`เปลี่ยนเป็น Bo${bo} ทุกคู่ที่ยังไม่เริ่ม (${n} คู่)`)) return;
    const r = await act(() => adm("a2_adm_bo", { p_codes: null, p_bo: bo }), "เปลี่ยน Bo แล้ว"); if (r !== undefined) { toast(`เปลี่ยน ${r} คู่`); await loadAll(); redraw(); }
  },
  async withdraw() {
    const sd = +$("wdteam").value, n = matches().filter((m) => m.status !== "done" && (m.red_seed === sd || m.blue_seed === sd)).length;
    if (!confirm(`${teamName(sd)} ถอนตัว\nคู่ที่เหลือ ${n} คู่จะให้คู่แข่งชนะบาย รวมถึงคู่ในรอบถัดไปถ้าทีมนี้ผ่านเข้าไป`)) return;
    if (await act(() => adm("a2_adm_absent", { p_seed: sd, p_absent: true }), "บันทึกถอนตัวแล้ว") !== undefined) refreshTools();
  },
  async comeback() {
    const sd = +$("wdteam").value;
    if (!confirm(`${teamName(sd)} กลับมาแข่ง\nคู่ที่ยังไม่จบจะยกเลิกแพ้บายจากการถอนตัว คู่ที่จบไปแล้วไม่เปลี่ยน`)) return;
    if (await act(() => adm("a2_adm_absent", { p_seed: sd, p_absent: false }), "กลับมาแข่งแล้ว") !== undefined) refreshTools();
  },
  async noticeshow() {
    const v = ($("ntext")?.value || "").trim(); if (!v) return toast("พิมพ์ข้อความก่อน", true);
    if (await act(() => adm("a2_adm_event", { p: { notice: v, notice_on: true } }), "แสดงประกาศแล้ว") !== undefined) { refreshTools(); redraw(); }
  },
  async noticehide() { if (await act(() => adm("a2_adm_event", { p: { notice_on: false } }), "ซ่อนประกาศแล้ว") !== undefined) { refreshTools(); redraw(); } },
  gotab(b) { const t = document.querySelector(`[data-tab="${b.dataset.t}"]`); if (t) t.click(); },
  async reject(b) { await act(() => adm("a2_adm_forfeit", { p_code: b.dataset.c, p_side: null }), "ไม่อนุมัติแล้ว"); },
  async mk(b) {
    const card = b.closest("[data-g]"), id = b.closest("[data-mid]").dataset.mid;
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: b.dataset.op, p_id: id }), "อัปเดตแล้ว"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  async mkedit(b) {
    const card = b.closest("[data-g]"), id = b.closest("[data-mid]").dataset.mid, v = prompt("เวลาใหม่ นับจาก GO (เช่น 0:12.5)"); if (v == null) return;
    const t = parseT(v); if (Number.isNaN(t)) return toast("รูปแบบเวลา 0:12.5", true);
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: "edit", p_id: id, p_t_ms: t }), "อัปเดตแล้ว"); dlg.innerHTML = dlgHtml(dlgCode);
  },
  async mkadd(b) {
    const card = b.closest("[data-g]"), q = (n) => card.querySelector(`[data-n="${n}"]`).value, t = parseT(q("t"));
    if (Number.isNaN(t)) return toast("รูปแบบเวลา 0:12.5", true);
    await act(() => adm("a2_adm_mark", { p_game: +card.dataset.g, p_op: "add", p_kind: q("kind"), p_side: q("side"), p_t_ms: t }), "เพิ่มเหตุการณ์แล้ว"); dlg.innerHTML = dlgHtml(dlgCode);
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
  bradd() { sc.breaks.push({ at: "", min: 15, label: "" }); scSave(); formTab = ""; render(); },
  brdel(b) { sc.breaks.splice(+b.dataset.i, 1); scSave(); formTab = ""; render(); },
  pdfcomp() {
    const st = $("pdfstage")?.value || "", list = compMatches().filter((m) => !st || m.stage === st).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no);
    printSchedule(st ? "ตารางแข่ง " + stageLabel(st) : "ตารางแข่ง", list, sc.day || todayStr(), !!$("pdfnp")?.checked);
  },
  pdfprac() { printSchedule("ตารางวันซ้อม", pracMatches().slice().sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no), sc.pday || todayStr()); },
  async pracgen() {
    const seeds = practiceTeams(), n = seeds.length, k = +sc.pgames;
    if (n < 2) return toast("ต้องมีทีมมาซ้อมอย่างน้อย 2 ทีม", true);
    if ((n * k) % 2 || k < 1 || k > n - 1) return toast(`${n} ทีม ทีมละ ${k} คู่ ไม่ลงตัว ลองจำนวนคู่อื่น`, true);
    const pairs = poolPairs(n, k); if (!pairs) return toast("สุ่มคู่ไม่สำเร็จ ลองอีกครั้ง", true);
    const tl = timeline(sc.pday || todayStr(), sc.pstart, pairs, () => +sc.pmin || 10);
    const items = tl.map(({ it, t }, i) => ({ code: "P" + (i + 1), red: seeds[it[0]], blue: seeds[it[1]], bo: +sc.pbo, at: new Date(t).toISOString() }));
    if (pracMatches().length && !confirm("สร้างคู่ซ้อมใหม่แทนชุดเดิม")) return;
    let r = await act(() => adm("a2_adm_practice", { p_matches: items, p_force: false }));
    if (r === undefined && confirm("มีผลการซ้อมอยู่แล้ว ล้างผลซ้อมเดิมแล้วสร้างใหม่ไหม")) r = await act(() => adm("a2_adm_practice", { p_matches: items, p_force: true }));
    if (r !== undefined) { toast(`สร้างคู่ซ้อม ${r} คู่แล้ว`); await loadAll(); formTab = ""; render(); }
  },
  async pracclear() {
    if (!confirm("ล้างคู่ซ้อมและผลซ้อมทั้งหมด (ไม่กระทบการแข่งจริง)")) return;
    if (await act(() => adm("a2_adm_practice", { p_matches: [], p_force: true }), "ล้างการซ้อมแล้ว") !== undefined) { await loadAll(); formTab = ""; render(); }
  },
  clearsc(b) { const tr = b.closest("tr"); tr.querySelector('[data-k="at"]').value = ""; tr.querySelector('[data-k="auto"]').checked = false; },
  // Reload before redrawing : the form tab is drawn from local data, which Realtime may not have updated yet
  async savesc() { const items = readSchedule(); if (await act(() => adm("a2_adm_schedule", { p_items: items }), "บันทึกเวลาแล้ว") !== undefined) { await loadAll().catch(() => {}); formTab = ""; render(); } },
  async tbup(b) {
    const G = b.dataset.g, s = +b.dataset.s, seeds = tableOf(G).filter((r) => r.seed != null).map((r) => r.seed), i = seeds.indexOf(s);
    if (i > 0) { [seeds[i - 1], seeds[i]] = [seeds[i], seeds[i - 1]]; await act(() => adm("a2_adm_tiebreak", { p_grp: G, p_seeds: seeds }), "ปรับลำดับแล้ว"); }
  },
  async tbclear(b) { await act(() => adm("a2_adm_tiebreak", { p_grp: b.dataset.g, p_seeds: null }), "ล้างแล้ว"); },
  async saveteams() { const names = Array.from({ length: teamsArr().length }, (_, i) => document.querySelector(`[data-seed="${i + 1}"]`).value.trim()); await act(() => adm("a2_adm_teams", { p_names: names }), "บันทึกชื่อทีมแล้ว"); },
  shuffle() { const els = [...document.querySelectorAll("[data-seed]")], v = els.map((e) => e.value); for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [v[i], v[j]] = [v[j], v[i]]; } els.forEach((e, i) => (e.value = v[i])); toast("สลับแล้ว ยังไม่ได้บันทึก"); },
  async fmtapply() {
    const f = fmtEdit(), err = validateFormat(f); if (err.length) return toast(err[0], true);
    const b = buildFormat(f);
    const desc = Array.isArray(f.customMatches) ? `กำหนดเอง (${f.teams} ทีม, ${b.matches.length} คู่)`
      : f.rounds.map((r) => r.type === "groups" ? `${stageLabel(r.id)} (${r.groups.map((g) => `${g.grp} ${g.size} ทีม เข้ารอบ ${g.adv}`).join(", ")})` : `แพ้คัดออก${r.third ? " และชิงที่ 3" : ""}`).join(", ");
    if (!confirm(`ใช้รูปแบบ : ${desc}\nสร้างคู่ใหม่ ${b.matches.length} คู่ แทนของเดิมทั้งหมด`)) return;
    if (await act(() => adm("a2_adm_format", { p_format: b.format, p_groups: b.groups, p_matches: b.matches }), "ใช้รูปแบบใหม่แล้ว") !== undefined) { fmt = null; await loadAll(); formTab = ""; render(); }
  },
  fmtundo() { fmt = null; redrawFmt(); },
  fpoolshuffle() { quickApply({ ...quickOf(fmtEdit()), mode: "pool" }); redrawFmt(); },
  fquickreset() { quickApply({ ...quickOf(fmtDefaults()), mode: "gko" }); redrawFmt(); },
  fmtcustom() { fmt = materializeCustom(fmtEdit()); redrawFmt(); },
  fmtauto() { if (!confirm("ทิ้งการแก้ไขแบบกำหนดเองแล้วกลับไปใช้ตัวสร้างรอบอัตโนมัติ")) return; const f = fmtEdit(); f.customMatches = null; f.customGroups = null; redrawFmt(); },
  fraddg() {
    const f = fmtEdit(), gRounds = f.rounds.filter((r) => r.type === "groups"), prev = gRounds[gRounds.length - 1];
    let groups = [{ grp: "A", size: 3, adv: 2, srcs: null }, { grp: "B", size: 3, adv: 2, srcs: null }];
    if (prev) {
      const q = roundQualifiers(prev).length || 4, nG = q >= 6 && q % 3 === 0 ? q / 3 : q >= 8 && q % 4 === 0 ? q / 4 : q >= 4 ? 2 : 1;
      const base = Math.floor(q / nG), rem = q % nG, hasKo = !!koOf(f);
      groups = [...Array(nG).keys()].map((i) => { const sz = Math.max(2, base + (i < rem ? 1 : 0)); return { grp: "A", size: sz, adv: hasKo ? 1 : 0, srcs: null }; });
    }
    const koIdx = f.rounds.findIndex((r) => r.type === "ko"), nr = { id: "r", type: "groups", bo: 3, groups };
    if (koIdx >= 0) f.rounds.splice(koIdx, 0, nr); else f.rounds.push(nr);
    reletter(f); clearDownstream(f, f.rounds.indexOf(nr)); redrawFmt();
  },
  frdel(b) { const f = fmtEdit(), ri = +b.dataset.ri; f.rounds.splice(ri, 1); reletter(f); clearDownstream(f, Math.max(-1, ri - 1)); redrawFmt(); },
  fraddko() { const f = fmtEdit(); if (!koOf(f)) { f.rounds.push(defaultKoRound({})); redrawFmt(); } },
  frdelko() { const f = fmtEdit(); f.rounds = f.rounds.filter((r) => r.type !== "ko"); redrawFmt(); },
  fgadd(b) { const f = fmtEdit(), ri = +b.dataset.ri; f.rounds[ri].groups.push({ grp: "A", size: 3, adv: 1, srcs: null }); reletter(f); clearDownstream(f, ri - 1); redrawFmt(); },
  fgdel(b) { const f = fmtEdit(), ri = +b.dataset.ri; f.rounds[ri].groups.splice(+b.dataset.i, 1); reletter(f); clearDownstream(f, ri - 1); redrawFmt(); },
  rauto(b) { const f = fmtEdit(), ri = +b.dataset.ri; f.rounds[ri].groups.forEach((g) => { g.srcs = null; }); redrawFmt(); },
  fslotauto(b) { const ko = koOf(fmtEdit()), st = b.dataset.st; if (!ko) return; if (!st) { ko.slots = null; ko.links = null; } else if (ko.links && st in ko.links) delete ko.links[st]; else { ko.slots = null; ko.links = null; } redrawFmt(); },
  cgadd() {
    const f = fmtEdit(); f.customGroups ||= [];
    const used = new Set(f.customGroups.map((g) => g.grp)), lt = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !used.has(c));
    if (!lt) return;
    f.customGroups.push({ grp: lt, stage: "r1", adv: 1, srcs: ["s1", ...(f.teams >= 2 ? ["s2"] : []), ...(f.teams >= 3 ? ["s3"] : [])] });
    redrawFmt();
  },
  cgdel(b) { const f = fmtEdit(); f.customGroups.splice(+b.dataset.i, 1); redrawFmt(); },
  cgslotadd(b) { const f = fmtEdit(), g = f.customGroups[+b.dataset.i]; g.srcs.push("s1"); redrawFmt(); },
  cgslotdel(b) { const f = fmtEdit(), g = f.customGroups[+b.dataset.i]; if (g.srcs.length > 1) { g.srcs.pop(); if (g.adv > g.srcs.length) g.adv = g.srcs.length; redrawFmt(); } },
  cgrr(b) {
    const f = fmtEdit(), g = f.customGroups[+b.dataset.i];
    f.customMatches = f.customMatches.filter((m) => m.grp !== g.grp);
    buildGroupMatches(g.grp, g.stage, g.srcs.map(parseSrcKey), 3).forEach((m) => {
      f.customMatches.push({ code: m.code, stage: m.stage, grp: g.grp, bo: 3, red: srcKey(m.red_src), blue: srcKey(m.blue_src) });
    });
    redrawFmt();
  },
  cmadd() {
    const f = fmtEdit(), used = new Set(f.customMatches.map((m) => m.code));
    let k = f.customMatches.length + 1; while (used.has("M" + k)) k++;
    f.customMatches.push({ code: "M" + k, stage: "r1", grp: null, bo: 3, red: "s1", blue: f.teams >= 2 ? "s2" : "s1" });
    redrawFmt();
  },
  cmup(b) { const m = fmtEdit().customMatches, i = +b.dataset.i; if (i > 0) { [m[i - 1], m[i]] = [m[i], m[i - 1]]; redrawFmt(); } },
  cmdn(b) { const m = fmtEdit().customMatches, i = +b.dataset.i; if (i < m.length - 1) { [m[i], m[i + 1]] = [m[i + 1], m[i]]; redrawFmt(); } },
  cmdel(b) { fmtEdit().customMatches.splice(+b.dataset.i, 1); redrawFmt(); },
  async drawstart() { await act(() => adm("a2_adm_event", { p: { tv_mode: "draw", draw_state: { start: Math.round(now()) + 2500 } } }), "เริ่มจับสายแล้ว"); await loadAll().catch(() => {}); formTab = ""; render(); },
  async dlstart() {
    const pool = [...new Set(($("dpool")?.value || "").split("\n").map((s) => s.trim().slice(0, 40)).filter(Boolean))];
    if (!pool.length) return toast("ใส่รายชื่อทีมก่อน", true);
    if (!confirm(`เริ่มจับสายสด ชื่อทีมทั้ง ${teamsArr().length} หมายเลขจะว่าง แล้วค่อยวางชื่อทีละทีม`)) return;
    if ((await act(() => adm("a2_adm_teams", { p_names: teamsArr().map(() => "") }))) === undefined) return;
    await act(() => adm("a2_adm_event", { p: { tv_mode: "draw", draw_state: { live: true, pool } } }), "เริ่มจับสายสดแล้ว");
    drawPick = null; await loadAll().catch(() => {}); drawRedraw();
  },
  async dladd() {
    const n = ($("dnew")?.value || "").trim().slice(0, 40); if (!n) return;
    const ds = event().draw_state || {}, pool = ds.pool || [];
    if (pool.includes(n)) return toast("มีชื่อนี้แล้ว", true);
    await act(() => adm("a2_adm_event", { p: { draw_state: { ...ds, pool: [...pool, n] } } }));
    await loadAll().catch(() => {}); drawRedraw();
  },
  dlclear(b) { const names = seedNames(); names[+b.dataset.s - 1] = ""; drawSave(names); },
  dlreset() { if (confirm("เอาชื่อออกจากทุกหมายเลข")) drawSave(seedNames().map(() => "")); },
  async dlend() {
    const empty = seedNames().filter((n) => !n).length;
    if (empty && !confirm(`ยังว่างอยู่ ${empty} หมายเลข จบการจับสายเลยไหม`)) return;
    await act(() => adm("a2_adm_event", { p: { tv_mode: "auto", draw_state: { ...(event().draw_state || {}), live: false } } }), "จบการจับสายแล้ว จอ Dashboard กลับเป็นอัตโนมัติ");
    drawPick = null; await loadAll().catch(() => {}); drawRedraw();
  },
  async tvauto() { await act(() => adm("a2_adm_event", { p: { tv_mode: "auto" } }), "จอ Dashboard กลับเป็นอัตโนมัติ"); await loadAll().catch(() => {}); formTab = ""; render(); },
  async tvmode(b) { await act(() => adm("a2_adm_event", { p: { tv_mode: b.dataset.m } }), "เปลี่ยนโหมดจอแล้ว"); await loadAll().catch(() => {}); formTab = ""; render(); },
  async rndshow(b) { await act(() => adm("a2_adm_event", { p: { dash_layout: { ...(event().dash_layout || {}), rnd: b.dataset.m } } }), "เปลี่ยนรอบที่แสดงแล้ว"); await loadAll().catch(() => {}); formTab = ""; render(); },
  async bkshow(b) { await act(() => adm("a2_adm_event", { p: { dash_layout: { ...(event().dash_layout || {}), bk: b.dataset.m } } }), "เปลี่ยนตารางสายแล้ว"); await loadAll().catch(() => {}); formTab = ""; render(); },
  async laysave() { await act(() => adm("a2_adm_event", { p: { dash_layout: { ...(event().dash_layout || {}), live: lay } } }), "บันทึกผังแล้ว"); },
  layreset() { lay = liveLayout(null); paintLay(); },
  layundo() { lay = liveLayout(event().dash_layout?.live); paintLay(); },
  async docadd() {
    const f = $("df").files[0], title = $("dt").value.trim() || (f && f.name.replace(/\.[^.]+$/, ""));
    if (!f) return toast("เลือกไฟล์ก่อน", true);
    if (f.size > 10 * 1024 * 1024) return toast("ไฟล์ใหญ่เกิน 10 MB", true);
    const b = $("df"); b.disabled = true;
    const ok = await act(async () => adm("a2_adm_doc_add", { p_title: title, p_file_name: f.name, p_mime: f.type || "application/octet-stream", p_data: await fileToB64(f) }), "อัปโหลดแล้ว");
    b.disabled = false; if (ok !== undefined) { $("dt").value = ""; b.value = ""; loadDocs(); }
  },
  async savename() { const name = $("en").value.trim(); if (!name) return toast("ใส่ชื่องานก่อน", true); await act(() => adm("a2_adm_event", { p: { name } }), "บันทึกชื่อแล้ว"); },
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
  // Clear results only (migration 020) : team names, matches and the schedule stay
  async resetres() {
    const sc2 = $("rrs").value, what = { all: "ผลทุกคู่", practice: "ผลคู่ซ้อม", comp: "ผลคู่แข่งจริง" }[sc2];
    if (!confirm(`ล้าง${what} ชื่อทีมและเวลานัดยังอยู่ ย้อนกลับไม่ได้`)) return;
    const n = await act(() => adm("a2_adm_reset_results", { p_scope: sc2 }));
    if (n !== undefined) { toast(`ล้างผล ${n} คู่แล้ว`); await loadAll().catch(() => {}); formTab = ""; render(); }
  },
  async reset() { if ($("rc").value.trim() !== "รีเซ็ต") return toast("พิมพ์ รีเซ็ต ให้ตรงก่อน", true); if (!confirm("ลบผลและเกมทั้งหมด ย้อนกลับไม่ได้ ดาวน์โหลด JSON ไว้แล้วหรือยัง")) return; await act(() => adm("a2_adm_reset", {}), "รีเซ็ตแล้ว"); $("rc").value = ""; },
  logload() { loadLog(); },
};
document.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (!b || b.disabled) return; const f = H[b.dataset.act]; if (f) f(b); });
document.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
document.addEventListener("click", async (e) => {
  const o = e.target.closest("[data-doc]"), d = e.target.closest("[data-docdel]");
  if (o) showDoc(+o.dataset.doc, { p_pw: pw }, o.dataset.t);
  if (d && confirm(`ลบเอกสาร ${d.dataset.t}`)) { if ((await act(() => adm("a2_adm_doc_del", { p_id: +d.dataset.docdel }), "ลบแล้ว")) !== undefined) loadDocs(); }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "lgf") { logF = e.target.value; redraw(); }
  if (e.target.id === "dref") {
    const on = e.target.checked;
    if ((await act(() => adm("a2_adm_event", { p: { docs_ref: on } }), on ? "กรรมการเปิดดูเอกสารได้แล้ว" : "ซ่อนเอกสารจากกรรมการแล้ว")) === undefined) e.target.checked = !on;
  }
  if (e.target.id === "rm") {
    const on = e.target.checked, f = field(1), busy = f && f.match_code && ["setup", "ready", "countdown", "game", "stopped", "over"].includes(f.phase);
    if (busy && !confirm("มีเกมกำลังดำเนินอยู่ เปลี่ยนโหมดตอนนี้ กรรมการจะเห็นหน้าใหม่ทันที")) { e.target.checked = !on; return; }
    if ((await act(() => adm("a2_adm_event", { p: { rules_mode: on } }), on ? "เปิดโหมดกติกาแล้ว" : "ปิดโหมดกติกาแล้ว")) === undefined) e.target.checked = !on; else { await loadAll().catch(() => {}); formTab = ""; render(); }
  }
});
document.addEventListener("change", (e) => {
  const t = e.target; if (!t.closest || !t.closest(".fmtc")) return;
  if (t.dataset.q) { const q = quickOf(fmtEdit()); q[t.dataset.q] = t.type === "checkbox" ? t.checked : t.dataset.q === "mode" ? t.value : +t.value; if (t.dataset.q === "mode" && q.mode === "pool") Object.assign(q, POOL_DEF, { mode: "pool", teams: q.teams }); quickApply(q); redrawFmt(); return; }
  const f = fmtEdit();
  if (t.dataset.fk === "teams") { f.teams = +t.value; const ko = koOf(f); if (ko && !Array.isArray(f.customMatches)) { ko.slots = null; ko.links = null; } }
  else if (t.dataset.rgbo !== undefined) { f.rounds[+t.dataset.rgbo].bo = +t.value; }
  else if (t.dataset.gk) {
    const ri = +t.dataset.ri, gi = +t.dataset.gi, g = f.rounds[ri].groups[gi];
    g[t.dataset.gk] = +t.value;
    if (t.dataset.gk === "size" && g.adv > g.size) g.adv = g.size;
    if (ri === 0 && !Array.isArray(f.customMatches)) f.teams = f.rounds[0].groups.reduce((s, x) => s + Math.max(0, +x.size || 0), 0);
    if (t.dataset.gk === "size") g.srcs = null;
    clearDownstream(f, ri);
  } else if (t.dataset.rslot) {
    const [ri, gi, si] = t.dataset.rslot.split(":").map(Number), r = f.rounds[ri], cur = resolveRoundGroupSlots(f, ri), v = t.value;
    r.groups.forEach((g, idx) => { g.srcs = cur[idx].slice(); });
    for (let oi = 0; oi < r.groups.length; oi++) {
      const osi = r.groups[oi].srcs.indexOf(v);
      if (osi >= 0 && (oi !== gi || osi !== si)) { r.groups[oi].srcs[osi] = r.groups[gi].srcs[si]; break; }
    }
    r.groups[gi].srcs[si] = v;
  } else if (t.dataset.kothird) {
    const ko = koOf(f); if (ko) { ko.third = t.checked; if (ko.links) delete ko.links.third; }
  } else if (t.dataset.kobo) {
    const ko = koOf(f); if (ko) ko.bo_by_stage[t.dataset.kobo] = +t.value;
  } else if (t.dataset.kos) {
    const ko = koOf(f); if (!ko) return;
    const [st, idxStr] = t.dataset.kos.split(":"), i = +idxStr, sub = +t.dataset.sub, v = t.value || "";
    const cur = buildFormat(f).koStages.find((x) => x.stage === st); if (!cur) return;
    const sl = cur.slots.slice(), j = v ? sl.indexOf(v) : sl.indexOf("");
    if (j >= 0 && j !== i) sl[j] = sl[i];
    sl[i] = v;
    if (sub === 0) { ko.slots = sl; ko.links = null; } else { ko.links ||= {}; ko.links[st] = sl; }
  } else if (t.dataset.cgk) {
    const g = f.customGroups[+t.dataset.cgi], k = t.dataset.cgk;
    g[k] = k === "adv" ? +t.value : k === "grp" ? t.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1) : t.value;
  } else if (t.dataset.cgslot) {
    const [gi, si] = t.dataset.cgslot.split(":").map(Number);
    f.customGroups[gi].srcs[si] = t.value;
  } else if (t.dataset.cmk) {
    const m = f.customMatches[+t.dataset.cmi], k = t.dataset.cmk;
    m[k] = k === "bo" ? +t.value : k === "code" ? t.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8) : k === "grp" ? (t.value || null) : t.value;
  } else return;
  redrawFmt();
});
document.addEventListener("change", async (e) => {
  const c = e.target.closest("[data-abs]"); if (!c) return;
  const seed = +c.dataset.abs, on = c.checked;
  if (on && !confirm(`${teamName(seed)} ไม่มา แพ้บายทุกคู่ที่เหลือ`)) { c.checked = false; return; }
  if ((await act(() => adm("a2_adm_absent", { p_seed: seed, p_absent: on }), on ? "ตั้งเป็นไม่มาแล้ว" : "ยกเลิกไม่มาแล้ว")) === undefined) c.checked = !on;
});
function hydrateCustomSelect(t) {
  const sel = t?.closest?.("select[data-csrc]");
  if (!sel || sel.dataset.hydrated) return;
  sel.dataset.hydrated = "1";
  const f = fmtEdit(), cur = sel.value || "";
  const ex = sel.dataset.cmk ? f.customMatches?.[+sel.dataset.cmi]?.code || "" : "";
  sel.innerHTML = customSrcOpts(f, ex, cur);
  sel.value = cur;
}
document.addEventListener("pointerdown", (e) => hydrateCustomSelect(e.target), true);
document.addEventListener("mousedown", (e) => hydrateCustomSelect(e.target), true);
document.addEventListener("focusin", (e) => hydrateCustomSelect(e.target));
document.addEventListener("click", (e) => { if (e.target.closest('[data-tab="log"]')) loadLog(); });

boot();

// Remember whether the detailed format editor is open across redraws
document.addEventListener("toggle", (e) => {
  if (!e.target.classList) return;
  if (e.target.classList.contains("fdet")) fmtDetOpen = e.target.open;
  if (e.target.classList.contains("fprev")) { fmtPrevOpen = e.target.open; if (e.target.open) fitBrackets(e.target); }
}, true);

// Queue row selects : change Bo of one match, or mark a team absent for one match
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.boCode) {
    const c = t.dataset.boCode, bo = +t.value;
    if (!confirm(`คู่ ${c} เปลี่ยนเป็น Bo${bo}`)) { redraw(); return; }
    if (await act(() => adm("a2_adm_bo", { p_codes: [c], p_bo: bo }), `${c} เป็น Bo${bo} แล้ว`) !== undefined) { await loadAll(); redraw(); }
  }
  if (t.dataset && t.dataset.ffCode && t.value) {
    const c = t.dataset.ffCode, sd = t.value, m = match(c);
    if (!confirm(`${sideName(m, sd)} ไม่มา ให้ ${sideName(m, sd === "red" ? "blue" : "red")} ชนะบาย (${Math.ceil(m.bo / 2)}-0)`)) { t.value = ""; return; }
    await act(() => adm("a2_adm_forfeit", { p_code: c, p_side: sd }), "บันทึกแพ้บายแล้ว");
  }
});

// Schedule settings inputs : saved per browser right away
document.addEventListener("change", (e) => {
  const t = e.target; if (!t.dataset) return;
  if (t.dataset.sc && t.closest(".sched")) { const k = t.dataset.sc; sc[k] = k === "auto" ? t.value === "1" : ["pgames", "pbo", "pmin"].includes(k) ? +t.value : t.value; scSave(); if (k === "pgames") { formTab = ""; render(); } }
  else if (t.dataset.pteam) { const sd = +t.dataset.pteam, a = new Set(sc.pabsent || []); if (t.checked) a.delete(sd); else a.add(sd); sc.pabsent = [...a]; scSave(); formTab = ""; render(); }
  else if (t.dataset.scmin) { sc.mins[t.dataset.scmin] = +t.value; scSave(); }
  else if (t.dataset.brk) { const x = sc.breaks[+t.dataset.brk]; if (x) { x[t.dataset.bk] = t.dataset.bk === "min" ? +t.value : t.value; scSave(); } }
});
