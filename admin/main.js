import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { connect, onChange, event, fields, matches, match, gamesOf, openGame, gameNo, sideName, teamName, teamsArr, tableOf, fieldLeft, fieldPhaseLabel, fmtMs, parseMs, fmtTime, esc, $, now, rpc, toast, netBadge, raf, paintNet, S, T, STATUS_TH, METHOD_TH, previewDecide, REASON_TH, sb } from "../shared/common.js";

const app = $("app"), dlg = $("dlg");
const store = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e) {} return null; };
const lstore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; };
let pw = store("a2pw") || "", authed = false, started = false, hasSetup = null;
let tab = lstore("a2tab") || "home";
const TABS = [["home", "ภาพรวม"], ["queue", "คิวสนาม"], ["schedule", "ตั้งเวลา"], ["groups", "สายและอันดับ"], ["matches", "ทุกคู่"], ["teams", "ทีม"], ["tv", "หน้า TV"], ["settings", "ตั้งค่า"], ["log", "ประวัติ"]];
const ROUND = { r1: "รอบแรก", r2: "รอบสอง", final: "ชิงชนะเลิศ" };

// ---------- เรียก RPC ของแอดมิน ----------
async function adm(name, args) {
  try { return await rpc(name, { p_pw: pw, ...args }); }
  catch (e) { if (e.code === "forbidden") { logout(true); } throw e; }
}
async function act(fn, ok) {
  try { const r = await fn(); if (ok) toast(ok); return r; }
  catch (e) { toast(e.message || "ทำรายการไม่สำเร็จ", true); return undefined; }
}
function logout(expired) { pw = ""; authed = false; store("a2pw", null); if (expired) toast("รหัสผ่านไม่ถูกต้องหรือถูกเปลี่ยนแล้ว", true); drawLogin(); }

// ---------- เข้าสู่ระบบ และตั้งค่าครั้งแรก ----------
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

