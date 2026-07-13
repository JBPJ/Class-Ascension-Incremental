// ===== Pathbound (Idle rework) — fill-bar combat engine with statuses =====
'use strict';

let C = null;

// ---- ability metadata ----
function abilityDef(id) { return ABILITIES[id]; }
function costTotal(cost) { return (cost.stam || 0) + (cost.mana || 0) + (cost.reson || 0); }
function isSpell(def) { return !!(def.cost.mana || def.cost.reson); }
function isSkillAb(def) { return !!def.cost.stam; }
function fillTimeOf(side, def) {
  return Math.max(0.25, costTotal(def.cost)); // seconds of "cost" — divided by live speed while filling
}

function slotState(id) {
  const def = abilityDef(id);
  return {
    id: id,
    prog: 0,
    cd: (def && def.startCd) ? cooldownOf(null, def) : 0,
    ammo: (def && def.ammo) ? def.ammo : null,
    reloading: false,   // ammo/charge refill in progress
    frozen: 0,          // concuss
    followStacks: 0,    // follow-up mechanic
    hasten: 1,          // speedLink boost until it deals damage
    rf: 0,              // repeating-focus cast counter
    freeUsed: false,    // firstFree consumed
  };
}

function cooldownOf(side, def) {
  let cd = isSpell(def) ? CFG.cdSpell : CFG.cdSkill;
  if (side && side.concepts) {
    if (side.concepts['tireless']) cd = Math.max(0, cd - 0.5);
    if (side.concepts['rebound'] && def.tag === 'agi' && isSkillAb(def)) cd = 0;
  }
  return cd;
}
// the long cooldown after the last use of an ammo/charge ability
// (modifiers like Tireless apply to the base BEFORE the multiplier)
function rechargeCd(side, def) {
  const base = cooldownOf(side, def);
  if (def.charge) return base * (1 + 0.5 * def.ammo); // Charge: +50% per charge
  return base * 5;                                    // Ammo: 5× reload
}

function combatant(name, classId, level, stats, slotIds, isPlayer) {
  const d = derive(stats);
  const c = {
    name: name, classId: classId, level: level, isPlayer: !!isPlayer,
    stats: stats,
    abil: slotIds.map((id) => (id ? slotState(id) : null)),
    concepts: {},
    maxHp: d.maxHp, hp: d.maxHp, hpRegen: d.hpRegen,
    maxShield: d.maxShield, shield: d.maxShield,
    maxMana: d.maxMana, mana: d.maxMana, manaRegen: d.manaRegen,
    maxStam: d.maxStam, stam: d.maxStam, stamRegen: d.stamRegen,
    maxReson: d.maxReson, reson: 0, resonRegen: d.resonRegen,
    atkSpeed: d.atkSpeed, castSpeed: d.castSpeed,
    status: {},          // key -> {secs} or {count}
    counter: null,       // pending Counter Strike
    fury: 0,             // Fury concept stacks
    buckleAcc: 0,        // Buckle concept accumulator
    dots: [], buffs: [], weaks: [],   // legacy draft-skill effects
  };
  c.abil.forEach((s) => {
    if (s && abilityDef(s.id) && abilityDef(s.id).concept) c.concepts[s.id] = true;
  });
  // concept build effects
  if (c.concepts['watched-over']) { c.maxHp += stats.fai; c.hp = c.maxHp; }
  if (c.concepts['diseased']) c.hpRegen = 0;
  return c;
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
  np.fury = old.fury; np.buckleAcc = old.buckleAcc;
  const prev = {};
  old.abil.forEach((s) => { if (s) prev[s.id] = s; });
  np.abil.forEach((s) => {
    if (s && prev[s.id]) {
      const o = prev[s.id];
      s.prog = o.prog; s.cd = o.cd; s.ammo = o.ammo; s.reloading = o.reloading; s.frozen = o.frozen;
      s.followStacks = o.followStacks; s.hasten = o.hasten; s.rf = o.rf; s.freeUsed = o.freeUsed;
    }
  });
  C.player = np;
}

