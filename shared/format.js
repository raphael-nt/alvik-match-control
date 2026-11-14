// Flexible tournament format generator.
// Supports arbitrary sequences of group rounds (round robin, unequal group sizes and advances),
// optional knockout bracket (seed placement, 3rd place match, editable slots at every sub-round),
// and full custom groups/matches mode. Output is sent to a2_adm_format.

export const STAGE_EN = {
  r1: "Group stage", r2: "Round 2", r64: "Round of 64", r32: "Round of 32",
  r16: "Round of 16", qf: "Quarterfinal", sf: "Semifinal", third: "3rd place", final: "Final",
};
const KO = { 2: ["final", "F"], 4: ["sf", "SF"], 8: ["qf", "QF"], 16: ["r16", "R16-"], 32: ["r32", "R32-"], 64: ["r64", "R64-"] };
export const KO_ORDER = ["r64", "r32", "r16", "qf", "sf", "final"];
export const STAGE_CHOICES = ["r1", "r2", "r3", "r4", "r64", "r32", "r16", "qf", "sf", "third", "final"];
export const LIMITS = { groups: [0, 26], size: [2, 64], teams: 64, matches: 400, depth: 16 };
export const BOS = [1, 3, 5, 7];
const L = (i) => String.fromCharCode(65 + i);

export function stageLabel(st) {
  if (!st) return "";
  if (STAGE_EN[st]) return STAGE_EN[st];
  const m = /^r(\d+)$/.exec(st);
  return m ? `Round ${m[1]}` : st;
}

export const srcKey = (s) => (!s ? "" : s.seed ? "s" + s.seed : s.g ? s.g + s.p : s.w ? "w:" + s.w : s.l ? "l:" + s.l : "");
export function parseSrcKey(k) {
  if (!k) return null;
  let m;
  if ((m = /^s(\d+)$/.exec(k))) return { seed: +m[1] };
  if ((m = /^([A-Z])(\d+)$/.exec(k))) return { g: m[1], p: +m[2] };
  if ((m = /^w:([A-Z0-9-]{1,8})$/.exec(k))) return { w: m[1] };
  if ((m = /^l:([A-Z0-9-]{1,8})$/.exec(k))) return { l: m[1] };
  return null;
}

export function defaultKoRound(ov = {}) {
  const base = BOS.includes(+ov.bo_ko) ? +ov.bo_ko : 3;
  const fin = BOS.includes(+ov.bo_final) ? +ov.bo_final : 5;
  const rawBo = ov.bo_by_stage || {};
  const bo_by_stage = {};
  for (const st of ["r64", "r32", "r16", "qf", "sf", "third", "final"]) {
    const v = +rawBo[st];
    bo_by_stage[st] = BOS.includes(v) ? v : st === "final" ? fin : base;
  }
  return {
    id: "ko",
    type: "ko",
    third: !!ov.third,
    bo_by_stage,
    slots: Array.isArray(ov.slots) ? ov.slots.map((x) => x || "") : null,
    links: ov.links && typeof ov.links === "object" ? structuredClone(ov.links) : null,
  };
}

export function defaults() {
  return {
    teams: 9,
    rounds: [
      {
        id: "r1",
        type: "groups",
        bo: 3,
        groups: [
          { grp: "A", size: 3, adv: 2, srcs: null },
          { grp: "B", size: 3, adv: 2, srcs: null },
          { grp: "C", size: 3, adv: 2, srcs: null },
        ],
      },
      defaultKoRound({ bo_ko: 3, bo_final: 5, third: false }),
    ],
    customGroups: null,
    customMatches: null,
  };
}

// Re-letter all groups sequentially (A..Z) across group rounds so a2_group.grp stays unique
export function reletter(f) {
  let gi = 0, rNum = 0;
  f.rounds.forEach((r) => {
    if (r.type !== "groups") { r.id = "ko"; return; }
    rNum++;
    r.id = "r" + rNum;
    r.groups.forEach((g) => {
      g.grp = gi < 26 ? L(gi) : "?";
      gi++;
    });
  });
  return f;
}

