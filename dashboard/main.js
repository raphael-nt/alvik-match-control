// Dashboard (formerly TV), docs/DESIGN_v3.md section 5
import { grpName, fsSupported, toggleFs, isFs, FS_ICON, useMarks, connect, onChange, event, field, matches, match, openGame, gamesOf, gameNo, sideName, teamName, teamsArr, tableOf, groups, marksOf, clockV3, decideV3, fmtMs1, fmtTime, PHASE_EN, RULE_EN, esc, $, now, beep, netBadge, raf, paintNet, S, T, teamAbsent } from "../shared/common.js";
import { bracketHtml, fitBrackets } from "../shared/bracket.js";
import { stageLabel } from "../shared/format.js";
import { liveLayout } from "../shared/layout.js";

useMarks();
const stage = $("stage");
function fit() { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px,${(innerHeight - 1080 * k) / 2}px) scale(${k})`; stage.style.left = 0; stage.style.top = 0; }
addEventListener("resize", fit); fit();
let sound = false;
$("fs").onclick = async () => { try { await document.documentElement.requestFullscreen(); } catch (e) {} sound = true; beep(660, 80); $("fs").remove(); try { await navigator.wakeLock?.request("screen"); } catch (e) {} };
const snd = (f, ms) => sound && beep(f, ms);

// Header on every screen; an announcement from Admin shows as a bar over the top of the screen
const head = (right) => `<div class="top"><img src="../shared/irap.png" alt=""><h1>${esc(event().name)}</h1><span class="rnd">${right || ""}</span>${netBadge()}</div>${event().notice_on && event().notice ? `<div class="notice">${esc(event().notice)}</div>` : ""}`;
const upNext = (n = 3) => matches().filter((m) => m.status === "ready" && m.field_no == null).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no).slice(0, n);
const upNextHtml = () => `<div class="upn"><h3>Up next</h3>${upNext().map((m) => `<div><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span>${m.sched_at ? fmtTime(m.sched_at) : ""}</span></div>`).join("") || "<div>-</div>"}</div>`;

const finalMatch = () => match("F") || matches().find((m) => m.stage === "final");
const allMatchesDone = () => { const ms = matches(); return ms.length > 0 && ms.every((m) => m.status === "done"); };
function onField() { const f = field(1); const m = f && f.match_code ? match(f.match_code) : null; return m && m.status !== "done" ? { f, m } : null; }
function mode() {
  const ev = event(), md = ev.tv_mode;
  if (md && md !== "auto") return { fields: "live", groups: "standings" }[md] || md;
  const F = finalMatch();
  if ((F && F.status === "done") || (!F && allMatchesDone() && S.ranking.some((r) => r.pos === 1))) return "champion";
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
    info: `<div class="lh"><span>${stageLabel(m.stage)}</span>${m.grp ? `<span>Group <b>${m.grp}</b></span>` : ""}<span>Match <b>${m.code}</b></span><span>Game <b>${gn} of ${m.bo}</b></span>${rules ? `<span>Pattern <b>${g?.pattern || "-"}</b></span>` : ""}</div>`,
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
  const gs = groups();
  if (!gs.length) return `${head("Standings")}<div class="groups"><div class="gp"><h2>No groups</h2></div></div>`;
  const n = gs.length, maxT = Math.max(2, ...gs.map((g) => (g.srcs || []).length));
  const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols);
  const cellH = (940 - (rows - 1) * 18) / rows, fs = Math.max(16, Math.min(34, Math.floor((cellH - 90) / (maxT + 1) / 1.45)));
  return `${head("Standings")}<div class="groups" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);--fs:${fs}px">${gs.map((g) => `<div class="gp"><h2>${esc(grpName(g.grp))}<span class="rnd">${stageLabel(g.stage)}</span></h2><table>${tableRows(g.grp, g.adv)}</table></div>`).join("")}</div>`;
}
function scheduleView() {
  const st = { locked: "Locked", ready: "Ready", queued: "On field", live: "Live", done: "Finished" };
  return `${head("Schedule")}<div class="sched">${matches().map((m) => `<div class="${m.status}"><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span class="s">${m.status === "done" ? m.red_wins + "-" + m.blue_wins : m.sched_at ? fmtTime(m.sched_at) : ""} ${st[m.status] || ""}</span></div>`).join("")}</div>`;
}
function drawView() {
  const ds = event().draw_state || {}, t = now() - (ds.start || 0);
  const col = (title, seeds) => `<div class="dc"><h2>${title}</h2>${seeds.map((sd) => `<div class="slot"><small>${sd}</small>${t >= (sd - 1) * 1600 ? `<span class="nm">${esc(teamName(sd))}</span>` : `<span class="muted">...</span>`}</div>`).join("")}</div>`;
  const r1 = groups().filter((g) => g.srcs?.some((x) => x && x.seed != null));
  if (r1.length) {
    return `${head("Draw")}<div class="drawcols" style="grid-template-columns:repeat(${Math.min(4, r1.length)},1fr)">${r1.map((g) => col(grpName(g.grp), g.srcs.filter((x) => x && x.seed != null).map((x) => x.seed))).join("")}</div>`;
  }
  const seeds = teamsArr().map((x) => x.seed), c = Math.min(4, Math.max(1, Math.ceil(seeds.length / 8))), per = Math.ceil(seeds.length / c);
  const cols = [...Array(c).keys()].map((i) => seeds.slice(i * per, (i + 1) * per)).filter((a) => a.length);
  return `${head("Draw")}<div class="drawcols" style="grid-template-columns:repeat(${cols.length || 1},1fr)">${cols.map((arr, i) => col(cols.length > 1 ? `Seeds ${arr[0]} to ${arr[arr.length - 1]}` : "Seeds", arr)).join("")}</div>`;
}
function champView() {
  const F = finalMatch();
  if (F && F.winner_seed != null) {
    const W = F.winner_seed, R = W === F.red_seed ? F.blue_seed : F.red_seed;
    return `${head("Results")}<div class="champ"><div class="cbig"><div class="k">Champion</div><div class="v">${esc(teamName(W))}</div><div class="s">Runner-up ${esc(teamName(R))}</div></div>
      <div class="rk">${S.ranking.filter((r) => r.pos >= 3 && r.seed != null).map((r) => `<div><b>${r.label}</b><span>${esc(teamName(r.seed))}</span></div>`).join("")}</div></div>`;
  }
  const top1 = S.ranking.filter((r) => r.pos === 1 && r.seed != null), top2 = S.ranking.filter((r) => r.pos === 2 && r.seed != null);
  if (!allMatchesDone() || !top1.length) return bracketView();
  const minRest = top1.length === 1 && top2.length ? 3 : 2;
  const sub = top1.length === 1 && top2.length ? `Runner-up ${top2.map((r) => esc(teamName(r.seed))).join(", ")}` : "";
  return `${head("Results")}<div class="champ"><div class="cbig"><div class="k">${top1.length > 1 ? "Champions" : "Champion"}</div><div class="v">${top1.map((r) => esc(teamName(r.seed))).join(", ")}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>
    <div class="rk">${S.ranking.filter((r) => r.pos >= minRest && r.seed != null).map((r) => `<div><b>${r.label}</b><span>${esc(teamName(r.seed))}</span></div>`).join("")}</div></div>`;
}

