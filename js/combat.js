// ===== Pathbound (Idle rework) — fill-bar combat engine: stacks, allies, bursts =====
'use strict';

let C = null;

// ---- ability metadata ----
function abilityDef(id) { return ABILITIES[id]; }
// the definition a given unit actually uses (players get enhancements)
function defFor(unit, id) { return unit.isPlayer ? enhancedDef(id) : abilityDef(id); }
function costTotal(cost) { return (cost.stam || 0) + (cost.mana || 0) + (cost.reson || 0); }
function isSpell(def) { return !!(def.cost.mana || def.cost.reson); }
function isSkillAb(def) { return !!def.cost.stam; }
function fillTimeOf(unit, def, slot) {
  return Math.max(0.25, costTotal(def.cost)) * ((slot && slot.costMult) || 1);
}

function slotState(unit, id) {
  const def = defFor(unit || { isPlayer: false }, id) || abilityDef(id);
  return {
    id: id, prog: 0,
    cd: (def && def.startCd) ? baseCooldown(def) : 0,
    ammo: (def && def.ammo) ? def.ammo : null,
    reloading: false, frozen: 0,
    followStacks: 0, hasten: 1, rf: 0,
    costMult: 1, bonusBurst: 0,
    sustaining: null,
  };
}

function baseCooldown(def) { return isSpell(def) ? CFG.cdSpell : CFG.cdSkill; }
function cooldownOf(unit, def) {
  let cd = baseCooldown(def);
  if (unit && unit.concepts) {
    if (unit.concepts['tireless']) cd = Math.max(0, cd - 0.5);
    if (unit.concepts['rebound'] && def.tag === 'agi' && isSkillAb(def)) cd = 0;
  }
  return cd;
}
function burstOf(def, slot) { return (def.burst || 0) + ((slot && slot.bonusBurst) || 0); }
function rechargeCd(unit, def) {
  const base = cooldownOf(unit, def);
  if (def.charge) return base * (1 + 0.5 * def.ammo);
  return base * 5;
}

// ---- combatant / unit ----
let _unitUid = 0;
function combatant(name, classId, level, stats, slotIds, isPlayer) {
  const d = derive(stats);
  const c = {
    uid: ++_unitUid,
    name: name, classId: classId, level: level, isPlayer: !!isPlayer,
    stats: stats,
    concepts: {},
    maxHp: d.maxHp, hp: d.maxHp, hpRegen: d.hpRegen,
    maxShield: d.maxShield, shield: d.maxShield,
    maxMana: d.maxMana, mana: d.maxMana, manaRegen: d.manaRegen,
    maxStam: d.maxStam, stam: d.maxStam, stamRegen: d.stamRegen,
    maxReson: d.maxReson, reson: 0, resonRegen: d.resonRegen,
    atkSpeed: d.atkSpeed, castSpeed: d.castSpeed,
    status: {},
    counter: null, fury: 0, buckleAcc: 0, flightAcc: 0,
    panicked: false, itnTimer: 0,
    dots: [], buffs: [], weaks: [],
  };
  c.abil = slotIds.map((id) => (id ? slotState(c, id) : null));
  c.abil.forEach((s) => {
    if (s && abilityDef(s.id) && abilityDef(s.id).concept) { c.concepts[s.id] = true; applyConceptBuild(c, s.id, stats); }
  });
  return c;
}
// build-time effects of a concept (also used for player Embodiments)
function applyConceptBuild(c, id, stats) {
  if (id === 'watched-over') { c.maxHp += stats.fai * 2; c.hp = c.maxHp; }
  else if (id === 'diseased') c.hpRegen = 0;
  else if (id === 'in-the-name-of') c.resonRegen = 0;
}

function buildPlayer() {
  const p = G.profile;
  const stats = characterStats();
  const c = combatant(CLASSES[p.selectedClass].name, p.selectedClass, levelOf(p.selectedClass), stats, p.slots, true);
  const ub = upgradeBonuses();
  c.maxHp += ub.hp;       c.hp = c.maxHp;
  c.hpRegen += ub.hpRegen;
  c.maxStam += ub.stam;   c.stam = c.maxStam;
  c.stamRegen += ub.stamRegen;
  c.maxMana += ub.mana;   c.mana = c.maxMana;
  c.manaRegen += ub.manaRegen;
  c.maxReson += ub.reson;
  c.resonRegen += ub.resonRegen;
  // Embodied concepts stay active even without an equipped slot
  embodiedConcepts().forEach((id) => {
    if (!c.concepts[id]) { c.concepts[id] = true; applyConceptBuild(c, id, stats); }
  });
  if (c.concepts['in-the-name-of']) c.resonRegen = 0;
  c.dmgByTag = ub.dmgByTag;
  return c;
}

function rebuildPlayer() {
  if (!C) return;
  const old = C.player;
  const np = buildPlayer();
  np.hp = Math.min(old.hp, np.maxHp);
  np.shield = Math.min(old.shield, np.maxShield);
  np.mana = Math.min(old.mana, np.maxMana);
  np.stam = Math.min(old.stam, np.maxStam);
  np.reson = Math.min(old.reson, np.maxReson);
  np.dots = old.dots; np.buffs = old.buffs; np.weaks = old.weaks;
  np.status = old.status; np.counter = old.counter;
  np.fury = old.fury; np.buckleAcc = old.buckleAcc; np.flightAcc = old.flightAcc;
  const prev = {};
  old.abil.forEach((s) => { if (s) prev[s.id] = s; });
  np.abil.forEach((s) => {
    if (s && prev[s.id]) {
      const o = prev[s.id];
      ['prog', 'cd', 'ammo', 'reloading', 'frozen', 'followStacks', 'hasten', 'rf', 'costMult', 'bonusBurst', 'sustaining']
        .forEach((k) => (s[k] = o[k]));
    }
  });
  C.player = np;
}

