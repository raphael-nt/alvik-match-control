// Bracket drawn with connector lines: group boxes, then knockout rounds, built from a2_group and a2_match
import { groups, match, matches, teamName, srcLabel, sideName, tableOf, teamAbsent, esc, grpName } from "./common.js";
import { stageLabel, KO_ORDER } from "./format.js";

// Data source : live store, or preview data from bracketHtml({ data: { groups, matches } }) before a format is applied
let PV = null;
function setPreview(data) {
  if (!data) { PV = null; return; }
  const ms = data.matches.map((m) => ({ ...m, red_seed: m.red_src && m.red_src.seed != null ? m.red_src.seed : null, blue_seed: m.blue_src && m.blue_src.seed != null ? m.blue_src.seed : null,
    red_wins: 0, blue_wins: 0, winner_seed: null, status: "locked", field_no: null, walkover: null, forfeit: null }));
  PV = { groups: data.groups, matches: ms, byCode: new Map(ms.map((m) => [m.code, m])) };
}
const _groups = () => (PV ? PV.groups : groups());
const _matches = () => (PV ? PV.matches : matches());
const _match = (c) => (PV ? PV.byCode.get(c) : match(c));
const _table = (g) => {
  if (!PV) return tableOf(g);
  const gr = PV.groups.find((x) => x.grp === g); if (!gr) return [];
  return (gr.srcs || []).map((src, i) => ({ grp: g, slot: i, pos: i + 1, seed: src && src.seed != null ? src.seed : null, mw: 0, ml: 0, gw: 0, gl: 0, sure: false }));
};
const _team = (sd) => (PV ? "Team " + sd : teamName(sd));
const _side = (m, side) => (PV ? (m[side + "_seed"] != null ? "Team " + m[side + "_seed"] : srcLabel(side === "red" ? m.red_src : m.blue_src)) : sideName(m, side));

// Box sizes. bracketHtml({ compact: true }) swaps in shorter rows with no match chips and no champion box,
// for short panels such as the Live screen strip
const FULL = { COLW: 300, GAP: 110, HH: 36, RH: 34, CH: 40, VGAP: 24, TOP: 96, MINH: 620 };
const COMPACT = { COLW: 300, GAP: 90, HH: 30, RH: 28, CH: 8, VGAP: 14, TOP: 16, MINH: 0 };
let COLW, GAP, HH, RH, CH, VGAP, TOP, MINH, IS_COMPACT = false;
const useDims = (d) => ({ COLW, GAP, HH, RH, CH, VGAP, TOP, MINH } = d);
useDims(FULL);

const itemKey = (it) => (it.kind === "g" ? "g:" + it.g.grp : "m:" + it.m.code);
const srcDeps = (src) => (!src ? [] : src.g ? ["g:" + src.g] : src.w ? ["m:" + src.w] : src.l ? ["m:" + src.l] : []);

// Split a single stage column into topological sub-columns if items within it depend on each other
function splitByDeps(colItems) {
  if (colItems.length < 2) return [colItems];
  const byKey = new Map(colItems.map((it) => [itemKey(it), it]));
  const lvl = new Map(), visiting = new Set();
  const depth = (k) => {
    if (lvl.has(k)) return lvl.get(k);
    if (visiting.has(k)) return 0;
    visiting.add(k);
    const it = byKey.get(k);
    const srcs = it.kind === "g" ? (it.g.srcs || []) : [it.m.red_src, it.m.blue_src];
    let best = 0;
    for (const s of srcs) {
      for (const dk of srcDeps(s)) {
        if (dk !== k && byKey.has(dk)) best = Math.max(best, depth(dk) + 1);
      }
    }
    visiting.delete(k);
    lvl.set(k, best);
    return best;
  };
  let maxL = 0;
  colItems.forEach((it) => { maxL = Math.max(maxL, depth(itemKey(it))); });
  if (maxL === 0) return [colItems];
  const sub = Array.from({ length: maxL + 1 }, () => []);
  colItems.forEach((it) => sub[lvl.get(itemKey(it))].push(it));
  return sub.filter((s) => s.length);
}

