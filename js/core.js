// ===== Pathbound (Idle rework) — profile, leveling, book map, gear, EP =====
'use strict';

const SAVE_KEY = 'pathbound-save-v7'; // v7: book 2, EP/enhance, stacking conditions

const G = {
  profile: null,
  session: false,
};

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function seededPick(arr, seed) {
  const x = Math.sin((seed + 1) * 99991) * 10000;
  return arr[Math.floor((x - Math.floor(x)) * arr.length)];
}

function emptyStatMap() {
  const m = {}; STATS.forEach((s) => (m[s] = 0)); return m;
}

function newProfile() {
  const classXp = {};
  Object.keys(CLASSES).forEach((id) => (classXp[id] = 0));
  const equipment = {};
  Object.keys(EQUIP_SLOTS).forEach((k) => (equipment[k] = null));
  return {
    classXp: classXp,
    selectedClass: 'classless',
    statXp: emptyStatMap(),
    upgrades: {},
    maxLevel: {},
    prestiged: {},
    skills: [],
    tomeSkills: [],
    slots: new Array(CFG.slotCount).fill(null),
    ep: 0,                       // Enhance Points (run-scoped)
    sacrificed: [],              // ability ids sacrificed this run
    enhance: {},                 // abilityId -> {spent,multi,charge,burst,ammo,dur:{},stack:{}}
    gold: 0,
    inventory: [],
    equipment: equipment,
    node: 0,
    wins: {},
    seen: {},
    metEnemies: {},              // enemy id -> true (Bestiary)
    chapterClears: {},
    completedThisRun: {},
    autoTravel: true,
    pendingDrafts: [],
    totalXp: 0,
  };
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(G.profile)); }
  catch (e) { /* private mode etc. */ }
}

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { G.profile = JSON.parse(raw); }
  } catch (e) { G.profile = null; }
  if (!G.profile || !G.profile.classXp) {
    G.profile = newProfile();
    addClassXpDirect('classless', playerCost('classless', 1));
    save();
  }
  Object.keys(CLASSES).forEach((id) => { if (G.profile.classXp[id] == null) G.profile.classXp[id] = 0; });
  ['upgrades', 'maxLevel', 'prestiged', 'wins', 'equipment', 'seen', 'metEnemies',
   'chapterClears', 'completedThisRun', 'enhance'].forEach((k) => { if (!G.profile[k]) G.profile[k] = {}; });
  ['inventory', 'tomeSkills', 'pendingDrafts', 'skills', 'sacrificed'].forEach((k) => { if (!G.profile[k]) G.profile[k] = []; });
  if (G.profile.gold == null) G.profile.gold = 0;
  if (G.profile.ep == null) G.profile.ep = 0;
  if (G.profile.autoTravel == null) G.profile.autoTravel = true;
  checkCompletions();
}

// ---- derived stats ----
function derive(s) {
  const soul = 1 + s.sol / 100;
  const soul2 = 1 + s.sol / 200;
  const perA = ((s.per * 2) / 10) + 1;
  return {
    atkSpeed:    1 + s.agi / 100,
    castSpeed:   1 + s.wis / 100,
    maxHp:       100 + (((s.pie + s.fai) / 10) + 1) * s.per * soul,
    hpRegen:     (1 + (((s.end * 2) / 100) + 1) * perA * soul) / 10,
    maxMana:     10 + (((s.int + s.wis) / 10) + 1) * ((s.per / 10) + 1) * soul,
    manaRegen:   (1 + (((s.wis * 2) / 100) + 1) * perA * soul) / 10,
    maxShield:   50 + (((s.int + s.wis) / 20) + 1) * ((s.per / 2) + 1) * soul2,
    maxStam:     10 + (((s.dex + s.agi) / 10) + 1) * ((s.per / 10) + 1) * soul,
    stamRegen:   (1 + (((s.dex * 2) / 100) + 1) * perA * soul) / 10,
    maxReson:    10 + (((s.pie + s.fai) / 10) + 1) * ((s.per / 10) + 1) * soul,
    resonRegen:  (1 + (((s.fai * 2) / 100) + 1) * perA * soul) / 10,
  };
}