function buildEnemy(g) {
  const ed = genEnemy(g);
  const c = combatant(ed.name, ed.id, 0, ed.stats, ed.abilities, false);
  c.maxHp = ed.hp; c.hp = ed.hp;   // authored HP overrides the formula
  c.bookTag = ed.bookTag;
  if (ed.noRegen) c.hpRegen = 0;
  if (ed.noShield) { c.maxShield = 0; c.shield = 0; }
  return c;
}

function startSession() {
  G.session = true;
  skipClearedPages();
  const msgs = checkCompletions();
  newBattle();
  msgs.forEach(logMsg);
}
function endSession() {
  G.session = false;
  C = null;
}

function newBattle() {
  const g = G.profile.node;
  C = {
    node: g,
    info: pageInfo(g),
    player: buildPlayer(),
    enemy: buildEnemy(g),
    log: [],
    over: false, fled: false,
    elapsed: 0,
  };
  logMsg(C.enemy.name + ' — ' + C.info.bookName + ', "' + C.info.chapterName + '", Page ' + C.info.page + '.');
}

function logMsg(s) { if (!C) return; C.log.push(s); if (C.log.length > 60) C.log.shift(); }

// ---- statuses ----
function stHas(side, key) { return !!side.status[key]; }
function addStatus(side, key, dur, count) {
  const meta = STATUSES[key];
  if (meta.instant) return applyInstantStatus(side, key, dur);
  if (meta.charge || count) {
    const cur = side.status[key];
    side.status[key] = { count: ((cur && cur.count) || 0) + (count || 1) };
  } else {
    const cur = side.status[key];
    side.status[key] = { secs: Math.max((cur && cur.secs) || 0, dur || 1) };
  }
}
function consumeCharge(side, key) {
  const st = side.status[key];
  if (!st || !st.count) return false;
  st.count -= 1;
  if (st.count <= 0) delete side.status[key];
  return true;
}
function applyInstantStatus(side, key, dur) {
  const live = side.abil.filter((s) => s && !abilityDef(s.id).concept && (!s.ammo || s.ammo > 0));
  if (!live.length) return;
  const s = pick(live);
  if (key === 'nausea') { s.cd = Math.max(s.cd, dur); s.prog = 0; logMsg(side.name + '\'s ' + abilityDef(s.id).name + ' is disrupted by Nausea!'); }
  if (key === 'concuss') { s.frozen = Math.max(s.frozen, dur); logMsg(side.name + '\'s ' + abilityDef(s.id).name + ' is Concussed!'); }
}
// stats after multiplicative status buffs
function effStats(side) {
  const s = {};
  STATS.forEach((k) => (s[k] = side.stats[k]));
  if (stHas(side, 'enlarged')) { s.end *= 1.3; s.str *= 1.3; }
  if (stHas(side, 'unburdened')) { s.str *= 1.2; s.agi *= 1.2; s.dex *= 1.2; }
  return s;
}
// live fill-speed multiplier for one slot ("Ability Speed")
function slotSpeed(side, slot, def) {
  if (def.concept) return 0;
  if (slot.frozen > 0) return 0;
  if (stHas(side, 'interrupted')) return 0;
  let m = isSpell(def) ? side.castSpeed : side.atkSpeed;
  if (stHas(side, 'frost')) m *= 0.9;
  if (stHas(side, 'intimidated')) m *= 0.75;
  if (stHas(side, 'dazed')) m *= CFG.dazedSlow;
  if (stHas(side, 'agile') && isSkillAb(def)) m *= 1.3;
  if (def.followUp && slot.followStacks > 0) m *= 1 + 0.25 * slot.followStacks;
  m *= slot.hasten || 1;
  return m;
}