function columns() {
  const cols = [], gs = _groups(), ms = _matches().filter((m) => !m.grp);
  const stageNum = (s) => (/^r(\d+)$/.test(s) ? +RegExp.$1 : 999);
  const koAll = new Set([...KO_ORDER, "third"]);
  const gBySt = new Map(), mBySt = new Map(), preSet = new Set();
  gs.forEach((g) => {
    const st = g.stage || "r1";
    preSet.add(st);
    let arr = gBySt.get(st); if (!arr) gBySt.set(st, (arr = []));
    arr.push({ kind: "g", g, n: (g.srcs || []).length });
  });
  ms.forEach((m) => {
    if (!koAll.has(m.stage)) preSet.add(m.stage);
    let arr = mBySt.get(m.stage); if (!arr) mBySt.set(m.stage, (arr = []));
    arr.push(m);
  });
  const pushStage = (items) => { if (items.length) splitByDeps(items).forEach((c) => cols.push(c)); };
  const preStages = [...preSet].sort((a, b) => stageNum(a) - stageNum(b) || a.localeCompare(b));
  preStages.forEach((st) => pushStage([...(gBySt.get(st) || []), ...(mBySt.get(st) || []).map((m) => ({ kind: "m", m, n: 2 }))]));
  KO_ORDER.forEach((st) => {
    const list = st === "final" ? [...(mBySt.get("final") || []), ...(mBySt.get("third") || [])] : (mBySt.get(st) || []);
    pushStage(list.map((m) => ({ kind: "m", m, n: 2 })));
  });
  return cols;
}

// Compute chip area height for a group box based on how many 26px chips fit in COLW - 16
function chipAreaH(ms) {
  if (IS_COMPACT) return CH;
  const maxW = COLW - 18;
  let rows = 1, lineW = 0;
  for (const m of ms) {
    const started = m.red_wins + m.blue_wins > 0 || m.status === "done";
    const cw = 22 + m.code.length * 9 + (started ? 28 : 0) + (m.walkover ? 20 : 0) + (m.field_no && m.status !== "done" ? 20 : 0);
    if (lineW > 0 && lineW + 6 + cw > maxW) { rows++; lineW = cw; }
    else lineW = lineW > 0 ? lineW + 6 + cw : cw;
  }
  return Math.max(CH, 14 + rows * 26 + Math.max(0, rows - 1) * 6);
}

function findFinalKey(cols) {
  let k = "";
  for (const c of cols) for (const b of c) {
    if (b.kind === "m" && b.m.code === "F") return "m:F";
    if (b.kind === "m" && b.m.stage === "final") k = "m:" + b.m.code;
  }
  return k;
}

function layout(mByGrp) {
  const cols = columns(), boxes = {}, finalKey = IS_COMPACT ? "" : findFinalKey(cols);
  const gapBefore = (b, i) => (i === 0 ? 0 : (finalKey && itemKey(b) === finalKey ? Math.max(VGAP, 92) : VGAP));
  const minContent = (c) => c.reduce((s, b, i) => s + b.h + gapBefore(b, i), 0);

  cols.forEach((c) => c.forEach((b) => {
    b.ch = b.kind === "m" ? CH : chipAreaH(mByGrp.get(b.g.grp) || []);
    b.h = HH + b.n * RH + b.ch;
  }));

  const contentH = Math.max(MINH - TOP, 0, ...cols.map(minContent));
  const H = TOP + contentH;
  cols.forEach((c, ci) => {
    const x = ci * (COLW + GAP);
    const req = minContent(c), extra = Math.max(0, contentH - req), unit = extra / c.length;
    let y = TOP + 0.5 * unit;
    c.forEach((b, i) => {
      if (i > 0) y += gapBefore(b, i) + unit;
      const key = itemKey(b), box = { ...b, key, ci, idx: i, x, y, w: COLW };
      boxes[key] = box;
      c[i] = box;
      y += b.h;
    });
  });
  return { cols, boxes, finalKey, W: Math.max(1, cols.length * (COLW + GAP) - GAP), H };
}
const rowY = (b, i) => b.y + HH + i * RH + RH / 2;