// ---- leveling ----
function levelCostRaw(classId, level) {
  const c = CLASSES[classId];
  const base = c.baseXp + (c.flatStep || 0) * (level - 1);
  return Math.round(base * Math.pow(c.xpMult, level - 1));
}
function prestigeCount() {
  let n = 0; for (const k in G.profile.prestiged) if (G.profile.prestiged[k]) n++; return n;
}
function prestigeSpeedMult() { return 1 + CFG.prestigeSpeedPerClass * prestigeCount(); }
function playerCost(classId, level) {
  let cost = levelCostRaw(classId, level);
  if (G.profile.prestiged[classId]) cost /= CFG.prestigeDivisor;
  const cap = (G.profile.maxLevel[classId] || 0) + prestigeCount();
  if (level <= cap) cost /= prestigeSpeedMult();
  return Math.max(1, Math.round(cost));
}
function genLevelFromXp(classId, xp, costFn) {
  let lvl = 0, spent = 0;
  while (lvl < CFG.levelCap) {
    const need = costFn(classId, lvl + 1);
    if (spent + need > xp) break;
    spent += need; lvl += 1;
  }
  return lvl;
}
function levelOf(classId) { return genLevelFromXp(classId, G.profile.classXp[classId] || 0, playerCost); }
function totalCostTo(classId, level) {
  let sum = 0; for (let l = 1; l <= level; l++) sum += playerCost(classId, l); return sum;
}
function levelProgress(classId) {
  const xp = G.profile.classXp[classId] || 0;
  const lvl = levelOf(classId);
  const spent = totalCostTo(classId, lvl);
  const need = lvl >= CFG.levelCap ? 0 : playerCost(classId, lvl + 1);
  return { level: lvl, into: xp - spent, need: need };
}
function ancestorsOf(classId) {
  const out = [], seen = {};
  const walk = (id) => {
    (CLASSES[id].parents || []).forEach((p) => {
      if (!seen[p]) { seen[p] = true; out.push(p); walk(p); }
    });
  };
  walk(classId);
  return out;
}
function statGainCumulative(classId, level) {
  const out = emptyStatMap();
  if (level <= 0) return out;
  CLASSES[classId].gains.forEach((rule) => {
    const n = rule.everyN;
    const lowCount = Math.floor(Math.min(level, 100) / n);
    const hiCount = level > 100 ? (Math.floor(level / (2 * n)) - Math.floor(100 / (2 * n))) : 0;
    const count = lowCount + hiCount;
    if (count) for (const st in rule.add) out[st] += rule.add[st] * count;
  });
  if (level >= 100) out.per += 1;
  return out;
}
function equipmentStats() {
  const s = emptyStatMap();
  Object.keys(G.profile.equipment).forEach((k) => {
    const it = G.profile.equipment[k];
    if (!it) return;
    it.prefixes.forEach((p) => { if (p) s[p.stat] += p.amt; });
  });
  return s;
}
function characterStats() {
  const s = {}; STATS.forEach((st) => (s[st] = CFG.startStat));
  Object.keys(CLASSES).forEach((id) => {
    const g = statGainCumulative(id, levelOf(id));
    STATS.forEach((st) => (s[st] += g[st]));
  });
  const eq = equipmentStats();
  STATS.forEach((st) => (s[st] += eq[st]));
  if (G.profile.slots.indexOf('determination') !== -1) {
    const m = 1 + 0.002 * (G.profile.maxLevel.classless || 0);
    s.sol *= m; s.per *= m;
  }
  return s;
}