function buildEnemyUnit(ed) {
  const c = combatant(ed.name, ed.id, 0, ed.stats, ed.abilities, false);
  c.maxHp = ed.hp; c.hp = ed.hp;
  if (ed.noRegen) c.hpRegen = 0;
  if (ed.noShield) { c.maxShield = 0; c.shield = 0; }
  c.bookTag = ed.bookTag;
  return c;
}

function buildAlly(defId, forPlayer, g) {
  if (ALLY_DEFS[defId] && ALLY_DEFS[defId].halfPlayer) {
    const base = characterStats();
    const stats = {}; STATS.forEach((s) => (stats[s] = Math.max(1, base[s] / 2)));
    const a = combatant(ALLY_DEFS[defId].name, 'ally', 0, stats, ALLY_DEFS[defId].abilities, false);
    a.isAlly = true; a.allyOfPlayer = true;
    return a;
  }
  // page-def ally (a copy of an authored enemy)
  const info = pageInfo(g);
  const content = BOOKS[info.book].content;
  let def = null;
  content.forEach((ch) => ch.pages.forEach((p) => { if (p.id === defId) def = p; }));
  if (!def) return null;
  const stats = {};
  STATS.forEach((s) => { stats[s] = enemyBaseStat(info, def, s) * info.mult; });
  const a = combatant(def.name, def.id, 0, stats, def.abilities, false);
  a.maxHp = enemyHpVal(info, def); a.hp = a.maxHp;
  a.isAlly = true; a.allyOfPlayer = !!forPlayer;
  return a;
}

function startSession() {
  G.session = true;
  skipClearedPages();
  const msgs = checkCompletions();
  newBattle();
  msgs.forEach(logMsg);
}
function endSession() { G.session = false; C = null; }

function newBattle() {
  const g = G.profile.node;
  const ed = genEnemy(g);
  G.profile.metEnemies[ed.id] = true;
  const enemy = buildEnemyUnit(ed);
  C = {
    node: g, info: pageInfo(g),
    player: buildPlayer(), enemy: enemy,
    pAllies: [], eAllies: [],
    reverse: ed.reverse, silence: ed.silence,
    log: [], over: false, fled: false, ending: false, noReward: false,
    elapsed: 0,
  };
  // authored extras
  ed.allies.forEach((aid) => { const a = buildAlly(aid, false, g); if (a) C.eAllies.push(a); });
  ed.playerAllies.forEach((aid) => { const a = buildAlly(aid, true, g); if (a) C.pAllies.push(a); });
  if (ed.dormant) enemy.dormant = true;
  if (ed.startFeast) {
    const fs = enemy.abil.find((s) => s && s.id === 'feast');
    if (fs) fs.sustaining = { acc: 0, threshold: 0.10 * enemy.maxHp };
  }
  if (C.reverse) {
    // she is halfway down and bleeding out (2×Bleed, 2×Poison over 120s)
    enemy.hp = enemy.maxHp / 2;
    addStatus(enemy, 'bleed', { dur: 120, stacks: 2, src: enemy });
    addStatus(enemy, 'poison', { dur: 120, stacks: 2, src: enemy });
  }
  logMsg(enemy.name + ' — ' + C.info.bookName + ', "' + C.info.chapterName + '", Page ' + C.info.page + '.');
  // Initiate abilities fire at the start of combat
  allUnits().forEach((u) => { runInitiates(u); });
}

function allUnits() { return [C.player].concat(C.pAllies, [C.enemy], C.eAllies); }
function sideUnits(unit) {
  return (unit === C.player || unit.allyOfPlayer) ? [C.player].concat(C.pAllies) : [C.enemy].concat(C.eAllies);
}
function foeUnits(unit) {
  return (unit === C.player || unit.allyOfPlayer) ? [C.enemy].concat(C.eAllies) : [C.player].concat(C.pAllies);
}
function aliveFoes(unit) { return foeUnits(unit).filter((u) => u.hp > 0); }
function pickTarget(unit) { const f = aliveFoes(unit); return f.length ? pick(f) : null; }

function runInitiates(u) {
  u.abil.forEach((s) => {
    if (!s) return;
    const def = defFor(u, s.id);
    if (!def || !def.initiate) return;
    const target = pickTarget(u);
    if (!target) return;
    if (def.concept) {
      if (def.initOps) applyOps(def.initOps, u, target, def.name + ' (Initiate)', def.tag, { mult: 1, extra: 0, isSkill: true });
    } else {
      castAbility(u, target, s, true, true);
    }
  });
}

function logMsg(s) { if (!C) return; C.log.push(s); if (C.log.length > 60) C.log.shift(); }

