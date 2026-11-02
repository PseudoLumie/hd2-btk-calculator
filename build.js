/* 构建脚本
 *   node btk/build.js
 *
 * 产出两个文件：
 *   1. btk/data.js      —— data/*.json 打包成 script，供 index.html 开发时引入
 *   2. btk/HD2-BTK计算器.html —— 单文件分发版：把 data.js + engine.js 全部内联进 HTML
 *                                （双击即用，不依赖任何外部文件，可随意拷贝/发人）
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'data');
const weapons = JSON.parse(fs.readFileSync(path.join(dir, 'weapons.json'), 'utf8'));
const enemies = JSON.parse(fs.readFileSync(path.join(dir, 'enemies.json'), 'utf8'));

// 武器排序：类别顺序固定，类内按 id
const catOrder = ['突击步枪', '冲锋枪', '精确射手', '狙击', '手枪', '霰弹枪', '支援武器'];
weapons.sort((a, b) => {
  const ca = catOrder.indexOf(a.cat), cb = catOrder.indexOf(b.cat);
  if (ca !== cb) return ca - cb;
  return a.id.localeCompare(b.id, 'en');
});

const parts = enemies.reduce((n, e) => n + e.parts.length, 0);
const today = new Date().toISOString().slice(0, 10);

const payload = {
  meta: {
    built: today,
    scope: '原版实弹武器（单发/多弹丸）；不含爆炸、DoT、穿透减速',
    rounding: '只在最终 BTK 取整；中间伤害保留浮点',
    source: 'helldivers.wiki.gg/zh · 详细武器数据 + 部位分析',
    count: { weapons: weapons.length, enemies: enemies.length, parts }
  },
  weapons,
  enemies
};

/* ---------- 1. data.js（开发用） ---------- */
const dataJs = 'window.HD2_DATA = ' + JSON.stringify(payload, null, 1) + ';\n';
fs.writeFileSync(path.join(__dirname, 'data.js'), dataJs, 'utf8');

/* ---------- 2. 单文件版 ---------- */
const engineJs = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const swap = (marker, code, label) => {
  if (!html.includes(marker)) {
    console.log(`  ! 找不到 ${label} 的引入语句：${marker}`);
    return;
  }
  html = html.replace(marker, '<script>\n' + code.trimEnd() + '\n</script>');
  console.log(`  · 已内联 ${label}（${(code.length / 1024).toFixed(1)} KB）`);
};

swap('<script src="data.js"></script>', dataJs, '数据集');
swap('<script src="engine.js"></script>', engineJs, '计算引擎');

const footer = [
  '<footer style="padding:14px 28px 26px;color:#6f6b61;font-size:11.5px;border-top:1px solid #2a2a25;margin-top:8px">',
  `单文件版 · ${weapons.length} 把武器 / ${enemies.length} 种敌人 / ${parts} 个部位 · 构建于 ${today}`,
  ' · 数据 source: helldivers.wiki.gg/zh · 本文件自包含，可离线打开或直接发给别人',
  '</footer>'
].join('');

html = html.replace('</body>', footer + '\n</body>');

// 保险：确认没有残留外部引用
const leftover = html.match(/<script[^>]+src=|<link[^>]+href=/g);
if (leftover) {
  console.log('  ! 仍有外部引用：' + leftover.join(', '));
}

const singlePath = path.join(__dirname, '绝地潜兵2_武器击杀阈值与BTK计算器.html');
fs.writeFileSync(singlePath, html, 'utf8');

console.log(`data.js 已生成：${weapons.length} 把武器 / ${enemies.length} 种敌人 / ${parts} 个部位 (${(dataJs.length / 1024).toFixed(1)} KB)`);
console.log(`单文件版已生成：${path.basename(singlePath)} (${(html.length / 1024).toFixed(1)} KB)${leftover ? ' —— 有外部引用，请检查' : ' —— 无外部依赖'}`);
