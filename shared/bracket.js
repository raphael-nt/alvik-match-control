// Bracket drawn with connector lines: group boxes, then knockout rounds, built from a2_group and a2_match
import { groups, match, matches, teamName, srcLabel, sideName, tableOf, teamAbsent, esc } from "./common.js";
import { stageLabel, KO_ORDER } from "./format.js";

// Box sizes. bracketHtml({ compact: true }) swaps in shorter rows with no match chips and no champion box,
// for short panels such as the Live screen strip
const FULL = { COLW: 300, GAP: 110, HH: 36, RH: 34, CH: 40, VGAP: 18, TOP: 96, MINH: 620 };
const COMPACT = { COLW: 300, GAP: 90, HH: 30, RH: 28, CH: 8, VGAP: 10, TOP: 0, MINH: 0 };
let COLW, GAP, HH, RH, CH, VGAP, TOP, MINH;
const useDims = (d) => ({ COLW, GAP, HH, RH, CH, VGAP, TOP, MINH } = d);
useDims(FULL);

function columns() {
  const cols = [], gs = groups(), ms = matches().filter((m) => !m.grp);
  const stageNum = (s) => (/^r(\d+)$/.test(s) ? +RegExp.$1 : 999);
  const koAll = [...KO_ORDER, "third"];
  const preStages = [...new Set([...gs.map((g) => g.stage || "r1"), ...ms.filter((m) => !koAll.includes(m.stage)).map((m) => m.stage)])]
    .sort((a, b) => stageNum(a) - stageNum(b) || a.localeCompare(b));
  preStages.forEach((st) => {
    const gItems = gs.filter((g) => (g.stage || "r1") === st).map((g) => ({ kind: "g", g, n: (g.srcs || []).length }));
    const mItems = ms.filter((m) => m.stage === st).map((m) => ({ kind: "m", m, n: 2 }));
    const col = [...gItems, ...mItems];
    if (col.length) cols.push(col);
  });
  KO_ORDER.forEach((st) => {
    const l = ms.filter((m) => m.stage === st || (st === "final" && m.stage === "third")).sort((a, b) => (a.stage === "third") - (b.stage === "third"));
    if (l.length) cols.push(l.map((m) => ({ kind: "m", m, n: 2 })));
  });
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
  const title = isM ? (b.m.stage === "final" ? "Final" : b.m.stage === "third" ? "3rd place" : b.m.code) : "Group " + b.g.grp;
  const stLbl = isM ? stageLabel(b.m.stage) : stageLabel(b.g.stage);
  const sub = isM ? `${stLbl && b.m.stage !== "final" && b.m.stage !== "third" ? stLbl + ", " : ""}Bo${b.m.bo}` : stLbl;
  const rh = rowsOf(b).map((r) => {
    const up = isM ? r.win : adv > 0 && r.sure && r.pos <= adv, out = isM ? r.lose : adv > 0 && r.sure && r.pos > adv, ab = r.seed != null && teamAbsent(r.seed);
    return `<div class="bk-row${up ? " up" : ""}${out ? " out" : ""}" style="height:${RH}px"><span class="p">${isM ? "" : r.sure ? r.pos : "-"}</span><span class="n${r.seed == null ? " ph" : ""}">${esc(r.label)}${ab ? ` <s>absent</s>` : ""}</span><span class="s">${isM ? "" : r.mw}</span></div>`;
  }).join("");
  const ms = isM ? [b.m] : matches().filter((m) => m.grp === b.g.grp);
  return `<div class="bk-box${isM && b.m.stage === "final" ? " fin" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><div class="bk-h" style="height:${HH}px"><b>${title}</b><span>${sub}</span></div>${rh}<div class="bk-c" style="height:${CH}px">${ms.map((m) => chipHtml(m, clickable)).join("")}</div></div>`;
}
// One colour per source group or match so each line can be followed by eye
const WIRE_C = ["#00878F", "#E07A1F", "#7B4FC9", "#D6336C", "#2F8A4E", "#2457C5", "#B8860B"];
function wires(boxes) {
  const ws = [];
  const elbow = (x1, y1, x2, y2, on, src) => ws.push({ x1, y1, x2, y2, on, c: WIRE_C[(srcIdx[src] ??= Object.keys(srcIdx).length) % WIRE_C.length] });
  const srcIdx = {};
  const from = (src, k) => {
    if (src.g && boxes["g:" + src.g]) { const sb = boxes["g:" + src.g], sr = tableOf(src.g)[src.p - 1]; return { x: sb.x + sb.w, y: rowY(sb, src.p - 1), on: !!(sr && sr.sure) }; }
    if (src.w && boxes["m:" + src.w]) { const sb = boxes["m:" + src.w], m = match(src.w); return { x: sb.x + sb.w, y: sb.y + HH + RH, on: !!(m && m.winner_seed != null) }; }
    // Loser of a match (3rd place): same column as the target, so the line leaves from the bottom of the semifinal box
    if (src.l && boxes["m:" + src.l]) { const sb = boxes["m:" + src.l], m = match(src.l); return { x: sb.x + sb.w, y: sb.y + sb.h - CH / 2, on: !!(m && m.winner_seed != null) }; }
    return null;
  };
  Object.values(boxes).forEach((b) => {
    if (b.kind === "m") [b.m.red_src, b.m.blue_src].forEach((src, j) => { const f = src && from(src); if (f) elbow(f.x, f.y, b.x, rowY(b, j), f.on, src.g || src.w || "L" + src.l); });
    else {
      const rows = tableOf(b.g.grp);
      (b.g.srcs || []).forEach((src, j) => {
        if (!src || (!src.g && !src.w && !src.l)) return;
        const f = from(src), di = rows.findIndex((r) => r.slot === j);
        if (f) elbow(f.x, f.y, b.x, rowY(b, di < 0 ? j : di), f.on, src.g || src.w || "L" + src.l);
      });
    }
  });
  // Every wire in a column gap gets its own vertical lane so lines never run on top of each other
  const gaps = {};
  ws.forEach((w) => (gaps[w.x1] = gaps[w.x1] || []).push(w));
  return Object.values(gaps).flatMap((g) => {
    const down = g.filter((w) => w.y2 >= w.y1).sort((a, b) => b.y1 - a.y1), up = g.filter((w) => w.y2 < w.y1).sort((a, b) => a.y1 - b.y1);
    const order = [...up, ...down], n = order.length, span = GAP - 36;
    return order.map((w, i) => { const mx = w.x1 + 18 + (n > 1 ? (span * i) / (n - 1) : span / 2);
      return `<path class="${w.on ? "on" : ""}" style="stroke:${w.c}" d="M${w.x1} ${w.y1}H${mx}V${w.y2}H${w.x2}"/><circle cx="${w.x2 - 4}" cy="${w.y2}" r="4" style="fill:${w.c}"/>`; });
  }).join("");
}
function champHtml(boxes) {
  const fb = boxes["m:F"] || Object.values(boxes).find((b) => b.kind === "m" && b.m.stage === "final"); if (!fb) return "";
  const w = fb.m.winner_seed;
  return `<div class="bk-champ${w != null ? " has" : ""}" style="left:${fb.x}px;top:${Math.max(4, fb.y - 84)}px;width:${COLW}px"><span>Champion</span><b>${w != null ? esc(teamName(w)) : "TBD"}</b></div>`;
}

// Bracket HTML. opts.clickable makes each match chip clickable (data-act="edit"), opts.dark for dark screens
export function bracketHtml(opts = {}) {
  useDims(opts.compact ? COMPACT : FULL);
  const { boxes, W, H } = layout();
  const body = Object.values(boxes).map((b) => boxHtml(b, !!opts.clickable)).join("") + (opts.compact ? "" : champHtml(boxes));
  const wireHtml = wires(boxes); useDims(FULL);
  return `<div class="bk${opts.dark ? " dark" : ""}${opts.compact ? " compact" : ""}" data-bk data-w="${W}" data-h="${H}"${opts.maxh ? ` data-maxh="${opts.maxh}"` : ""}><div class="bk-stage" style="width:${W}px;height:${H}px"><svg class="bk-wires" width="${W}" height="${H}" aria-hidden="true">${wireHtml}</svg>${body}</div></div>`;
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
