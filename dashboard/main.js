// Dashboard (formerly TV), docs/DESIGN_v3.md section 5
import { useMarks, connect, onChange, event, field, matches, match, openGame, gamesOf, gameNo, sideName, teamName, teamsArr, tableOf, groups, marksOf, clockV3, decideV3, fmtMs1, fmtTime, PHASE_EN, RULE_EN, esc, $, now, beep, netBadge, raf, paintNet, S, T, teamAbsent } from "../shared/common.js";
import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { STAGE_EN } from "../shared/format.js";
import { liveLayout } from "../shared/layout.js";

useMarks();
const stage = $("stage");
function fit() { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px,${(innerHeight - 1080 * k) / 2}px) scale(${k})`; stage.style.left = 0; stage.style.top = 0; }
addEventListener("resize", fit); fit();
let sound = false;
$("fs").onclick = async () => { try { await document.documentElement.requestFullscreen(); } catch (e) {} sound = true; beep(660, 80); $("fs").remove(); try { await navigator.wakeLock?.request("screen"); } catch (e) {} };
const snd = (f, ms) => sound && beep(f, ms);

const ROUND = STAGE_EN;
const head = (right) => `<div class="top"><img src="../shared/irap.png" alt=""><h1>${esc(event().name)}</h1><span class="rnd">${right || ""}</span>${netBadge()}</div>`;
const upNext = (n = 3) => matches().filter((m) => m.status === "ready" && m.field_no == null).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no).slice(0, n);
const upNextHtml = () => `<div class="upn"><h3>Up next</h3>${upNext().map((m) => `<div><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span>${m.sched_at ? fmtTime(m.sched_at) : ""}</span></div>`).join("") || "<div>-</div>"}</div>`;

function onField() { const f = field(1); const m = f && f.match_code ? match(f.match_code) : null; return m && m.status !== "done" ? { f, m } : null; }
function mode() {
  const ev = event(), md = ev.tv_mode;
  if (md && md !== "auto") return { fields: "live", groups: "standings" }[md] || md;
  const F = match("F"); if (F && F.status === "done") return "champion";
  return onField() ? "live" : "bracket";
}

// ---------- Live ----------
function liveView() {
  const o = onField(); if (!o) return bracketView();
  const { f, m } = o, g = openGame(m.code) || gamesOf(m.code).slice(-1)[0], rules = event().rules_mode !== false;
  const gn = g ? gameNo(m.code, g) : 1, L = liveLayout(event().dash_layout?.live);
  // Team panels show the team name only
  const tm = (s) => `<div class="lt ${s === "red" ? "side-r" : "side-b"}"><div class="n">${esc(sideName(m, s))}</div></div>`;
  const body = {
    info: `<div class="lh"><span>${ROUND[m.stage]}</span>${m.grp ? `<span>Group <b>${m.grp}</b></span>` : ""}<span>Match <b>${m.code}</b></span><span>Game <b>${gn} of ${m.bo}</b></span>${rules ? `<span>Pattern <b>${g?.pattern || "-"}</b></span>` : ""}</div>`,
    red: tm("red"), blue: tm("blue"),
    clock: `<div class="lc">${rules ? `<div class="t" id="ct">1:30.0</div><div class="p" id="cp"></div><div class="msg" id="cm"></div>` : `<div class="t">${m.red_wins}-${m.blue_wins}</div><div class="p">Game ${gn} of ${m.bo}</div>`}</div>`,
    bracket: `<div class="bkarea">${bracketHtml({ dark: true, compact: true, maxh: L.bracket.h - 16 })}</div>`,
    upnext: upNextHtml(),
  };
  return `${head("● LIVE")}${Object.entries(L).filter(([, p]) => p.on).map(([k, p]) => `<div class="lp lp-${k}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">${body[k]}</div>`).join("")}<div id="cd"></div><div id="bn"></div>`;
}
// Bracket fills the height; Up next sits in a narrow column on the right
function bracketView() { return `${head()}<div class="bkfull"><div class="bkarea">${bracketHtml({ dark: true, maxh: 940 })}</div>${upNextHtml()}</div>`; }
function tableRows(G, adv) {
  const rows = tableOf(G).map((r) => `<tr class="${r.sure && r.pos <= adv ? "q" : ""}"><td class="p">${r.sure ? r.pos : "-"}</td><td>${r.seed != null ? esc(teamName(r.seed)) + (teamAbsent(r.seed) ? " (absent)" : "") : "TBD"}</td><td class="n">${r.mw}-${r.ml}</td><td class="n">${r.gw}-${r.gl}</td></tr>`).join("");
  return `<tr class="th"><td></td><td></td><td class="n">W-L</td><td class="n">Games</td></tr>` + rows;
}
// Fit every group on one screen: pick columns and rows, then size text to the tallest group
function standingsView() {
  const gs = groups(), n = gs.length || 1, maxT = Math.max(2, ...gs.map((g) => (g.srcs || []).length));
  const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
  const cellH = (940 - (rows - 1) * 18) / rows, fs = Math.max(16, Math.min(34, Math.floor((cellH - 90) / (maxT + 1) / 1.45)));
  return `${head("Standings")}<div class="groups" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);--fs:${fs}px">${gs.map((g) => `<div class="gp"><h2>Group ${g.grp}<span class="rnd">${ROUND[g.stage] || ""}</span></h2><table>${tableRows(g.grp, g.adv)}</table></div>`).join("")}</div>`;
}
function scheduleView() {
  const st = { locked: "Locked", ready: "Ready", queued: "On field", live: "Live", done: "Finished" };
  return `${head("Schedule")}<div class="sched">${matches().map((m) => `<div class="${m.status}"><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span class="s">${m.status === "done" ? m.red_wins + "-" + m.blue_wins : m.sched_at ? fmtTime(m.sched_at) : ""} ${st[m.status] || ""}</span></div>`).join("")}</div>`;
}
function drawView() {
  const ds = event().draw_state || {}, t = now() - (ds.start || 0);
  const col = (G, seeds) => `<div class="dc"><h2>Group ${G}</h2>${seeds.map((sd) => `<div class="slot"><small>${sd}</small>${t >= (sd - 1) * 1600 ? `<span class="nm">${esc(teamName(sd))}</span>` : `<span class="muted">...</span>`}</div>`).join("")}</div>`;
  const r1 = groups().filter((g) => g.stage === "r1");
  return `${head("Draw")}<div class="drawcols" style="grid-template-columns:repeat(${Math.min(4, r1.length)},1fr)">${r1.map((g) => col(g.grp, g.srcs.map((x) => x.seed))).join("")}</div>`;
}
function champView() {
  const F = match("F"); if (!F || F.winner_seed == null) return bracketView();
  const W = F.winner_seed, R = W === F.red_seed ? F.blue_seed : F.red_seed;
  return `${head("Results")}<div class="champ"><div class="cbig"><div class="k">Champion</div><div class="v">${esc(teamName(W))}</div><div class="s">Runner-up ${esc(teamName(R))}</div></div>
    <div class="rk">${S.ranking.filter((r) => r.pos >= 3 && r.seed != null).map((r) => `<div><b>${r.label}</b><span>${esc(teamName(r.seed))}</span></div>`).join("")}</div></div>`;
}

