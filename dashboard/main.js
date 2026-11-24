// Dashboard (formerly TV), docs/DESIGN_v3.md section 5
import { grpName, hasGrpLabel, roundKey, roundList, fsSupported, toggleFs, isFs, FS_ICON, useMarks, connect, onChange, event, field, matches, match, openGame, gamesOf, gameNo, sideName, teamName, teamsArr, tableOf, groups, marksOf, clockV3, decideV3, fmtMs1, fmtTime, PHASE_EN, RULE_EN, esc, $, now, beep, netBadge, raf, paintNet, S, T, teamAbsent, customMatch } from "../shared/common.js";
import { bracketHtml, fitBrackets, gamePills, roundTitle } from "../shared/bracket.js";
import { stageLabel } from "../shared/format.js";
import { liveLayout } from "../shared/layout.js";
import { unlock, tone, countDigit, countdown, stopCount, endSound } from "../shared/sound.js";

useMarks();
const stage = $("stage");
function fit() { const k = Math.min(innerWidth / 1920, innerHeight / 1080); stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px,${(innerHeight - 1080 * k) / 2}px) scale(${k})`; stage.style.left = 0; stage.style.top = 0; }
addEventListener("resize", fit); fit();
let sound = false;
$("fs").onclick = async () => { unlock(); try { await document.documentElement.requestFullscreen(); } catch (e) {} sound = true; tone(660, 80); $("fs").remove(); try { await navigator.wakeLock?.request("screen"); } catch (e) {} };
const snd = (f, ms, at) => sound && tone(f, ms, at);
// Embedded in the Admin preview window (dashboard/?embed=1) : no fullscreen prompt, stays silent
if (new URLSearchParams(location.search).has("embed")) $("fs").remove();

// Header on every screen; an announcement from Admin shows as a bar over the top of the screen
const head = (right) => `<div class="top"><img src="../shared/irap.png" alt=""><h1>${esc(event().name)}</h1><span class="rnd">${right || ""}</span>${fsSupported() ? `<button class="fsh" data-fsh aria-label="Full screen" title="Full screen">${FS_ICON}</button>` : ""}</div>${event().notice_on && event().notice ? `<div class="notice">${esc(event().notice)}</div>` : ""}`;
const upNext = (n = 3) => matches().filter((m) => m.status === "ready" && m.field_no == null).sort((a, b) => (a.sched_at || "9").localeCompare(b.sched_at || "9") || a.order_no - b.order_no).slice(0, n);
const upNextHtml = () => `<div class="upn"><h3>Up next</h3>${upNext().map((m) => `<div><b>${m.code}</b><span>${esc(sideName(m, "red"))}<em> vs ${esc(sideName(m, "blue"))}</em></span><span>${m.sched_at ? fmtTime(m.sched_at) : ""}</span></div>`).join("") || "<div>-</div>"}</div>`;

const finalMatch = () => match("F") || matches().find((m) => m.stage === "final");
const allMatchesDone = () => { const ms = matches(); return ms.length > 0 && ms.every((m) => m.status === "done"); };
function onField() { const f = field(1); const m = f && f.match_code ? match(f.match_code) : null; return m && m.status !== "done" ? { f, m } : null; }
function mode() {
  const ev = event(), md = ev.tv_mode;
  if (md && md !== "auto") return { fields: "live", groups: "standings" }[md] || md;
  const F = finalMatch();
  if ((F && F.status === "done") || (!F && allMatchesDone() && S.ranking.some((r) => r.pos === 1))) return "champion";
  const o = onField();
  if (o && o.m.stage === "custom") return "custom";   // the custom match on the field gets its own clock screen
  return o ? "live" : "bracket";
}

// ---------- Live ----------
function liveView() {
  const o = onField(); if (!o) return bracketView();
  const { f, m } = o, g = openGame(m.code) || gamesOf(m.code).slice(-1)[0], rules = event().rules_mode !== false;
  const gn = g ? gameNo(m.code, g) : 1, L = liveLayout(event().dash_layout?.live);
  // Team panels show the team name only
  const tm = (s) => `<div class="lt ${s === "red" ? "side-r" : "side-b"}"><div class="n">${esc(sideName(m, s))}</div></div>`;
  const body = {
    red: tm("red"), blue: tm("blue"),
    clock: `<div class="lc">${rules ? `<div class="t" id="ct">1:30.0</div><div class="p" id="cp"></div><div class="msg" id="cm"></div>` : `<div class="t">${m.red_wins}-${m.blue_wins}</div><div class="p">Game ${gn} of ${m.bo}</div>`}</div>`,
    bracket: `<div class="bkarea">${bracketHtml({ dark: true, compact: true, maxh: L.bracket.h - 16, hide: bkHide() })}</div>`,
    upnext: upNextHtml(),
  };
  return `${head()}${Object.entries(L).filter(([k, p]) => p.on && body[k]).map(([k, p]) => `<div class="lp lp-${k}" style="left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px">${body[k]}</div>`).join("")}<div id="cd"></div><div id="bn"></div>`;
}
// Custom screen : the two names typed in Admin and the big clock, nothing else
function customView() {
  const X = customMatch(), nm = (s) => (X ? esc(sideName(X, s)) : s === "red" ? "Red" : "Blue");
  const sc = X && X.bo > 1 ? `<div class="sc"><span class="c-r">${X.red_wins}</span> - <span class="c-b">${X.blue_wins}</span></div>` : "";
  return `${head()}<div class="cu"><div class="lt side-r"><div class="n">${nm("red")}</div></div>
    <div class="lc"><div class="t" id="ct">1:30.0</div><div class="p" id="cp"></div><div class="msg" id="cm"></div>${sc}</div>
    <div class="lt side-b"><div class="n">${nm("blue")}</div></div></div><div id="cd"></div><div id="bn"></div>`;
}
// Bracket fills the height; Up next sits in a narrow column on the right
function bracketView() { return `${head()}<div class="bkfull"><div class="bkarea">${bracketHtml({ dark: true, maxh: 940, hide: bkHide() })}</div>${upNextHtml()}</div>`; }
// Rounds Admin unticked in Dashboard > rounds shown in the bracket
const bkHide = () => event().dash_layout?.bkh || [];
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
  return `${head("Standings")}<div class="groups" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);--fs:${fs}px">${gs.map((g) => `<div class="gp"><h2>${esc(grpName(g.grp))}${hasGrpLabel(g.grp) ? "" : `<span class="rnd">${stageLabel(g.stage)}</span>`}</h2><table>${tableRows(g.grp, g.adv)}</table></div>`).join("")}</div>`;
}
function scheduleView() {
  const st = { locked: "Locked", ready: "Ready", queued: "On field", live: "Live", done: "Finished" };
  return `${head("Schedule")}<div class="sched">${matches().map((m) => `<div class="${m.status}"><b>${m.code}</b><span>${esc(sideName(m, "red"))} vs ${esc(sideName(m, "blue"))}</span><span class="gp2">${gamePills(m)}</span><span class="s">${m.status === "done" ? m.red_wins + "-" + m.blue_wins : m.sched_at ? fmtTime(m.sched_at) : ""} ${st[m.status] || ""}</span></div>`).join("")}</div>`;
}
// Live draw : the first round matches with each side shown by its number until Admin places a name there.
// A name that just arrived gets a short highlight.
let drawSeen = null;
function liveDrawView() {
  const r1 = groups().filter((g) => g.stage === "r1"), inR1 = new Set(r1.map((g) => g.grp));
  const ms = matches().filter((m) => inR1.has(m.grp)).sort((a, b) => a.order_no - b.order_no);
  const names = new Map(teamsArr().map((t) => [t.seed, t.name || ""]));
  const fresh = new Set(drawSeen ? [...names].filter(([sd, n]) => n && drawSeen.get(sd) !== n).map(([sd]) => sd) : []);
  drawSeen = names;
  const cell = (m, s) => { const sd = m[s + "_seed"], n = sd != null ? names.get(sd) : "";
    return `<div class="dt-s ${s === "red" ? "side-r" : "side-b"}${n ? "" : " blank"}${fresh.has(sd) ? " dnew" : ""}">${n ? `<small>${sd}</small>` : ""}<span>${n ? esc(n) : sd != null ? "Team " + sd : esc(sideName(m, s))}</span></div>`; };
  const title = r1.length === 1 ? grpName(r1[0].grp) : r1.map((g) => grpName(g.grp)).join(", ");
  const placed = [...names.values()].filter(Boolean).length;
  const rh = Math.max(48, Math.min(88, Math.floor((760 - 8 * Math.max(0, ms.length - 1)) / Math.max(1, ms.length))));
  return `${head("Draw")}<div class="dlive"><div class="dt"><h2>${esc(title)}<span>${placed} of ${names.size} teams drawn</span></h2>
    <div class="dt-rows" style="--rh:${rh}px">${ms.map((m) => `<div class="dt-r"><b>${esc(m.code)}</b>${cell(m, "red")}<em>vs</em>${cell(m, "blue")}</div>`).join("")}</div></div>
    <div class="dn"><h2>Teams</h2>${[...names].sort((a, b) => a[0] - b[0]).map(([sd, n]) => `<div class="dn-r${n ? "" : " blank"}${fresh.has(sd) ? " dnew" : ""}"><small>${sd}</small><span>${n ? esc(n) : "..."}</span></div>`).join("")}</div></div>`;
}
// ---------- Game by game results and the round view ----------
// Admin picks a round, or auto follows the match on the field, then the next match, then the last round played
function pickRound(list) {
  const want = event().dash_layout?.rnd;
  if (want && want !== "auto") { const r = list.find((x) => x.key === want); if (r) return r; }
  const f = field(1), on = f && f.match_code ? match(f.match_code) : null, nx = on || upNext(1)[0];
  if (nx) { const r = list.find((x) => x.key === roundKey(nx)); if (r) return r; }
  return [...list].reverse().find((r) => r.ms.some((m) => m.status === "done")) || list.find((r) => r.key !== "practice") || list[0];
}
function roundsView() {
  const list = roundList(); if (!list.length) return `${head("Matches")}<div class="rv"><h2>No matches</h2></div>`;
  const r = pickRound(list), f = field(1);
  // One row per match : time, match, the two teams in their Game 1 colours (sides swap every game after that), Bo, result
  const multi = new Set(r.ms.map((m) => m.grp || "")).size > 1;
  const n = r.ms.length + (multi ? new Set(r.ms.map((m) => m.grp || "")).size : 0);
  const rh = Math.max(40, Math.min(76, Math.floor(700 / Math.max(1, n)) - 8));
  const team = (m, s) => `<td class="st-t"><div class="${s === "red" ? "side-r" : "side-b"}${m.winner_seed != null && m.winner_seed === m[s + "_seed"] ? " win" : ""}"><span>${esc(sideName(m, s))}</span></div></td>`;
  const res = (m) => {
    if (f && f.match_code === m.code && m.status !== "done") return `<em class="on">On field</em>`;
    if (m.status === "done") return m.walkover ? `<em>Walkover</em>` : `<em>${esc(teamName(m.winner_seed))} wins</em>`;
    return `<em class="muted">${m.status === "locked" ? "Waiting" : "Ready"}</em>`;
  };
  let prevG = null;
  const rows = r.ms.map((m) => {
    const sec = multi && m.grp !== prevG ? `<tr class="st-g"><td colspan="7">${esc(m.grp ? grpName(m.grp) : roundTitle(r))}</td></tr>` : "";
    prevG = m.grp;
    const started = m.red_wins + m.blue_wins > 0 || m.status === "done";
    const on = f && f.match_code === m.code && m.status !== "done";
    return `${sec}<tr class="st-r ${m.status}${on ? " onf" : ""}"><td class="st-tm">${m.sched_at ? fmtTime(m.sched_at) : ""}</td><td class="st-c">${esc(m.code)}</td>${team(m, "red")}<td class="st-sc">${started ? `<span class="r">${m.red_wins}</span>-<span class="b">${m.blue_wins}</span>` : "vs"}</td>${team(m, "blue")}<td class="st-bo">Bo${m.bo}</td><td class="st-res">${res(m)}<div class="st-p">${gamePills(m)}</div></td></tr>`;
  }).join("");
  return `${head(esc(roundTitle(r)))}<div class="rv" style="--rh:${rh}px"><h2>${esc(roundTitle(r))}<span>${r.ms.filter((m) => m.status === "done").length} of ${r.ms.length} matches played</span></h2>
    <table class="st"><thead><tr><th>Time</th><th>Match</th><th class="c-r">RED <small>Game 1</small></th><th></th><th class="c-b">BLUE <small>Game 1</small></th><th>Bo</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function drawView() {
  if (event().draw_state && event().draw_state.live) return liveDrawView();
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
  const k = md + JSON.stringify([event().name, event().notice, event().notice_on, event().rules_mode, event().dash_layout, event().draw_state, teamsArr().map((t) => [t.name, t.absent]), groups().map((g) => [g.grp, g.stage, g.adv]), matches().map((x) => [x.code, x.status, x.red_wins, x.blue_wins, x.red_seed, x.blue_seed, x.field_no, x.sched_at]), f && [f.match_code, f.phase], [...T.a2_game.values()].map((g) => [g.id, g.version, g.status]), T.a2_mark.size, S.standings.map((r) => [r.pos, r.seed, r.mw, r.gw, r.sure]), S.ranking.map((r) => [r.pos, r.label, r.seed]), customMatch() && [teamName(901), teamName(902), customMatch().bo]]) + (md === "draw" && !event().draw_state?.live ? Math.floor(Date.now() / 800) : "");
  if (k === key) { paintNet(); return; }
  key = k; cur = md;
  stage.innerHTML = md === "live" ? liveView() : md === "standings" ? standingsView() : md === "schedule" ? scheduleView() : md === "draw" ? drawView() : md === "rounds" ? roundsView() : md === "champion" ? champView() : md === "custom" ? customView() : bracketView();
  fitBrackets(stage); paintNet();
}
onChange(render); connect();
setInterval(() => { if (cur === "draw") render(); }, 800);

// ---------- Clock, 3 2 1 sound and 8 second result banner ----------
let lp = null, ls = null, lastDone = null, bnUntil = 0;
let _ct = "", _ctCls = "", _cp = "", _cm = "", _cd = "", _bn = "", _bnMc = "", _bnGs = null, _ctEl = null;
raf(() => {
  const f = field(1), ct = $("ct"); if (!f || !ct) return;
  // The live screen was redrawn : the new elements hold placeholder text, so forget what was written before
  if (ct !== _ctEl) { _ctEl = ct; _ct = _ctCls = _cp = _cm = _cd = ""; }
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
  const left = ck.phase === "countdown" ? Date.parse(f.go_at) - now() : 0;
  const cdHtml = ck.phase === "countdown" ? `<div class="cd">${countDigit(left)}</div>` : ck.phase === "game" && ck.elapsed < 700 ? `<div class="cd">GO</div>` : "";
  if (cdHtml !== _cd) { _cd = cdHtml; $("cd").innerHTML = cdHtml; }
  // VEX timer sounds : 3 2 1 with the start sound on GO, the end sound when time is up or the clock stops
  if (sound && ck.phase === "countdown") countdown(f.go_at, left);
  else if (lp === "countdown" && ck.phase !== "game") stopCount();
  if (sound && (ck.phase === "over" || ck.phase === "stopped") && lp === "game") endSound();
  lp = ck.phase; ls = sec;
  // Knockout : Mission complete stops the clock, show it once per game
  // Once per Knockout : an undone Knockout followed by a new one shows again
  if (g && ck.phase === "stopped" && g.complete_side && koShown !== g.id + ":" + g.complete_ms) {
    koShown = g.id + ":" + g.complete_ms;
    if (Date.now() - LOAD_T > 4000) { const sd = g.complete_side; popup({ kind: "ko", side: sd, label: "Knockout", name: sd === "both" ? `${sideName(m, "red")} + ${sideName(m, "blue")}` : sideName(m, sd), detail: `Mission complete at ${fmtMs1(f.stop_ms)}, rule 6.1`, meta: `Match ${m.code} · Game ${gameNo(m.code, g)}` }); }
  }
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
        const fresh = Date.now() - LOAD_T > 4000 && Date.now() - bestTs < 8000;
        lastDone = d.id + d.version;
        if (fresh) {
          const meta = `Match ${m.code} · Game ${gameNo(m.code, d)}`;
          if (d.status === "replay") popup({ kind: "tie", label: "Tie", name: "Replay", detail: "Same field pattern, FAQ 34", meta });
          else if (m.status === "done" && m.winner_seed != null) popup({ kind: "match", side: d.winner, label: "Match winner", name: teamName(m.winner_seed), detail: `${m.grp ? grpName(m.grp) : stageLabel(m.stage)}, Bo${m.bo}`, meta: `Match ${m.code}`, score: [m.red_wins, m.blue_wins] });
          else popup({ kind: "game", side: d.winner, label: `Game ${gameNo(m.code, d)} winner`, name: sideName(m, d.winner), detail: RULE_EN[d.method] || "", meta, score: [m.red_wins, m.blue_wins] });
        }
      }
    }

  }
});
render();

// Fullscreen button in the header: appears on mouse move or touch, hides again after 3 seconds
if (fsSupported()) {
  let hideT = 0;
  const show = () => { document.body.classList.add("cur"); clearTimeout(hideT); hideT = setTimeout(() => document.body.classList.remove("cur"), 3000); };
  ["mousemove", "touchstart"].forEach((ev) => addEventListener(ev, show, { passive: true }));
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("[data-fsh]")) return;
    try { await toggleFs(); } catch (er) {}
    unlock();
    if (!sound) { sound = true; tone(660, 80); $("fs")?.remove(); }
    show();
  });
}

// ---------- Big centre popup ----------
let koShown = null;
const LOAD_T = Date.now();   // popups only for things that happen after the page has loaded
// Result plate over the whole screen for about 6 seconds : event header, what happened, the team, the reason
// and the series score, in the side colour. A short effect plays when sound is on (no voice).
function popup({ kind, side, label, name, detail, meta, score }) {
  // Own layer above the screen, scaled like the stage, so screen redraws do not remove it
  const stage = $("stage"); if (!stage) return;
  let st = $("fxl"); if (!st) { st = document.createElement("div"); st.id = "fxl"; document.body.append(st); }
  st.style.transform = stage.style.transform;
  st.querySelector(".pop8")?.remove();
  const sideTag = side === "red" || side === "blue" ? `<span class="sd8 ${side === "red" ? "side-r" : "side-b"}">${side.toUpperCase()}</span>` : side === "both" ? `<span class="sd8">RED + BLUE</span>` : "";
  const el = document.createElement("div");
  el.className = "pop8 " + kind + (side === "red" ? " side-r" : side === "blue" ? " side-b" : "");
  el.innerHTML = `<div class="card8"><div class="h8"><img src="../shared/irap.png" alt=""><span>${esc(event().name || "")}</span><b>${esc(meta || "")}</b></div>
    <div class="b8"><div class="l8">${esc(label)}</div>${sideTag}<div class="n8">${esc(name || "")}</div>${detail ? `<div class="s8">${esc(detail)}</div>` : ""}
    ${score ? `<div class="sc8"><span class="c-r">${score[0]}</span><i>-</i><span class="c-b">${score[1]}</span></div>` : ""}</div></div>`;
  st.append(el);
  if (kind === "ko" || kind === "match") [523, 659, 784, 1047].forEach((f, i) => snd(f, i === 3 ? 600 : 160, i * 0.17));
  else if (kind === "game") { snd(784, 200); snd(1047, 400, 0.22); }
  else snd(440, 500);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 500); }, kind === "match" ? 7000 : 5500);
}