// ---- class unlocks & grants ----
function classUnlocked(classId) {
  if (classId === 'classless') return true;
  return (CLASSES[classId].unlock || []).every((r) => levelOf(r.class) >= r.level);
}
function grantAbility(id) {
  if (G.profile.skills.indexOf(id) !== -1) return;
  G.profile.skills.push(id);
  const empty = G.profile.slots.indexOf(null);
  if (empty !== -1) G.profile.slots[empty] = id;
}
function updateMaxLevel(classId) {
  const lvl = levelOf(classId);
  if (lvl > (G.profile.maxLevel[classId] || 0)) G.profile.maxLevel[classId] = lvl;
}
function checkLevelUnlocks(classId, before, after) {
  [1, 10, 100].forEach((mark) => {
    if (before < mark && after >= mark) {
      const u = CLASSES[classId].unlocks;
      if (u) (u[mark] || []).forEach(grantAbility);
      else G.profile.pendingDrafts.push(rollDraft(G.profile.skills));
    }
  });
}
function addClassXp(classId, amount) {
  addClassXpDirect(classId, amount);
  ancestorsOf(classId).forEach((anc) => addClassXpDirect(anc, amount / 2));
}
function addClassXpDirect(classId, amount) {
  const before = levelOf(classId);
  G.profile.classXp[classId] = (G.profile.classXp[classId] || 0) + amount;
  G.profile.totalXp += amount;
  checkLevelUnlocks(classId, before, levelOf(classId));
  updateMaxLevel(classId);
}
function addStatXp(classId, amount) {
  const core = CLASSES[classId].core;
  if (!core.length) return;
  const share = amount / core.length;
  core.forEach((st) => { G.profile.statXp[st] += share; });
}

// ---- upgrades ----
function upgradeCount(id) { return G.profile.upgrades[id] || 0; }
function upgradeCost(id) {
  const n = upgradeCount(id);
  const base = UPGRADES[id].cost + CFG.upgradeFlatStep * n;
  return Math.round(base * Math.pow(CFG.upgradeMult, n));
}
function upgradesUnlocked() { return levelOf('classless') >= CFG.upgradeUnlock; }
function canBuyUpgrade(id) {
  if (!upgradesUnlocked()) return false;
  return G.profile.statXp[UPGRADES[id].stat] >= upgradeCost(id);
}
function buyUpgrade(id) {
  if (!canBuyUpgrade(id)) return false;
  G.profile.statXp[UPGRADES[id].stat] -= upgradeCost(id);
  G.profile.upgrades[id] = upgradeCount(id) + 1;
  save();
  return true;
}
function upgradeBonuses() {
  const b = { hp: 0, hpRegen: 0, stam: 0, stamRegen: 0, mana: 0, manaRegen: 0,
    reson: 0, resonRegen: 0, dmgByTag: {} };
  Object.keys(UPGRADES).forEach((id) => {
    const n = upgradeCount(id); if (!n) return;
    const u = UPGRADES[id];
    if (u.kind === 'dmg') b.dmgByTag[u.tag] = (b.dmgByTag[u.tag] || 0) + u.amt * n;
    else b[u.kind] += u.amt * n;
  });
  return b;
}

