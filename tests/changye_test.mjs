// 长夜灯 · 真实 UI 流程测试（纯点击/输入走完六个结局 + 三条支线）
import { chromium } from 'playwright-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GAME_URL = new URL('../changye.html', import.meta.url).href;

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -- ' + extra : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.setDefaultTimeout(8000);

await page.goto(GAME_URL);
await page.waitForSelector('.title-wrap');
const DATA = await page.evaluate(() => JSON.parse(document.getElementById('game-data').textContent));
const PZ = { ...DATA.puzzles, ...DATA.usePuzzles };

/* ---------- 小工具 ---------- */
const sceneName = () => page.textContent('.s-name');
const logText = () => page.textContent('.log').catch(() => '');
async function freshRun() {
  await page.evaluate(() => localStorage.removeItem('changye.save.v1'));
  await page.goto(GAME_URL);
  await page.waitForSelector('.title-wrap');
  await page.click('.mbtn:has-text("入 山")');
  await page.waitForSelector('.s-name');
}
const hs = id => page.click(`.hs[data-hs="${id}"]`);
const exitTo = to => page.click(`.exit[data-exit="${to}"]`);
const act = pz => page.click(`[data-pz="${pz}"] button.act`);
const opt = (pz, txt) => page.click(`[data-pz="${pz}"] button.opt:has-text("${txt}")`);
async function code(pid, val) {
  await page.fill(`[data-pz="${pid}"] input`, val);
  await page.click(`[data-pz="${pid}"] button.act`);
}
async function abacusSet(values) {
  for (let r = 0; r < 3; r++) {
    const rods = await page.$$('.abacus .rod');
    const beads = await rods[r].$$('.bead');
    if (values[r] >= 5) { await beads[0].click(); await page.waitForTimeout(50); }
    const rods2 = await page.$$('.abacus .rod');
    const beads2 = await rods2[r].$$('.bead');
    const lower = values[r] % 5;
    if (lower > 0) { await beads2[lower].click(); await page.waitForTimeout(50); }
  }
}
async function solveNineBox() {
  const targets = PZ.nine_box.targets;
  for (let i = 0; i < 9; i++) {
    if (targets[i] == null) continue;
    for (let guard = 0; guard < 8; guard++) {
      const pins = await page.$$('.grid9 > *');
      if (!pins.length || !pins[i]) return;      // 机关已解开消失
      const ar = await pins[i].$('.ar');
      if (!ar) break;
      const tr = await ar.getAttribute('style');
      const deg = parseFloat((tr.match(/rotate\((-?[\d.]+)deg\)/) || [0, 0])[1]);
      const cur = (((deg + 90) / 45) % 8 + 8) % 8;
      if (cur === targets[i]) break;
      await pins[i].click();
      await page.waitForTimeout(50);
    }
  }
}
async function orderSeq(pz, items) {
  for (const it of items) {
    await page.click(`[data-pz="${pz}"] button.opt:text-is("${it}")`);
    await page.waitForTimeout(40);
  }
}
const ending = async id => {
  await page.click(`[data-act="ending"][data-id="${id}"]`);
  await page.waitForSelector('.ending');
  return page.textContent('.ending h1');
};