// ---- statuses (v2: stacks with snapshots) ----
function statusMeta(key) { return STATUSES[key]; }
function stEntry(unit, key) { return unit.status[key]; }
function stHas(unit, key) {
  const e = unit.status[key];
  return !!e && ((e.count || 0) > 0 || (e.stacks && e.stacks.length > 0));
}
function stCount(unit, key) {
  const e = unit.status[key];
  if (!e) return 0;
  return e.count != null ? e.count : (e.stacks ? e.stacks.length : 0);
}
function stMinSecs(unit, key) {
  const e = unit.status[key];
  if (!e || !e.stacks || !e.stacks.length) return 0;
  return Math.min.apply(null, e.stacks.map((s) => s.secs));
}
// snapshot per-stack values from the inflictor's effective stats
function snapshotFor(key, src) {
  const s = src ? effStats(src) : emptyStatMap();
  switch (key) {
    case 'bleed': return { dps: 3 + 0.2 * s.str, burst: 6 + 0.4 * s.str };
    case 'frost': return { hit: 1 + 0.1 * s.wis, purge: 3 + 0.3 * s.wis };
    case 'poison': return { dps: 2 + 0.2 * s.dex };
    case 'mindrot': return { dps: 3 + 0.3 * s.int };
    case 'hemorrhage': return { dps: 5 + 0.4 * s.str };
    case 'siphon': return { src: src };
    default: return {};
  }
}
function addStatus(unit, key, opts) {
  opts = opts || {};
  const meta = statusMeta(key);
  if (!meta) return;
  // Purity: the next debuff is negated
  if (meta.bad && unit.status.purity && unit.status.purity.count > 0) {
    consumeCharge(unit, 'purity');
    logMsg(unit.name + '\'s Purity negates ' + meta.name + '!');
    return;
  }
  if (meta.kind === 'instant') return applyInstantStatus(unit, key, opts.dur || 1);
  if (meta.kind === 'charge') {
    const e = unit.status[key] || (unit.status[key] = { count: 0 });
    e.count += opts.count || 1;
    return;
  }
  const e = unit.status[key] || (unit.status[key] = { stacks: [] });
  const n = (meta.kind === 'stack') ? (opts.stacks || 1) : 1;
  for (let i = 0; i < n; i++) {
    const st = snapshotFor(key, opts.src);
    st.secs = opts.dur || 1;
    if (key === 'unwavered') st.dr = (opts.valBase || 2) + (opts.valMult || 0) * ((opts.src ? effStats(opts.src)[opts.valStat || 'fai'] : 0) || 0);
    if (key === 'enchant') { st.ench = opts.enchKey; st.enchDur = opts.enchDur; }
    if (meta.kind === 'dur' && e.stacks.length) {
      e.stacks[0].secs = Math.max(e.stacks[0].secs, st.secs); // refresh
    } else {
      e.stacks.push(st);
    }
  }
  if (key === 'taunt') {
    const live = unit.abil.filter((s) => s && !abilityDef(s.id).concept);
    unit.tauntSlot = live.length ? pick(live) : null;
  }
  if (key === 'flight') unit.flightAcc = 0;
  // Frost overload: 10+ stacks purge violently
  if (key === 'frost') {
    const fe = unit.status.frost;
    if (fe && fe.stacks.length >= 10) {
      const total = fe.stacks.reduce((a, s) => a + s.purge, 0);
      delete unit.status.frost;
      unit.hp -= total;
      addStatus(unit, 'interrupted', { dur: 2 });
      logMsg(unit.name + ' is overwhelmed by Frost! ' + Math.round(total) + ' damage and Interrupted.');
    }
  }
}
function consumeCharge(unit, key) {
  const e = unit.status[key];
  if (!e || !e.count) return false;
  e.count -= 1;
  if (e.count <= 0) delete unit.status[key];
  return true;
}
function removeOldestStack(unit, key) {
  const e = unit.status[key];
  if (!e || !e.stacks || !e.stacks.length) return;
  let mi = 0;
  e.stacks.forEach((s, i) => { if (s.secs < e.stacks[mi].secs) mi = i; });
  e.stacks.splice(mi, 1);
  if (!e.stacks.length) delete unit.status[key];
}
function cleanseOne(unit) {
  const bad = Object.keys(unit.status).filter((k) => statusMeta(k).bad);
  if (!bad.length) return false;
  delete unit.status[pick(bad)];
  return true;
}
function applyInstantStatus(unit, key, dur) {
  const live = unit.abil.filter((s) => s && !abilityDef(s.id).concept && (!s.ammo || s.ammo > 0));
  if (!live.length) return;
  const s = pick(live);
  if (key === 'nausea') { s.cd = Math.max(s.cd, dur); s.prog = 0; logMsg(unit.name + '\'s ' + abilityDef(s.id).name + ' is disrupted by Nausea!'); }
  if (key === 'concuss') { s.frozen = Math.max(s.frozen, dur); logMsg(unit.name + '\'s ' + abilityDef(s.id).name + ' is Concussed!'); }
}
function effStats(unit) {
  const s = {};
  STATS.forEach((k) => (s[k] = unit.stats[k]));
  if (stHas(unit, 'enlarged')) { s.end *= 1.3; s.str *= 1.3; }
  if (stHas(unit, 'unburdened')) { s.str *= 1.2; s.agi *= 1.2; s.dex *= 1.2; }
  if (stHas(unit, 'burdened')) { s.str *= 0.8; s.agi *= 0.8; s.dex *= 0.8; }
  return s;
}
function slotSpeed(unit, slot, def) {
  if (def.concept) return 0;
  if (slot.frozen > 0 || slot.sustaining) return 0;
  if (stHas(unit, 'interrupted')) return 0;
  if (unit.dormant && unit.hp >= unit.maxHp) return 0;
  if (C && C.silence && unit.isPlayer) return 0;
  let m = isSpell(def) ? unit.castSpeed : unit.atkSpeed;
  m *= Math.max(0, 1 - 0.10 * stCount(unit, 'frost'));
  if (stHas(unit, 'intimidated')) m *= 0.75;
  if (stHas(unit, 'terror')) m *= 0.5;
  if (stHas(unit, 'dazed')) m *= CFG.dazedSlow;
  if (stHas(unit, 'agile') && isSkillAb(def)) m *= 1.3;
  if (stHas(unit, 'flight')) m *= 1.5;
  if (stHas(unit, 'taunt') && unit.tauntSlot) m *= (slot === unit.tauntSlot ? 1.5 : 0.5);
  if (def.followUp && slot.followStacks > 0) m *= 1 + 0.25 * slot.followStacks;
  m *= slot.hasten || 1;
  // Battle Conscious: attack speed floor at 100%
  if (unit.concepts['battle-conscious'] && isSkillAb(def)) m = Math.max(m, unit.atkSpeed);
  return m;
}