// ---- EP: Sacrifice / Enhance / Buy Back (run-scoped) ----
function enhOf(id) {
  if (!G.profile.enhance[id]) G.profile.enhance[id] = { spent: 0, multi: 0, charge: 0, burst: 0, ammo: 0, dur: {}, stack: {} };
  const e = G.profile.enhance[id];
  if (!e.dur) e.dur = {}; if (!e.stack) e.stack = {};
  return e;
}
function sacrificeAbility(id) {
  const i = G.profile.skills.indexOf(id);
  if (i === -1) return false;
  G.profile.skills.splice(i, 1);
  const si = G.profile.slots.indexOf(id);
  if (si !== -1) G.profile.slots[si] = null;
  G.profile.sacrificed.push(id);
  G.profile.ep += 1;
  save();
  return true;
}
function buyBackAbility(id) {
  const i = G.profile.sacrificed.indexOf(id);
  if (i === -1 || G.profile.ep < 1) return false;
  G.profile.sacrificed.splice(i, 1);
  G.profile.ep -= 1;
  grantAbility(id);
  save();
  return true;
}
// enhancement options: {key, cost, available(def), apply(enh)}
function enhanceOptions(id) {
  const def = ABILITIES[id];
  const opts = [];
  if (def.full && def.full.some((op) => op.t === 'dmg' && op.stat)) {
    opts.push({ key: 'multi', label: '+0.1× stat multiplier', cost: 1 });
  }
  if (def.charge) opts.push({ key: 'charge', label: '+1 Charge', cost: 10 });
  if (def.burst) opts.push({ key: 'burst', label: '+1 Burst', cost: 10 });
  if (def.ammo && !def.charge) opts.push({ key: 'ammo', label: '+1 Ammo', cost: def.ammo <= 1 ? 20 : 10 });
  (def.full || []).forEach((op) => {
    if (op.t !== 'st') return;
    const meta = STATUSES[op.key];
    if (op.dur && op.key !== 'interrupted') {
      opts.push({ key: 'dur:' + op.key, label: '+1 ' + meta.name + ' duration', cost: 2 });
    }
    if (meta.kind === 'stack' || meta.kind === 'charge') {
      opts.push({ key: 'stack:' + op.key, label: '+1 ' + meta.name + ' stack', cost: 10 });
    }
  });
  return opts;
}
function buyEnhance(id, optKey, cost) {
  if (G.profile.ep < cost) return false;
  G.profile.ep -= cost;
  const e = enhOf(id);
  e.spent += cost;
  if (optKey === 'multi') e.multi += 1;
  else if (optKey === 'charge') e.charge += 1;
  else if (optKey === 'burst') e.burst += 1;
  else if (optKey === 'ammo') e.ammo += 1;
  else if (optKey.indexOf('dur:') === 0) { const k = optKey.slice(4); e.dur[k] = (e.dur[k] || 0) + 1; }
  else if (optKey.indexOf('stack:') === 0) { const k = optKey.slice(6); e.stack[k] = (e.stack[k] || 0) + 1; }
  save();
  return true;
}
// the player's enhanced version of an ability definition
function enhancedDef(id) {
  const base = ABILITIES[id];
  const e = G.profile.enhance[id];
  if (!e || !e.spent) return base;
  const d = JSON.parse(JSON.stringify(base));
  // restore non-serializable flags
  d.__enh = e.spent;
  // cost: +1 per 2 EP spent, applied to the primary resource
  const costUp = Math.floor(e.spent / 2);
  ['stam', 'mana', 'reson'].forEach((k) => { if (d.cost[k]) d.cost[k] += costUp; });
  if (e.charge || e.ammo) d.ammo = (d.ammo || 0) + e.charge + e.ammo;
  if (e.burst) d.burst = (d.burst || 0) + e.burst;
  let firstDmg = true;
  (d.full || []).forEach((op) => {
    if (op.t === 'dmg') {
      if (firstDmg) { op.base += e.spent; firstDmg = false; } // +1 flat dmg per EP spent
      if (op.stat && e.multi) op.mult = +(op.mult + 0.1 * e.multi).toFixed(2);
    }
    if (op.t === 'st') {
      if (op.dur && e.dur[op.key]) op.dur += e.dur[op.key];
      if (e.stack[op.key]) {
        if (STATUSES[op.key].kind === 'charge') op.count = (op.count || 1) + e.stack[op.key];
        else op.stacks = (op.stacks || 1) + e.stack[op.key];
      }
    }
  });
  return d;
}