// ---------- โครงหน้า ----------
function shell() {
  app.innerHTML = `<div class="top"><img src="../shared/irap.png" alt=""><b id="evn"></b><span class="sp"></span>${netBadge()}<button class="btn small" id="lo">ออกจากระบบ</button></div>
    <nav class="tabs" role="tablist">${TABS.map(([k, t]) => `<button role="tab" data-tab="${k}" class="${k === tab ? "on" : ""}">${t}</button>`).join("")}</nav><div class="main" id="mn"></div>`;
  $("lo").onclick = () => logout(false);
  app.querySelector(".tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; lstore("a2tab", tab); app.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("on", x === b)); lastKey = ""; formTab = ""; render(true); };
  paintNet();
}

// ---------- วาดหน้า ----------
let lastKey = "", formTab = "";
if (!TABS.some((t) => t[0] === tab)) tab = "home";
const FORM_TABS = ["schedule", "teams", "settings"];   // แท็บที่มีช่องกรอก วาดซ้ำเฉพาะตอนสลับแท็บหรือหลังกดบันทึก
function render(force) {
  if (!authed || !S.ready) { if (authed) { const mn = $("mn"); if (mn && !mn.innerHTML) mn.innerHTML = `<p class="muted">กำลังโหลดข้อมูล</p>`; } return; }
  const ev = event(); const en = $("evn"); if (en && en.textContent !== ev.name) en.textContent = ev.name || "Alvik";
  paintNet();
  if (FORM_TABS.includes(tab)) { if (formTab !== tab || force === "again") { formTab = tab; $("mn").innerHTML = VIEW[tab](); afterForm(); } updateDlgBanner(); return; }
  const k = tab + JSON.stringify([ev, [...T.a2_team.values()].map((t) => [t.name, t.absent]), matches().map((m) => [m.code, m.status, m.red_wins, m.blue_wins, m.red_seed, m.blue_seed, m.field_no, m.sched_at, m.sched_field, m.auto_open, m.walkover, m.forfeit]), fields().map((f) => [f.no, f.match_code, f.phase, f.running, f.left_ms, f.ref_seen && Math.floor(Date.parse(f.ref_seen) / 10000)]), S.standings, [...T.a2_tiebreak.values()], tab === "log" ? logRows.length : 0]);
  if (k === lastKey) { updateDlgBanner(); return; }
  lastKey = k; $("mn").innerHTML = VIEW[tab](); fitBrackets($("mn")); updateDlgBanner();
}
const redraw = () => { lastKey = ""; formTab = ""; render(); };

// ---------- แท็บ ภาพรวม ----------
function clockBox(f) {
  const m = f.match_code ? match(f.match_code) : null;
  if (!m) return `<div class="ck empty"><div class="ckh"><b>สนาม ${f.no}</b><span>ว่าง</span></div><div class="ckt" data-clk="${f.no}">${fmtMs(0)}</div></div>`;
  const online = f.ref_seen && Date.now() - Date.parse(f.ref_seen) < 30000;
  return `<div class="ck st-${m.status}"><div class="ckh"><b>สนาม ${f.no}</b><span>${m.code}</span><span class="dot${online ? " on" : ""}" title="${online ? "กรรมการออนไลน์" : "ยังไม่มีกรรมการเข้า"}"></span></div>
    <div class="ckv"><span class="r">${esc(sideName(m, "red"))}</span><b>${m.red_wins}-${m.blue_wins}</b><span class="b">${esc(sideName(m, "blue"))}</span></div>
    <div class="ckt" data-clk="${f.no}">0:00</div><div class="ckp muted" data-ph="${f.no}"></div></div>`;
}
function homeView() {
  const free = fields().filter(isFree), ready = matches().filter((m) => m.status === "ready").slice(0, 6);
  const rq = ready.length ? ready.map((m) => `<div class="rq"><b>${m.code}</b><span>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</span><span class="muted">${m.sched_at ? fmtTime(m.sched_at) + (m.auto_open ? " เปิดเอง" : "") : ""}</span>${free.map((f) => `<button class="btn small primary" data-act="open" data-c="${m.code}" data-f="${f.no}">เปิดสนาม ${f.no}</button>`).join("")}</div>`).join("") : `<p class="muted">ไม่มีคู่ที่พร้อมเปิดคิว</p>`;
  return `<div class="home"><div class="card hbk">${bracketHtml({ clickable: true })}</div>
    <div class="hbot"><div class="card"><div class="h2"><h2>พร้อมเปิดคิว</h2><span>กดชิปคู่ในตารางสายเพื่อดูหรือแก้ผล</span></div>${rq}</div><div class="hclk n${fields().length}">${fields().map(clockBox).join("")}</div></div></div>`;
}

// ---------- แท็บ คิวสนาม ----------
const timerBtns = (f) => {
  const b = (a, t, c = "") => `<button class="btn ${c}" data-act="timer" data-f="${f.no}" data-a="${a}">${t}</button>`;
  if (!f.match_code) return "";
  const ph = f.phase;
  if (ph === "idle") return b("start_setup", "เริ่ม Setup", "primary");
  if (ph === "setup") return f.running ? b("pause", "หยุดชั่วคราว") + b("start_game", "ข้ามไปเริ่มแข่ง") : f.left_ms === 0 ? b("start_game", "เริ่มจับเวลาแข่ง", "primary") + b("reset", "รีเซ็ตนาฬิกา") : b("resume", "เล่นต่อ", "primary") + b("start_game", "ข้ามไปเริ่มแข่ง") + b("reset", "รีเซ็ตนาฬิกา");
  if (ph === "game") return f.running ? b("pause", "หยุดชั่วคราว") : b("resume", "เล่นต่อ", "primary") + b("reset", "รีเซ็ตนาฬิกา");
  return b("reset", "รีเซ็ตนาฬิกา");
};
const isFree = (f) => !f.match_code || match(f.match_code)?.status === "done";
function fieldCard(f) {
  const m = f.match_code ? match(f.match_code) : null;
  if (!m) {
    const ready = matches().filter((x) => x.status === "ready");
    return `<div class="card fc"><div class="h2"><h2>สนาม ${f.no}</h2><span>ว่าง ยังไม่ได้เปิดคิว</span></div>
      ${ready.length ? `<div class="btns">${ready.slice(0, 4).map((x) => `<button class="btn primary" data-act="open" data-c="${x.code}" data-f="${f.no}">เปิดคิว ${x.code}  ${esc(sideName(x, "red"))} พบ ${esc(sideName(x, "blue"))}</button>`).join("")}</div>` : `<p class="muted">ไม่มีคู่ที่พร้อมแข่ง</p>`}</div>`;
  }
  const g = openGame(m.code), live = m.status === "live", done = m.status === "done";
  const online = f.ref_seen && Date.now() - Date.parse(f.ref_seen) < 30000;
  const gn = g ? gameNo(m.code, g) : gamesOf(m.code).filter((x) => x.status === "done").length;
  return `<div class="card fc st-${m.status}"><div class="h2"><h2>สนาม ${f.no}</h2><span class="pill ${m.status}">${STATUS_TH[m.status]}</span><span>${online ? "กรรมการออนไลน์" : "ยังไม่มีกรรมการเข้า"}</span></div>
    <div class="vs"><b>${m.code}</b><span>${ROUND[m.stage]}${m.grp ? " สาย " + m.grp : ""}</span><span class="r">${esc(sideName(m, "red"))}</span><span class="sc">${m.red_wins} - ${m.blue_wins}</span><span class="b">${esc(sideName(m, "blue"))}</span></div>
    <div class="muted">${done ? "จบคู่แล้ว ผู้ชนะ " + esc(teamName(m.winner_seed)) : "เกม " + (gn || 1) + " จาก Bo" + m.bo + (g?.pattern ? "  แบบสนาม " + g.pattern : "  ยังไม่เลือกแบบสนาม") + (g && g.status === "review" ? "  รอยืนยันผลเกม" : "")}</div>
    <div class="t" data-clk="${f.no}">0:00</div><div class="muted" data-ph="${f.no}"></div>
    <div class="btns">${done ? "" : timerBtns(f)}<button class="btn" data-act="edit" data-c="${m.code}">ดูและแก้คะแนน</button><button class="btn danger" data-act="close" data-f="${f.no}" data-c="${m.code}">${done ? "ปิดคิว" : "ปิดคิว ยกเลิกการเปิด"}</button></div></div>`;
}
function matchRow(m) {
  const fl = fields(), free = fl.filter(isFree);
  const when = m.sched_at ? fmtTime(m.sched_at) + (m.auto_open ? " อัตโนมัติ" : " ตามเวลา") : "";
  return `<tr><td><b>${m.code}</b></td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td><td class="num">${m.status === "locked" ? "" : m.red_wins + "-" + m.blue_wins}</td><td><span class="pill ${m.status}">${STATUS_TH[m.status]}${m.field_no ? " สนาม " + m.field_no : ""}</span></td><td>${when}</td>
    <td>${m.status === "ready" ? free.map((f) => `<button class="btn small primary" data-act="open" data-c="${m.code}" data-f="${f.no}">เปิดสนาม ${f.no}</button>`).join(" ") : ""} <button class="btn small" data-act="edit" data-c="${m.code}">แก้</button></td></tr>`;
}
const queueView = () => `<div class="cols"><div class="stack">${fields().map(fieldCard).join("")}</div><div><div class="h2"><h2>ลำดับการแข่ง</h2><span>กดเปิดคิวเมื่อถึงรอบนั้นเท่านั้น กรรมการจึงจะเลือกสนามได้</span></div><div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>ทีม</th><th class="num">ผล</th><th>สถานะ</th><th>เวลา</th><th></th></tr></thead><tbody>${matches().map(matchRow).join("")}</tbody></table></div></div></div>`;

// ---------- แท็บ ตั้งเวลา ----------
const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const hm = (iso) => iso ? fmtTime(iso) : "";
function scheduleView() {
  const ev = event(), nf = ev.field_count, first = matches().find((m) => m.sched_at);
  const day = first ? (() => { const d = new Date(first.sched_at); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })() : todayStr();
  return `<div class="h2"><h2>ตั้งเวลาเปิดคิว</h2><span>ระบบเปิดคิวให้เองเมื่อถึงเวลา โดยต้องรู้ผู้เล่นครบและสนามว่าง ยังเปิดก่อนเวลาเองได้เสมอ</span></div>
   <div class="card" style="margin-bottom:14px"><div class="form" style="max-width:none"><div class="gf" style="grid-template-columns:repeat(5,minmax(0,1fr))">
     <label>วันแข่ง<input type="date" id="sd" value="${day}"></label><label>เวลาเริ่มคู่แรก<input type="time" id="s0" value="09:00"></label>
     <label>ห่างกันรอบละ (นาที)<input type="number" id="si" min="1" value="12"></label><label>เปิดอัตโนมัติ<select id="sa"><option value="1">เปิด</option><option value="0">ปิด</option></select></label>
     <button class="btn primary" data-act="autofill" style="align-self:end">เติมให้อัตโนมัติ</button></div>
     <p class="muted" style="margin:0">เติมตามลำดับคู่ รอบละ ${nf} คู่ต่อสนามที่เปิดอยู่ จากนั้นแก้รายคู่ได้ แล้วกดบันทึก</p></div></div>
   <div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>ทีม</th><th>เวลา</th><th>สนาม</th><th>เปิดเอง</th><th></th></tr></thead><tbody>${matches().map((m) => `<tr data-sc="${m.code}"><td><b>${m.code}</b></td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td>
     <td>${m.status === "done" ? `<span class="muted">${hm(m.sched_at)} จบแล้ว</span>` : `<input type="time" data-k="at" value="${hm(m.sched_at)}">`}</td>
     <td>${m.status === "done" ? "" : `<select data-k="field"><option value="">ไม่ระบุ</option>${Array.from({ length: nf }, (_, i) => `<option value="${i + 1}" ${m.sched_field === i + 1 ? "selected" : ""}>สนาม ${i + 1}</option>`).join("")}</select>`}</td>
     <td>${m.status === "done" ? "" : `<input type="checkbox" data-k="auto" ${m.auto_open ? "checked" : ""} aria-label="เปิดอัตโนมัติ ${m.code}">`}</td><td>${m.sched_at && m.status !== "done" ? `<button class="btn small" data-act="clearsc">ล้าง</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
   <div class="btns"><button class="btn primary" data-act="savesc">บันทึกเวลา</button></div>`;
}
function readSchedule() {
  const day = $("sd")?.value || todayStr(), out = [];
  document.querySelectorAll("tr[data-sc]").forEach((tr) => {
    const code = tr.dataset.sc, m = match(code); if (m.status === "done") return;
    const t = tr.querySelector('[data-k="at"]').value, f = tr.querySelector('[data-k="field"]').value, a = tr.querySelector('[data-k="auto"]').checked;
    out.push({ code, at: t ? new Date(day + "T" + t + ":00").toISOString() : null, field: f ? +f : null, auto: !!(t && a) });
  });
  return out;
}
function autofill() {
  const day = $("sd").value || todayStr(), t0 = $("s0").value, iv = Math.max(1, +$("si").value || 12), nf = event().field_count, auto = $("sa").value === "1";
  if (!t0) return toast("ใส่เวลาเริ่มคู่แรกก่อน", true);
  const base = new Date(day + "T" + t0 + ":00").getTime(); let i = 0;
  document.querySelectorAll("tr[data-sc]").forEach((tr) => {
    if (!["locked", "ready"].includes(match(tr.dataset.sc).status)) return;
    const slot = Math.floor(i / nf), f = (i % nf) + 1, d = new Date(base + slot * iv * 60000); i++;
    tr.querySelector('[data-k="at"]').value = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    tr.querySelector('[data-k="field"]').value = String(f); tr.querySelector('[data-k="auto"]').checked = auto;
  });
  toast("เติมแล้ว ตรวจสอบแล้วกดบันทึก");
}

// ---------- แท็บ สายและอันดับ ----------
function groupsView() {
  return `<div class="grid5">${["A", "B", "C", "D", "E"].map((G) => {
    const rows = tableOf(G), tiedAny = rows.some((r) => r.tied), seeds = rows.filter((r) => r.seed != null).map((r) => r.seed), tb = T.a2_tiebreak.get(G);
    return `<div><div class="h2"><h2>สาย ${G}</h2><span>${G < "D" ? "รอบแรก ผ่าน 2 ทีม" : "รอบสอง ผ่าน 1 ทีม"}</span></div>
      <div class="tw"><table class="tbl"><thead><tr><th>ที่</th><th>ทีม</th><th class="num">ชนะ-แพ้</th><th class="num">เกม</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.tied ? "tied" : ""}"><td>${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) : "รอผล"}${r.how ? `<div class="muted" style="font-size:13px">${esc(r.how)}</div>` : ""}</td><td class="num">${r.mw}-${r.ml}</td><td class="num">${r.gw}-${r.gl}</td>
        <td>${r.tied && i > 0 && rows[i - 1].tied && r.seed != null ? `<button class="btn small" data-act="tbup" data-g="${G}" data-s="${r.seed}">ขึ้น</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${tiedAny ? `<div class="warn">มีทีมเสมอกันทุกเกณฑ์ กดขึ้นเพื่อให้ทีมนั้นอยู่เหนือทีมข้างบน</div>` : ""}${tb ? `<div class="btns"><button class="btn small" data-act="tbclear" data-g="${G}">ล้างการตัดสินลำดับ</button></div>` : ""}</div>`;
  }).join("")}</div>`;
}

// ---------- แท็บ ทุกคู่ ----------
const matchesView = () => `<div class="h2"><h2>ทุกคู่</h2><span>แก้ผลรายเกมได้ทุกคู่ แม้จบแล้ว ระบบคำนวณอันดับและผู้ชนะใหม่ให้เอง</span></div>
  <div class="tw"><table class="tbl"><thead><tr><th>คู่</th><th>รอบ</th><th>ทีม</th><th class="num">ผล</th><th>สถานะ</th><th></th></tr></thead><tbody>${matches().map((m) => `<tr><td><b>${m.code}</b></td><td>${ROUND[m.stage]}${m.grp ? " สาย " + m.grp : ""} Bo${m.bo}</td><td>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</td><td class="num">${m.red_wins}-${m.blue_wins}</td><td><span class="pill ${m.status}">${STATUS_TH[m.status]}</span></td><td><button class="btn small" data-act="edit" data-c="${m.code}">เปิดดูและแก้</button></td></tr>`).join("")}</tbody></table></div>`;

// ---------- หน้าต่างแก้คู่ ----------
let dlgCode = "", dlgSig = "";
const sigOf = (c) => JSON.stringify([match(c), gamesOf(c)]);
function gameBlock(m, g) {
  const n = gameNo(m.code, g), ms = (v) => (v == null ? "" : fmtMs(v)), pv = previewDecide(g);
  const stTxt = { ready: "ยังไม่เริ่ม", live: "กำลังแข่ง", review: "รอยืนยัน", done: "จบแล้ว", replay: "เสมอ แข่งใหม่" }[g.status] || g.status;
  const side = (s, nm) => `<div class="gf"><b class="side-${s === "red" ? "r" : "b"}" style="color:var(--c);align-self:center">${esc(nm)}</b>
    <label>จอดได้ (0-3)<select data-k="${s}_parked">${[0, 1, 2, 3].map((i) => `<option ${g[s + "_parked"] === i ? "selected" : ""}>${i}</option>`).join("")}</select></label>
    <label>จอดครบที่ (นาที:วินาที)<input data-k="${s}_full_ms" value="${ms(g[s + "_full_ms"])}" placeholder="ไม่มี"></label>
    <label>ยกแท่นแรกที่<input data-k="${s}_lift_ms" value="${ms(g[s + "_lift_ms"])}" placeholder="ไม่มี"></label>
    <label>ออกจากกรอบแดงที่<input data-k="${s}_exit_ms" value="${ms(g[s + "_exit_ms"])}" placeholder="ไม่มี"></label><span></span></div>`;
  return `<div class="card st-${g.status === "done" ? "done" : g.status === "live" ? "live" : "ready"}" data-g="${g.id}" data-v="${g.version}"><div class="h2"><h2>เกม ${g.status === "replay" ? "เสมอ (แข่งใหม่)" : n}</h2><span class="pill ${g.status === "done" ? "done" : g.status === "live" ? "live" : "ready"}">${stTxt}</span>
    <span>${g.winner ? "ผู้ชนะ " + esc(sideName(m, g.winner)) + (g.method ? "  " + METHOD_TH[g.method] : "") : pv.need ? esc(REASON_TH[pv.need]) : pv.side ? "ระบบเห็นว่า " + esc(sideName(m, pv.side)) + " น่าจะชนะ" : ""}</span></div>
    <div class="gf" style="grid-template-columns:140px 1fr"><label>แบบสนาม<select data-k="pattern"><option value="">ยังไม่เลือก</option>${[1, 2, 3].map((i) => `<option value="${i}" ${g.pattern === i ? "selected" : ""}>แบบ ${i}</option>`).join("")}</select></label><label>หมายเหตุ<input data-k="note" value="${esc(g.note || "")}"></label></div>
    ${side("red", sideName(m, "red"))}${side("blue", sideName(m, "blue"))}
    <div class="btns"><button class="btn primary" data-act="gsave">บันทึกตัวเลข</button><button class="btn" data-act="gauto">บันทึกและให้ระบบตัดสิน</button>
      <button class="btn red" data-act="gwin" data-w="red">ให้ ${esc(sideName(m, "red"))} ชนะ</button><button class="btn blue" data-act="gwin" data-w="blue">ให้ ${esc(sideName(m, "blue"))} ชนะ</button>
      ${g.winner ? `<button class="btn" data-act="gwin" data-w="">ล้างผู้ชนะ</button>` : ""}<button class="btn danger" data-act="gvoid">ลบเกมนี้</button></div></div>`;
}
function dlgHtml(code) {
  const m = match(code), gs = gamesOf(code), fl = fields().filter(isFree);
  dlgSig = sigOf(code);
  return `<div class="dh"><h2>คู่ ${m.code}  ${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}  <span class="muted">${m.red_wins}-${m.blue_wins}</span></h2><span class="pill ${m.status}">${STATUS_TH[m.status]}</span><button class="btn" data-act="dclose">ปิด</button></div>
   <div class="db">${m.walkover ? `<div class="warn">ชนะบาย ${esc(sideName(m, m.walkover === "red" ? "blue" : "red"))} ชนะ เพราะ ${esc(sideName(m, m.walkover))} ไม่มา ${m.forfeit ? "" : "(ตั้งทีมนี้เป็นไม่มาไว้ในแท็บทีม)"}</div>` : ""}<div class="warn" id="dwarn" hidden>ข้อมูลคู่นี้เพิ่งเปลี่ยนจากที่อื่น <button class="btn small" data-act="dreload">โหลดใหม่</button> (ตัวเลขที่กรอกค้างไว้จะหายไป)</div>
   ${gs.length ? gs.map((g) => gameBlock(m, g)).join("") : `<p class="muted">ยังไม่มีเกมในคู่นี้ ${m.status === "locked" ? "คู่นี้ยังรอผลคู่ก่อนหน้า" : "เกมแรกจะถูกสร้างตอนเปิดคิว หรือกดเพิ่มเกมด้านล่าง"}</p>`}
   <div class="btns"><button class="btn" data-act="gadd" ${m.status === "locked" ? "disabled" : ""}>เพิ่มเกม</button>${!gs.length && m.status !== "done" ? `<button class="btn" data-act="swap">สลับฝั่งแดงกับน้ำเงิน</button>` : ""}
   ${(m.red_seed != null && m.blue_seed != null && m.status !== "done") || m.forfeit ? ["red", "blue"].map((sd) => `<button class="btn danger" data-act="ff" data-s="${sd}">${esc(sideName(m, sd))} ไม่มา แพ้บาย</button>`).join("") : ""}${m.forfeit ? `<button class="btn" data-act="ff" data-s="">ยกเลิกแพ้บาย</button>` : ""}
   ${m.status === "ready" ? fl.map((f) => `<button class="btn primary" data-act="open" data-c="${m.code}" data-f="${f.no}" data-keep="1">เปิดคิวสนาม ${f.no}</button>`).join("") : ""}</div></div>`;
}
function openDlg(code) { dlgCode = code; dlg.innerHTML = dlgHtml(code); if (!dlg.open) dlg.showModal(); }
function updateDlgBanner() { if (!dlg.open || !dlgCode) return; const w = $("dwarn"); if (w) w.hidden = sigOf(dlgCode) === dlgSig; }
dlg.addEventListener("close", () => { dlgCode = ""; });
function readGame(card) {
  const p = {};
  card.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k, v = el.value;
    if (k.endsWith("_ms")) { const x = parseMs(v); if (Number.isNaN(x)) throw new Error("เวลาต้องเป็นรูปแบบ 0:45 หรือจำนวนวินาที"); p[k] = x; }
    else if (k.endsWith("_parked")) p[k] = +v; else if (k === "pattern") p[k] = v ? +v : null; else p[k] = v;
  });
  return p;
}

// ---------- แท็บ ทีม ----------
function teamsView() {
  const t = teamsArr(), draw = event().tv_mode === "draw";
  return `<div class="h2"><h2>ทีมแข่งขัน</h2><span>ลำดับ 1 ถึง 9 คือสายที่ทีมอยู่ A คือ 1-3 B คือ 4-6 C คือ 7-9 ใช้ปุ่มสุ่มเพื่อจับสาย</span></div>
   <div class="teams">${["A", "B", "C"].map((G, gi) => `<div class="card grp"><h2>สาย ${G}</h2>${[1, 2, 3].map((j) => { const s = gi * 3 + j; return `<div><span class="muted">${s}</span><input data-seed="${s}" value="${esc(t.find((x) => x.seed === s)?.name || "")}" placeholder="ทีม ${s}" maxlength="40"><label class="ab"><input type="checkbox" data-abs="${s}" ${t.find((x) => x.seed === s)?.absent ? "checked" : ""}>ไม่มา</label></div>`; }).join("")}</div>`).join("")}</div>
   <div class="btns"><button class="btn primary" data-act="saveteams">บันทึกชื่อทีม</button><button class="btn" data-act="shuffle">สุ่มสลับสายในช่องกรอก</button></div>
   <div class="h2" style="margin-top:24px"><h2>จับสายบนจอ TV</h2><span>${draw ? "TV กำลังอยู่ในโหมดจับสาย" : "บันทึกชื่อทีมก่อน แล้วกดเริ่ม TV จะเผยชื่อทีมทีละทีม"}</span></div>
   <div class="btns"><button class="btn primary" data-act="drawstart">เริ่มเผยชื่อทีมบน TV</button><button class="btn" data-act="tvauto">กลับโหมดอัตโนมัติ</button></div>`;
}

// ---------- แท็บ หน้า TV ----------
function tvView() {
  const ev = event(), M = [["auto", "อัตโนมัติ", "ตารางสายพร้อมคะแนนแต่ละสนาม จบคู่ชิงแล้วขึ้นแชมป์เอง"], ["bracket", "ตารางสาย", "ตารางสายแบบเส้นลาก และคะแนนสนาม"], ["groups", "ตารางคะแนน", "อันดับของทุกสาย"], ["fields", "สนามแบบใหญ่", "คะแนนสนามตัวใหญ่ เต็มจอ"], ["draw", "จับสาย", "เผยชื่อทีมทีละทีม"], ["champion", "ประกาศแชมป์", "ใช้ได้เมื่อจบคู่ชิง"]];
  return `<div class="h2"><h2>สั่งหน้า TV</h2><span>เปลี่ยนแล้ว TV เปลี่ยนตามทันที ปกติใช้โหมดอัตโนมัติ TV ไม่แสดงนาฬิกา ถ้าต้องการให้ใส่ ?clock=1 ท้ายลิงก์ของหน้า TV</span></div>
   <div class="grid5">${M.map(([k, t, d]) => `<div class="card ${ev.tv_mode === k ? "st-ready" : ""}"><h2>${t}${ev.tv_mode === k ? ` <span class="pill ready">กำลังใช้</span>` : ""}</h2><p class="muted">${d}</p><button class="btn ${ev.tv_mode === k ? "" : "primary"}" data-act="tvmode" data-m="${k}" ${ev.tv_mode === k ? "disabled" : ""}>ใช้โหมดนี้</button></div>`).join("")}</div>`;
}

// ---------- แท็บ ตั้งค่า ----------
function settingsView() {
  const ev = event(), base = new URL("../", location.href).href, nf = T.a2_field.size || 2;
  const link = (p, t, d) => `<div class="lk"><div data-qr="${base}${p}/"></div><div><b>${t}</b><div class="muted">${d}</div><code>${base}${p}/</code><div class="btns"><button class="btn small" data-act="copy" data-u="${base}${p}/">คัดลอกลิงก์</button><a class="btn small" style="text-decoration:none" href="${base}${p}/" target="_blank" rel="noopener">เปิด</a></div></div></div>`;
  return `<div class="cols"><div class="stack"><div class="card"><div class="h2"><h2>การแข่งขัน</h2></div><div class="form">
     <label>ชื่องาน<input id="en" value="${esc(ev.name)}" maxlength="80"></label>
     <div class="two"><label>เวลา Setup (วินาที)<input id="es" type="number" min="0" value="${Math.round(ev.setup_ms / 1000)}"></label><label>เวลาแข่งต่อเกม (วินาที)<input id="eg" type="number" min="10" value="${Math.round(ev.game_ms / 1000)}"></label></div>
     <label>จำนวนสนามที่ใช้<select id="ef">${Array.from({ length: nf }, (_, i) => `<option ${ev.field_count === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
     <button class="btn primary" data-act="saveev">บันทึก</button></div></div>
    <div class="card"><div class="h2"><h2>รหัสผ่านและ PIN</h2></div><div class="form"><div class="two"><label>รหัสผ่านแอดมินใหม่<input id="np" type="password" autocomplete="new-password" minlength="6"></label><label>PIN กรรมการใหม่<input id="ni" inputmode="numeric" pattern="[0-9]{4,8}"></label></div>
     <button class="btn" data-act="savepw">เปลี่ยน (กรอกเฉพาะช่องที่ต้องการเปลี่ยน)</button></div></div>
    <div class="card"><div class="h2"><h2>ข้อมูล</h2></div><div class="btns"><button class="btn" data-act="export">ดาวน์โหลดผลทั้งหมด (JSON)</button></div>
     <div class="form" style="margin-top:14px"><label>เริ่มงานใหม่ ลบผลและเกมทั้งหมด (พิมพ์ รีเซ็ต เพื่อยืนยัน)<input id="rc" placeholder="รีเซ็ต"></label><button class="btn danger" data-act="reset">ลบผลทั้งหมดและเริ่มใหม่</button><span class="muted">ชื่อทีมและการตั้งค่าไม่ถูกลบ</span></div></div></div>
   <div class="card links"><div class="h2"><h2>ลิงก์ของแต่ละหน้า</h2></div>${link("tv", "หน้า TV", "เปิดบนโน้ตบุ๊กที่ต่อจอ แล้วกดเต็มจอ")}${link("ref", "หน้ากรรมการ", "ให้กรรมการสแกน ต้องใช้ PIN และเลือกสนาม")}${link("admin", "หน้าแอดมิน", "สำหรับผู้จัดเท่านั้น")}</div></div>`;
}
function afterForm() {
  document.querySelectorAll("[data-qr]").forEach((d) => { try { const q = window.qrcode(0, "M"); q.addData(d.dataset.qr); q.make(); d.innerHTML = q.createSvgTag({ scalable: true, margin: 2 }); d.firstChild.style.cssText = "width:110px;height:110px"; } catch (e) {} });
}

// ---------- แท็บ ประวัติ ----------
let logRows = [];
const AL = { "queue.assign": "เปิดคิว", "queue.unassign": "ปิดคิว", "game.patch": "แก้ผลเกม", "game.add": "เพิ่มเกม", "game.void": "ลบเกม", "event.update": "แก้ตั้งค่า", "schedule.set": "ตั้งเวลา", reset: "รีเซ็ต", "group.tiebreak": "ตัดสินอันดับ", "teams.set": "แก้ชื่อทีม", "match.swap": "สลับฝั่ง", "match.forfeit": "แพ้บาย", "team.absent": "ทีมไม่มา",
  "timer.start_setup": "เริ่ม Setup", "timer.start_game": "เริ่มแข่ง", "timer.pause": "หยุดนาฬิกา", "timer.resume": "เล่นต่อ", "timer.reset": "รีเซ็ตนาฬิกา",
  "game.pattern": "เลือกแบบสนาม", "game.parked_inc": "จอดเพิ่ม", "game.parked_dec": "จอดลด", "game.lift": "ยกแท่นแรก", "game.exit": "ออกจากกรอบแดง", "game.clear_lift": "ล้างยกแท่น", "game.clear_exit": "ล้างออกกรอบ", "game.finish": "จบเกม", "game.judge": "กรรมการตัดสิน" };
const actorTh = (a) => (a === "admin" ? "แอดมิน" : a === "system:auto" ? "ระบบ เปิดคิวตามเวลา" : String(a).startsWith("ref:") ? "กรรมการ สนาม " + String(a).split("@")[1] : a);
function logView() {
  return `<div class="h2"><h2>ประวัติการแก้ไข</h2><button class="btn small" data-act="logload">โหลดใหม่</button></div><div class="tw"><table class="tbl"><thead><tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>กับ</th></tr></thead><tbody>${logRows.map((r) => `<tr><td class="num">${new Date(r.at).toLocaleTimeString("th-TH")}</td><td>${esc(actorTh(r.actor))}</td><td>${esc(AL[r.action] || r.action)}</td><td>${esc(r.target || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">ยังไม่มีรายการ</td></tr>`}</tbody></table></div>`;
}
async function loadLog() { logRows = (await act(() => adm("a2_adm_audit", { p_limit: 200 }))) || []; redraw(); }

const VIEW = { home: homeView, queue: queueView, schedule: scheduleView, groups: groupsView, matches: matchesView, teams: teamsView, tv: tvView, settings: settingsView, log: logView };

// ---------- นาฬิกาในการ์ดสนาม ----------
function clocks() {
  document.querySelectorAll("[data-clk]").forEach((el) => {
    const f = T.a2_field.get(+el.dataset.clk); if (!f) return;
    const left = fieldLeft(f); el.textContent = fmtMs(left); el.classList.toggle("warn", f.phase === "game" && left > 0 && left <= 10000);
    const ph = document.querySelector(`[data-ph="${f.no}"]`); if (ph) ph.textContent = fieldPhaseLabel(f);
  });
}

// ---------- การกดปุ่ม ----------
const H = {
  async open(b) {
    const c = b.dataset.c, f = +b.dataset.f, F = T.a2_field.get(f), M = match(c);
    if (!confirm(`เปิดคิวคู่ ${c} ที่สนาม ${f}\n${sideName(M, "red")} พบ ${sideName(M, "blue")}\nกรรมการจะเลือกสนามนี้ได้ทันที`)) return;
    await act(() => adm("a2_adm_assign", { p_code: c, p_field: f }), `เปิดคิว ${c} ที่สนาม ${f} แล้ว`);
    if (dlg.open && dlgCode === c) dlg.innerHTML = dlgHtml(c);
  },
  async close(b) {
    const f = +b.dataset.f, c = b.dataset.c, M = match(c);
    const msg = M.status === "done" ? `ปิดคิวสนาม ${f}` : `ปิดคิวสนาม ${f} ทั้งที่คู่ ${c} ยังไม่จบ\nกรรมการที่เลือกสนามนี้อยู่จะถูกตัดออก`;
    if (!confirm(msg)) return;
    await act(() => adm("a2_adm_unassign", { p_field: f }), `ปิดคิวสนาม ${f} แล้ว`);
  },
  async timer(b) { await act(() => adm("a2_adm_timer", { p_field: +b.dataset.f, p_action: b.dataset.a })); },
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
  clearsc(b) { const tr = b.closest("tr"); tr.querySelector('[data-k="at"]').value = ""; tr.querySelector('[data-k="field"]').value = ""; tr.querySelector('[data-k="auto"]').checked = false; },
  async savesc() { const items = readSchedule(); if (await act(() => adm("a2_adm_schedule", { p_items: items }), "บันทึกเวลาแล้ว") !== undefined) { formTab = ""; render(); } },
  async tbup(b) {
    const G = b.dataset.g, s = +b.dataset.s, seeds = tableOf(G).filter((r) => r.seed != null).map((r) => r.seed), i = seeds.indexOf(s);
    if (i > 0) { [seeds[i - 1], seeds[i]] = [seeds[i], seeds[i - 1]]; await act(() => adm("a2_adm_tiebreak", { p_grp: G, p_seeds: seeds }), "ปรับลำดับแล้ว"); }
  },
  async tbclear(b) { await act(() => adm("a2_adm_tiebreak", { p_grp: b.dataset.g, p_seeds: null }), "ล้างแล้ว"); },
  async saveteams() { const names = Array.from({ length: 9 }, (_, i) => document.querySelector(`[data-seed="${i + 1}"]`).value.trim()); await act(() => adm("a2_adm_teams", { p_names: names }), "บันทึกชื่อทีมแล้ว"); },
  shuffle() { const els = [...document.querySelectorAll("[data-seed]")], v = els.map((e) => e.value); for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [v[i], v[j]] = [v[j], v[i]]; } els.forEach((e, i) => (e.value = v[i])); toast("สลับแล้ว ยังไม่ได้บันทึก"); },
  async drawstart() { await act(() => adm("a2_adm_event", { p: { tv_mode: "draw", draw_state: { start: Math.round(now()) + 2500 } } }), "TV เริ่มเผยชื่อทีมแล้ว"); formTab = ""; render(); },
  async tvauto() { await act(() => adm("a2_adm_event", { p: { tv_mode: "auto" } }), "TV กลับเป็นอัตโนมัติ"); formTab = ""; render(); },
  async tvmode(b) { await act(() => adm("a2_adm_event", { p: { tv_mode: b.dataset.m } }), "เปลี่ยนหน้า TV แล้ว"); },
  async saveev() {
    const p = { name: $("en").value.trim(), setup_ms: Math.max(0, +$("es").value) * 1000, game_ms: Math.max(10, +$("eg").value) * 1000, field_count: +$("ef").value };
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
    const data = { exported_at: new Date().toISOString(), event: event(), teams: teamsArr(), matches: matches(), games: [...T.a2_game.values()], standings: S.standings, ranking: S.ranking };
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "alvik-result-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "") + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async reset() { if ($("rc").value.trim() !== "รีเซ็ต") return toast("พิมพ์ รีเซ็ต ให้ตรงก่อน", true); if (!confirm("ลบผลและเกมทั้งหมด ย้อนกลับไม่ได้ ดาวน์โหลด JSON ไว้แล้วหรือยัง")) return; await act(() => adm("a2_adm_reset", {}), "รีเซ็ตแล้ว"); $("rc").value = ""; },
  logload() { loadLog(); },
};
document.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (!b || b.disabled) return; const f = H[b.dataset.act]; if (f) f(b); });
document.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
document.addEventListener("change", async (e) => {
  const c = e.target.closest("[data-abs]"); if (!c) return;
  const seed = +c.dataset.abs, on = c.checked;
  if (on && !confirm(`${teamName(seed)} ไม่มา แพ้บายทุกคู่ที่เหลือ`)) { c.checked = false; return; }
  if ((await act(() => adm("a2_adm_absent", { p_seed: seed, p_absent: on }), on ? "ตั้งเป็นไม่มาแล้ว" : "ยกเลิกไม่มาแล้ว")) === undefined) c.checked = !on;
});
document.addEventListener("click", (e) => { if (e.target.closest('[data-tab="log"]')) loadLog(); });

boot();