// ---- numbers ----
function opAmount(op, stats) {
  const sv = (op.stat ? (stats[op.stat] || 0) : 0) + (op.stat2 ? (stats[op.stat2] || 0) : 0);
  return Math.max(0, op.base + (op.mult || 0) * sv);
}
function buffAmt(u) { return u.buffs.reduce((a, b) => a + b.amt, 0); }
function weakAmt(u) { return u.weaks.reduce((a, b) => a + b.amt, 0); }
function earlyCost(def, prog, slot) {
  const c = {};
  const cm = (slot && slot.costMult) || 1;
  ['stam', 'mana', 'reson'].forEach((k) => {
    if (def.cost[k]) c[k] = Math.max(0, Math.ceil(def.cost[k] * cm * (1 - prog)));
  });
  return c;
}
function canAfford(u, cost) {
  return (u.stam >= (cost.stam || 0)) && (u.mana >= (cost.mana || 0)) && (u.reson >= (cost.reson || 0));
}
function payCost(u, cost) {
  u.stam = Math.max(0, u.stam - (cost.stam || 0));
  u.mana = Math.max(0, u.mana - (cost.mana || 0));
  u.reson = Math.max(0, u.reson - (cost.reson || 0));
}

// ---- damage ----
function dealDamage(caster, target, amt, opts) {
  opts = opts || {};
  amt = Math.max(0, amt + buffAmt(caster) - weakAmt(caster));
  if (caster.concepts['skittish']) amt *= 0.5;
  if (target.concepts['skittish']) amt *= 0.5;
  if (caster.concepts['berserk']) amt *= 1.4;
  if (target.concepts['berserk']) amt *= 1.2;
  if (stHas(target, 'protection')) amt *= 0.75;
  if (opts.isSkill) amt *= 1 + 0.5 * stCount(target, 'bruised');
  if (stHas(target, 'plummet')) { amt *= 1.5; consumeCharge(target, 'plummet'); }
  // frost: extra damage per stack on each hit
  if (!opts.isDot && stHas(target, 'frost')) {
    amt += target.status.frost.stacks.reduce((a, s) => a + s.hit, 0);
  }
  if (stHas(target, 'unwavered')) {
    amt = Math.max(0, amt - target.status.unwavered.stacks[0].dr);
  }
  if (amt <= 0) return 0;
  let toShield = 0;
  const shieldWas = target.shield;
  if (!opts.isDot && !opts.pierce && target.shield > 0) {
    toShield = Math.min(target.shield, amt / 2);
    target.shield -= toShield;
  }
  const toHp = amt - toShield;
  target.hp -= toHp;
  if (opts.leech && toHp > 0) {
    caster.hp = Math.min(caster.maxHp, caster.hp + Math.max(1, toHp * opts.leech));
  }
  if (!opts.isDot) {
    // caster's stealth breaks when dealing damage
    if (stHas(caster, 'stealth')) delete caster.status.stealth;
    // enchants: hits inflict the enchanted condition
    if (stHas(caster, 'enchant')) {
      caster.status.enchant.stacks.forEach((en) => {
        addStatus(target, en.ench, { dur: en.enchDur, src: caster });
      });
    }
    // guard breaker: shield fully depleted by this hit
    if (caster.concepts['guard-breaker'] && shieldWas > 0 && target.shield <= 0) {
      addStatus(target, 'interrupted', { dur: 2 });
      addStatus(target, 'bleed', { dur: 3, src: caster });
      logMsg(caster.name + ' breaks the guard!');
    }
    // on-receive effects
    if (!target.concepts['disciplined']) addStatus(target, 'dazed', { dur: CFG.dazedSecs });
    if (target.concepts['fury']) target.fury += 1;
    if (stHas(target, 'latch')) addStatus(target, 'bleed', { dur: 5, src: caster });
    if (stHas(target, 'fracture')) addStatus(target, 'bruised', { dur: 5, src: caster });
    if (target.concepts['panic'] && !target.panicked && target.hp <= target.maxHp * 0.5) {
      target.panicked = true;
      addStatus(target, 'agile', { dur: 12 });
      addStatus(target, 'confusion', { count: 3 });
      logMsg(target.name + ' panics!');
    }
    if (target.concepts['buckle']) {
      target.buckleAcc += amt;
      if (target.buckleAcc >= 0.2 * target.maxHp) {
        target.maxHp = Math.round(target.maxHp * 0.9);
        const extra = 0.05 * target.maxHp;
        target.hp = Math.min(target.hp, target.maxHp) - extra;
        target.buckleAcc = 0;
        logMsg(target.name + ' Buckles! Max health crushed.');
      }
    }
    // flight: enough damage knocks you out of the air
    if (stHas(target, 'flight')) {
      target.flightAcc += amt;
      if (target.flightAcc >= 0.2 * target.maxHp) {
        delete target.status.flight;
        addStatus(target, 'plummet', { count: 3 });
        logMsg(target.name + ' Plummets!');
      }
    }
    // sustains accumulate damage and can break
    target.abil.forEach((s) => {
      if (!s || !s.sustaining) return;
      s.sustaining.acc += amt;
      if (s.sustaining.acc >= s.sustaining.threshold) {
        s.sustaining = null;
        s.cd = cooldownOf(target, defFor(target, s.id));
        logMsg(target.name + '\'s ' + abilityDef(s.id).name + ' is broken!');
      }
    });
    if (stHas(target, 'repent') && !opts.isReflect && target.hp > 0) {
      const back = amt * 0.5;
      logMsg(target.name + ' repents ' + Math.round(back) + ' damage back!');
      dealDamage(target, caster, back, { kind: 'mag', isReflect: true });
    }
    if (target.counter && !opts.isReflect && target.hp > 0) {
      const cs = target.counter; target.counter = null;
      const reflect = amt * cs.pct + cs.base + cs.mult * (effStats(target)[cs.stat] || 0);
      logMsg(target.name + ' counters for ' + Math.round(reflect) + '!');
      dealDamage(target, caster, reflect, { kind: 'phys', isReflect: true, isSkill: true });
    }
  }
  return amt;
}

function healUnit(u, n) {
  if (stHas(u, 'hemorrhage')) n *= 0.5;
  u.hp = Math.min(u.maxHp, u.hp + n);
  return n;
}