// ---- prestige ----
function canPrestige(classId) {
  return !G.profile.prestiged[classId] && levelOf(classId) >= CFG.prestigeLevel;
}
function doPrestige(classId) {
  if (!canPrestige(classId)) return false;
  updateMaxLevel(classId);
  G.profile.prestiged[classId] = true;
  Object.keys(G.profile.completedThisRun).forEach((key) => {
    G.profile.chapterClears[key] = (G.profile.chapterClears[key] || 0) + 1;
  });
  G.profile.completedThisRun = {};
  Object.keys(CLASSES).forEach((id) => (G.profile.classXp[id] = 0));
  G.profile.selectedClass = 'classless';
  G.profile.skills = [];
  G.profile.slots = new Array(CFG.slotCount).fill(null);
  G.profile.pendingDrafts = [];
  G.profile.node = 0;
  G.profile.wins = {};
  G.profile.ep = 0;
  G.profile.sacrificed = [];
  G.profile.enhance = {};
  addClassXpDirect('classless', playerCost('classless', 1));
  G.profile.tomeSkills.forEach(grantAbility);
  checkCompletions();
  save();
  return true;
}

// ---- drafts (tier 1.5+): pool = draft skills + learnable enemy abilities ----
function rollDraft(owned, n) {
  n = n || 3;
  const pool = Object.keys(ABILITIES).filter((id) => {
    const a = ABILITIES[id];
    if (owned.indexOf(id) !== -1) return false;
    if (a.draft) return true;
    return enemyAbilityIds()[id] && !a.noLearn && !a.negative && !a.concept;
  });
  const offer = [];
  while (offer.length < n && pool.length) offer.push(pool.splice(rnd(pool.length), 1)[0]);
  return offer;
}

// ---- the book map ----
function bookOf(g) {
  let b = 0;
  while (b < BOOKS.length - 1 && g >= BOOK_STARTS[b + 1]) b++;
  return b;
}
function pageInfo(g) {
  const b = bookOf(g);
  let within = g - BOOK_STARTS[b];
  const content = BOOKS[b].content;
  for (let ci = 0; ci < content.length; ci++) {
    const ch = content[ci];
    if (within < ch.pages.length) {
      return {
        book: b, bookName: BOOKS[b].name, mult: BOOKS[b].mult,
        chapter: ci + 1, chapterName: ch.name, boss: !!ch.boss,
        page: within + 1, pageCount: ch.pages.length,
        enemy: ch.pages[within],
        key: 'b' + b + 'c' + ci,
        reward: ch.reward, killXp: ch.killXp, gold: ch.gold, gearLvl: ch.gearLvl,
      };
    }
    within -= ch.pages.length;
  }
  return null;
}
function chapterPages(b, ci) {
  let start = BOOK_STARTS[b];
  const content = BOOKS[b].content;
  for (let i = 0; i < ci; i++) start += content[i].pages.length;
  const out = [];
  for (let i = 0; i < content[ci].pages.length; i++) out.push(start + i);
  return out;
}
function reqFor(g) {
  const info = pageInfo(g);
  const base = info.enemy.req || CFG.winsToAdvance;
  return Math.max(0, base - (G.profile.chapterClears[info.key] || 0));
}
function winsOn(g) { return G.profile.wins[g] || 0; }
function canAdvance() { return winsOn(G.profile.node) >= reqFor(G.profile.node); }
function computeMaxNode() {
  let i = 0;
  while (i < TOTAL_PAGES - 1 && winsOn(i) >= reqFor(i)) i++;
  return i;
}
function recordWin() {
  G.profile.wins[G.profile.node] = winsOn(G.profile.node) + 1;
}
function travel(dir) {
  const target = G.profile.node + dir;
  if (target < 0 || target >= TOTAL_PAGES) return false;
  if (target > computeMaxNode()) return false;
  G.profile.node = target;
  save();
  return true;
}
function checkCompletions() {
  const msgs = [];
  for (let b = 0; b < BOOKS.length; b++) {
    const content = BOOKS[b].content;
    for (let ci = 0; ci < content.length; ci++) {
      const key = 'b' + b + 'c' + ci;
      if (G.profile.completedThisRun[key]) continue;
      const done = chapterPages(b, ci).every((g) => winsOn(g) >= reqFor(g));
      if (!done) continue;
      G.profile.completedThisRun[key] = true;
      const rw = content[ci].reward, mult = BOOKS[b].mult;
      const targets = [];
      if (rw.classless) targets.push(['classless', rw.classless]);
      if (rw.t05) T05_IDS.forEach((id) => targets.push([id, rw.t05]));
      if (rw.t1) T1_IDS.forEach((id) => targets.push([id, rw.t1]));
      if (rw.t15) T15_IDS.forEach((id) => targets.push([id, rw.t15]));
      targets.forEach((t) => addClassXpDirect(t[0], t[1] * mult));
      msgs.push(BOOKS[b].name + ' — "' + content[ci].name + '" complete! Rewards granted.');
    }
  }
  if (msgs.length) save();
  return msgs;
}
function skipClearedPages() {
  if (!G.profile.autoTravel) return;
  let guard = 0;
  while (G.profile.node < TOTAL_PAGES - 1 && reqFor(G.profile.node) === 0 &&
         G.profile.node < computeMaxNode() && guard++ < TOTAL_PAGES) {
    G.profile.node += 1;
  }
}
function killXpFor(g) { const i = pageInfo(g); return i.killXp * i.mult; }
function goldFor(g) { const i = pageInfo(g); return i.gold * i.mult; }