// ---- numbers ----
function opAmount(op, stats) {
  const sv = (op.stat ? (stats[op.stat] || 0) : 0) + (op.stat2 ? (stats[op.stat2] || 0) : 0);
  return Math.max(0, op.base + (op.mult || 0) * sv);
}
function buffAmt(side) { return side.buffs.reduce((a, b) => a + b.amt, 0); }
function weakAmt(side) { return side.weaks.reduce((a, b) => a + b.amt, 0); }

function earlyCost(def, prog) {
  const c = {};
  ['stam', 'mana', 'reson'].forEach((k) => {
    if (def.cost[k]) c[k] = Math.max(0, Math.ceil(def.cost[k] * (1 - prog)));
  });
  return c;
}
function canAfford(side, cost) {
  return (side.stam >= (cost.stam || 0)) && (side.mana >= (cost.mana || 0)) && (side.reson >= (cost.reson || 0));
}
function payCost(side, cost) {
  side.stam = Math.max(0, side.stam - (cost.stam || 0));
  side.mana = Math.max(0, side.mana - (cost.mana || 0));
  side.reson = Math.max(0, side.reson - (cost.reson || 0));
}

// ---- damage ----
function dealDamage(caster, target, amt, opts) {
  opts = opts || {};
  amt = Math.max(0, amt + buffAmt(caster) - weakAmt(caster));
  if (caster.concepts && caster.concepts['skittish']) amt *= 0.5; // Skittish deals half
  if (target.concepts && target.concepts['skittish']) amt *= 0.5; // ...and receives half
  if (stHas(target, 'protection')) amt *= 0.75;
  if (opts.isSkill && stHas(target, 'bruised')) amt *= 1.5;
  if (amt <= 0) return 0;
  let toShield = 0;
  if (!opts.isDot && !opts.pierce && target.shield > 0) {
    toShield = Math.min(target.shield, amt / 2);
    target.shield -= toShield;
  }
  const toHp = amt - toShield;
  target.hp -= toHp;
  if (opts.leech && toHp > 0) {
    caster.hp = Math.min(caster.maxHp, caster.hp + Math.max(1, toHp * opts.leech));
  }
  // on-receive effects
  if (!opts.isDot) {
    if (!target.concepts['disciplined']) addStatus(target, 'dazed', CFG.dazedSecs);
    if (target.concepts['fury']) target.fury += 1;
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
    if (target.counter && !opts.isCounter && target.hp > 0) {
      const cs = target.counter; target.counter = null;
      const reflect = amt * cs.pct + cs.base + cs.mult * (effStats(target)[cs.stat] || 0);
      logMsg(target.name + ' counters for ' + Math.round(reflect) + '!');
      dealDamage(target, caster, reflect, { kind: 'phys', isCounter: true, isSkill: true });
    }
  }
  return amt;
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
        if (firstDmg) { dmg += ctx.extra; firstDmg = false; }
        dmg *= ctx.mult;
        const dealt = dealDamage(caster, target, dmg, { kind: op.kind, pierce: op.pierce, leech: op.leech, isSkill: ctx.isSkill });
        out.push(Math.round(dealt) + ' dmg' + (op.pierce ? ' (pierce)' : ''));
        break;
      }
      case 'heal':
        caster.hp = Math.min(caster.maxHp, caster.hp + n); out.push('+' + Math.round(n) + ' HP'); break;
      case 'shield': {
        const cap = op.overcap ? Infinity : caster.maxShield;
        caster.shield = Math.min(cap, caster.shield + n);
        out.push('+' + Math.round(n) + ' shield' + (op.overcap ? ' (overcap)' : '')); break;
      }
      case 'st': {
        const who = op.to === 'self' ? [caster] : op.to === 'both' ? [caster, target] : [target];
        who.forEach((w) => addStatus(w, op.key, op.dur, op.count));
        out.push(STATUSES[op.key].name + (op.dur ? ' ' + op.dur : op.count ? ' ×' + op.count : '') +
          (op.to === 'self' ? '' : op.to === 'both' ? ' (everyone)' : '')); break;
      }
      case 'dot': {
        const lbl = op.label || 'DoT';
        target.dots.push({ dps: n * CFG.dmgScale, secs: op.secs, label: lbl });
        out.push(lbl + ' ' + Math.round(n) + '/s x' + op.secs + 's'); break;
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
  return ops.map((op) => {
    const n = Math.round(opAmount(op, stats));
    switch (op.t) {
      case 'dmg': return 'Deal ' + n + (op.kind === 'mag' ? ' magic' : ' physical') + (op.pierce ? ' (pierce)' : '') + (op.leech ? ', heal ' + Math.round(op.leech * 100) + '%' : '');
      case 'heal': return 'Heal ' + n;
      case 'shield': return '+' + n + ' shield' + (op.overcap ? ' (can Overcap)' : '');
      case 'st': return (op.to === 'self' ? 'Gain ' : op.to === 'both' ? 'Everyone gains ' : 'Inflict ') +
        STATUSES[op.key].name + (op.dur ? ' ' + op.dur : op.count ? ' ×' + op.count : '');
      case 'dot': return (op.label || 'DoT') + ' ' + n + '/s for ' + op.secs + 's';
      case 'buff': return '+' + n + ' damage ' + op.secs + 's';
      case 'weaken': return 'Enemy -' + n + ' damage ' + op.secs + 's';
    }
    return '';
  }).join(' · ');
}
function formulaOps(ops, side) {
  return ops.map((op) => {
    if (op.t === 'st') {
      return STATUSES[op.key].name + (op.dur ? ' ' + op.dur : op.count ? ' ×' + op.count : '') + ' — ' + STATUSES[op.key].desc +
        (op.to === 'self' ? ' (on you)' : op.to === 'both' ? ' (on everyone)' : '');
    }
    let f = '' + op.base;
    const es = effStats(side);
    if (op.mult && op.stat) f += ' + ' + op.mult + '×' + STAT_INFO[op.stat].abbr + '(' + Math.round(es[op.stat] || 0) + ')';
    if (op.mult && op.stat2) f += ' + ' + op.mult + '×' + STAT_INFO[op.stat2].abbr + '(' + Math.round(es[op.stat2] || 0) + ')';
    const n = Math.round(opAmount(op, es));
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
function castAbility(side, foe, slot, free) {
  const def = abilityDef(slot.id);
  if (!def || def.concept) return false;
  if (stHas(side, 'blind')) return false;
  if (slot.ammo !== null && slot.ammo <= 0) return false;
  if (!free) {
    let cost = earlyCost(def, slot.prog);
    if (def.firstFree && !slot.freeUsed) cost = {};
    if (!canAfford(side, cost)) return false;
    payCost(side, cost);
  }
  if (def.firstFree) slot.freeUsed = true;
  slot.prog = 0;
  if (slot.ammo !== null) {
    slot.ammo -= 1;
    if (slot.ammo > 0) {
      // Charge abilities have no cooldown while charges remain
      slot.cd = def.charge ? 0 : cooldownOf(side, def);
    } else {
      slot.cd = rechargeCd(side, def); // long refill, then ammo/charges restore
      slot.reloading = true;
    }
  } else {
    slot.cd = cooldownOf(side, def);
  }
  // reveal enemy abilities on first activation
  if (!side.isPlayer && G.profile && !G.profile.seen[slot.id]) { G.profile.seen[slot.id] = true; save(); }

  // specials
  if (def.special === 'flee') {
    logMsg(side.name + ' flees! No victory, no spoils.');
    C.over = true; C.fled = true; C.restartAt = C.elapsed + 1.0;
    return true;
  }
  if (def.special === 'counter') {
    side.counter = { pct: 0.5, base: 3, mult: 1.1, stat: 'str' };
    logMsg(side.name + ' • ' + def.name + ': braced to counter!');
    return true;
  }
  if (def.speedLink) {
    side.abil.forEach((s) => { if (s && s.id === def.speedLink.id) s.hasten = def.speedLink.mult; });
  }

  // damaging-ability pre-checks
  const damaging = def.full.some((op) => op.t === 'dmg');
  const ctx = { mult: 1, extra: 0, isSkill: isSkillAb(def) };
  let target = foe;
  if (damaging) {
    if (consumeCharge(side, 'guilt')) { ctx.mult *= 0.5; logMsg(side.name + ' holds back (Guilt).'); }
    if (consumeCharge(side, 'confusion') && Math.random() < 0.5) {
      target = side; logMsg(side.name + ' is Confused and lashes out at... themselves!');
    }
    if (side.status.empower && side.status.empower.count) {
      ctx.extra += effStats(side).pie; consumeCharge(side, 'empower');
    }
    if (side.concepts['repeating-focus'] && isSpell(def)) { ctx.extra += slot.rf; slot.rf += 1; }
    if (side.concepts['fury'] && isSkillAb(def) && def.tag === 'str') ctx.extra += side.fury;
    if (target !== side && stHas(target, 'shrink') && Math.random() < 0.2) {
      logMsg(target.name + ' dodges ' + def.name + '!');
      return true;
    }
    // Skittish: chance to hit and be hit is halved
    if (side.concepts['skittish'] && target !== side && Math.random() < 0.5) {
      logMsg(side.name + ' skitters and misses ' + def.name + '!');
      return true;
    }
    if (target !== side && target.concepts['skittish'] && Math.random() < 0.5) {
      logMsg(target.name + ' skitters away from ' + def.name + '!');
      return true;
    }
  }
  applyOps(def.full, side, target, def.name, def.tag, ctx);
  if (damaging) {
    // follow-up stacks build on OTHER skills' damage; reset when the follow-up itself hits
    side.abil.forEach((s) => {
      if (!s || !abilityDef(s.id).followUp) return;
      if (s === slot) s.followStacks = 0;
      else if (ctx.isSkill) s.followStacks += 1;
    });
    if (slot.hasten > 1) slot.hasten = 1; // speedLink boost spent once it deals damage
  }
  return true;
}

function playerActivate(slotIdx) {
  if (!C || C.over) return;
  const slot = C.player.abil[slotIdx];
  if (!slot || slot.cd > 0 || slot.frozen > 0) return;
  const def = abilityDef(slot.id);
  if (!def || def.concept) return;
  castAbility(C.player, C.enemy, slot, false);
  checkEnd();
}

// ---- per-frame update ----
function regenSide(side, dt) {
  // status timers
  Object.keys(side.status).forEach((k) => {
    const st = side.status[k];
    if (st.secs != null) { st.secs -= dt; if (st.secs <= 0) delete side.status[k]; }
  });
  // health regen with modifiers
  let hpReg = side.hpRegen;
  if (stHas(side, 'frost')) hpReg *= 0.5;
  if (stHas(side, 'poison')) hpReg = 0;
  side.hp = Math.min(side.maxHp, side.hp + hpReg * dt);
  if (stHas(side, 'poison')) side.hp -= 0.01 * side.maxHp * dt;
  if (stHas(side, 'regen')) side.hp = Math.min(side.maxHp, side.hp + 0.05 * side.maxHp * dt);
  side.mana = Math.min(side.maxMana, side.mana + side.manaRegen * dt);
  side.stam = Math.min(side.maxStam, side.stam + side.stamRegen * dt);
  side.reson = Math.min(side.maxReson, side.reson + side.resonRegen * dt);
  // overcapped shield decays 1% of the excess per second
  if (side.shield > side.maxShield) {
    const excess = side.shield - side.maxShield;
    side.shield = side.maxShield + excess * Math.max(0, 1 - 0.01 * dt);
  }
  side.buffs = side.buffs.filter((b) => (b.secs -= dt) > 0);
  side.weaks = side.weaks.filter((w) => (w.secs -= dt) > 0);
  side.dots = side.dots.filter((d) => {
    side.hp -= d.dps * Math.min(dt, d.secs);
    d.secs -= dt;
    return d.secs > 0;
  });
}

function advanceBars(side, foe, dt) {
  // cooldown tick rate (Momentum Shift)
  let cdRate = 1;
  if (stHas(side, 'cdfast')) cdRate *= 1.25;
  if (stHas(side, 'cdslow')) cdRate *= 0.8;
  for (let i = 0; i < side.abil.length; i++) {
    const s = side.abil[i];
    if (!s) continue;
    const def = abilityDef(s.id);
    if (!def || def.concept) continue;
    if (s.frozen > 0) { s.frozen = Math.max(0, s.frozen - dt); continue; }
    if (s.cd > 0) {
      s.cd = Math.max(0, s.cd - dt * cdRate);
      if (s.cd === 0 && s.reloading) { s.ammo = def.ammo; s.reloading = false; }
      continue;
    }
    if (s.ammo !== null && s.ammo <= 0) {
      // safety: reload finished elsewhere or never started
      if (s.reloading) continue;
      s.ammo = def.ammo;
    }
    const speed = slotSpeed(side, s, def);
    if (speed <= 0) continue;
    s.prog += dt * speed / fillTimeOf(side, def);
    if (s.prog >= 1) {
      s.prog = 1;
      if (stHas(side, 'blind')) continue; // ready, waiting for Blind to end
      castAbility(side, foe, s, true);
      if (C.over || foe.hp <= 0 || side.hp <= 0) return;
    }
  }
}

function combatTick(dt) {
  if (!C || C.over) return;
  C.elapsed += dt;
  regenSide(C.player, dt);
  regenSide(C.enemy, dt);
  if (checkEnd()) return;
  advanceBars(C.player, C.enemy, dt);
  if (checkEnd()) return;
  advanceBars(C.enemy, C.player, dt);
  checkEnd();
}

// ---- resolution ----
function checkEnd() {
  if (!C || C.over) return C && C.over;
  if (C.enemy.hp <= 0) { onWin(); return true; }
  if (C.player.hp <= 0) { onLoss(); return true; }
  return false;
}

function onWin() {
  C.over = true;
  const sel = G.profile.selectedClass;
  const g = G.profile.node;
  const xp = killXpFor(g);
  addClassXp(sel, xp);
  addStatXp(sel, xp);
  recordWin();
  const gold = goldFor(g);
  G.profile.gold += gold;
  let msg = 'Victory! +' + xp + ' XP, +' + gold + ' gold';
  // gear & rune level follow the CHAPTER (chapter 5 drops L5 gear)
  const dropLvl = C.info.chapter;
  if (Math.random() < CFG.dropChance) {
    if (invFull()) msg += ' — an item drops but your bag is full!';
    else { const it = genItem(dropLvl); G.profile.inventory.push(it); msg += ' — ' + it.name + ' (L' + it.level + ') drops!'; }
  }
  if (Math.random() < CFG.runeChance) {
    if (invFull()) msg += ' — a rune drops but your bag is full!';
    else { const ru = genRune(dropLvl); G.profile.inventory.push(ru); msg += ' — Rune of ' + STAT_INFO[ru.stat].name + '!'; }
  }
  if (Math.random() < CFG.tomeChance) {
    const tome = genTome(); // tomes always fit, even in a full bag
    if (tome) { G.profile.inventory.push(tome); msg += ' — a TOME drops!'; }
  }
  logMsg(msg + ' (' + winsOn(g) + '/' + reqFor(g) + ' wins)');
  checkCompletions().forEach(logMsg);
  // auto-advance the moment the requirement is met
  if (G.profile.autoTravel && winsOn(g) === reqFor(g) && g < TOTAL_PAGES - 1) {
    if (travel(1)) logMsg('Requirement met — moving ahead!');
  }
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