function applyOps(ops, caster, target, label, tag, ctx) {
  ctx = ctx || { mult: 1, extra: 0 };
  const out = [];
  const tagDmg = (tag && caster.dmgByTag) ? (caster.dmgByTag[tag] || 0) : 0;
  let firstDmg = true;
  ops.forEach((op) => {
    const n = opAmount(op, effStats(caster));
    switch (op.t) {
      case 'dmg': {
        let dmg = n * CFG.dmgScale + tagDmg;
        if (op.pctMaxHp) dmg += caster.maxHp * op.pctMaxHp; // e.g. Body Bash: 10% max HP
        if (firstDmg) { dmg += ctx.extra; firstDmg = false; }
        dmg *= ctx.mult;
        if (C.reverse && caster.isPlayer) {
          const healed = healUnit(target, dmg);
          out.push('+' + Math.round(healed) + ' stabilized');
          break;
        }
        const dealt = dealDamage(caster, target, dmg, { kind: op.kind, pierce: op.pierce, leech: op.leech, isSkill: ctx.isSkill });
        if (op.recoil && dealt > 0) { caster.hp -= dealt * op.recoil; out.push(Math.round(dealt) + ' dmg (recoil ' + Math.round(dealt * op.recoil) + ')'); }
        else out.push(Math.round(dealt) + ' dmg' + (op.pierce ? ' (pierce)' : ''));
        break;
      }
      case 'heal': {
        const h = healUnit(caster, n); out.push('+' + Math.round(h) + ' HP'); break;
      }
      case 'shield': {
        const cap = op.overcap ? Infinity : caster.maxShield;
        caster.shield = Math.min(cap, caster.shield + n);
        out.push('+' + Math.round(n) + ' shield' + (op.overcap ? ' (overcap)' : '')); break;
      }
      case 'st': {
        const who = op.to === 'self' ? [caster] : op.to === 'both' ? [caster, target] : [target];
        let stDur = op.dur;
        // Creeping Frost: each Frost you inflict lengthens future Frosts
        if (op.key === 'frost' && caster.concepts['creeping-frost']) {
          stDur = (op.dur || 0) + (caster.creepFrost || 0);
          caster.creepFrost = (caster.creepFrost || 0) + 1;
        }
        who.forEach((w) => addStatus(w, op.key, {
          dur: stDur, count: op.count, stacks: op.stacks, src: caster,
          valBase: op.valBase, valMult: op.valMult, valStat: op.valStat,
          enchKey: op.enchKey, enchDur: op.enchDur,
        }));
        const stx = (op.stacks && op.stacks > 1) ? op.stacks + '×' : (op.count && op.count > 1) ? op.count + '×' : '';
        out.push(stx + STATUSES[op.key].name + (op.dur ? ' ' + op.dur : ''));
        break;
      }
      case 'dot': {
        target.dots.push({ dps: n * CFG.dmgScale, secs: op.secs, label: op.label || 'DoT' });
        out.push((op.label || 'DoT') + ' ' + Math.round(n) + '/s x' + op.secs + 's'); break;
      }
      case 'buff':
        caster.buffs.push({ amt: n, secs: op.secs }); out.push('+' + Math.round(n) + ' dmg ' + op.secs + 's'); break;
      case 'weaken':
        target.weaks.push({ amt: n, secs: op.secs }); out.push('enemy -' + Math.round(n) + ' dmg ' + op.secs + 's'); break;
    }
  });
  logMsg(caster.name + ' • ' + label + ': ' + (out.join(', ') || 'activated'));
}

// ---- descriptions ----
function describeOps(ops, stats) {
  return (ops || []).map((op) => {
    const n = Math.round(opAmount(op, stats));
    switch (op.t) {
      case 'dmg': return 'Deal ' + n + (op.kind === 'mag' ? ' magic' : ' physical') + (op.pierce ? ' (pierce)' : '') + (op.recoil ? ', recoil ' + Math.round(op.recoil * 100) + '%' : '') + (op.leech ? ', heal ' + Math.round(op.leech * 100) + '%' : '');
      case 'heal': return 'Heal ' + n;
      case 'shield': return '+' + n + ' shield' + (op.overcap ? ' (can Overcap)' : '');
      case 'st': {
        const stx = (op.stacks && op.stacks > 1) ? op.stacks + '×' : (op.count && op.count > 1) ? op.count + '×' : '';
        return (op.to === 'self' ? 'Gain ' : op.to === 'both' ? 'Everyone gains ' : 'Inflict ') +
          stx + STATUSES[op.key].name + (op.dur ? ' ' + op.dur : '');
      }
      case 'dot': return (op.label || 'DoT') + ' ' + n + '/s for ' + op.secs + 's';
      case 'buff': return '+' + n + ' damage ' + op.secs + 's';
      case 'weaken': return 'Enemy -' + n + ' damage ' + op.secs + 's';
    }
    return '';
  }).join(' · ');
}
function formulaOps(ops, unit) {
  return (ops || []).map((op) => {
    if (op.t === 'st') {
      const stx = (op.stacks && op.stacks > 1) ? op.stacks + '×' : (op.count && op.count > 1) ? op.count + '×' : '';
      return '[[' + op.key + ']]' + stx + STATUSES[op.key].name + (op.dur ? ' ' + op.dur : '') + ' — ' + STATUSES[op.key].desc +
        (op.to === 'self' ? ' (on you)' : op.to === 'both' ? ' (on everyone)' : '');
    }
    let f = '' + op.base;
    const es = effStats(unit);
    if (op.pctMaxHp) f += ' + ' + Math.round(op.pctMaxHp * 100) + '% max HP(' + Math.round(unit.maxHp * op.pctMaxHp) + ')';
    if (op.mult && op.stat) f += ' + ' + op.mult + '×' + STAT_INFO[op.stat].abbr + '(' + Math.round(es[op.stat] || 0) + ')';
    if (op.mult && op.stat2) f += ' + ' + op.mult + '×' + STAT_INFO[op.stat2].abbr + '(' + Math.round(es[op.stat2] || 0) + ')';
    const n = Math.round(opAmount(op, es) + (op.pctMaxHp ? unit.maxHp * op.pctMaxHp : 0));
    const names = { dmg: (op.kind === 'mag' ? 'Magic damage' : 'Physical damage'), heal: 'Heal',
      shield: 'Shield' + (op.overcap ? ' (Overcap)' : ''), dot: (op.label || 'DoT') + '/s (' + op.secs + 's)',
      buff: 'Damage buff (' + op.secs + 's)', weaken: 'Enemy damage cut (' + op.secs + 's)' };
    return (names[op.t] || op.t) + ': ' + f + ' = ' + n +
      (op.pierce ? ' · ignores shield' : '') + (op.leech ? ' · heals ' + Math.round(op.leech * 100) + '%' : '');
  });
}
function costText(cost) {
  const parts = [];
  if (cost.stam) parts.push(cost.stam + ' stam');
  if (cost.mana) parts.push(cost.mana + ' mana');
  if (cost.reson) parts.push(cost.reson + ' reson');
  return parts.join(', ') || 'passive';
}