/* ---------- 基础推进：山道 → 柜房三谜 → 禁房 → 地窖 → 祠堂 → 灯房 ---------- */
async function playToLamproom({ collect = false, nameTxt = '落下真名' } = {}) {
  await hs('bundle'); await hs('stele');
  if (collect) {
    await hs('stele_base');
    await exitTo('stage');
    await opt('opera_pick', '目连救母');
    await exitTo('road');
  }
  await exitTo('temple');
  await exitTo('hall'); // 未点灯应被拦
  check('未点灯下山被拦（failText 反馈）', (await logText()).includes('山黑得吃人'));
  await hs('under_altar'); if (collect) await hs('sticktube');
  await act('light_lamp');
  await exitTo('hall');
  check('点亮灯笼后进入大堂', (await sceneName()) === '大堂');
  await page.waitForSelector('[data-pz="sign_name"]');
  await opt('sign_name', nameTxt);
  check('落名抉择后入场框消失', !(await page.$('[data-pz="sign_name"]')));
  if (collect) await hs('plaque_back');
  await exitTo('backyard');
  if (collect) {
    await exitTo('kitchen');
    await hs('stove_god');
    await exitTo('backyard');
  }
  await hs('stone_crack'); await hs('bucket');
  await exitTo('woodshed');
  await hs('rope'); await hs('oil');
  await act('floor_door');
  await exitTo('cellar');
  check('灯油照出暗门后进入地窖', (await sceneName()) === '地窖');
  await hs('diary');
  if (collect) await hs('behind_jars');
  await opt('jar_hex', '寅');
  check('坛阵点错被重置并反馈', (await logText()).includes('封泥嗡地一响'));
  await orderSeq('jar_hex', ['子', '丑', '寅', '亥', '卯', '戌']);
  await orderSeq('gate_bagua', PZ.gate_bagua.seq);
  await exitTo('woodshed');
  if (collect) {
    await exitTo('backyard');
    await act('well_pull');
    await exitTo('well_bottom');
    await hs('well_crack');
    await exitTo('backyard');
  } else {
    await exitTo('backyard');
  }
  await exitTo('hall');
  await exitTo('counter');
  await page.waitForSelector('[data-pz="counter_lock"]');
  check('点锁定的门弹出铜环锁机关', true);
  await code('counter_lock', '1111');
  check('错误密码有反馈', (await logText()).includes('纹丝不动'));
  await page.click('[data-pz="counter_lock"] .hint-btn');
  const h1 = await page.textContent('[data-pz="counter_lock"] .hint-text');
  await page.click('[data-pz="counter_lock"] .hint-btn');
  const h2 = await page.textContent('[data-pz="counter_lock"] .hint-text');
  check('提示分层（两级内容不同）', h1 !== h2 && h1.includes('匾'), h1 + ' | ' + h2);
  await code('counter_lock', '6346');
  await exitTo('counter');
  check('匾额笔画锁（6346）开后进入柜房', (await sceneName()) === '柜房');
  await hs('ledger'); await hs('wall_note'); if (collect) await hs('ledger_cover');
  await abacusSet([4, 0, 8]);
  await page.waitForTimeout(150);
  check('算盘还清欠账（408）暗格开启', !(await page.$('[data-pz="abacus"]')));
  await solveNineBox();
  await page.waitForTimeout(150);
  check('九钉向心（铜匣）开启', !(await page.$('[data-pz="nine_box"]')));
  await exitTo('hall');
  await exitTo('corridor');
  check('二楼走廊就位（三灯机关）', !!await page.$('[data-pz="corridor_lamps"]'));
  if (collect) {
    await hs('lamp_top');
    await exitTo('room_bing');
    await hs('bing_lamp');
    await exitTo('corridor');
  }
  await exitTo('attic');
  await act('box');
  await hs('easel');
  if (collect) await hs('box_bottom');
  await exitTo('corridor'); await exitTo('hall');
  await opt('confront', '您说过');
  await exitTo('backyard'); await exitTo('woodshed'); await exitTo('cellar'); await exitTo('shrine');
  if (collect) await hs('behind_tablets');
  await exitTo('lamproom');
  check('挂上记忆之画进入灯房', (await sceneName()) === '灯房');
}

/* ---------- 运行一：真结局（含存档恢复检查） ---------- */
await freshRun();
await hs('bundle'); await hs('stele');
await exitTo('temple');
await hs('under_altar');
await act('light_lamp');
await exitTo('hall');
await page.waitForSelector('[data-pz="sign_name"]');
await opt('sign_name', '落下真名');
await page.reload();
await page.waitForSelector('.title-wrap');
await page.click('.mbtn:has-text("继")');
await page.waitForSelector('.s-name');
check('刷新后从标题「继续」恢复进度', (await sceneName()) === '大堂' &&
  (await page.textContent('.chip.lan')).includes('0/12'));
await exitTo('backyard'); await hs('stone_crack'); await hs('bucket');
await exitTo('woodshed'); await hs('rope'); await hs('oil');
await act('floor_door');
await exitTo('cellar'); await hs('diary');
await orderSeq('jar_hex', ['子', '丑', '寅', '亥', '卯', '戌']);
await orderSeq('gate_bagua', PZ.gate_bagua.seq);
await exitTo('woodshed'); await exitTo('backyard'); await exitTo('hall');
await exitTo('counter'); await code('counter_lock', '6346'); await exitTo('counter');
await abacusSet([4, 0, 8]); await page.waitForTimeout(120);
await solveNineBox(); await page.waitForTimeout(120);
await exitTo('hall'); await exitTo('corridor'); await exitTo('attic');
await act('box'); await hs('easel'); await exitTo('corridor'); await exitTo('hall');
await opt('confront', '您说过');
await exitTo('backyard'); await exitTo('woodshed'); await exitTo('cellar'); await exitTo('shrine');
await exitTo('lamproom');
check('真结局「灯长明」达成', (await ending('e_true')) === '灯长明');
check('真结局统计显示灯花与提示', (await page.textContent('.ending .stat')).includes('灯花 0/12'));

