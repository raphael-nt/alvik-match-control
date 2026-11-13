// Bracket drawn with connector lines: group boxes, then knockout rounds, built from a2_group and a2_match
import { groups, match, matches, teamName, srcLabel, sideName, tableOf, teamAbsent, esc } from "./common.js";
import { STAGE_EN, KO_ORDER } from "./format.js";

const COLW = 300, GAP = 110, HH = 36, RH = 34, CH = 40, VGAP = 18, TOP = 96, MINH = 620;

function columns() {
  const cols = [], gs = groups();
  ["r1", "r2"].forEach((st) => { const l = gs.filter((g) => g.stage === st); if (l.length) cols.push(l.map((g) => ({ kind: "g", g, n: (g.srcs || []).length }))); });
  KO_ORDER.forEach((st) => { const l = matches().filter((m) => m.stage === st); if (l.length) cols.push(l.map((m) => ({ kind: "m", m, n: 2 }))); });
  return cols;
}
function layout() {
  const cols = columns(), boxes = {};
  const hOf = (b) => HH + b.n * RH + CH;
  const H = Math.max(MINH, TOP + Math.max(0, ...cols.map((c) => c.reduce((s, b) => s + hOf(b) + VGAP, 0))));
  cols.forEach((c, ci) => {
    const x = ci * (COLW + GAP), slot = (H - TOP) / c.length;
    c.forEach((b, i) => { const h = hOf(b); boxes[b.kind === "g" ? "g:" + b.g.grp : "m:" + b.m.code] = { ...b, x, y: TOP + slot * (i + 0.5) - h / 2, w: COLW, h }; });
  });
  return { boxes, W: Math.max(1, cols.length * (COLW + GAP) - GAP), H };
}
const rowY = (b, i) => b.y + HH + i * RH + RH / 2;

