// 长夜灯 · 可达性自动校验（无死档证明）
//
// 原理：游戏内资源（道具/灯花/flag/已解谜题）只增不耗，所有门控都是「拥有即可过」的单调条件。
// 因此在固定剧情分支（大堂落名三选一）内，「贪心全拿」的不动点闭包就是该分支的可达上限，
// 任何真实通关路径的收获都是闭包的子集 —— 于是「某实体可达」⟺「它出现在某一分支的闭包中」。
// 对落名的 3 个选项各跑一次闭包，取并集后断言：
//   1. 全场景可达           2. 全谜题可解           3. 全部热点可见可点
//   4. 全部出口可通行       5. 四结局全部可达成      6. 数据静态一致性
import { readFileSync } from 'fs';

const html = readFileSync(new URL('../changye.html', import.meta.url), 'utf8');
const m = html.match(/<script id="game-data"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL  未找到 game-data JSON'); process.exit(1); }
const DATA = JSON.parse(m[1]);

const PZ = { ...DATA.puzzles, ...(DATA.usePuzzles || {}) };
const SCENES = Object.fromEntries(DATA.scenes.map(s => [s.id, s]));
const NAME_PZ = Object.keys(PZ).find(id => PZ[id].type === 'choice' && PZ[id].intro); // 落名（唯一互斥分支）
const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
};

/* ---------- 断言 6：静态一致性 ---------- */
{
  const errs = [];
  for (const s of DATA.scenes) for (const e of s.exits || []) {
    if (!SCENES[e.to]) errs.push(`出口 ${s.id}→${e.to} 目标不存在`);
    if (e.lockPuzzle && !PZ[e.lockPuzzle]) errs.push(`出口锁谜题 ${e.lockPuzzle} 不存在`);
  }
  for (const s of DATA.scenes) for (const p of s.puzzles || [])
    if (!PZ[p.id]) errs.push(`场景 ${s.id} 引用谜题 ${p.id} 不存在`);
  for (const [id, def] of Object.entries(PZ)) {
    const isStory = def.type === 'choice' && def.intro;
    if (!isStory && (!def.hints || !def.hints.length)) errs.push(`谜题 ${id} 无提示`);
    if (def.type === 'code' && (!def.accept || !def.accept.length)) errs.push(`谜题 ${id} 无答案`);
    if (def.type === 'order' && !def.seq && !def.groups) errs.push(`谜题 ${id} 缺少次序解`);
  }
  const lfs = [];
  for (const s of DATA.scenes) for (const h of s.hotspots || [])
    if (h.give && h.give.lantern) lfs.push(h.give.lantern.id);
  for (const [, def] of Object.entries(PZ)) {
    const src = [def.onSolve, ...(def.type === 'choice' && def.options ? def.options.filter(o => o.correct).map(o => o.give) : [])];
    for (const g of src) if (g && g.lantern) lfs.push(g.lantern.id);
  }
  if (lfs.length !== DATA.meta.lanternTotal) errs.push(`灯花 ${lfs.length} != ${DATA.meta.lanternTotal}`);
  if (new Set(lfs).size !== lfs.length) errs.push('灯花 id 重复');
  check('数据一致性（出口/谜题引用、提示、答案、灯花总数）', errs.length === 0, errs.join('；'));
}

/* ---------- 条件判定（与引擎同语义） ---------- */
const partOk = (r, st) =>
  (!r.items || r.items.every(i => st.items.has(i))) &&
  (!r.flags || r.flags.every(f => !!st.flags[f])) &&
  (!r.solved || r.solved.every(p => !!st.solved[p])) &&
  (!r.notes || r.notes.every(n => st.notes.has(n))) &&
  (!r.min_lanterns || st.lanterns.size >= r.min_lanterns);
const reqOk = (r, st) => !r ? true : (r.any ? r.any.some(x => partOk(x, st)) : partOk(r, st));

function grant(st, g) {
  if (!g) return false;
  let ch = false;
  const addItem = i => { if (!st.items.has(i)) { st.items.add(i); ch = true; } };
  if (g.item) addItem(g.item);
  if (g.items) g.items.forEach(addItem);
  if (g.flag && !st.flags[g.flag]) { st.flags[g.flag] = true; ch = true; }
  if (g.note && !st.notes.has(g.note.id)) { st.notes.add(g.note.id); ch = true; }
  if (g.lantern && !st.lanterns.has(g.lantern.id)) { st.lanterns.add(g.lantern.id); ch = true; }
  return ch;
}
function solvePuzzle(st, pid) {
  if (st.solved[pid]) return false;
  const def = PZ[pid];
  st.solved[pid] = true;
  let ch = grant(st, def.onSolve);
  if (def.type === 'choice') {
    const op = def.options.some(o => o.correct) ? def.options.find(o => o.correct) : null;
    if (op) { if (op.flag && !st.flags[op.flag]) { st.flags[op.flag] = true; ch = true; } ch = grant(st, op.give) || ch; }
  }
  return true;
}