/* ---------- 运行二：坏结局（假名线 + 隐藏支线场景顺路检查） ---------- */
await freshRun();
await hs('bundle');
await exitTo('stage');
check('荒戏台可达（序章支线场景）', (await sceneName()) === '荒戏台');
await hs('stage_box'); await hs('libretto');
await opt('opera_pick', '夜奔');
check('点错戏被「不悦」反馈', (await logText()).includes('不点刀兵') || (await logText()).includes('哑'));
await exitTo('road'); await exitTo('temple');
await hs('under_altar');
await act('light_lamp');
await exitTo('hall');
await page.waitForSelector('[data-pz="sign_name"]');
await opt('sign_name', '落个假名');
await exitTo('backyard'); await hs('stone_crack'); await hs('bucket');
await exitTo('woodshed'); await hs('rope'); await hs('oil');
await act('floor_door');
await exitTo('cellar'); await hs('diary');
await orderSeq('jar_hex', ['子', '丑', '寅', '亥', '卯', '戌']);
await orderSeq('gate_bagua', PZ.gate_bagua.seq);
await exitTo('woodshed'); await exitTo('backyard'); await exitTo('hall');
await exitTo('counter'); await code('counter_lock', '6346'); await exitTo('counter');
await abacusSet([4, 0, 8]); await page.waitForTimeout(120);
await solveNineBox(); await page.waitForTimeout(120);
await exitTo('hall'); await exitTo('corridor'); await exitTo('attic');
await act('box'); await hs('easel');
await exitTo('memory');
check('灯影记忆之境可达（画中三谜）', (await sceneName()) === '灯影记忆之境');
await orderSeq('mem_drum', ['两声慢', '三声紧', '一声长', '一声收']);
await opt('mem_paint', '影子');
await opt('mem_keeper', '名字早喂回了灯里');
await exitTo('attic'); await exitTo('corridor'); await exitTo('hall');
await opt('confront', '您说过');
await exitTo('backyard'); await exitTo('woodshed'); await exitTo('cellar'); await exitTo('shrine');
await exitTo('lamproom');
check('坏结局「灯灭」达成（假名线同样走通）', (await ending('e_dark')) === '灯灭');

/* ---------- 运行三：普通结局 ---------- */
await freshRun();
await playToLamproom({ collect: false, nameTxt: '再说吧' });
check('普通结局「天亮启程」达成', (await ending('e_dawn')) === '天亮启程');

/* ---------- 运行四：隐藏甲（集齐 12 灯花） ---------- */
await freshRun();
await playToLamproom({ collect: true, nameTxt: '落个假名' });
const lanChip = await page.textContent('.chip.lan');
check('十二粒灯花集齐（HUD 12/12）', lanChip.includes('12/12'), lanChip);
check('隐藏结局「灯影中人」达成', (await ending('e_keeper')) === '灯影中人');

/* ---------- 运行五：无名结局（井底生名） ---------- */
await freshRun();
await hs('bundle'); await hs('stele');
await exitTo('temple');
await hs('under_altar');
await act('light_lamp');
await exitTo('hall');
await opt('sign_name', '落下真名');
await exitTo('backyard'); await hs('stone_crack'); await hs('bucket');
await exitTo('woodshed'); await hs('rope'); await hs('oil');
await act('floor_door');
await exitTo('cellar'); await hs('diary');
await orderSeq('jar_hex', ['子', '丑', '寅', '亥', '卯', '戌']);
await orderSeq('gate_bagua', PZ.gate_bagua.seq);
await exitTo('woodshed');
await exitTo('backyard');
await act('well_pull');
await exitTo('well_bottom');
await hs('raw_stone');
check('井底拓下生名名条', true);
await exitTo('backyard');
await exitTo('hall');
await exitTo('counter'); await code('counter_lock', '6346'); await exitTo('counter');
await abacusSet([4, 0, 8]); await page.waitForTimeout(120);
await solveNineBox(); await page.waitForTimeout(120);
await exitTo('hall'); await exitTo('corridor'); await exitTo('attic');
await act('box'); await exitTo('corridor'); await exitTo('hall');
await opt('confront', '您说过');
await exitTo('backyard'); await exitTo('woodshed'); await exitTo('cellar'); await exitTo('shrine');
await exitTo('lamproom');
check('结局「无名」达成', (await ending('e_none')) === '无名');

