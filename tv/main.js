import { connect, onChange, event, fields, matches, match, openGame, gamesOf, gameNo, sideName, teamName, teamsArr, tableOf, fieldLeft, fieldPhaseLabel, fmtMs, esc, $, now, beep, netBadge, raf, paintNet, S, T, METHOD_TH, teamAbsent } from "../shared/common.js";
import { bracketHtml, fitBrackets } from "../shared/bracket.js";

// TV ไม่แสดงนาฬิกา เปิดดูได้ด้วย ?clock=1
const SHOW_CLOCK = new URLSearchParams(location.search).get("clock") === "1";

const stage = $("stage");
function fit() { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px,${(innerHeight - 1080 * k) / 2}px) scale(${k})`; stage.style.left = 0; stage.style.top = 0; }
addEventListener("resize", fit); fit();
$("fs").onclick = async () => { try { await document.documentElement.requestFullscreen(); } catch (e) {} beep(660, 80); $("fs").remove(); try { await navigator.wakeLock?.request("screen"); } catch (e) {} };

const ROUND = { r1: "รอบแรก", r2: "รอบสอง", final: "ชิงชนะเลิศ" };
const head = (right) => `<div class="top"><img src="../shared/irap.png" alt=""><h1>${esc(event().name)}</h1><span class="rnd">${right || ""}</span>${netBadge()}</div>`;
const lastSeen = {};   // ผลเกมล่าสุดที่เพิ่งจบ ไว้แสดงค้าง 8 วินาที
let key = "", mode = "";

function effectiveMode() {
  const ev = event();
  if (ev.tv_mode && ev.tv_mode !== "auto") return ev.tv_mode;
  const F = match("F"); if (F && F.status === "done") return "champion";
  return "bracket";
}
function tableRows(G, adv) {
  const rows = tableOf(G).map((r) => {
    const q = r.sure && r.pos <= adv;
    return `<tr class="${q ? "q" : ""}"><td class="p">${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) + (teamAbsent(r.seed) ? " (ไม่มา)" : "") : "รอผล"}</td><td class="n">${r.mw}-${r.ml}</td><td class="n">${r.gw}-${r.gl}</td></tr>`;
  }).join("");
  return `<tr class="th"><td></td><td></td><td class="n">ชนะ-แพ้</td><td class="n">เกม</td></tr>` + (rows || `<tr><td>-</td></tr>`);
}
const ADV = { A: 2, B: 2, C: 2, D: 1, E: 1 };

function fieldPanel(f, n) {
  const m = f.match_code ? match(f.match_code) : null;
  if (!m) return `<div class="fp empty"><b>สนาม ${f.no}</b><span>ว่าง</span></div>`;
  const g = openGame(m.code), gs = gamesOf(m.code), lastDone = [...gs].reverse().find((x) => x.status === "done");
  const live = g && (g.status === "live" || g.status === "review");
  const doneM = m.status === "done";
  const gn = g ? gameNo(m.code, g) : gs.filter((x) => x.status === "done").length;
  const pk = (s) => { const k = g ? g[s + "_parked"] : 0; return `<div class="pk">${[1, 2, 3].map((i) => `<i class="${i <= k ? "on" : ""}"></i>`).join("")}${g && g[s + "_full_ms"] != null ? `<span>ครบ ${fmtMs(g[s + "_full_ms"])}</span>` : ""}</div>`; };
  const det = (s) => g ? `<div>ยกแรก ${g[s + "_lift_ms"] != null ? fmtMs(g[s + "_lift_ms"]) : "-"}</div>` : "";
  const tm = (s, cls) => `<div class="tm ${cls}"><div class="n">${esc(sideName(m, s))}</div>${pk(s)}</div>`;
  let flash = "";
  const seen = gs.filter((x) => x.status === "done" || x.status === "replay").sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  if (seen && Date.now() - Date.parse(seen.updated_at) < 8000 && !(g && g.status === "live")) {
    flash = seen.status === "replay" ? `<div class="flash">เสมอ แข่งใหม่ด้วยแบบสนามเดิม</div>` : `<div class="flash">${esc(sideName(m, seen.winner))} ชนะเกม ${gameNo(m.code, seen)}  ${METHOD_TH[seen.method] || ""}</div>`;
  }
  if (doneM) flash = `<div class="flash" style="background:var(--done);color:#fff">จบคู่ ${m.code} ผู้ชนะ ${esc(teamName(m.winner_seed))}</div>`;
  const cls = doneM ? "done" : live ? "live" : "";
  return `<div class="fp ${cls} n${n}"><div class="h"><b>สนาม ${f.no}</b><span>${m.code} ${ROUND[m.stage]}${m.grp ? " สาย " + m.grp : ""} เกม ${gn || 1} จาก Bo${m.bo}${g?.pattern ? " แบบสนาม " + g.pattern : ""}</span></div>
    <div class="vs">${tm("red", "side-r")}<div class="big"><span class="w">${m.red_wins}</span><span class="w">-</span><span class="w">${m.blue_wins}</span></div>${tm("blue", "side-b")}</div>
    ${SHOW_CLOCK ? `<div class="clk" data-clk="${f.no}">0:00</div><div class="ph" data-ph="${f.no}"></div>` : `<div class="ph big-ph" data-ph="${f.no}"></div>`}
    ${flash}</div>`;
}

// โหมดสนามแบบใหญ่ คะแนนล้วน ไม่มีตารางอื่น
function fieldsView() {
  const fs = fields(), n = fs.length;
  const act = fs.filter((f) => f.match_code && match(f.match_code)?.status !== "done");
  const groupsShown = [...new Set(act.map((f) => match(f.match_code).grp).filter(Boolean))].slice(0, 3);
  const strip = groupsShown.length ? `<div class="strip">${groupsShown.map((G) => `<div class="gt"><h3>สาย ${G}</h3><table>${tableRows(G, ADV[G])}</table></div>`).join("")}</div>` : "";
  return `${head(ROUND[match(act[0]?.match_code)?.stage] || "")}<div class="grid n${n}">${fs.map((f) => fieldPanel(f, n)).join("")}</div>${strip}`;
}

// การ์ดสนามแบบย่อ อยู่ใต้ตารางสาย
function miniCard(f) {
  const m = f.match_code ? match(f.match_code) : null;
  if (!m) return `<div class="mc empty"><b>สนาม ${f.no}</b><span>ว่าง</span></div>`;
  const g = openGame(m.code), doneM = m.status === "done", live = g && (g.status === "live" || g.status === "review");
  const pk = (s) => { const k = g ? g[s + "_parked"] : 0; return `<span class="pk">${[1, 2, 3].map((i) => `<i class="${i <= k ? "on" : ""}"></i>`).join("")}</span>`; };
  const gn = g ? gameNo(m.code, g) : gamesOf(m.code).filter((x) => x.status === "done").length;
  const seen = gamesOf(m.code).filter((x) => x.status === "done").sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
  let note = doneM ? `จบคู่ ผู้ชนะ ${esc(teamName(m.winner_seed))}` : seen && Date.now() - Date.parse(seen.updated_at) < 8000 && !live ? `${esc(sideName(m, seen.winner))} ชนะเกม ${gameNo(m.code, seen)}  ${METHOD_TH[seen.method] || ""}` : `เกม ${gn || 1} จาก Bo${m.bo}${g?.pattern ? "  แบบสนาม " + g.pattern : ""}`;
  return `<div class="mc ${doneM ? "done" : live ? "live" : ""}"><div class="mh"><b>สนาม ${f.no}</b><span>${m.code}${m.grp ? " สาย " + m.grp : " ชิงชนะเลิศ"}</span>${SHOW_CLOCK ? `<span class="t" data-clk="${f.no}">0:00</span>` : ""}</div>
    <div class="mv"><div class="tm side-r"><span class="n">${esc(sideName(m, "red"))}</span>${pk("red")}</div><div class="sc">${m.red_wins}<small>-</small>${m.blue_wins}</div><div class="tm side-b"><span class="n">${esc(sideName(m, "blue"))}</span>${pk("blue")}</div></div>
    <div class="mn">${note}</div></div>`;
}
function bracketView() {
  const fs = fields();
  return `${head("ตารางสายการแข่งขัน")}<div class="bkarea">${bracketHtml({ dark: true, maxh: 700 })}</div><div class="minis n${fs.length}">${fs.map(miniCard).join("")}</div>`;
}
function groupsView() {
  const gp = (G) => `<div class="gp"><h2>สาย ${G}<span class="rnd">${G < "D" ? "รอบแรก" : "รอบสอง"}</span></h2><table>${tableRows(G, ADV[G])}</table></div>`;
  return `${head("ตารางคะแนน")}<div class="groups">${["A", "B", "C", "D", "E"].map(gp).join("")}</div>`;
}
function drawView() {
  const ds = event().draw_state || {}, t = now() - (ds.start || 0);
  const names = teamsArr();
  const col = (G, seeds) => `<div class="dc"><h2>สาย ${G}</h2>${seeds.map((sd, i) => { const idx = sd - 1, shown = t >= idx * 1600; return `<div class="slot"><small>${sd}</small>${shown ? `<span class="nm">${esc(teamName(sd))}</span>` : `<span class="muted">...</span>`}</div>`; }).join("")}</div>`;
  return `${head("จับสายแข่งขัน")}<div class="drawcols">${col("A", [1, 2, 3])}${col("B", [4, 5, 6])}${col("C", [7, 8, 9])}</div>`;
}
function champView() {
  const F = match("F"), W = F.winner_seed, R = W === F.red_seed ? F.blue_seed : F.red_seed;
  const rk = S.ranking.filter((r) => r.pos >= 3 && r.seed != null);
  return `${head("ประกาศผล")}<div class="champ"><div class="cbig"><div class="k">แชมป์</div><div class="v">${esc(teamName(W))}</div><div class="s">รองแชมป์ ${esc(teamName(R))}</div></div>
    <div class="rk">${rk.map((r) => `<div><b>${r.label}</b><span>${esc(teamName(r.seed))}</span></div>`).join("")}</div></div>`;
}

function render() {
  if (!S.ready) { stage.innerHTML = head("กำลังโหลด"); paintNet(); return; }
  const m = effectiveMode();
  const k = m + JSON.stringify([event().name, event().field_count, [...T.a2_team.values()].map((t) => t.name), matches().map((x) => [x.code, x.status, x.red_wins, x.blue_wins, x.red_seed, x.blue_seed, x.walkover, x.field_no]), [...T.a2_team.values()].map((t) => t.absent), fields().map((f) => [f.no, f.match_code, f.phase, f.running, f.left_ms]), [...T.a2_game.values()].map((g) => [g.id, g.version, g.status]), S.standings.length, S.standings.map((r) => [r.grp, r.pos, r.seed, r.mw, r.gw, r.gl, r.sure]), event().draw_state]) + (m === "fields" || m === "bracket" ? Math.floor(Date.now() / 1000 / 2) : "");
  if (k === key) { paintNet(); return; }
  key = k; mode = m;
  stage.innerHTML = m === "fields" ? fieldsView() : m === "draw" ? drawView() : m === "champion" ? champView() : m === "groups" ? groupsView() : bracketView();
  fitBrackets(stage);
  paintNet();
}
let drawSt = 0;
onChange(render); connect();
setInterval(() => { if (mode === "draw" || mode === "fields" || mode === "bracket") { render(); } }, 1000);

let beeped = {};
raf(() => {
  document.querySelectorAll("[data-clk]").forEach((el) => {
    const f = T.a2_field.get(+el.dataset.clk); if (!f) return;
    const left = fieldLeft(f); el.textContent = fmtMs(left);
    el.classList.toggle("warn", f.phase === "game" && left > 0 && left <= 10000);
    const ph = document.querySelector(`[data-ph="${f.no}"]`); if (ph) ph.textContent = fieldPhaseLabel(f);
    const s = Math.ceil(left / 1000), bk = f.no + ":" + f.phase;
    if (f.running && s <= 3 && s >= 1 && beeped[bk] !== s) { beeped[bk] = s; beep(660, 90); }
    if (f.running && f.phase === "game" && left > 89000) { if (beeped.start !== f.ends_at) { beeped.start = f.ends_at; beep(1040, 400); } }
  });
});
render();
