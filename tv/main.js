import { connect, onChange, event, fields, matches, match, openGame, gamesOf, gameNo, sideName, teamName, teamsArr, tableOf, fieldLeft, fieldPhaseLabel, fmtMs, fmtTime, esc, $, now, beep, netBadge, raf, paintNet, S, T, STATUS_TH, METHOD_TH, previewDecide } from "../shared/common.js";

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
  if (fields().some((f) => f.match_code && match(f.match_code)?.status !== "done")) return "fields";
  return "groups";
}
function tableRows(G, adv) {
  const rows = tableOf(G).map((r) => {
    const q = r.sure && r.pos <= adv;
    return `<tr class="${q ? "q" : ""}"><td class="p">${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) : "รอผล"}</td><td class="n">${r.mw}-${r.ml}</td><td class="n">${r.gw}-${r.gl}</td></tr>`;
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
    <div class="clk" data-clk="${f.no}">0:00</div><div class="ph" data-ph="${f.no}"></div>
    ${flash}</div>`;
}

function fieldsView() {
  const fs = fields(), n = fs.length;
  const act = fs.filter((f) => f.match_code && match(f.match_code)?.status !== "done");
  const groupsShown = [...new Set(act.map((f) => match(f.match_code).grp).filter(Boolean))].slice(0, 3);
  const strip = groupsShown.length ? `<div class="strip">${groupsShown.map((G) => `<div class="gt"><h3>สาย ${G}</h3><table>${tableRows(G, ADV[G])}</table></div>`).join("")}${groupsShown.length < 3 ? nextBox() : ""}</div>` : `<div class="strip">${nextBox()}</div>`;
  return `${head(ROUND[match(act[0]?.match_code)?.stage] || "")}<div class="grid n${n}">${fs.map((f) => fieldPanel(f, n)).join("")}</div>${strip}`;
}
function nextBox() {
  const nx = matches().filter((m) => m.status !== "done" && !fields().some((f) => f.match_code === m.code)).slice(0, 3);
  return `<div class="next" style="grid-column:span ${3 - 0 === 3 ? 1 : 1}"><h2>คู่ถัดไป</h2>${nx.map((m) => `<div class="r"><b>${m.code}</b><span>${esc(sideName(m, "red"))} พบ ${esc(sideName(m, "blue"))}</span><span class="t">${m.sched_at ? fmtTime(m.sched_at) : ""}</span></div>`).join("") || "<div class='r muted'>-</div>"}</div>`;
}
function groupsView() {
  const gp = (G) => {
    const ms = matches().filter((m) => m.grp === G);
    return `<div class="gp"><h2>สาย ${G}<span class="rnd">${G < "D" ? "รอบแรก" : "รอบสอง"}</span></h2><table>${tableRows(G, ADV[G])}</table>
      <div class="ml">${ms.map((m) => `<div class="${m.status}"><b>${m.code}</b><span>${m.red_seed != null || m.blue_seed != null ? esc(m.red_seed != null ? teamName(m.red_seed) : "?") + " พบ " + esc(m.blue_seed != null ? teamName(m.blue_seed) : "?") : "รอผล"}</span><span class="s">${m.status === "done" || m.red_wins + m.blue_wins > 0 ? m.red_wins + "-" + m.blue_wins : m.sched_at ? fmtTime(m.sched_at) : ""}</span></div>`).join("")}</div></div>`;
  };
  const F = match("F");
  const fin = `<div class="gp"><h2>ชิงชนะเลิศ<span class="rnd">Bo5</span></h2><div class="ml"><div class="${F.status}"><b>F</b><span>${esc(sideName(F, "red"))} พบ ${esc(sideName(F, "blue"))}</span><span class="s">${F.status === "done" || F.red_wins + F.blue_wins ? F.red_wins + "-" + F.blue_wins : F.sched_at ? fmtTime(F.sched_at) : ""}</span></div></div>
    ${F.winner_seed != null ? `<h2>แชมป์ ${esc(teamName(F.winner_seed))}</h2>` : ""}</div>`;
  return `${head("ตารางคะแนน")}<div class="groups">${["A", "B", "C", "D", "E"].map(gp).join("")}${fin}</div>`;
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
  const k = m + JSON.stringify([event().name, event().field_count, [...T.a2_team.values()].map((t) => t.name), matches().map((x) => [x.code, x.status, x.red_wins, x.blue_wins, x.red_seed, x.blue_seed, x.sched_at]), fields().map((f) => [f.no, f.match_code, f.phase, f.running, f.left_ms]), [...T.a2_game.values()].map((g) => [g.id, g.version, g.status]), S.standings.length, S.standings.map((r) => [r.grp, r.pos, r.seed, r.mw, r.gw, r.gl, r.sure]), event().draw_state]) + (m === "fields" ? Math.floor(Date.now() / 1000 / 2) : "");
  if (k === key) { paintNet(); return; }
  key = k; mode = m;
  stage.innerHTML = m === "fields" ? fieldsView() : m === "draw" ? drawView() : m === "champion" ? champView() : groupsView();
  paintNet();
}
let drawSt = 0;
onChange(render); connect();
setInterval(() => { if (mode === "draw" || mode === "fields") { key = ""; render(); } }, 1000);

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