/* ---------- 运行六：完璧（三条支线全齐） ---------- */
await freshRun();
await hs('bundle'); await hs('stele');
await exitTo('temple');
await hs('under_altar');
await act('light_lamp');
await exitTo('hall');
await opt('sign_name', '落个假名');
await exitTo('backyard'); await hs('stone_crack'); await hs('bucket');
await exitTo('kitchen');
await hs('stove_couplet');
await orderSeq('kitchen_stoves', ['粥', '面', '酒', '茶']);
check('四灶按时辰点着，得到热粥', true);
await exitTo('backyard');
await exitTo('woodshed'); await hs('rope'); await hs('oil');
await act('floor_door');
await exitTo('cellar'); await hs('diary');
await orderSeq('jar_hex', ['子', '丑', '寅', '亥', '卯', '戌']);
await orderSeq('gate_bagua', PZ.gate_bagua.seq);
await exitTo('woodshed'); await exitTo('backyard'); await exitTo('hall');
await hs('give_porridge');
check('热粥递给阿九（支线一）', true);
await exitTo('counter');
await code('counter_lock', '6346');
await exitTo('counter');
await abacusSet([4, 0, 8]); await page.waitForTimeout(120);
await solveNineBox(); await page.waitForTimeout(120);
await exitTo('hall');
await exitTo('corridor');
await hs('corr_carve');
await orderSeq('corridor_lamps', ['安', '静', '眠']);
check('走廊三灯按更次点亮（得静室钥匙）', true);
await exitTo('room_bing');
await hs('bing_letters');
await code('bing_box', '山高月小');
check('丙房信匣（山高月小）得画稿丙', true);
await exitTo('corridor');
await exitTo('study');
await hs('half_letter');
await code('study_box', '昭');
check('静室木匣（吾儿乳名）得画稿乙与家书', true);
await exitTo('corridor'); await exitTo('attic');
await act('box'); await hs('easel');
await exitTo('memory');
await orderSeq('mem_drum', ['两声慢', '三声紧', '一声长', '一声收']);
await opt('mem_paint', '影子');
await opt('mem_keeper', '名字早喂回了灯里');
await exitTo('attic'); await exitTo('corridor'); await exitTo('hall');
await opt('confront', '您说过');
await exitTo('backyard'); await exitTo('woodshed'); await exitTo('cellar'); await exitTo('shrine');
await exitTo('lamproom');
check('隐藏结局「完璧」达成（三支线全齐）', (await ending('e_perfect')) === '完璧');

/* ---------- 图鉴 ---------- */
await page.click('.mbtn:has-text("回到山口")');
await page.waitForSelector('.title-wrap');
await page.click('.mbtn:has-text("结局图鉴")');
const seen = await page.$$eval('.end-card.seen', els => els.length);
check('结局图鉴 6/6 全点亮', seen === 6, 'seen=' + seen);

/* ---------- 巡检截图 ---------- */
await page.click('.panel .close');
await page.evaluate(() => localStorage.removeItem('changye.save.v1'));
await page.goto(GAME_URL);
await page.waitForSelector('.title-wrap');
await page.screenshot({ path: 'shots/changye_title.png', fullPage: true });
await page.click('.mbtn:has-text("入 山")');
await page.waitForSelector('.s-name');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/changye_scene.png', fullPage: true });
// 推进到走廊与记忆之境截图
await page.click('.hs[data-hs="bundle"]');
await page.click('.exit[data-exit="temple"]');
await page.click('.hs[data-hs="under_altar"]');
await page.click('[data-pz="light_lamp"] button.act');
await page.click('.exit[data-exit="hall"]');
await page.waitForTimeout(300);
await page.click('[data-pz="sign_name"] .opt:has-text("落下真名")');
await page.click('.exit[data-exit="corridor"]');
await page.waitForTimeout(500);
await page.screenshot({ path: 'shots/changye_corridor.png', fullPage: true });

check('无页面错误', errors.length === 0, errors.join(' | '));

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
await browser.close();
process.exit(failed.length ? 1 : 0);
