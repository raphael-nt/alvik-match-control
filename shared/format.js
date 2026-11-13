// Tournament format generator. Two modes:
//   groups : round robin groups (each group has its own size and number of teams that advance), then knockout
//   ko     : knockout only, seeds placed in standard bracket order
// Optional 3rd place match from the two semifinal losers. The first knockout round can be rearranged by hand (f.slots).
// Output is sent to a2_adm_format, which replaces a2_group and a2_match.

export const STAGE_EN = { r1: "Group stage", r2: "Round 2", r64: "Round of 64", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal", sf: "Semifinal", third: "3rd place", final: "Final" };
const KO = { 2: ["final", "F"], 4: ["sf", "SF"], 8: ["qf", "QF"], 16: ["r16", "R16-"], 32: ["r32", "R32-"], 64: ["r64", "R64-"] };
export const KO_ORDER = ["r64", "r32", "r16", "qf", "sf", "final"];
export const LIMITS = { groups: [1, 8], size: [2, 12], teams: 64 };
const BOS = [1, 3, 5, 7];
const L = (i) => String.fromCharCode(65 + i);

export function defaults() { return { mode: "groups", groups: [{ size: 3, adv: 2 }, { size: 3, adv: 2 }, { size: 3, adv: 2 }], teams: 8, bo_group: 3, bo_ko: 3, bo_final: 5, third: false, slots: null }; }

// Accept the old stored shape { groups: 3, size: 3, advance: 2 } as well as the new one
export function normalize(f0) {
  const d = defaults(), f = { ...d, ...(f0 || {}) };
  if (!Array.isArray(f.groups)) f.groups = [...Array(+f0?.groups || 3)].map(() => ({ size: +f0?.size || 3, adv: +f0?.advance || 2 }));
  f.groups = f.groups.map((g) => ({ size: +g.size, adv: +g.adv }));
  if (f.mode !== "ko") f.mode = "groups";
  f.third = !!f.third;
  if (!Array.isArray(f.slots)) f.slots = null;
  return f;
}

export function validate(f0) {
  const f = normalize(f0), e = [];
  ["bo_group", "bo_ko", "bo_final"].forEach((k) => { if (!BOS.includes(+f[k])) e.push(`${k} ต้องเป็น 1 3 5 หรือ 7`); });
  if (f.mode === "ko") {
    if (!Number.isInteger(+f.teams) || f.teams < 2 || f.teams > LIMITS.teams) e.push(`จำนวนทีมต้องเป็น 2 ถึง ${LIMITS.teams}`);
  } else {
    if (f.groups.length < LIMITS.groups[0] || f.groups.length > LIMITS.groups[1]) e.push(`จำนวนกลุ่มต้องเป็น ${LIMITS.groups[0]} ถึง ${LIMITS.groups[1]}`);
    f.groups.forEach((g, i) => {
      if (!Number.isInteger(g.size) || g.size < LIMITS.size[0] || g.size > LIMITS.size[1]) e.push(`กลุ่ม ${L(i)} : ทีมต้องเป็น ${LIMITS.size[0]} ถึง ${LIMITS.size[1]}`);
      if (!Number.isInteger(g.adv) || g.adv < 0 || g.adv > g.size) e.push(`กลุ่ม ${L(i)} : ทีมที่เข้ารอบต้องเป็น 0 ถึง ${g.size}`);
    });
    const tot = f.groups.reduce((s, g) => s + g.size, 0);
    if (tot > LIMITS.teams) e.push(`ทีมรวมไม่เกิน ${LIMITS.teams}`);
  }
  if (!e.length && f.slots) { const s = slotError(f); if (s) e.push(s); }
  return e;
}

// Circle method: every team rests evenly, sides alternate
function roundRobin(n) {
  const ids = [...Array(n).keys()]; if (n % 2) ids.push(-1);
  const m = ids.length, out = [];
  let arr = ids.slice();
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i], b = arr[m - 1 - i];
      if (a < 0 || b < 0) continue;
      out.push((r + i) % 2 ? { r, i, a: b, b: a } : { r, i, a, b });
    }
    arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
  }
  return out;
}
// Standard bracket seed order: 1 meets the lowest seed, top seeds meet as late as possible
function seedOrder(P) { let o = [1]; while (o.length < P) { const s = o.length * 2; o = o.flatMap((x) => [x, s + 1 - x]); } return o; }

