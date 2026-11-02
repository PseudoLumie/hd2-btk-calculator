/* 自检：node btk/engine.test.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('./engine.js');

const W = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/weapons.json'), 'utf8'));
const N = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/enemies.json'), 'utf8'));
const gun = (id) => W.find((w) => w.id === id);
const foe = (name) => N.find((e) => e.enemy === name) || N.find((e) => e.enemy === name + '（低难）');
const partOf = (enemy, part) => foe(enemy).parts.find((p) => p.part === part);

let pass = 0;
function ok(label, fn) {
  try { fn(); pass++; console.log('  ✓ ' + label); }
  catch (e) { console.log('  ✗ ' + label + '\n    ' + e.message); process.exitCode = 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} 期望≈${b}，实得 ${a}`);
const eq = (a, b, msg) => assert.strictEqual(a, b, msg);

console.log('\n[1] 距离衰减 —— AMW-20 官方补丁说明做外部锚点');
{
  const w = { drag: 0.1, caliber: 20, mass: 70, v0: 1500 };
  ok('口径 20：200 m 处 rd ≈ 92%', () => near(E.distanceFactor(w, 200), 0.923, 0.002));
  ok('口径 60（改前）：200 m 处 rd ≈ 53%', () => near(E.distanceFactor({ ...w, caliber: 60 }, 200), 0.534, 0.005));
}

console.log('\n[2] 耐久混算 —— wiki 原文例 BR-14 审判者');
{
  const w = gun('BR-14');
  const part = { av: 2, durability: 0.30 };
  ok('95×0.7 + 23×0.3 = 73.4，中间不取整', () => near(E.perShotDamage(w, part, 0), 73.4, 1e-9));
  ok('展示值向下取整为 73', () => eq(Math.floor(E.perShotDamage(w, part, 0)), 73));
}

console.log('\n[3] air_drag 实测样本 —— SG-8S 重炮手 10/20/38 m');
{
  const w = gun('SG-8S');
  ok('18mm / 50g / 阻力200% → α ≈ −6.10e−3', () => near(E.alpha(w), -6.104e-3, 1e-6));
  const r10 = E.distanceFactor(w, 10), r20 = E.distanceFactor(w, 20), r38 = E.distanceFactor(w, 38);
  console.log(`     算得：10 m ${(r10 * 100).toFixed(1)}%  20 m ${(r20 * 100).toFixed(1)}%  38 m ${(r38 * 100).toFixed(1)}%`);
  ok('10 m ≈ 90%', () => near(r10 * 100, 90, 2));
  ok('20 m ≈ 81%', () => near(r20 * 100, 81, 3));
  ok('38 m ≈ 71%', () => near(r38 * 100, 71, 2));
}

console.log('\n[4] 甲弹阈值 —— 阈值型，不是线性减伤');
{
  eq(E.penFactor(3, 2), 1, 'AP>AV 应 100%');
  eq(E.penFactor(2, 2), 0.65, 'AP=AV 应 65%');
  eq(E.penFactor(2, 3), 0, 'AP<AV 应 0');
  const w = gun('AR-23'), heavy = partOf('强袭虫', '主体');
  ok('AR-23(AP2) 打 AV4 主体 = 0（跳弹）', () => eq(E.perShotDamage(w, heavy, 0), 0));
  ok('打不穿时 BTK 为 ∞', () => eq(E.btkAt(w, heavy, foe('强袭虫'), 0).btk, Infinity));
}

console.log('\n[5] 致死部位 vs 非致死部位 —— 本次修正的核心');
{
  const ar = gun('AR-23'), wu = foe('武斗虫');

  ok('致死部位：打爆即死，不再要求清空主体（AR-23 打武斗虫头部 = 2 发）',
    () => eq(E.btkAt(ar, partOf('武斗虫', '头部'), wu, 0).btk, 2));
  ok('……且走的是「打爆致死部位」路径', () => eq(E.btkAt(ar, partOf('武斗虫', '头部'), wu, 0).path, 'part'));
  ok('……打爆后由流血收尾 200/70 ≈ 2.9 s',
    () => near(E.btkAt(ar, partOf('武斗虫', '头部'), wu, 0).bleedSec, 200 / 70, 1e-9));

  const peng = foe('蹂躏者');
  ok('wiki 战术信息「一记爆头消灭蹂躏者」：R-63 勤勉 = 1 发',
    () => eq(E.btkAt(gun('R-63'), partOf('蹂躏者', '头部'), peng, 0).btk, 1));
  ok('同上：P-113 裁决 = 1 发',
    () => eq(E.btkAt(gun('P-113'), partOf('蹂躏者', '头部'), peng, 0).btk, 1));
  ok('AR-23 打蹂躏者头部 = 2 发（110 / 76.4）',
    () => eq(E.btkAt(ar, partOf('蹂躏者', '头部'), peng, 0).btk, 2));

  // 非致死部位：部位被打爆后不再传导，所以先看「打爆前能不能传够」
  const arm = partOf('蹂躏者', '手臂(2)');
  eq(arm.fatal, false, '手臂应为非致死');
  ok('手臂只能摧毁，打不死本体（260 × 50% = 130 < 750）',
    () => eq(E.btkAt(ar, arm, peng, 0).path, 'destroy'));
  ok('摧毁手臂 = ceil(260 / 90) = 3 发', () => eq(E.btkAt(ar, arm, peng, 0).btk, 3));
  ok('摧毁路径没有「传导打死主体」这条路', () => eq(E.btkAt(ar, arm, peng, 0).byMain, null));
  ok('摧毁路径也不产生「致死部位」路径', () => eq(E.btkAt(ar, arm, peng, 0).byPart, null));

  // 强袭虫腿甲：用户点名的例子
  const leg = partOf('强袭虫', '前腿甲(2)');
  const apw = gun('APW-1');
  ok('强袭虫前腿甲：APW-1 单发 190.1，最多传导 800×60% = 480 < 2400',
    () => near(E.transmitPerShot(E.perPelletDamage(apw, leg, 0), leg), 190.125 * 0.6, 1e-6));
  ok('……因此只能报「摧毁腿甲」：ceil(800 / 190.125) = 5 发',
    () => eq(E.btkAt(apw, leg, foe('强袭虫'), 0).btk, 5));
  ok('……路径标记为 destroy', () => eq(E.btkAt(apw, leg, foe('强袭虫'), 0).path, 'destroy'));

  // 与主体共用生命池的部位（hp=null）不受此限：打爆它就是打死主体
  const flesh = partOf('强袭虫', '内部血肉');
  ok('内部血肉 hp=null → 300% 传导直通主体，可以打死',
    () => eq(E.btkAt(apw, flesh, foe('强袭虫'), 0).path, 'main'));
  ok('……ceil(2400 / (382.5×3)) = 3 发', () => eq(E.btkAt(apw, flesh, foe('强袭虫'), 0).btk, 3));

  // 两条路取较小者
  const torso = partOf('蹂躏者', '躯干');
  ok('AR-23(AP2) 打躯干 AV3 是跳弹 → ∞（护甲阈值优先于一切）',
    () => eq(E.btkAt(ar, torso, peng, 0).btk, Infinity));
  ok('换 APW-1(AP4)：躯干致死 425 → 2 发，比打死主体 750 的 3 发更快，取 2',
    () => eq(E.btkAt(gun('APW-1'), torso, peng, 0).btk, 2));
  ok('……且确实选了「打爆致死部位」这条', () => eq(E.btkAt(gun('APW-1'), torso, peng, 0).path, 'part'));
}

console.log('\n[6] 健康值 / 流血速度（§20）');
{
  const b = E.bleedInfo({ bleed: '750 [-100/s]' });
  ok('负号是「流失」写法，速率取绝对值 100', () => eq(b.rate, 100));
  ok('强袭虫主体：流血速度 100/s → 750 健康值 7.5 s',
    () => near(E.bleedSeconds({ hp: 2400, bleed: '750 [-100/s]' }), 7.5, 1e-9));
  ok('流血速度 0 时健康值算额外血量（霸王虫腹板 15,000+35,000）',
    () => eq(E.shootOutHp(partOf('霸王虫', '腹板装甲(前6)')), 50000));
  ok('流血速度 >0 时健康值不计入要打掉的血量（武斗虫头部 = 110）',
    () => eq(E.pools(partOf('武斗虫', '头部').hp, partOf('武斗虫', '头部').bleed).cripple, 110));
  ok('单次 100,000 伤害 → 主体只吃 5,000（传导上限）',
    () => eq(E.transmitPerShot(100000, partOf('霸王虫', '腹板装甲(前6)')), 5000));
}

console.log('\n[7] 取整只发生在最后一步');
{
  const arm = partOf('霸王虫', '腹板装甲(前6)');
  const w = { id: 'X', dmg: 9.7, dmg2: 9.7, ap: [9], caliber: 5, mass: 5, v0: 500, drag: 0, pellets: 1 };
  ok('浮点伤害不被中间取整', () => near(E.perShotDamage(w, arm, 0), 9.7, 1e-12));
  ok('传导保留浮点（0.97）', () => near(E.transmitPerShot(9.7, arm), 0.97, 1e-12));
}

console.log('\n[8] 阶梯与突变点自洽');
{
  const w = gun('APW-1'), e = foe('强袭虫'), part = partOf('强袭虫', '头部');
  ok('起点 7 发（1200 / 182.8）', () => eq(E.btkAt(w, part, e, 0).btk, 7));
  const rows = E.ladder(w, part, e, { maxS: 150, step: 0.5 });
  ok('阶梯单调不减', () => {
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].btk >= rows[i - 1].btk, `第 ${i} 段退化`);
  });
  ok('首段从 0 m 开始', () => eq(rows[0].from, 0));
  const bps = E.breakpoints(w, part, e, { maxS: 150 });
  ok('有突变点且升序', () => {
    assert.ok(bps.length >= 1, '至少一个突变点');
    for (let i = 1; i < bps.length; i++) assert.ok(bps[i].at >= bps[i - 1].at);
  });
  ok('每个突变点前后 BTK 确实变化', () => {
    for (const b of bps) {
      const before = E.btkAt(w, part, e, Math.max(0, b.at - 0.05)).btk;
      const after = E.btkAt(w, part, e, b.at + 0.05).btk;
      assert.ok(after > before, `@${b.at.toFixed(2)}m 未跳变 (${before}→${after})`);
    }
  });
  console.log(`     APW-1 打强袭虫头部 150 m 内突变点：` +
    bps.map((b) => `@${b.at.toFixed(1)}m ${b.from}→${b.to}发（${b.why}）`).join('，'));
}

console.log('\n[9] 数据集完整性');
{
  ok('武器数 ≥ 55', () => assert.ok(W.length >= 55, '只有 ' + W.length));
  ok('每把武器字段齐全', () => {
    for (const w of W) for (const f of ['id', 'name', 'cat', 'dmg', 'dmg2', 'ap', 'drag', 'pellets'])
      assert.ok(w[f] !== undefined && w[f] !== null, `${w.id} 缺 ${f}`);
  });
  ok('AP 四元组合法', () => {
    for (const w of W) {
      eq(w.ap.length, 4, w.id + ' AP 长度');
      for (const a of w.ap) assert.ok(a >= 0 && a <= 10, w.id + ' AP 越界');
    }
  });
  ok('每个敌人都有主体且 fatal', () => {
    for (const e of N) {
      const m = e.parts.find((p) => p.part === '主体');
      assert.ok(m, e.enemy + ' 无主体');
      assert.ok(e.mainHp > 0, e.enemy + ' mainHp 非法');
      eq(m.fatal, true, e.enemy + ' 主体应致死');
    }
  });
  ok('部位传导率合法（0–3）', () => {
    for (const e of N) for (const p of e.parts) {
      if (p.to_main == null) continue;
      assert.ok(p.to_main >= 0 && p.to_main <= 3, `${e.enemy}/${p.part} 传导率 ${p.to_main}`);
    }
  });
  ok('致死部位若无独立生命值则不应被判为可打爆（hp=null 时没有 part 路径）', () => {
    for (const e of N) for (const p of e.parts) {
      if (p.to_main == null || p.hp != null) continue;
      const r = E.btkAt(gun('AR-23'), p, e, 0);
      eq(r.byPart, null, `${e.enemy}/${p.part} 不该有 part 路径`);
    }
  });
}


console.log('\n[10] 多弹丸：击发次数 + 弹丸数');
{
  const w = gun('MGX-42'), e2 = foe('武斗虫'), p = partOf('武斗虫', '主体');
  ok('MGX-42 每次只出一颗：250 血需 3 颗 = 3 次击发', () => eq(E.btkAt(w, p, e2, 0).pelletsNeeded, 3));
  ok('……因此要 3 次击发（不是 1 次齐射）', () => eq(E.btkAt(w, p, e2, 0).shots, 3));
  const sg = gun('SG-8');
  ok('SG-8（9 弹丸，单颗 46.2 耐久混算）打武斗虫主体：1 次击发 / 6 颗', () => {
    const r = E.btkAt(sg, partOf('武斗虫', '主体'), foe('武斗虫'), 0);
    eq(r.shots, 1); eq(r.pelletsNeeded, 6);
  });
}

console.log('\n[11] 打残 / 打死（无票者）');
{
  const w = gun('AR-23'), e2 = foe('无票者（轻型）'), p = partOf('无票者（轻型）', '主体');
  const r = E.btkAt(w, p, e2, 0);
  ok('打残（清空 100 生命值、进入流血）= 2 次', () => eq(r.cripple.shots, 2));
  ok('彻底打死（100 + 100 健康值）= 3 次', () => eq(r.full.shots, 3));
  ok('主体流血 100/5 = 20 s', () => near(r.bleedSec, 20, 1e-9));
}

console.log('\n[12] 电弧：无衰减但有硬射程');
{
  const w = gun('ARC-12'), e2 = foe('蹂躏者'), p = partOf('蹂躏者', '头部');
  ok('ARC-12 一次 5 道弧，头部只需 3 颗 → 1 次击发', () => {
    const r = E.btkAt(w, p, e2, 0); eq(r.pelletsNeeded, 3); eq(r.shots, 1);
  });
  ok('25 m 内 BTK 不变（无衰减）', () => eq(E.btkAt(w, p, e2, 20).btk, E.btkAt(w, p, e2, 0).btk));
  ok('26 m 超出射程 → ∞', () => eq(E.btkAt(w, p, e2, 26).btk, Infinity));
}

console.log(`\n${process.exitCode ? '有失败项' : '全部通过'}：${pass} 项`);
