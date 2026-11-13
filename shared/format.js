// Tournament format generator: groups (round robin) then knockout.
// Output is sent to a2_adm_format, which replaces a2_group and a2_match.

export const STAGE_EN = { r1: "Group stage", r2: "Round 2", r64: "Round of 64", r32: "Round of 32", r16: "Round of 16", qf: "Quarterfinal", sf: "Semifinal", final: "Final" };
const KO = { 2: ["final", "F"], 4: ["sf", "SF"], 8: ["qf", "QF"], 16: ["r16", "R16-"], 32: ["r32", "R32-"], 64: ["r64", "R64-"] };
export const KO_ORDER = ["r64", "r32", "r16", "qf", "sf", "final"];
export const LIMITS = { groups: [1, 8], size: [2, 8], teams: 64 };

export function defaults() { return { groups: 3, size: 3, advance: 2, bo_group: 3, bo_ko: 3, bo_final: 5 }; }

export function validate(f) {
  const e = [];
  const int = (k, a, b) => { if (!Number.isInteger(f[k]) || f[k] < a || f[k] > b) e.push(`${k} ต้องเป็น ${a} ถึง ${b}`); };
  int("groups", ...LIMITS.groups); int("size", ...LIMITS.size); int("advance", 1, f.size || 1);
  ["bo_group", "bo_ko", "bo_final"].forEach((k) => { if (![1, 3, 5, 7].includes(f[k])) e.push(`${k} ต้องเป็น 1 3 5 หรือ 7`); });
  if (f.groups * f.size > LIMITS.teams) e.push(`ทีมรวมไม่เกิน ${LIMITS.teams}`);
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

export function build(f) {
  const G = f.groups, K = f.size, A = f.advance, teams = G * K;
  const L = (i) => String.fromCharCode(65 + i);
  const groups = [...Array(G).keys()].map((gi) => ({ grp: L(gi), stage: "r1", adv: A, srcs: [...Array(K).keys()].map((j) => ({ seed: gi * K + j + 1 })) }));
  // Group matches, interleaved across groups so no group plays twice in a row
  const rr = [];
  groups.forEach((g, gi) => roundRobin(K).forEach((p) => rr.push({ ...p, gi, g })));
  rr.sort((x, y) => x.r - y.r || x.i - y.i || x.gi - y.gi);
  const cnt = {}, matches = [];
  rr.forEach((p) => { cnt[p.g.grp] = (cnt[p.g.grp] || 0) + 1; matches.push({ code: p.g.grp + cnt[p.g.grp], stage: "r1", grp: p.g.grp, bo: f.bo_group, red_src: p.g.srcs[p.a], blue_src: p.g.srcs[p.b] }); });
  // Knockout
  const Q = [];
  for (let p = 1; p <= A; p++) for (let gi = 0; gi < G; gi++) Q.push({ g: L(gi), p });
  const N = Q.length;
  if (N >= 2) {
    let P = 2; while (P < N) P *= 2;
    let ent = seedOrder(P).map((s) => (s <= N ? Q[s - 1] : null));
    // Avoid two teams from the same group meeting in the first knockout round
    for (let k = 0; k < ent.length; k += 2) {
      const a = ent[k], b = ent[k + 1]; if (!a || !b || a.g !== b.g) continue;
      for (let j = 0; j < ent.length; j += 2) {
        if (j === k) continue; const c = ent[j], d = ent[j + 1]; if (!c || !d) continue;
        if (d.g !== a.g && b.g !== c.g) { ent[k + 1] = d; ent[j + 1] = b; break; }
      }
    }
    while (ent.length > 1) {
      const [stage, pre] = KO[ent.length], nx = []; let k = 0;
      for (let i = 0; i < ent.length; i += 2) {
        const a = ent[i], b = ent[i + 1];
        if (!b) { nx.push(a); continue; } if (!a) { nx.push(b); continue; }
        k++; const code = stage === "final" ? "F" : pre + k;
        matches.push({ code, stage, grp: null, bo: stage === "final" ? f.bo_final : f.bo_ko, red_src: a, blue_src: b });
        nx.push({ w: code });
      }
      ent = nx;
    }
  }
  matches.forEach((m, i) => (m.order_no = i + 1));
  return { format: { ...f, teams }, groups, matches };
}
