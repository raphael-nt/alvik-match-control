// Bracket drawn with connector lines, built from group data
import { T, S, groups, match, matches, teamName, srcLabel, sideName, tableOf, teamAbsent, esc } from "./common.js";

const W = 1520, H = 620, COLW = 320, COLX = [0, 600, 1200], HH = 36, RH = 34, CH = 40;
const STAGES = ["r1", "r2"];

function layout() {
  const gs = groups(), boxes = {}, byStage = {};
  gs.forEach((g) => (byStage[g.stage] = byStage[g.stage] || []).push(g));
  STAGES.forEach((st, c) => {
    const list = byStage[st] || [];
    list.forEach((g, i) => {
      const n = (g.srcs || []).length, h = HH + n * RH + CH;
      boxes[g.grp] = { g, x: COLX[c], y: (H / list.length) * (i + 0.5) - h / 2, w: COLW, h, n };
    });
  });
  const F = match("F");
  if (F) { const h = HH + 2 * RH + CH; boxes.F = { g: { grp: "F", stage: "final" }, x: COLX[2], y: H / 2 - h / 2 + 40, w: COLW, h, n: 2 }; }
  return boxes;
}
const rowY = (b, i) => b.y + HH + i * RH + RH / 2;

function rowsOf(b) {
  const G = b.g.grp;
  if (G === "F") { const F = match("F"); return ["red", "blue"].map((s, i) => ({ slot: i, seed: s === "red" ? F.red_seed : F.blue_seed, label: sideName(F, s), pos: null, sure: false, mw: 0, ml: 0, win: F.winner_seed != null && F.winner_seed === (s === "red" ? F.red_seed : F.blue_seed) })); }
  return tableOf(G).map((r) => ({ ...r, label: r.seed != null ? teamName(r.seed) : srcLabel((b.g.srcs || [])[r.slot]) }));
}

function chipHtml(m, clickable) {
  const started = m.red_wins + m.blue_wins > 0 || m.status === "done";
  const sc = started ? `<i>${m.red_wins}-${m.blue_wins}</i>` : "";
  const tag = m.walkover ? `<u>บาย</u>` : "";
  const tip = `${m.code} ${sideName(m, "red")} พบ ${sideName(m, "blue")}${m.field_no ? " สนาม " + m.field_no : ""}`;
  const attrs = clickable ? ` data-act="edit" data-c="${m.code}"` : "";
  return `<button type="button" class="bk-chip ${m.status}"${attrs} title="${esc(tip)}"><b>${m.code}</b>${sc}${tag}${m.field_no && m.status !== "done" ? `<em>${m.field_no}</em>` : ""}</button>`;
}

function boxHtml(b, clickable) {
  const G = b.g.grp, isF = G === "F", adv = b.g.adv || 0;
  const rows = rowsOf(b);
  const ms = isF ? [match("F")] : matches().filter((m) => m.grp === G);
  const title = isF ? "ชิงชนะเลิศ" : "สาย " + G;
  const sub = isF ? "Bo5" : b.g.stage === "r1" ? "รอบแรก" : "รอบสอง";
  const rh = rows.map((r) => {
    const out = !isF && r.sure && r.pos > adv, up = !isF && r.sure && r.pos <= adv, ab = r.seed != null && teamAbsent(r.seed);
    return `<div class="bk-row${up ? " up" : ""}${out ? " out" : ""}${r.win ? " up" : ""}" style="height:${RH}px"><span class="p">${isF ? "" : r.sure ? r.pos : "-"}</span><span class="n${r.seed == null ? " ph" : ""}">${esc(r.label)}${ab ? ` <s>ไม่มา</s>` : ""}</span><span class="s">${isF ? "" : r.mw + "-" + r.ml}</span></div>`;
  }).join("");
  return `<div class="bk-box${isF ? " fin" : ""}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><div class="bk-h" style="height:${HH}px"><b>${title}</b><span>${sub}</span></div>${rh}<div class="bk-c" style="height:${CH}px">${ms.map((m) => chipHtml(m, clickable)).join("")}</div></div>`;
}

function wires(boxes) {
  const out = [];
  const elbow = (x1, y1, x2, y2, on, k) => { const mx = x1 + 34 + k * 12; out.push(`<path class="${on ? "on" : ""}" d="M${x1} ${y1}H${mx}V${y2}H${x2}"/>`); };
  groups().filter((g) => g.stage === "r2").forEach((g) => {
    const dst = boxes[g.grp], rows = tableOf(g.grp);
    (g.srcs || []).forEach((src, j) => {
      if (!src.g || !boxes[src.g]) return;
      const sb = boxes[src.g], srows = tableOf(src.g), sr = srows[src.p - 1];
      const di = rows.findIndex((r) => r.slot === j);
      elbow(sb.x + sb.w, rowY(sb, src.p - 1), dst.x, rowY(dst, di < 0 ? j : di), !!(sr && sr.sure), src.p + (src.g.charCodeAt(0) % 3));
    });
  });
  const F = match("F"), fb = boxes.F;
  if (F && fb) [F.red_src, F.blue_src].forEach((src, j) => {
    if (!src || !src.g || !boxes[src.g]) return;
    const sb = boxes[src.g], sr = tableOf(src.g)[src.p - 1];
    elbow(sb.x + sb.w, rowY(sb, src.p - 1), fb.x, rowY(fb, j), !!(sr && sr.sure), j);
  });
  return out.join("");
}

function champHtml(boxes) {
  const F = match("F"), fb = boxes.F; if (!F || !fb) return "";
  const w = F.winner_seed;
  return `<div class="bk-champ${w != null ? " has" : ""}" style="left:${fb.x}px;top:${fb.y - 84}px;width:${COLW}px"><span>แชมป์</span><b>${w != null ? esc(teamName(w)) : "รอผลคู่ชิง"}</b></div>`;
}

// Bracket HTML. opts.clickable makes each match chip clickable (data-act="edit"), opts.dark for dark screens
export function bracketHtml(opts = {}) {
  const boxes = layout();
  const body = Object.values(boxes).map((b) => boxHtml(b, !!opts.clickable)).join("") + champHtml(boxes);
  return `<div class="bk${opts.dark ? " dark" : ""}" data-bk${opts.maxh ? ` data-maxh="${opts.maxh}"` : ""}><div class="bk-stage" style="width:${W}px;height:${H}px"><svg class="bk-wires" width="${W}" height="${H}" aria-hidden="true">${wires(boxes)}</svg>${body}</div></div>`;
}

// Scale the bracket to fit its box. Call after every render
export function fitBrackets(root = document) {
  root.querySelectorAll("[data-bk]").forEach((el) => {
    const st = el.firstElementChild, maxh = +el.dataset.maxh || Infinity, w = el.clientWidth || el.parentElement.clientWidth;
    const k = Math.min(w / W, maxh / H, 2);
    st.style.transform = `translateX(${Math.max(0, (w - W * k) / 2)}px) scale(${k})`;
    el.style.height = Math.round(H * k) + "px";
  });
}
addEventListener("resize", () => fitBrackets());