// ---- enemy build data ----
function genEnemy(g) {
  const info = pageInfo(g);
  const def = info.enemy;
  const filler = 3 + 2 * info.chapter + (info.book >= 1 ? 10 : 0);
  const stats = {};
  STATS.forEach((s) => { stats[s] = ((def.stats && def.stats[s]) || filler) * info.mult; });
  return {
    name: def.name, id: def.id,
    hp: def.hp * info.mult,
    stats: stats,
    abilities: def.abilities.slice(),
    allies: (def.allies || []).slice(),
    playerAllies: (def.playerAllies || []).slice(),
    noRegen: !!def.noRegen, noShield: !!def.noShield,
    silence: !!def.silence, reverse: !!def.reverse,
    dormant: !!def.dormant, startFeast: !!def.startFeast,
    bookTag: info.mult > 1 ? BOOKS[info.book].name.replace(/Book \d /, '') : null,
  };
}

// all ability ids used by book enemies (for tome pool / drafts)
let _enemyAbilityCache = null;
function enemyAbilityIds() {
  if (_enemyAbilityCache) return _enemyAbilityCache;
  const used = {};
  [BOOK1, BOOK2].forEach((book) => book.forEach((ch) => ch.pages.forEach((p) => {
    p.abilities.forEach((id) => (used[id] = true));
    (p.allies || []).forEach((aid) => { /* allies share page defs */ });
  })));
  _enemyAbilityCache = used;
  return used;
}

// ---- equipment & blacksmith ----
function rollPrefix(level) {
  let base = 1 + rnd(Math.max(1, level));
  let mult = 1;
  CFG.multChances.forEach((mc) => { if (Math.random() < mc[1]) mult *= mc[0]; });
  return { stat: pick(GEAR_STATS), base: base, mult: mult, amt: base * mult };
}
function genItem(level) {
  const slotKey = pick(Object.keys(EQUIP_SLOTS));
  const prefixes = [];
  for (let i = 0; i < 5; i++) {
    prefixes.push(Math.random() < CFG.prefixChances[i] ? rollPrefix(level) : null);
  }
  return { kind: 'gear', slot: slotKey, name: EQUIP_SLOTS[slotKey], level: level,
    upgrades: 0, rerolls: 0, prefixes: prefixes };
}
function genRune(level) {
  const p = rollPrefix(level);
  return { kind: 'rune', stat: p.stat, base: p.base, mult: p.mult, amt: p.amt, level: level };
}
function invFull() { return G.profile.inventory.length >= CFG.invSize; }
// scrap value = total roll sum (runes: their roll; tomes: 1)
function scrapValue(it) {
  if (it.kind === 'gear') return it.prefixes.reduce((a, p) => a + (p ? p.amt : 0), 0) || 1;
  if (it.kind === 'rune') return it.amt;
  return 1;
}