let key = "", cur = "";
function render() {
  if (!S.ready) { stage.innerHTML = head("Loading"); paintNet(); return; }
  const md = mode(), f = field(1);
  const k = md + JSON.stringify([event().name, event().notice, event().notice_on, event().rules_mode, event().dash_layout, event().draw_state, teamsArr().map((t) => [t.name, t.absent]), groups().map((g) => [g.grp, g.stage, g.adv]), matches().map((x) => [x.code, x.status, x.red_wins, x.blue_wins, x.red_seed, x.blue_seed, x.field_no, x.sched_at]), f && [f.match_code, f.phase], [...T.a2_game.values()].map((g) => [g.id, g.version, g.status]), T.a2_mark.size, S.standings.map((r) => [r.pos, r.seed, r.mw, r.gw, r.sure]), S.ranking.map((r) => [r.pos, r.label, r.seed])]) + (md === "draw" ? Math.floor(Date.now() / 800) : "");
  if (k === key) { paintNet(); return; }
  key = k; cur = md;
  stage.innerHTML = md === "live" ? liveView() : md === "standings" ? standingsView() : md === "schedule" ? scheduleView() : md === "draw" ? drawView() : md === "champion" ? champView() : bracketView();
  fitBrackets(stage); paintNet();
}
onChange(render); connect();
setInterval(() => { if (cur === "draw") render(); }, 800);