/* ---------- 单分支单调闭包 ---------- */
function closure(nameOptionIdx) {
  const st = { items: new Set(), flags: {}, solved: {}, lanterns: new Set(), notes: new Set(), scenes: new Set(['road']) };
  const puzzleSeen = new Map(), hsSeen = new Map(), exitSeen = new Map(), ends = new Set();
  for (let round = 0; round < 50; round++) {
    let changed = false;
    for (const sid of [...st.scenes]) {
      const sc = SCENES[sid];
      for (const h of sc.hotspots || []) {
        const id = sid + '/' + h.id;
        const ok = reqOk(h.requires, st);
        hsSeen.set(id, (hsSeen.get(id) || false) || ok);
        if (ok) changed = grant(st, h.give) || changed;
      }
      const hosted = [...(sc.puzzles || []).map(p => p.id)];
      for (const e of sc.exits || []) if (e.lockPuzzle && !hosted.includes(e.lockPuzzle)) hosted.push(e.lockPuzzle);
      for (const pid of hosted) {
        const def = PZ[pid];
        let solvable;
        if (def.type === 'use') solvable = reqOk(def.requires, st);
        else if (def.type === 'choice') solvable = !def.showIf || reqOk(def.showIf, st);
        else solvable = true; // code/abacus/rotate/order 可机械试出（且有提示兜底）
        puzzleSeen.set(pid, (puzzleSeen.get(pid) || false) || solvable);
        if (!solvable || st.solved[pid]) continue;
        if (pid === NAME_PZ) {
          // 固定分支：只落本闭包对应的那个名字
          const op = def.options[nameOptionIdx];
          st.solved[pid] = true;
          if (op.flag) st.flags[op.flag] = true;
          grant(st, op.give);
          changed = true;
        } else {
          solvePuzzle(st, pid); changed = true;
        }
      }
      for (const e of sc.exits || []) {
        const id = sid + '→' + e.to;
        const ok = reqOk(e.requires, st);
        exitSeen.set(id, (exitSeen.get(id) || false) || ok);
        if (ok && !st.scenes.has(e.to)) { st.scenes.add(e.to); changed = true; }
      }
      if (sc.choices) for (const c of sc.choices)
        if (reqOk(c.requires, st)) ends.add(c.id);
    }
    if (!changed) break;
  }
  return { st, puzzleSeen, hsSeen, exitSeen, ends, scenes: st.scenes };
}

/* ---------- 三个落名分支各跑一次，取并 ---------- */
const runs = [0, 1, 2].map(closure);
const merge = (key) => {
  const out = new Map();
  for (const r of runs) for (const [k, v] of r[key]) out.set(k, (out.get(k) || false) || v);
  return out;
};
const scenesAll = new Set(runs.flatMap(r => [...r.scenes]));
const puzzleAll = merge('puzzleSeen'), hsAll = merge('hsSeen'), exitAll = merge('exitSeen');
const endsAll = new Set(runs.flatMap(r => [...r.ends]));

check('全场景可达（' + Object.keys(SCENES).length + ' 个）',
  Object.keys(SCENES).every(id => scenesAll.has(id)),
  Object.keys(SCENES).filter(id => !scenesAll.has(id)).join(','));

check('全谜题可解（' + Object.keys(PZ).length + ' 个）',
  Object.keys(PZ).every(id => puzzleAll.get(id)),
  Object.keys(PZ).filter(id => !puzzleAll.get(id)).join(','));

const hsBad = [...hsAll.entries()].filter(([, v]) => !v).map(([k]) => k);
check('全部热点可见可点（' + hsAll.size + ' 个）', hsBad.length === 0, hsBad.join(','));

const exBad = [...exitAll.entries()].filter(([, v]) => !v).map(([k]) => k);
check('全部出口可通行（' + exitAll.size + ' 条）', exBad.length === 0, exBad.join(','));

check('四结局全部可达成',
  Object.keys(DATA.endings).every(id => endsAll.has(id)),
  Object.keys(DATA.endings).filter(id => !endsAll.has(id)).join(','));

// 灯花 7/7 与真结局条件可同时成立（隐藏结局的可达性核心）
const keeper = DATA.endings.e_keeper ? true : false;
const best = runs.map(r => r.st).sort((a, b) => b.lanterns.size - a.lanterns.size)[0];
check('灯花可集齐 7/7 且真结局条件可同时成立',
  best.lanterns.size === DATA.meta.lanternTotal && partOk(PZ ? { items: ['painting', 'nameplate'], flags: ['knows_secret'] } : {}, best),
  `lanterns=${best.lanterns.size}`);

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过（落名三分支闭包并集）`);
process.exit(failed.length ? 1 : 0);