// ---- activation ----
function castAbility(unit, target, slot, free, isInitiate) {
  const def = defFor(unit, slot.id);
  if (!def || def.concept) return false;
  if (C.silence && unit.isPlayer) return false;
  if (slot.ammo !== null && slot.ammo <= 0) return false;
  if (slot.sustaining) return false;
  if (!free) {
    const cost = earlyCost(def, slot.prog, slot);
    if (!canAfford(unit, cost)) return false;
    payCost(unit, cost);
  }
  slot.prog = 0;
  const bursts = 1 + burstOf(def, slot);
  // cooldown handling
  if (def.sustain) {
    slot.sustaining = { acc: 0, threshold: def.sustain.thresholdPct * unit.maxHp };
  } else if (slot.ammo !== null) {
    slot.ammo -= 1;
    if (slot.ammo > 0) slot.cd = def.charge ? 0 : cooldownOf(unit, def) * bursts;
    else { slot.cd = rechargeCd(unit, def); slot.reloading = true; }
  } else {
    slot.cd = cooldownOf(unit, def) * bursts;
  }
  if (!unit.isPlayer && !unit.isAlly && G.profile && !G.profile.seen[slot.id]) { G.profile.seen[slot.id] = true; save(); }

  // specials
  if (def.special === 'flee') {
    logMsg(unit.name + ' flees! No victory, no spoils.');
    C.over = true; C.fled = true; C.restartAt = C.elapsed + 1.0;
    return true;
  }
  if (def.special === 'endwin') {
    logMsg(unit.name + ' • ' + def.name);
    C.ending = true; C.noReward = true; C.endAt = C.elapsed + 3;
    return true;
  }
  if (def.special === 'counter') {
    unit.counter = { pct: 0.5, base: 3, mult: 1.1, stat: 'str' };
    logMsg(unit.name + ' • ' + def.name + ': braced to counter!');
    return true;
  }
  if (def.special === 'sonic') {
    let best = null;
    unit.abil.forEach((s) => {
      if (!s || abilityDef(s.id).concept) return;
      const d2 = defFor(unit, s.id);
      if (!d2.cost.stam) return;
      if (!best || d2.cost.stam > defFor(unit, best.id).cost.stam) best = s;
    });
    if (best) { best.bonusBurst += 1; logMsg(unit.name + ' • ' + def.name + ': ' + abilityDef(best.id).name + ' gains Burst!'); }
    return true;
  }
  if (def.special === 'hatred') {
    ['str', 'end', 'dex', 'agi', 'int', 'wis', 'fai', 'pie'].forEach((k) => (unit.stats[k] += 10));
    logMsg(unit.name + ' • ' + def.name + ': its hatred grows...');
    return true;
  }
  if (def.rally) {
    const mySide = (unit === C.player || unit.allyOfPlayer) ? C.pAllies : C.eAllies;
    if (mySide.length < CFG.maxAllies) {
      const clone = buildAlly(unit.classId, unit === C.player || unit.allyOfPlayer, C.node);
      if (clone) { mySide.push(clone); logMsg('Another ' + clone.name + ' joins the fight!'); }
    }
    slot.costMult = (slot.costMult || 1) * 2; // mana cost doubles for the rest of combat
    return true;
  }
  if (def.speedLink) {
    unit.abil.forEach((s) => { if (s && s.id === def.speedLink.id) s.hasten = def.speedLink.mult; });
  }
  if (def.sustain) {
    if (slot.id === 'feast') logMsg(unit.name + ' begins to Feast...');
    return true;
  }

  const damaging = def.full.some((op) => op.t === 'dmg');
  for (let b = 0; b < bursts; b++) {
    const ctx = { mult: 1, extra: 0, isSkill: isSkillAb(def) };
    let tgt = target && target.hp > 0 ? target : pickTarget(unit);
    if (!tgt) break;
    if (damaging) {
      // blind: 30% chance to miss
      if (stHas(unit, 'blind') && Math.random() < 0.3) { logMsg(unit.name + ' misses ' + def.name + ' (Blind)!'); continue; }
      if (consumeCharge(unit, 'guilt')) { ctx.mult *= 0.5; logMsg(unit.name + ' holds back (Guilt).'); }
      if (consumeCharge(unit, 'confusion') && Math.random() < 0.5) {
        tgt = unit; logMsg(unit.name + ' is Confused and lashes out at... themselves!');
      }
      if (unit.status.empower && unit.status.empower.count) { ctx.extra += effStats(unit).pie; consumeCharge(unit, 'empower'); }
      if (def.doubleIfProtected && stHas(unit, 'protection')) ctx.mult *= 2;
      if (def.followDmg && slot.followStacks > 0) {
        ctx.extra += slot.followStacks * (def.followDmg.base + def.followDmg.mult * (effStats(unit)[def.followDmg.stat] || 0));
      }
      if (unit.concepts['fury'] && ctx.isSkill && def.tag === 'str') ctx.extra += unit.fury;
      if (unit.concepts['arcane-crafted'] && free && !isInitiate && isSpell(def)) ctx.mult *= 1.5;
      if (isInitiate && def.initDmgMult) ctx.mult *= def.initDmgMult;
      if (tgt !== unit && stHas(tgt, 'stealth') && !C.reverse) { logMsg(tgt.name + ' is hidden — ' + def.name + ' misses!'); continue; }
      if (tgt !== unit && stHas(tgt, 'shrink') && Math.random() < 0.2) { logMsg(tgt.name + ' dodges ' + def.name + '!'); continue; }
      if (unit.concepts['skittish'] && tgt !== unit && Math.random() < 0.5) { logMsg(unit.name + ' skitters and misses!'); continue; }
      if (tgt !== unit && tgt.concepts['skittish'] && Math.random() < 0.5) { logMsg(tgt.name + ' skitters away!'); continue; }
      // bounty hunter: overkill pays out
      if (def.special === 'bounty' && unit.isPlayer) {
        const before = tgt.hp;
        applyOps(isInitiate && def.initOps ? def.initOps.concat(def.full) : def.full, unit, tgt, def.name, def.tag, ctx);
        if (tgt.hp <= 0 && before > 0) {
          const over = Math.round(-tgt.hp);
          if (over > 0) { G.profile.gold += over; logMsg('Bounty! +' + over + ' overkill gold.'); }
        }
        continue;
      }
    }
    const ops = isInitiate && def.initOps ? def.initOps.concat(def.full) : def.full;
    applyOps(ops, unit, tgt, def.name + (isInitiate ? ' (Initiate)' : ''), def.tag, ctx);
    // bleed bursts when the BLEEDING unit activates — handled for the caster below
  }
  // activating any ability triggers your own bleed burst
  if (stHas(unit, 'bleed')) {
    const e = unit.status.bleed;
    const total = e.stacks.reduce((a, s) => a + s.burst, 0);
    unit.hp -= total;
    removeOldestStack(unit, 'bleed');
    logMsg(unit.name + ' bleeds for ' + Math.round(total) + '!');
  }
  if (damaging) {
    unit.abil.forEach((s) => {
      if (!s || !abilityDef(s.id).followUp) return;
      if (s === slot) s.followStacks = 0;
      else if (isSkillAb(def)) s.followStacks += 1;
    });
    if (slot.hasten > 1) slot.hasten = 1;
  }
  return true;
}