let key = "", cur = "";
function render() {
  if (!S.ready) { stage.innerHTML = head("Loading"); paintNet(); return; }
  const md = mode(), f = field(1);
  const k = md + JSON.stringify([event().name, event().rules_mode, event().dash_layout, event().draw_state, teamsArr().map((t) => [t.name, t.absent]), matches().map((x) => [x.code, x.status, x.red_wins, x.blue_wins, x.red_seed, x.blue_seed, x.field_no, x.sched_at]), f && [f.match_code, f.phase], [...T.a2_game.values()].map((g) => [g.id, g.version, g.status]), T.a2_mark.size, S.standings.map((r) => [r.pos, r.seed, r.mw, r.gw, r.sure])]) + (md === "draw" ? Math.floor(Date.now() / 800) : "");
  if (k === key) { paintNet(); return; }
  key = k; cur = md;
  stage.innerHTML = md === "live" ? liveView() : md === "standings" ? standingsView() : md === "schedule" ? scheduleView() : md === "draw" ? drawView() : md === "champion" ? champView() : bracketView();
  fitBrackets(stage); paintNet();
}
onChange(render); connect();
setInterval(() => { if (cur === "draw") render(); }, 800);

// ---------- Clock, 3 2 1 sound and 8 second result banner ----------
let lp = null, ls = null, lastDone = null, bnUntil = 0;
raf(() => {
  const f = field(1), ct = $("ct"); if (!f || !ct) return;
  const ck = clockV3(f), sec = ck.phase === "countdown" ? ck.count : ck.phase === "game" ? Math.ceil(ck.ms / 1000) : null;
  ct.textContent = ck.phase === "stopped" ? fmtMs1(ck.elapsed) : fmtMs1(ck.ms);
  ct.className = "t" + (ck.phase === "game" && ck.ms <= 10000 ? " warn" : ck.phase === "stopped" ? " stop" : "");
  $("cp").textContent = PHASE_EN[ck.phase];
  const m = match(f.match_code), g = m && openGame(m.code);
  $("cm").textContent = ck.phase === "stopped" && g?.complete_side ? `${g.complete_side.toUpperCase()} mission complete ${fmtMs1(f.stop_ms)}` : "";
  $("cd").innerHTML = ck.phase === "countdown" ? `<div class="cd">${ck.count}</div>` : ck.phase === "game" && ck.elapsed < 700 ? `<div class="cd">GO</div>` : "";
  if (ck.phase === "countdown" && sec !== ls) snd(880, 120);
  if (ck.phase === "game" && lp === "countdown") snd(1320, 700);
  if (ck.phase === "game" && sec <= 5 && sec > 0 && sec !== ls) snd(880, 90);
  if ((ck.phase === "over" && lp === "game") || (ck.phase === "stopped" && lp === "game")) snd(440, 900);
  lp = ck.phase; ls = sec;
  if (m) {
    const d = gamesOf(m.code).filter((x) => x.status === "done" || x.status === "replay").sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
    if (d && d.id + d.version !== lastDone) { if (lastDone !== null && Date.now() - Date.parse(d.updated_at) < 8000) bnUntil = Date.now() + 8000; lastDone = d.id + d.version;
      $("bn").dataset.t = d.status === "replay" ? "Tie, replay with same pattern" : `${d.winner.toUpperCase()} wins Game ${gameNo(m.code, d)} · ${RULE_EN[d.method] || ""}`; }
    $("bn").innerHTML = Date.now() < bnUntil ? `<div class="banner8">${esc($("bn").dataset.t)}</div>` : "";
  }
});
render();