// Teams that enter the knockout, best first: every group winner, then every runner up, and so on
export function qualifiers(f0) {
  const f = normalize(f0);
  if (f.mode === "ko") return [...Array(+f.teams).keys()].map((i) => ({ seed: i + 1 }));
  const Q = [], maxA = Math.max(0, ...f.groups.map((g) => g.adv));
  for (let p = 1; p <= maxA; p++) f.groups.forEach((g, gi) => { if (g.adv >= p) Q.push({ g: L(gi), p }); });
  return Q;
}
export const srcKey = (s) => (!s ? "" : s.seed ? "s" + s.seed : s.g + s.p);

// Automatic first knockout round (null = bye). Teams from the same group are kept apart where possible
export function autoSlots(f0) {
  const Q = qualifiers(f0), N = Q.length; if (N < 2) return [];
  let P = 2; while (P < N) P *= 2;
  const ent = seedOrder(P).map((s) => (s <= N ? Q[s - 1] : null));
  for (let k = 0; k < ent.length; k += 2) {
    const a = ent[k], b = ent[k + 1]; if (!a || !b || !a.g || a.g !== b.g) continue;
    for (let j = 0; j < ent.length; j += 2) {
      if (j === k) continue; const c = ent[j], d = ent[j + 1]; if (!c || !d) continue;
      if (d.g !== a.g && b.g !== c.g) { ent[k + 1] = d; ent[j + 1] = b; break; }
    }
  }
  return ent.map(srcKey);
}
// Hand-made slots must use every qualifier exactly once and fill a bracket of 2, 4, 8 ... places
function slotError(f) {
  const keys = qualifiers(f).map(srcKey), s = f.slots, filled = s.filter(Boolean);
  if (s.length !== autoSlots(f).length) return "จำนวนช่องในรอบแรกไม่ตรงกับจำนวนทีม กด Auto arrange ใหม่";
  if (filled.length !== keys.length || new Set(filled).size !== filled.length || filled.some((k) => !keys.includes(k))) return "รอบแรกต้องมีทุกทีมที่เข้ารอบ ทีมละ 1 ช่อง";
  for (let i = 0; i < s.length; i += 2) if (!s[i] && !s[i + 1]) return "มีคู่ที่ว่างทั้งสองฝั่ง";
  return "";
}

export function build(f0) {
  const f = normalize(f0), matches = [], groups = [];
  let teams;
  if (f.mode === "groups") {
    let seed = 0;
    f.groups.forEach((g, gi) => groups.push({ grp: L(gi), stage: "r1", adv: g.adv, srcs: [...Array(g.size).keys()].map(() => ({ seed: ++seed })) }));
    teams = seed;
    // Group matches, interleaved across groups so no group plays twice in a row
    const rr = [];
    groups.forEach((g, gi) => roundRobin(g.srcs.length).forEach((p) => rr.push({ ...p, gi, g })));
    rr.sort((x, y) => x.r - y.r || x.i - y.i || x.gi - y.gi);
    const cnt = {};
    rr.forEach((p) => { cnt[p.g.grp] = (cnt[p.g.grp] || 0) + 1; matches.push({ code: p.g.grp + cnt[p.g.grp], stage: "r1", grp: p.g.grp, bo: f.bo_group, red_src: p.g.srcs[p.a], blue_src: p.g.srcs[p.b] }); });
  } else teams = +f.teams;

  // Knockout
  const byKey = Object.fromEntries(qualifiers(f).map((q) => [srcKey(q), q]));
  let ent = (f.slots && !slotError(f) ? f.slots : autoSlots(f)).map((k) => (k ? byKey[k] : null));
  const sfCodes = [];
  while (ent.length > 1) {
    const [stage, pre] = KO[ent.length], nx = []; let k = 0;
    for (let i = 0; i < ent.length; i += 2) {
      const a = ent[i], b = ent[i + 1];
      if (!b) { nx.push(a); continue; } if (!a) { nx.push(b); continue; }
      k++; const code = stage === "final" ? "F" : pre + k;
      if (stage === "final" && f.third && sfCodes.length === 2) matches.push({ code: "3P", stage: "third", grp: null, bo: f.bo_ko, red_src: { l: sfCodes[0] }, blue_src: { l: sfCodes[1] } });
      matches.push({ code, stage, grp: null, bo: stage === "final" ? f.bo_final : f.bo_ko, red_src: a, blue_src: b });
      if (stage === "sf") sfCodes.push(code);
      nx.push({ w: code });
    }
    ent = nx;
  }
  matches.forEach((m, i) => (m.order_no = i + 1));
  return { format: { ...f, teams }, groups, matches };
}