function playerActivate(slotIdx) {
  if (!C || C.over) return;
  const slot = C.player.abil[slotIdx];
  if (!slot || slot.cd > 0 || slot.frozen > 0 || slot.sustaining) return;
  const def = defFor(C.player, slot.id);
  if (!def || def.concept) return;
  castAbility(C.player, pickTarget(C.player), slot, false);
  checkEnd();
}

// ---- per-frame ----
function regenUnit(u, dt) {
  // status stack timers
  Object.keys(u.status).forEach((k) => {
    const e = u.status[k];
    if (!e.stacks) return;
    e.stacks = e.stacks.filter((s) => (s.secs -= dt) > 0);
    if (!e.stacks.length) delete u.status[k];
  });
  if (!stHas(u, 'taunt')) u.tauntSlot = null;
  // hp regen with modifiers
  let hpReg = u.hpRegen;
  if (stCount(u, 'frost') > 0) hpReg *= 0.5;
  if (stHas(u, 'poison')) hpReg = 0;
  if (hpReg > 0) healUnit(u, hpReg * dt);
  if (stHas(u, 'regen')) healUnit(u, 0.05 * u.maxHp * dt);
  // sustained Feast grants regen
  u.abil.forEach((s) => { if (s && s.sustaining && s.id === 'feast') healUnit(u, 0.05 * u.maxHp * dt); });
  // damaging stacks
  if (stHas(u, 'poison')) {
    u.hp -= 0.01 * u.maxHp * dt;
    u.hp -= u.status.poison.stacks.reduce((a, s) => a + s.dps, 0) * dt;
  }
  if (stHas(u, 'bleed')) u.hp -= u.status.bleed.stacks.reduce((a, s) => a + s.dps, 0) * dt;
  if (stHas(u, 'hemorrhage')) u.hp -= u.status.hemorrhage.stacks.reduce((a, s) => a + s.dps, 0) * dt;
  if (stHas(u, 'mindrot')) {
    const dps = u.status.mindrot.stacks.reduce((a, s) => a + s.dps, 0);
    u.hp -= dps * dt;
    u.mana -= dps * dt;
    if (u.mana <= 0) {
      u.mana = 0;
      delete u.status.mindrot;
      u.hp = u.hp / 2;
      logMsg(u.name + '\'s mind fractures! Half their health is lost.');
    }
  }
  if (stHas(u, 'siphon')) {
    u.status.siphon.stacks.forEach((s) => {
      const drain = 0.03 * u.maxHp * dt;
      u.hp -= drain;
      if (s.src && s.src.hp > 0) healUnit(s.src, drain);
    });
  }
  u.mana = Math.min(u.maxMana, u.mana + u.manaRegen * dt);
  u.stam = Math.min(u.maxStam, u.stam + u.stamRegen * dt);
  u.reson = Math.min(u.maxReson, u.reson + u.resonRegen * dt);
  if (u.shield > u.maxShield) {
    const excess = u.shield - u.maxShield;
    u.shield = u.maxShield + excess * Math.max(0, 1 - 0.01 * dt);
  }
  // concept ticks
  if (u.concepts['in-the-name-of']) {
    u.itnTimer += dt;
    while (u.itnTimer >= 2) { u.itnTimer -= 2; addStatus(u, 'empower', { count: 1 }); }
  }
  if (u.concepts['holier-than-thou'] && u.reson >= u.maxReson - 0.01) {
    const foe = pickTarget(u);
    if (foe) dealDamage(u, foe, u.resonRegen * dt, { kind: 'mag', isDot: true });
  }
  u.buffs = u.buffs.filter((b) => (b.secs -= dt) > 0);
  u.weaks = u.weaks.filter((w) => (w.secs -= dt) > 0);
  u.dots = u.dots.filter((d) => {
    u.hp -= d.dps * Math.min(dt, d.secs);
    d.secs -= dt;
    return d.secs > 0;
  });
}