// Accept legacy 009 format, v3-flex { mode, groups }, and canonical { rounds, customMatches }
export function normalize(f0) {
  if (!f0) return defaults();
  if (Array.isArray(f0.rounds)) {
    const rounds = [];
    let hasKo = false;
    for (const r of f0.rounds) {
      if (r?.type === "ko") {
        if (!hasKo) { rounds.push(defaultKoRound(r)); hasKo = true; }
      } else if (r?.type === "groups") {
        const groups = Array.isArray(r.groups) ? r.groups.map((g) => ({
          grp: String(g?.grp || "A"),
          size: Math.trunc(+(g?.size ?? 0)),
          adv: Math.trunc(+(g?.adv ?? 0)),
          srcs: Array.isArray(g?.srcs) ? g.srcs.map((x) => (typeof x === "string" ? x : srcKey(x))) : null,
        })) : [];
        rounds.push({ id: r.id || "r1", type: "groups", bo: BOS.includes(+r.bo) ? +r.bo : 3, groups });
      }
    }
    const f = {
      teams: Math.trunc(+f0.teams || 8),
      rounds,
      customGroups: Array.isArray(f0.customGroups)
        ? f0.customGroups.map((g) => ({
            grp: String(g?.grp || "").toUpperCase().slice(0, 1),
            stage: String(g?.stage || "r1"),
            adv: Math.trunc(+g?.adv || 0),
            srcs: Array.isArray(g?.srcs) ? g.srcs.map((x) => (typeof x === "string" ? x : srcKey(x))) : [],
          }))
        : null,
      customMatches: Array.isArray(f0.customMatches)
        ? f0.customMatches.map((m) => ({
            code: String(m?.code || "").toUpperCase().slice(0, 8),
            stage: String(m?.stage || "r1"),
            grp: m?.grp ? String(m.grp).toUpperCase().slice(0, 1) : null,
            bo: +m?.bo || 3,
            red: typeof m?.red === "string" ? m.red : srcKey(m?.red_src || m?.red),
            blue: typeof m?.blue === "string" ? m.blue : srcKey(m?.blue_src || m?.blue),
          }))
        : null,
      quick: f0.quick && typeof f0.quick === "object" ? { ...f0.quick } : null,
    };
    reletter(f);
    if (!f.customMatches && f.rounds[0]?.type === "groups") {
      const sum = f.rounds[0].groups.reduce((s, g) => s + (g.size > 0 ? g.size : 0), 0);
      if (sum > 0) f.teams = sum;
    }
    return f;
  }

  if (f0.mode === "ko") {
    return {
      teams: Math.trunc(+f0.teams || 8),
      rounds: [defaultKoRound(f0)],
      customGroups: null,
      customMatches: null,
    };
  }

  const rawGroups = Array.isArray(f0.groups)
    ? f0.groups.map((g) => ({ size: Math.trunc(+(g?.size ?? 0)), adv: Math.trunc(+(g?.adv ?? 0)), srcs: null }))
    : [...Array(Math.max(1, +f0.groups || 3))].map(() => ({ size: Math.trunc(+(f0?.size ?? 3)), adv: Math.trunc(+(f0?.advance ?? 2)), srcs: null }));
  const r1 = { id: "r1", type: "groups", bo: BOS.includes(+f0.bo_group) ? +f0.bo_group : 3, groups: rawGroups };
  const totAdv = rawGroups.reduce((s, g) => s + Math.max(0, g.adv), 0);
  const f = {
    teams: rawGroups.reduce((s, g) => s + Math.max(0, g.size), 0) || Math.trunc(+f0.teams || 8),
    rounds: totAdv >= 2 ? [r1, defaultKoRound(f0)] : [r1],
    customGroups: null,
    customMatches: null,
  };
  return reletter(f);
}