function rowsOf(b) {
  if (b.kind === "m") { const m = b.m; return ["red", "blue"].map((s) => { const sd = m[s + "_seed"]; return { seed: sd, label: sideName(m, s), win: m.winner_seed != null && m.winner_seed === sd, lose: m.winner_seed != null && sd != null && m.winner_seed !== sd }; }); }
  return tableOf(b.g.grp).map((r) => ({ ...r, label: r.seed != null ? teamName(r.seed) : srcLabel((b.g.srcs || [])[r.slot]) }));
}
function chipHtml(m, clickable) {
  const started = m.red_wins + m.blue_wins > 0 || m.status === "done";
  const tip = `${m.code} ${sideName(m, "red")} vs ${sideName(m, "blue")}`;
  return `<button type="button" class="bk-chip ${m.status}"${clickable ? ` data-act="edit" data-c="${m.code}"` : ""} title="${esc(tip)}"><b>${m.code}</b>${started ? `<i>${m.red_wins}-${m.blue_wins}</i>` : ""}${m.walkover ? `<u>FF</u>` : ""}${m.field_no && m.status !== "done" ? `<em>●</em>` : ""}</button>`;
}
function boxHtml(b, clickable) {
  const isM = b.kind === "m", adv = isM ? 0 : b.g.adv || 0;
  const title = isM ? (b.m.stage === "final" ? "Final" : b.m.code) : "Group " + b.g.grp;
  const sub = isM ? `${STAGE_EN[b.m.stage] && b.m.stage !== "final" ? STAGE_EN[b.m.stage] + " · " : ""}Bo${b.m.bo}` : STAGE_EN[b.g.stage] || "";
  const rh = rowsOf(b).map((r) => {
    const up = isM ? r.win : r.sure && r.pos <= adv, out = isM ? r.lose : r.sure && r.pos > adv, ab = r.seed != null && teamAbsent(r.seed);
    return `<div class="bk-row${up ? " up" : ""}${out ? " out" : ""}" style="height:${RH}px"><span class="p">${isM ? "" : r.sure ? r.pos : "-"}</span><span class="n${r.seed == null ? " ph" : ""}">${esc(r.label)}${ab ? ` <s>absent</s>` : ""}</span><span class="s">${isM ? "" : r.mw + "-" + r.ml}</span></div>`;
  }).join("");
  const ms = isM ? [b.m] : matches().filter((m) => m.grp === b.g.grp);
  return `<div class="bk-box${isM && b.m.stage === "final" ? " fin" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><div class="bk-h" style="height:${HH}px"><b>${title}</b><span>${sub}</span></div>${rh}<div class="bk-c" style="height:${CH}px">${ms.map((m) => chipHtml(m, clickable)).join("")}</div></div>`;
}
function wires(boxes) {
  const out = [];
  const elbow = (x1, y1, x2, y2, on, k) => { const mx = x1 + 30 + (k % 5) * 12; out.push(`<path class="${on ? "on" : ""}" d="M${x1} ${y1}H${mx}V${y2}H${x2}"/>`); };
  const from = (src, k) => {
    if (src.g && boxes["g:" + src.g]) { const sb = boxes["g:" + src.g], sr = tableOf(src.g)[src.p - 1]; return { x: sb.x + sb.w, y: rowY(sb, src.p - 1), on: !!(sr && sr.sure) }; }
    if (src.w && boxes["m:" + src.w]) { const sb = boxes["m:" + src.w], m = match(src.w); return { x: sb.x + sb.w, y: sb.y + HH + RH, on: !!(m && m.winner_seed != null) }; }
    return null;
  };
  Object.values(boxes).forEach((b, bi) => {
    if (b.kind === "m") [b.m.red_src, b.m.blue_src].forEach((src, j) => { const f = src && from(src); if (f) elbow(f.x, f.y, b.x, rowY(b, j), f.on, bi + j); });
    else if (b.g.stage === "r2") { const rows = tableOf(b.g.grp); (b.g.srcs || []).forEach((src, j) => { const f = from(src); const di = rows.findIndex((r) => r.slot === j); if (f) elbow(f.x, f.y, b.x, rowY(b, di < 0 ? j : di), f.on, bi + j); }); }
  });
  return out.join("");
}
function champHtml(boxes) {
  const fb = boxes["m:F"]; if (!fb) return "";
  const w = fb.m.winner_seed;
  return `<div class="bk-champ${w != null ? " has" : ""}" style="left:${fb.x}px;top:${Math.max(4, fb.y - 84)}px;width:${COLW}px"><span>Champion</span><b>${w != null ? esc(teamName(w)) : "TBD"}</b></div>`;
}

// Bracket HTML. opts.clickable makes each match chip clickable (data-act="edit"), opts.dark for dark screens
export function bracketHtml(opts = {}) {
  const { boxes, W, H } = layout();
  const body = Object.values(boxes).map((b) => boxHtml(b, !!opts.clickable)).join("") + champHtml(boxes);
  return `<div class="bk${opts.dark ? " dark" : ""}" data-bk data-w="${W}" data-h="${H}"${opts.maxh ? ` data-maxh="${opts.maxh}"` : ""}><div class="bk-stage" style="width:${W}px;height:${H}px"><svg class="bk-wires" width="${W}" height="${H}" aria-hidden="true">${wires(boxes)}</svg>${body}</div></div>`;
}

// Scale the bracket to fit its box. Call after every render
export function fitBrackets(root = document) {
  root.querySelectorAll("[data-bk]").forEach((el) => {
    const W = +el.dataset.w, H = +el.dataset.h, st = el.firstElementChild, maxh = +el.dataset.maxh || Infinity, w = el.clientWidth || el.parentElement.clientWidth;
    const k = Math.min(w / W, maxh / H, 2);
    st.style.transform = `translateX(${Math.max(0, (w - W * k) / 2)}px) scale(${k})`;
    el.style.height = Math.round(H * k) + "px";
  });
}
addEventListener("resize", () => fitBrackets());