function rowsOf(b) {
  if (b.kind === "m") { const m = b.m; return ["red", "blue"].map((s) => { const sd = m[s + "_seed"]; return { seed: sd, label: _side(m, s), win: m.winner_seed != null && m.winner_seed === sd, lose: m.winner_seed != null && sd != null && m.winner_seed !== sd }; }); }
  return _table(b.g.grp).map((r) => ({ ...r, label: r.seed != null ? _team(r.seed) : srcLabel((b.g.srcs || [])[r.slot]) }));
}
function chipHtml(m, clickable) {
  const started = m.red_wins + m.blue_wins > 0 || m.status === "done";
  const tip = `${m.code} ${_side(m, "red")} vs ${_side(m, "blue")}`;
  return `<button type="button" class="bk-chip ${m.status}"${clickable ? ` data-act="edit" data-c="${m.code}"` : ""} title="${esc(tip)}"><b>${m.code}</b>${started ? `<i>${m.red_wins}-${m.blue_wins}</i>` : ""}${m.walkover ? `<u>FF</u>` : ""}${m.field_no && m.status !== "done" ? `<em>●</em>` : ""}</button>`;
}
function boxHtml(b, clickable, mByGrp) {
  const isM = b.kind === "m", adv = isM ? 0 : b.g.adv || 0;
  const title = isM ? (b.m.stage === "final" ? "Final" : b.m.stage === "third" ? "3rd place" : b.m.code) : grpName(b.g.grp);
  const stLbl = isM ? stageLabel(b.m.stage) : stageLabel(b.g.stage);
  const sub = isM ? `${stLbl && b.m.stage !== "final" && b.m.stage !== "third" ? stLbl + ", " : ""}Bo${b.m.bo}` : stLbl;
  const rh = rowsOf(b).map((r) => {
    const up = isM ? r.win : adv > 0 && r.sure && r.pos <= adv, out = isM ? r.lose : adv > 0 && r.sure && r.pos > adv, ab = r.seed != null && teamAbsent(r.seed);
    return `<div class="bk-row${up ? " up" : ""}${out ? " out" : ""}" style="height:${RH}px"><span class="p">${isM ? "" : r.sure ? r.pos : "-"}</span><span class="n${r.seed == null ? " ph" : ""}">${esc(r.label)}${ab ? ` <s>absent</s>` : ""}</span><span class="s">${isM ? "" : r.mw}</span></div>`;
  }).join("");
  const ms = isM ? [b.m] : (mByGrp.get(b.g.grp) || []);
  return `<div class="bk-box${isM && b.m.stage === "final" ? " fin" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><div class="bk-h" style="height:${HH}px"><b>${title}</b><span>${sub}</span></div>${rh}<div class="bk-c" style="height:${b.ch}px">${ms.map((m) => chipHtml(m, clickable)).join("")}</div></div>`;
}

// Merge overlapping blocked [top, bot] intervals
function mergeIntervals(iv) {
  if (!iv.length) return [];
  iv.sort((a, b) => a[0] - b[0]);
  const out = [[iv[0][0], iv[0][1]]];
  for (let i = 1; i < iv.length; i++) {
    const last = out[out.length - 1];
    if (iv[i][0] <= last[1]) last[1] = Math.max(last[1], iv[i][1]);
    else out.push([iv[i][0], iv[i][1]]);
  }
  return out;
}

// Available horizontal bypass corridors across columns [cLo .. cHi]
function freeCorridors(cols, cLo, cHi, finalKey) {
  const blocked = [];
  for (let c = cLo; c <= cHi; c++) {
    for (const b of cols[c] || []) {
      const top = (!IS_COMPACT && b.key === finalKey) ? Math.min(b.y - 8, b.y - 88) : b.y - 8;
      blocked.push([top, b.y + b.h + 8]);
    }
  }
  const m = mergeIntervals(blocked);
  if (!m.length) return [{ key: "mid", top: -Infinity, bot: Infinity, kind: "free" }];
  const out = [{ key: `top:${m[0][0]}`, top: -Infinity, bot: m[0][0], kind: "top" }];
  for (let i = 0; i < m.length - 1; i++) {
    if (m[i + 1][0] - m[i][1] >= 18) out.push({ key: `in:${m[i][1]}:${m[i + 1][0]}`, top: m[i][1], bot: m[i + 1][0], kind: "in" });
  }
  out.push({ key: `bot:${m[m.length - 1][1]}`, top: m[m.length - 1][1], bot: Infinity, kind: "bot" });
  return out;
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Spread horizontal bypass lanes by >= step inside corridor [top, bot]
function assignBypassY(list, c) {
  const step = 10, pad = 10, n = list.length;
  if (c.kind === "top") {
    list.sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2));
    list.forEach((w) => { w.by = Math.min(c.bot - pad, Math.max(14, (w.y1 + w.y2) / 2)); });
    for (let i = n - 2; i >= 0; i--) if (list[i].by > list[i + 1].by - step) list[i].by = list[i + 1].by - step;
  } else if (c.kind === "bot") {
    list.sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2));
    list.forEach((w) => { w.by = Math.max(c.top + pad, (w.y1 + w.y2) / 2); });
    for (let i = 1; i < n; i++) if (list[i].by < list[i - 1].by + step) list[i].by = list[i - 1].by + step;
  } else if (c.kind === "free") {
    list.sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2));
    list.forEach((w, i) => { w.by = (w.y1 + w.y2) / 2 + (i - (n - 1) / 2) * step; });
  } else {
    const lo = c.top + pad, hi = c.bot - pad;
    list.sort((a, b) => (a.y1 + a.y2) - (b.y1 + b.y2));
    if ((n - 1) * step >= hi - lo) {
      const s = n > 1 ? (hi - lo) / (n - 1) : 0;
      list.forEach((w, i) => { w.by = n === 1 ? (lo + hi) / 2 : lo + i * s; });
    } else {
      list.forEach((w, i) => { w.by = clampNum((w.y1 + w.y2) / 2, lo + i * step, hi - (n - 1 - i) * step); });
      for (let i = 1; i < n; i++) if (list[i].by < list[i - 1].by + step) list[i].by = list[i - 1].by + step;
      for (let i = n - 2; i >= 0; i--) if (list[i].by > list[i + 1].by - step) list[i].by = list[i + 1].by - step;
    }
  }
}