// Circle method for round robin : every team rests evenly, sides alternate
function roundRobin(n) {
  const ids = [...Array(n).keys()];
  if (n % 2) ids.push(-1);
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

// Standard bracket seed order : 1 meets lowest seed, top seeds meet as late as possible
function seedOrder(P) {
  let o = [1];
  while (o.length < P) {
    const s = o.length * 2;
    o = o.flatMap((x) => [x, s + 1 - x]);
  }
  return o;
}

// Qualifiers produced by a single group round, ordered best placement first
export function roundQualifiers(round) {
  const Q = [], maxA = Math.max(0, ...round.groups.map((g) => Math.max(0, +g.adv || 0)));
  for (let p = 1; p <= maxA; p++) {
    round.groups.forEach((g) => {
      if ((+g.adv || 0) >= p) Q.push({ g: g.grp, p });
    });
  }
  return Q;
}

// Teams entering the knockout round (from last group round, or seeds 1..teams if KO only)
export function qualifiers(f0) {
  const f = normalize(f0);
  const gRounds = f.rounds.filter((r) => r.type === "groups");
  if (!gRounds.length) return [...Array(Math.max(0, +f.teams || 0)).keys()].map((i) => ({ seed: i + 1 }));
  return roundQualifiers(gRounds[gRounds.length - 1]);
}

// Snake-seed qualifiers across next-round groups and swap pairs to avoid same-group rematches
export function autoGroupAssign(prevQuals, targetGroups) {
  const G = targetGroups.length;
  if (!G) return [];
  const cap = targetGroups.map((g) => Math.max(0, +g.size || 0));
  const buckets = targetGroups.map(() => []);
  let dir = 1, gi = 0;
  for (const q of prevQuals) {
    let guard = 0;
    while (buckets[gi].length >= cap[gi] && guard++ < G * 2) {
      const nx = gi + dir;
      if (nx < 0 || nx >= G) dir = -dir; else gi = nx;
    }
    if (buckets[gi].length >= cap[gi]) {
      const open = buckets.findIndex((b, idx) => b.length < cap[idx]);
      if (open < 0) break;
      gi = open;
    }
    buckets[gi].push(srcKey(q));
    const nx = gi + dir;
    if (nx < 0 || nx >= G) dir = -dir; else gi = nx;
  }
  const origin = (k) => parseSrcKey(k)?.g || "";
  const clashes = (arr) => {
    const seen = new Set(); let c = 0;
    for (const k of arr) { const o = origin(k); if (o && seen.has(o)) c++; if (o) seen.add(o); }
    return c;
  };
  let improved = true, iter = 0;
  while (improved && iter++ < 60) {
    improved = false;
    for (let a = 0; a < G; a++) {
      if (!clashes(buckets[a])) continue;
      for (let ia = 0; ia < buckets[a].length; ia++) {
        const ka = buckets[a][ia];
        if (buckets[a].filter((x) => origin(x) === origin(ka)).length < 2) continue;
        for (let b = 0; b < G; b++) {
          if (a === b) continue;
          for (let ib = 0; ib < buckets[b].length; ib++) {
            const kb = buckets[b][ib];
            const before = clashes(buckets[a]) + clashes(buckets[b]);
            buckets[a][ia] = kb; buckets[b][ib] = ka;
            const after = clashes(buckets[a]) + clashes(buckets[b]);
            if (after < before) { improved = true; break; }
            buckets[a][ia] = ka; buckets[b][ib] = kb;
          }
          if (improved) break;
        }
        if (improved) break;
      }
    }
  }
  return buckets;
}

// Compute effective per-group slot key arrays for group round at index rIdx in f.rounds
export function resolveRoundGroupSlots(f, rIdx) {
  const r = f.rounds[rIdx];
  if (!r || r.type !== "groups") return [];
  if (rIdx === 0) {
    let sd = 0;
    return r.groups.map((g) => [...Array(Math.max(0, +g.size || 0)).keys()].map(() => "s" + (++sd)));
  }
  const prevQuals = roundQualifiers(f.rounds[rIdx - 1]);
  const prevKeys = prevQuals.map(srcKey);
  const auto = autoGroupAssign(prevQuals, r.groups);
  const allCustom = r.groups.every((g, i) => Array.isArray(g.srcs) && g.srcs.length === g.size && g.srcs.every((k) => prevKeys.includes(k)));
  const flatCustom = allCustom ? r.groups.flatMap((g) => g.srcs) : [];
  if (allCustom && flatCustom.length === prevKeys.length && new Set(flatCustom).size === prevKeys.length) {
    return r.groups.map((g) => g.srcs.slice());
  }
  return auto;
}

export function autoSlotsForQuals(Q) {
  const N = Q.length;
  if (N < 2) return [];
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
export const autoSlots = (f0) => autoSlotsForQuals(qualifiers(f0));

function sameMultiset(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const map = new Map();
  a.forEach((x) => map.set(x, (map.get(x) || 0) + 1));
  for (const x of b) {
    const n = map.get(x) || 0;
    if (!n) return false;
    map.set(x, n - 1);
  }
  return true;
}

function koSlotError(slots, Q) {
  const keys = Q.map(srcKey);
  let P = 2; while (P < Q.length) P *= 2;
  const filled = slots.filter(Boolean);
  if (slots.length !== P) return "Knockout round 1 slots do not match bracket size, click Auto arrange";
  if (filled.length !== keys.length || new Set(filled).size !== filled.length || filled.some((k) => !keys.includes(k))) {
    return "Knockout round 1 must include each qualifying team once";
  }
  for (let i = 0; i < slots.length; i += 2) if (!slots[i] && !slots[i + 1]) return "Knockout pair cannot have Bye on both sides";
  return "";
}

// Compute KO matches AND per-sub-round editable stage descriptors
function compileKo(koRound, Q) {
  if (!koRound || Q.length < 2) return { matches: [], koStages: [] };
  const byKey = Object.fromEntries(Q.map((q) => [srcKey(q), q]));
  const autoKeys1 = autoSlotsForQuals(Q);
  const useSlots1 = Array.isArray(koRound.slots) && !koSlotError(koRound.slots, Q);
  let ent = (useSlots1 ? koRound.slots : autoKeys1).map((k) => (k ? byKey[k] : null));

  const out = [], koStages = [], sfCodes = [];
  let subIdx = 0;
  while (ent.length > 1) {
    const [stage, pre] = KO[ent.length], nx = [];
    const autoKeys = ent.map(srcKey);
    const customLinks = subIdx > 0 && koRound.links?.[stage];
    const useLinks = Array.isArray(customLinks) && sameMultiset(customLinks, autoKeys);
    const curKeys = useLinks ? customLinks.slice() : autoKeys;
    const curEnt = useLinks ? curKeys.map((k) => (k ? parseSrcKey(k) : null)) : ent;
    const stageCodes = [];
    let k = 0;

    for (let i = 0; i < curEnt.length; i += 2) {
      const a = curEnt[i], b = curEnt[i + 1];
      if (!b) { nx.push(a); stageCodes.push(null); continue; }
      if (!a) { nx.push(b); stageCodes.push(null); continue; }
      k++;
      const code = stage === "final" ? "F" : pre + k;
      stageCodes.push(code);
      if (stage === "final" && koRound.third && sfCodes.length === 2) {
        const auto3 = ["l:" + sfCodes[0], "l:" + sfCodes[1]];
        const c3 = koRound.links?.third;
        const u3 = Array.isArray(c3) && sameMultiset(c3, auto3);
        const k3 = u3 ? c3.slice() : auto3;
        koStages.push({ stage: "third", subIdx: subIdx + 1, label: stageLabel("third"), slots: k3, options: auto3, codes: ["3P"], custom: u3, bo: koRound.bo_by_stage.third || 3 });
        out.push({ code: "3P", stage: "third", grp: null, bo: koRound.bo_by_stage.third || 3, red_src: parseSrcKey(k3[0]), blue_src: parseSrcKey(k3[1]) });
      }
      out.push({ code, stage, grp: null, bo: koRound.bo_by_stage[stage] || (stage === "final" ? 5 : 3), red_src: a, blue_src: b });
      if (stage === "sf") sfCodes.push(code);
      nx.push({ w: code });
    }
    koStages.push({
      stage,
      subIdx,
      label: stageLabel(stage),
      slots: curKeys,
      options: subIdx === 0 ? Q.map(srcKey) : autoKeys,
      allowBye: subIdx === 0 && autoKeys1.length > Q.length,
      codes: stageCodes,
      custom: subIdx === 0 ? useSlots1 : useLinks,
      bo: koRound.bo_by_stage[stage] || (stage === "final" ? 5 : 3),
    });
    ent = nx;
    subIdx++;
  }
  return { matches: out, koStages };
}

// Compute DAG depth & detect cycles for customGroups + customMatches (database does 16 passes)
function dagError(groups, matches) {
  const byGrp = Object.fromEntries(groups.map((g) => [g.grp, g]));
  const mByGrp = {};
  matches.forEach((m) => { if (m.grp) (mByGrp[m.grp] = mByGrp[m.grp] || []).push(m.code); });
  const mByCode = Object.fromEntries(matches.map((m) => [m.code, m]));

  const srcDeps = (src) => {
    if (!src) return [];
    if (src.w) return [src.w];
    if (src.l) return [src.l];
    if (src.g) return mByGrp[src.g] || [];
    return [];
  };
  const matchDeps = (code) => {
    const m = mByCode[code];
    if (!m) return [];
    const deps = [...srcDeps(m.red_src), ...srcDeps(m.blue_src)];
    if (m.grp && byGrp[m.grp]) {
      for (const s of byGrp[m.grp].srcs || []) deps.push(...srcDeps(s));
    }
    return [...new Set(deps)];
  };

  const state = new Map(), memo = new Map();
  let maxDepth = 0;
  function dfs(code) {
    const st = state.get(code);
    if (st === 1) return Infinity;
    if (st === 2) return memo.get(code);
    state.set(code, 1);
    let best = 0;
    for (const d of matchDeps(code)) {
      const sub = dfs(d);
      if (sub === Infinity) return Infinity;
      if (sub > best) best = sub;
    }
    state.set(code, 2);
    memo.set(code, best + 1);
    return best + 1;
  }
  for (const m of matches) {
    const d = dfs(m.code);
    if (d === Infinity) return "Dependency cycle detected among matches/groups";
    if (d > maxDepth) maxDepth = d;
  }
  if (maxDepth > LIMITS.depth) return `Format exceeds max depth (${maxDepth} > ${LIMITS.depth} passes)`;
  return "";
}

export function validate(f0, built = null) {
  const f = normalize(f0), e = [];
  if (Array.isArray(f.customMatches)) {
    if (!Number.isInteger(f.teams) || f.teams < 2 || f.teams > LIMITS.teams) e.push(`Teams must be 2 to ${LIMITS.teams}`);
    const cGroups = f.customGroups || [];
    if (cGroups.length > 26) e.push("Maximum 26 groups (A to Z)");
    const grpSet = new Set(), grpMap = {};
    cGroups.forEach((g, idx) => {
      if (!/^[A-Z]$/.test(g.grp)) e.push(`Group row ${idx + 1} : letter must be A to Z`);
      else if (grpSet.has(g.grp)) e.push(`Duplicate group letter ${g.grp}`);
      else { grpSet.add(g.grp); grpMap[g.grp] = g; }
      if (!/^[a-z0-9]{1,8}$/.test(g.stage)) e.push(`Group ${g.grp || idx + 1} : invalid stage`);
      if (!Number.isInteger(g.adv) || g.adv < 0 || g.adv > g.srcs.length) e.push(`Group ${g.grp || idx + 1} : advance must be 0 to ${g.srcs.length}`);
      if (!g.srcs.length) e.push(`Group ${g.grp || idx + 1} : needs at least 1 team slot`);
    });
    if (!f.customMatches.length || f.customMatches.length > LIMITS.matches) e.push(`Matches must be 1 to ${LIMITS.matches}`);
    const codeSet = new Set();
    f.customMatches.forEach((m, idx) => {
      if (!/^[A-Z0-9-]{1,8}$/.test(m.code)) e.push(`Match row ${idx + 1} : code must be 1 to 8 chars (A-Z, 0-9, -)`);
      else if (codeSet.has(m.code)) e.push(`Duplicate match code ${m.code}`);
      else codeSet.add(m.code);
      if (!BOS.includes(+m.bo)) e.push(`Match ${m.code || idx + 1} : Bo must be 1, 3, 5 or 7`);
      if (!/^[a-z0-9]{1,8}$/.test(m.stage)) e.push(`Match ${m.code || idx + 1} : invalid stage`);
      if (m.grp && !grpMap[m.grp]) e.push(`Match ${m.code || idx + 1} : unknown group ${m.grp}`);
    });
    const checkSrc = (lbl, key, ownerCode) => {
      const s = parseSrcKey(key);
      if (!s) return `${lbl} : missing or invalid source`;
      if (s.seed && (s.seed < 1 || s.seed > f.teams)) return `${lbl} : Seed ${s.seed} out of range 1 to ${f.teams}`;
      if (s.g) {
        const tg = grpMap[s.g];
        if (!tg) return `${lbl} : group ${s.g} does not exist`;
        if (s.p < 1 || s.p > tg.srcs.length) return `${lbl} : place ${s.p} out of range for Group ${s.g}`;
      }
      if (s.w && (!codeSet.has(s.w) || s.w === ownerCode)) return `${lbl} : unknown match ${s.w}`;
      if (s.l && (!codeSet.has(s.l) || s.l === ownerCode)) return `${lbl} : unknown match ${s.l}`;
      return "";
    };
    if (!e.length) {
      cGroups.forEach((g) => g.srcs.forEach((k, si) => { const err = checkSrc(`Group ${g.grp} slot ${si + 1}`, k, ""); if (err) e.push(err); }));
      f.customMatches.forEach((m) => {
        const er = checkSrc(`Match ${m.code} Red`, m.red, m.code); if (er) e.push(er);
        const eb = checkSrc(`Match ${m.code} Blue`, m.blue, m.code); if (eb) e.push(eb);
        if (!er && !eb && m.red === m.blue) e.push(`Match ${m.code} : Red and Blue cannot be the same source`);
      });
    }
    if (!e.length) {
      const gBuilt = cGroups.map((g) => ({ grp: g.grp, stage: g.stage, adv: g.adv, srcs: g.srcs.map(parseSrcKey) }));
      const mBuilt = f.customMatches.map((m) => ({ code: m.code, stage: m.stage, grp: m.grp || null, bo: m.bo, red_src: parseSrcKey(m.red), blue_src: parseSrcKey(m.blue) }));
      const de = dagError(gBuilt, mBuilt); if (de) e.push(de);
    }
    return e;
  }

  // Standard multi-round builder validation
  if (!f.rounds.length) { e.push("Add at least one Group round or Knockout round"); return e; }
  const gRounds = f.rounds.filter((r) => r.type === "groups");
  const totalGroups = gRounds.reduce((s, r) => s + r.groups.length, 0);
  if (totalGroups > 26) e.push("Maximum 26 groups total (A to Z)");

  f.rounds.forEach((r, idx) => {
    if (r.type === "groups") {
      if (!BOS.includes(+r.bo)) e.push(`${stageLabel(r.id)} : Bo must be 1, 3, 5 or 7`);
      if (!r.groups.length) e.push(`${stageLabel(r.id)} : needs at least 1 group`);
      r.groups.forEach((g) => {
        if (!Number.isInteger(g.size) || g.size < LIMITS.size[0] || g.size > LIMITS.size[1]) e.push(`Group ${g.grp} : teams must be ${LIMITS.size[0]} to ${LIMITS.size[1]}`);
        if (!Number.isInteger(g.adv) || g.adv < 0 || g.adv > g.size) e.push(`Group ${g.grp} : advance must be 0 to ${g.size}`);
      });
      const rSize = r.groups.reduce((s, g) => s + (g.size > 0 ? g.size : 0), 0);
      if (idx === 0) {
        if (rSize < 2 || rSize > LIMITS.teams) e.push(`Total teams in Round 1 must be 2 to ${LIMITS.teams}`);
      } else {
        const prev = f.rounds[idx - 1];
        const prevQ = roundQualifiers(prev);
        if (prevQ.length < 2) e.push(`${stageLabel(prev.id)} must advance at least 2 teams to feed ${stageLabel(r.id)}`);
        else if (rSize !== prevQ.length) e.push(`${stageLabel(r.id)} has ${rSize} slots, must equal ${prevQ.length} advancing teams from ${stageLabel(prev.id)}`);
        const hasCustom = r.groups.some((g) => Array.isArray(g.srcs));
        if (hasCustom && rSize === prevQ.length) {
          const prevKeys = prevQ.map(srcKey);
          const flat = r.groups.flatMap((g) => (Array.isArray(g.srcs) ? g.srcs : []));
          if (flat.length !== prevKeys.length || new Set(flat).size !== prevKeys.length || flat.some((k) => !prevKeys.includes(k))) {
            e.push(`${stageLabel(r.id)} manual slots must include each qualifying team once`);
          }
        }
      }
    } else if (r.type === "ko") {
      if (!gRounds.length && (!Number.isInteger(f.teams) || f.teams < 2 || f.teams > LIMITS.teams)) {
        e.push(`Teams must be 2 to ${LIMITS.teams}`);
      }
      for (const st of Object.keys(r.bo_by_stage)) {
        if (!BOS.includes(+r.bo_by_stage[st])) { e.push(`Knockout ${stageLabel(st)} : Bo must be 1, 3, 5 or 7`); break; }
      }
      const Q = qualifiers(f);
      if (Q.length < 2) e.push(`Knockout requires at least 2 advancing teams (got ${Q.length})`);
      else if (r.slots) {
        const err = koSlotError(r.slots, Q);
        if (err) e.push(err);
      }
    }
  });

  if (!e.length) {
    const b = built || build(f);
    if (b.matches.length < 1 || b.matches.length > LIMITS.matches) e.push(`Total matches must be 1 to ${LIMITS.matches} (got ${b.matches.length})`);
    const de = dagError(b.groups, b.matches);
    if (de) e.push(de);
  }
  return e;
}

// Expand a group's matches using circle-method round-robin ordering
export function buildGroupMatches(grp, stage, srcs, bo) {
  return roundRobin(srcs.length).map((p, idx) => ({
    ...p,
    code: grp + (idx + 1),
    stage,
    grp,
    bo,
    red_src: srcs[p.a],
    blue_src: srcs[p.b],
  }));
}

export function build(f0) {
  const f = normalize(f0);
  if (Array.isArray(f.customMatches)) {
    const groups = (f.customGroups || []).map((g) => ({
      grp: g.grp,
      stage: g.stage,
      adv: g.adv,
      srcs: g.srcs.map(parseSrcKey).filter(Boolean),
    }));
    const matches = f.customMatches.map((m, i) => ({
      code: m.code,
      stage: m.stage,
      grp: m.grp || null,
      order_no: i + 1,
      bo: +m.bo || 3,
      red_src: parseSrcKey(m.red) || {},
      blue_src: parseSrcKey(m.blue) || {},
    }));
    return { format: { ...f }, groups, matches, koStages: [] };
  }

  const groups = [], matches = [];
  let koStages = [];
  f.rounds.forEach((r, rIdx) => {
    if (r.type === "groups") {
      const roundBuckets = resolveRoundGroupSlots(f, rIdx);
      const rGroups = [];
      r.groups.forEach((g, gi) => {
        const srcs = (roundBuckets[gi] || []).map(parseSrcKey);
        const entry = { grp: g.grp, stage: r.id, adv: g.adv, srcs };
        groups.push(entry);
        rGroups.push(entry);
      });
      // Interleave matches across groups within this round so groups rotate cleanly
      const rr = [];
      rGroups.forEach((g, gi) => roundRobin(g.srcs.length).forEach((p) => rr.push({ ...p, gi, g })));
      rr.sort((x, y) => x.r - y.r || x.i - y.i || x.gi - y.gi);
      const cnt = {};
      rr.forEach((p) => {
        cnt[p.g.grp] = (cnt[p.g.grp] || 0) + 1;
        matches.push({ code: p.g.grp + cnt[p.g.grp], stage: r.id, grp: p.g.grp, bo: r.bo, red_src: p.g.srcs[p.a], blue_src: p.g.srcs[p.b] });
      });
    } else if (r.type === "ko") {
      const Q = qualifiers(f);
      const ko = compileKo(r, Q);
      koStages = ko.koStages;
      matches.push(...ko.matches);
    }
  });
  matches.forEach((m, i) => (m.order_no = i + 1));
  return { format: { ...f }, groups, matches, koStages };
}

// Convert current format (auto or already custom) into editable customGroups + customMatches
export function materializeCustom(f0) {
  const f = normalize(f0);
  if (Array.isArray(f.customMatches)) return f;
  const b = build(f);
  return {
    ...f,
    customGroups: b.groups.map((g) => ({ grp: g.grp, stage: g.stage, adv: g.adv, srcs: g.srcs.map(srcKey) })),
    customMatches: b.matches.map((m) => ({
      code: m.code,
      stage: m.stage,
      grp: m.grp || null,
      bo: m.bo,
      red: srcKey(m.red_src),
      blue: srcKey(m.blue_src),
    })),
  };
}
