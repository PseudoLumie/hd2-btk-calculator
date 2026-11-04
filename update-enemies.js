#!/usr/bin/env node
/**
 * 敌人数据增量更新：只抓 wiki 上有、本地没有的敌人。
 * 用法：node btk/update-enemies.js [--write]
 *   默认 dry-run，打印将要新增的内容；加 --write 才写回 enemies.json
 */
const fs = require('fs');
const path = require('path');

const API = 'https://helldivers.wiki.gg/zh/api.php';
const FILE = path.join(__dirname, 'enemies.json');

function getJSON(url) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'hd2-btk-datasync/1.0', Accept: 'application/json' } }, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => {
        const t = Buffer.concat(c).toString('utf8');
        try { resolve(JSON.parse(t)); } catch (e) { reject(new Error('非 JSON（可能被拦截）')); }
      });
    }).on('error', reject);
  });
}

const num = (s) => { const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const pct = (s) => { const n = num(s); return n == null ? 0 : n / 100; };
const norm = (s) => String(s).replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s+/g, '').trim();

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** 从 wikitext 解析 {{Anatomy Row|...}} */
function parseAnatomy(text) {
  const parts = [];
  const re = /\{\{Anatomy Row([\s\S]*?)\n?\s*\}\}/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    const f = (k) => {
      const mm = body.match(new RegExp('\\|\\s*' + k + '\\s*=\\s*([^|\\n}]*)', 'i'));
      return mm ? mm[1].trim() : '';
    };
    const name = f('part_name').replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const hpRaw = f('health');
    const shared = /^(Main|主体)$/i.test(hpRaw);
    const countM = name.match(/[（(]\s*(\d+)\s*[）)]\s*$/);
    const fatalRaw = f('fatal');
    const capRaw = f('dmg_cap_main');
    const bleedRaw = f('bleed');
    const toRaw = f('percent_to_main');
    parts.push({
      part: countM ? name.replace(/[（(]\s*\d+\s*[）)]\s*$/, '').trim() : name,
      count: countM ? Number(countM[1]) : 1,
      hp: shared ? null : num(hpRaw),
      av: num(f('av')) ?? 0,
      durability: pct(f('durability')),
      to_main: /^(-|—)$/.test(toRaw) || !toRaw ? null : pct(toRaw),
      cap: /^(Yes|是)/i.test(capRaw) ? true : (/^(No|否)/i.test(capRaw) ? false : null),
      fatal: /^(Yes|是)/i.test(fatalRaw),
      bleed: (bleedRaw && !/^(None|无|-)$/i.test(bleedRaw)) ? bleedRaw : null,
      exdr: pct(f('exdr'))
    });
  }
  return parts;
}

const EXCLUDE = ['平民', '绝地潜兵', '超级地球武装部队士兵', '光能者统御舰', '地面全地形采集钻机'];
const SPLIT = ['湮灭坦克', '碎裂坦克', '铁幕坦克', '移动工厂'];

function shouldSkip(page, localNames) {
  if (EXCLUDE.some((x) => page === x)) return '排除名单';
  for (const base of SPLIT) {
    if (page === base) {
      const has = Array.from(localNames).some((n) => n.indexOf(base) === 0);
      if (has) return '母体已拆条';
    }
  }
  return null;
}

function validate(enemy) {
  const errs = [];
  if (!enemy.mainHp || enemy.mainHp <= 0) errs.push('mainHp 无效');
  if (!enemy.parts.length) errs.push('无部位');
  for (const p of enemy.parts) {
    if (p.av < 0 || p.av > 10) errs.push(p.part + ' AV 越界(' + p.av + ')');
    if (p.hp != null && p.hp <= 0) errs.push(p.part + ' 血量无效');
  }
  return errs;
}

(async function main() {
  const write = process.argv.includes('--write');
  const local = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const localNames = new Set(local.map((e) => norm(e.enemy)));

  const list = await getJSON(API + '?action=cargoquery&tables=Enemies&fields=_pageName&limit=500&format=json&formatversion=2');
  const names = (list.cargoquery || []).map((x) => x.title._pageName);
  const fresh = names.filter((n) => !localNames.has(norm(n)));

  console.log('wiki 敌人 ' + names.length + ' 个，本地 ' + local.length + ' 个，待处理 ' + fresh.length + ' 个');

  const added = [];
  for (const page of fresh) {
    const skip = shouldSkip(page, localNames);
    if (skip) { console.log('  · ' + page + '：跳过（' + skip + '）'); continue; }
    try {
      const d = await getJSON(API + '?action=parse&page=' + encodeURIComponent(page) + '&prop=wikitext&format=json&formatversion=2');
      const wt = d.parse.wikitext;
      const parts = parseAnatomy(wt);
      if (!parts.length) { console.log('  · ' + page + '：无 Anatomy 表，跳过'); continue; }
      const main = parts.find((p) => p.part === '主体');
      const mainHp = main && main.hp != null ? main.hp : (parts[0].hp || null);
      const factionRaw = (wt.match(/\|\s*faction\s*=\s*([^\n|]*)/i) || [])[1] || '';
      const fm = { '终结族': '终结族', '机器人': '机器人', '光能者': '光能者',
      'Automaton': '机器人', 'Terminid': '终结族', 'Illuminate': '光能者',
      '腐蚀变种': '终结族', '爆裂变种': '终结族', '孢裂变种': '终结族',
      '掠食变种': '终结族', '生化人军团': '机器人', '炽灼部队': '机器人',
      '喷气旅': '机器人', '占领者': '光能者', '窃票者': '光能者' };
      let faction = '机器人';
      for (const k in fm) if (factionRaw.includes(k)) { faction = fm[k]; break; }
      if (!parts.some((p) => p.part === '主体')) {
        console.log('  ✗ ' + page + '：部位表无「主体」，跳过');
        continue;
      }
      const enemy = { enemy: page, faction, tier: '', mainHp, note: '', parts };
      const errs = validate(enemy);
      if (errs.length) { console.log('  ✗ ' + page + '：' + errs.join('；')); continue; }
      console.log('  + ' + page + '（' + faction + '）HP ' + mainHp + '，' + parts.length + ' 部位');
      added.push(enemy);
    } catch (e) {
      console.log('  ! ' + page + '：' + e.message);
    }
  }

  if (!added.length) { console.log('\n没有可新增的敌人。'); return; }
  if (!write) { console.log('\n(dry-run) 加 --write 才会写入，共 ' + added.length + ' 条'); return; }
  const out = local.concat(added);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 1), 'utf8');
  console.log('\n已写入 ' + added.length + ' 条，敌人总数 ' + out.length);
})();