// ---------- Clock, 3 2 1 sound and 8 second result banner ----------
let lp = null, ls = null, lastDone = null, bnUntil = 0;
let _ct = "", _ctCls = "", _cp = "", _cm = "", _cd = "", _bn = "", _bnMc = "", _bnGs = null;
raf(() => {
  const f = field(1), ct = $("ct"); if (!f || !ct) return;
  const ck = clockV3(f), sec = ck.phase === "countdown" ? ck.count : ck.phase === "game" ? Math.ceil(ck.ms / 1000) : null;
  const ctTxt = ck.phase === "stopped" ? fmtMs1(ck.elapsed) : fmtMs1(ck.ms);
  const ctCls = "t" + (ck.phase === "game" && ck.ms <= 10000 ? " warn" : ck.phase === "stopped" ? " stop" : "");
  const cpTxt = PHASE_EN[ck.phase];
  if (ctTxt !== _ct) { _ct = ctTxt; ct.textContent = ctTxt; }
  if (ctCls !== _ctCls) { _ctCls = ctCls; ct.className = ctCls; }
  if (cpTxt !== _cp) { _cp = cpTxt; $("cp").textContent = cpTxt; }
  const m = match(f.match_code), g = m && openGame(m.code);
  const cmTxt = ck.phase === "stopped" && g?.complete_side ? `${g.complete_side.toUpperCase()} mission complete ${fmtMs1(f.stop_ms)}` : "";
  if (cmTxt !== _cm) { _cm = cmTxt; $("cm").textContent = cmTxt; }
  const cdHtml = ck.phase === "countdown" ? `<div class="cd">${ck.count}</div>` : ck.phase === "game" && ck.elapsed < 700 ? `<div class="cd">GO</div>` : "";
  if (cdHtml !== _cd) { _cd = cdHtml; $("cd").innerHTML = cdHtml; }
  if (ck.phase === "countdown" && sec !== ls) snd(880, 120);
  if (ck.phase === "game" && lp === "countdown") snd(1320, 700);
  if (ck.phase === "game" && sec <= 5 && sec > 0 && sec !== ls) snd(880, 90);
  if ((ck.phase === "over" && lp === "game") || (ck.phase === "stopped" && lp === "game")) snd(440, 900);
  lp = ck.phase; ls = sec;
  if (m) {
    const gs = gamesOf(m.code), bnEl = $("bn");
    if (gs !== _bnGs || m.code !== _bnMc) {
      _bnGs = gs; _bnMc = m.code;
      let d = null, bestTs = -1;
      for (const x of gs) {
        if (x.status !== "done" && x.status !== "replay") continue;
        const ts = Date.parse(x.updated_at);
        if (ts > bestTs) { bestTs = ts; d = x; }
      }
      if (d && d.id + d.version !== lastDone) {
        if (lastDone !== null && Date.now() - bestTs < 8000) bnUntil = Date.now() + 8000;
        lastDone = d.id + d.version;
        bnEl.dataset.t = d.status === "replay" ? "Tie, replay with same pattern" : `${d.winner.toUpperCase()} wins Game ${gameNo(m.code, d)} (${RULE_EN[d.method] || ""})`;
      }
    }
    const bnHtml = Date.now() < bnUntil ? `<div class="banner8">${esc(bnEl.dataset.t)}</div>` : "";
    if (bnHtml !== _bn) { _bn = bnHtml; bnEl.innerHTML = bnHtml; }
  }
});
render();

// Corner fullscreen button: appears on mouse move or touch, hides again after 3 seconds
const fsx = $("fsx");
if (fsx && fsSupported()) {
  fsx.innerHTML = FS_ICON; let hideT = 0;
  const show = () => { fsx.classList.add("on"); document.body.classList.add("cur"); clearTimeout(hideT); hideT = setTimeout(() => { fsx.classList.remove("on"); document.body.classList.remove("cur"); }, 3000); };
  ["mousemove", "touchstart"].forEach((ev) => addEventListener(ev, show, { passive: true }));
  fsx.onclick = async () => { try { await toggleFs(); } catch (e) {} if (!sound) { sound = true; beep(660, 80); $("fs")?.remove(); } show(); };
  document.addEventListener("fullscreenchange", () => { fsx.title = isFs() ? "Exit full screen" : "Full screen"; });
} else if (fsx) fsx.remove();