// One colour per source group or match so each line can be followed by eye
const WIRE_C = ["#00878F", "#E07A1F", "#7B4FC9", "#D6336C", "#2F8A4E", "#2457C5", "#B8860B"];
function wires(state) {
  const { cols, boxes, finalKey } = state;
  const ws = [], srcIdx = {};
  const addWire = (sb, x1, y1, dst, x2, y2, on, srcKey) => ws.push({
    sb, x1, y1, dst, x2, y2, on, c: WIRE_C[(srcIdx[srcKey] ??= Object.keys(srcIdx).length) % WIRE_C.length],
    skip: dst.ci !== sb.ci + 1,
  });
  const from = (src) => {
    if (src.g && boxes["g:" + src.g]) { const sb = boxes["g:" + src.g], sr = _table(src.g)[src.p - 1]; return { sb, x: sb.x + sb.w, y: rowY(sb, src.p - 1), on: !!(sr && sr.sure) }; }
    if (src.w && boxes["m:" + src.w]) { const sb = boxes["m:" + src.w], m = _match(src.w); return { sb, x: sb.x + sb.w, y: sb.y + HH + RH, on: !!(m && m.winner_seed != null) }; }
    if (src.l && boxes["m:" + src.l]) { const sb = boxes["m:" + src.l], m = _match(src.l); return { sb, x: sb.x + sb.w, y: sb.y + sb.h - sb.ch / 2, on: !!(m && m.winner_seed != null) }; }
    return null;
  };
  Object.values(boxes).forEach((b) => {
    if (b.kind === "m") [b.m.red_src, b.m.blue_src].forEach((src, j) => { const f = src && from(src); if (f) addWire(f.sb, f.x, f.y, b, b.x, rowY(b, j), f.on, src.g || src.w || "L" + src.l); });
    else {
      const rows = _table(b.g.grp);
      (b.g.srcs || []).forEach((src, j) => {
        if (!src || (!src.g && !src.w && !src.l)) return;
        const f = from(src), di = rows.findIndex((r) => r.slot === j);
        if (f) addWire(f.sb, f.x, f.y, b, b.x, rowY(b, di < 0 ? j : di), f.on, src.g || src.w || "L" + src.l);
      });
    }
  });

  // Route wires spanning > 1 column through collision-free corridors between/above/below intermediate boxes
  const byCorridor = new Map();
  ws.filter((w) => w.skip).forEach((w) => {
    const forward = w.dst.ci > w.sb.ci;
    const cLo = forward ? w.sb.ci + 1 : w.dst.ci;
    const cHi = forward ? w.dst.ci - 1 : w.sb.ci;
    const corrs = freeCorridors(cols, cLo, cHi, finalKey);
    let best = corrs[0], bestCost = Infinity;
    for (const c of corrs) {
      const ideal = c.kind === "top" ? Math.min(c.bot - 10, Math.max(12, Math.min(w.y1, w.y2)))
        : c.kind === "bot" ? c.top + 10
        : c.kind === "free" ? (w.y1 + w.y2) / 2
        : clampNum((w.y1 + w.y2) / 2, c.top + 10, c.bot - 10);
      const cost = Math.abs(w.y1 - ideal) + Math.abs(ideal - w.y2);
      if (cost < bestCost) { bestCost = cost; best = c; }
    }
    let entry = byCorridor.get(best.key);
    if (!entry) byCorridor.set(best.key, (entry = { corr: best, items: [] }));
    entry.items.push(w);
  });
  for (const { corr, items } of byCorridor.values()) assignBypassY(items, corr);

  // Expand top or bottom bounds if bypass lines stack past stage edges
  let minY = 0, maxY = state.H;
  ws.forEach((w) => {
    if (!w.skip) return;
    minY = Math.min(minY, w.by - 12);
    maxY = Math.max(maxY, w.by + 14);
  });
  if (minY < 0) {
    const dy = -minY;
    Object.values(boxes).forEach((b) => { b.y += dy; });
    ws.forEach((w) => { w.y1 += dy; w.y2 += dy; if (w.skip) w.by += dy; });
    state.H += dy;
    maxY += dy;
  }
  state.H = Math.max(state.H, Math.ceil(maxY));

  // Allocate distinct vertical lane X coordinates inside every column gap
  const gapLegs = new Map();
  const pushLeg = (gapIdx, ya, yb, setX) => {
    let arr = gapLegs.get(gapIdx);
    if (!arr) gapLegs.set(gapIdx, (arr = []));
    arr.push({ ya, yb, setX });
  };
  ws.forEach((w) => {
    if (!w.skip) {
      pushLeg(w.sb.ci, w.y1, w.y2, (mx) => { w.mx = mx; });
    } else {
      pushLeg(w.sb.ci, w.y1, w.by, (mx) => { w.mx1 = mx; });
      pushLeg(w.dst.ci - 1, w.by, w.y2, (mx) => { w.mx2 = mx; });
    }
  });
  for (const [gi, legs] of gapLegs.entries()) {
    const gapX = gi * (COLW + GAP) + COLW;
    const down = legs.filter((l) => l.yb >= l.ya).sort((a, b) => b.ya - a.ya || a.yb - b.yb);
    const up = legs.filter((l) => l.yb < l.ya).sort((a, b) => a.ya - b.ya || b.yb - a.yb);
    const order = [...up, ...down], n = order.length, span = GAP - 32;
    order.forEach((l, i) => l.setX(Math.round(gapX + 16 + (n > 1 ? (span * i) / (n - 1) : span / 2))));
  }
  if (gapLegs.has(-1)) {
    const shiftX = 28;
    Object.values(boxes).forEach((b) => { b.x += shiftX; });
    ws.forEach((w) => {
      w.x1 += shiftX; w.x2 += shiftX;
      if (w.skip) { w.mx1 += shiftX; w.mx2 += shiftX; } else w.mx += shiftX;
    });
    state.W += shiftX;
  }
  for (const gi of gapLegs.keys()) {
    if (gi >= cols.length - 1) state.W = Math.max(state.W, gi * (COLW + GAP) + COLW + 40);
  }

  return ws.map((w) => {
    const d = w.skip
      ? `M${w.x1} ${w.y1}H${w.mx1}V${w.by}H${w.mx2}V${w.y2}H${w.x2}`
      : `M${w.x1} ${w.y1}H${w.mx}V${w.y2}H${w.x2}`;
    return `<path class="${w.on ? "on" : ""}" style="stroke:${w.c}" d="${d}"/><circle cx="${w.x2 - 4}" cy="${w.y2}" r="4" style="fill:${w.c}"/>`;
  }).join("");
}
function champHtml(boxes, finalKey) {
  const fb = (finalKey && boxes[finalKey]) || boxes["m:F"] || Object.values(boxes).find((b) => b.kind === "m" && b.m.stage === "final"); if (!fb) return "";
  const w = fb.m.winner_seed;
  return `<div class="bk-champ${w != null ? " has" : ""}" style="left:${fb.x}px;top:${Math.max(4, fb.y - 84)}px;width:${COLW}px"><span>Champion</span><b>${w != null ? esc(_team(w)) : "TBD"}</b></div>`;
}

// Bracket HTML. opts.clickable makes each match chip clickable (data-act="edit"), opts.dark for dark screens
export function bracketHtml(opts = {}) {
  setPreview(opts.data || null);
  IS_COMPACT = !!opts.compact;
  useDims(IS_COMPACT ? COMPACT : FULL);
  const mByGrp = new Map();
  _matches().forEach((m) => {
    if (!m.grp) return;
    let arr = mByGrp.get(m.grp); if (!arr) mByGrp.set(m.grp, (arr = []));
    arr.push(m);
  });
  const st = layout(mByGrp);
  const wireHtml = wires(st);
  const { boxes, finalKey, W, H } = st;
  const body = Object.values(boxes).map((b) => boxHtml(b, !!opts.clickable, mByGrp)).join("") + (IS_COMPACT ? "" : champHtml(boxes, finalKey));
  IS_COMPACT = false; useDims(FULL); setPreview(null);
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