function advanceBars(u, dt) {
  let cdRate = 1;
  if (stHas(u, 'cdfast')) cdRate *= 1.25;
  if (stHas(u, 'cdslow')) cdRate *= 0.8;
  for (let i = 0; i < u.abil.length; i++) {
    const s = u.abil[i];
    if (!s) continue;
    const def = defFor(u, s.id);
    if (!def || def.concept || s.sustaining) continue;
    if (s.frozen > 0) { s.frozen = Math.max(0, s.frozen - dt); continue; }
    if (s.cd > 0) {
      s.cd = Math.max(0, s.cd - dt * cdRate);
      if (s.cd === 0 && s.reloading) { s.ammo = def.ammo; s.reloading = false; }
      continue;
    }
    if (s.ammo !== null && s.ammo <= 0) {
      if (s.reloading) continue;
      s.ammo = def.ammo;
    }
    const speed = slotSpeed(u, s, def);
    if (speed <= 0) continue;
    s.prog += dt * speed / fillTimeOf(u, def, s);
    if (s.prog >= 1) {
      s.prog = 1;
      castAbility(u, pickTarget(u), s, true);
      if (C.over || C.player.hp <= 0 || C.enemy.hp <= 0) return;
    }
  }
}

function combatTick(dt) {
  if (!C || C.over) return;
  C.elapsed += dt;
  if (C.ending && C.elapsed >= C.endAt) {
    C.over = true;
    if (C.noReward) { recordWin(); checkCompletions().forEach(logMsg); autoAdvanceAfterWin(); save(); }
    C.restartAt = C.elapsed + 1.0;
    return;
  }
  allUnits().forEach((u) => { if (u.hp > 0) regenUnit(u, dt); });
  C.pAllies = C.pAllies.filter((a) => a.hp > 0);
  C.eAllies = C.eAllies.filter((a) => a.hp > 0);
  if (checkEnd()) return;
  allUnits().forEach((u) => { if (u.hp > 0 && !C.over) advanceBars(u, dt); });
  C.pAllies = C.pAllies.filter((a) => a.hp > 0);
  C.eAllies = C.eAllies.filter((a) => a.hp > 0);
  checkEnd();
}

// ---- resolution ----
function checkEnd() {
  if (!C || C.over) return C && C.over;
  if (C.ending) return false;
  if (C.reverse) {
    if (C.enemy.hp <= 0) { C.over = true; logMsg('She didn\'t make it... You couldn\'t save her.'); C.restartAt = C.elapsed + 1.5; return true; }
    if (C.player.hp <= 0) { onLoss(); return true; }
    return false;
  }
  if (C.enemy.hp <= 0 && C.eAllies.every((a) => a.hp <= 0)) { onWin(); return true; }
  if (C.player.hp <= 0) { onLoss(); return true; }
  return false;
}

function autoAdvanceAfterWin() {
  const g = G.profile.node;
  if (G.profile.autoTravel && winsOn(g) === reqFor(g) && g < TOTAL_PAGES - 1) {
    if (travel(1)) logMsg('Requirement met — moving ahead!');
  }
}

function onWin() {
  C.over = true;
  const sel = G.profile.selectedClass;
  const g = G.profile.node;
  const xp = masteryXp(killXpFor(g)); // (base + 100×M) × (1 + M)
  addClassXp(sel, xp);
  addStatXp(sel, xp);
  recordWin();
  const gold = goldFor(g);
  G.profile.gold += gold;
  let msg = 'Victory! +' + xp + ' XP, +' + gold + ' gold';
  const dropLvl = C.info.gearLvl;
  if (Math.random() < CFG.dropChance) {
    if (invFull()) msg += ' — an item drops but your bag is full!';
    else { const it = genItem(dropLvl); G.profile.inventory.push(it); msg += ' — ' + it.name + ' (L' + it.level + ') drops!'; }
  }
  if (Math.random() < CFG.runeChance) {
    if (invFull()) msg += ' — a rune drops but your bag is full!';
    else { const ru = genRune(dropLvl); G.profile.inventory.push(ru); msg += ' — Rune of ' + STAT_INFO[ru.stat].name + '!'; }
  }
  if (Math.random() < CFG.tomeChance) {
    const tome = genTome();
    if (tome) { G.profile.inventory.push(tome); msg += ' — a TOME drops!'; }
  }
  const auto = processAutoSalvage();
  if (auto.salvaged || auto.extracted) {
    msg += ' [auto: ' + (auto.salvaged ? auto.salvaged + ' salvaged' : '') +
      (auto.extracted ? (auto.salvaged ? ', ' : '') + auto.extracted + ' extracted' : '') + ']';
  }
  logMsg(msg + ' (' + winsOn(g) + '/' + reqFor(g) + ' wins)');
  checkCompletions().forEach(logMsg);
  autoAdvanceAfterWin();
  save();
  C.restartAt = C.elapsed + 1.0;
}

function onLoss() {
  C.over = true;
  logMsg('Defeated. Regrouping...');
  C.restartAt = C.elapsed + 1.0;
}

function maybeRestart(dt) {
  if (!C || !C.over) return;
  C.elapsed += dt;
  if (C.elapsed >= C.restartAt) newBattle();
}