// ---- tomes ----
function sameAsRoot(id) { return ABILITIES[id].sameAs || id; }
function ownsSkillOrVariant(id) {
  const root = sameAsRoot(id);
  const has = (x) => sameAsRoot(x) === root;
  return G.profile.skills.some(has) || G.profile.tomeSkills.some(has) || G.profile.sacrificed.some(has) ||
    G.profile.inventory.some((it) => it.kind === 'tome' && has(it.skill));
}
function tomePool() {
  return Object.keys(enemyAbilityIds()).filter((id) => {
    const a = ABILITIES[id];
    if (!a || a.noLearn || a.negative) return false;
    return !ownsSkillOrVariant(id);
  });
}
function genTome() {
  const pool = tomePool();
  if (!pool.length) return null;
  return { kind: 'tome', skill: pick(pool), level: 1 };
}
function learnTome(invIdx) {
  const t = G.profile.inventory[invIdx];
  if (!t || t.kind !== 'tome') return false;
  G.profile.inventory.splice(invIdx, 1);
  if (G.profile.tomeSkills.indexOf(t.skill) === -1) G.profile.tomeSkills.push(t.skill);
  grantAbility(t.skill);
  save();
  return true;
}

function spendGold(n) {
  if (G.profile.gold < n) return false;
  G.profile.gold -= n; return true;
}
function bsUpgrade(item) {
  if (item.kind !== 'gear' || item.upgrades >= CFG.maxItemUpgrades) return false;
  if (!spendGold(CFG.bsCosts.upgrade)) return false;
  item.upgrades += 1; item.level += 1;
  save(); return true;
}
function rerollCostOf(item) { return CFG.rerollCosts[Math.min(item.rerolls, CFG.rerollCosts.length - 1)]; }
function bsReroll(item, pfxIdx, mode) {
  const p = item.prefixes && item.prefixes[pfxIdx];
  if (!p || item.rerolls >= CFG.maxRerolls) return false;
  if (!spendGold(rerollCostOf(item))) return false;
  if (mode === 'amt') { p.base = 1 + rnd(Math.max(1, item.level)); }
  else { p.stat = pick(GEAR_STATS); }
  p.amt = p.base * p.mult;
  item.rerolls += 1;
  save(); return true;
}
function bsExtract(invIdx, pfxIdx) {
  const item = G.profile.inventory[invIdx];
  const p = item && item.prefixes && item.prefixes[pfxIdx];
  if (!p) return false;
  if (!spendGold(CFG.bsCosts.extract)) return false;
  G.profile.inventory.splice(invIdx, 1);
  G.profile.inventory.push({ kind: 'rune', stat: p.stat, base: p.base, mult: p.mult, amt: p.amt, level: item.level });
  save(); return true;
}
function bsAugment(item, pfxIdx, runeIdx) {
  const rune = G.profile.inventory[runeIdx];
  if (!item || item.kind !== 'gear' || !rune || rune.kind !== 'rune') return false;
  if (item.prefixes[pfxIdx]) return false;
  if (!spendGold(CFG.bsCosts.augment)) return false;
  item.prefixes[pfxIdx] = { stat: rune.stat, base: rune.base, mult: rune.mult, amt: rune.amt };
  G.profile.inventory.splice(runeIdx, 1);
  save(); return true;
}
function scrapItem(invIdx) {
  const item = G.profile.inventory[invIdx];
  if (!item) return false;
  G.profile.gold += scrapValue(item);
  G.profile.inventory.splice(invIdx, 1);
  save(); return true;
}
function equipItem(invIdx) {
  const item = G.profile.inventory[invIdx];
  if (!item || item.kind !== 'gear') return false;
  G.profile.inventory.splice(invIdx, 1);
  const old = G.profile.equipment[item.slot];
  G.profile.equipment[item.slot] = item;
  if (old) G.profile.inventory.push(old);
  save(); return true;
}
function unequipItem(slotKey) {
  const item = G.profile.equipment[slotKey];
  if (!item || invFull()) return false;
  G.profile.equipment[slotKey] = null;
  G.profile.inventory.push(item);
  save(); return true;
}
