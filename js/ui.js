// ===== Pathbound (Idle rework) — screens & rendering =====
'use strict';

const UI = {};
UI.tab = 'combat';
UI.foeOpen = false;
UI.bookFilter = 'all';
UI.tipFor = null;                 // {side:'p'|'e', i} — hold-to-view tooltip
UI.inv = { sel: null, mode: null, pfx: null };

const $app = () => document.getElementById('app');
UI.show = function (html) { $app().innerHTML = html; };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const r0 = (n) => Math.max(0, Math.round(n));
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

function bar(val, max, cls, label) {
  const pct = Math.max(0, Math.min(100, 100 * val / Math.max(1, max)));
  return '<div class="bar ' + cls + '"><div style="width:' + pct + '%"></div>' +
    '<span>' + (label || (r0(val) + ' / ' + r0(max))) + '</span></div>';
}
function statChips(stats) {
  return STATS.map((s) => '<span class="chip" style="--c:' + STAT_INFO[s].color + '">' +
    STAT_INFO[s].abbr + ' ' + r0(stats[s]) + '</span>').join('');
}
function pageLabel(g) {
  const info = pageInfo(g);
  return info.bookName + ' · Ch' + info.chapter + ' · Page ' + info.page;
}

// ---- root render ----
UI.render = function () {
  if (!G.session) return UI.home();
  return UI.session();
};
UI.refresh = function () {
  if (G.session && UI.tab === 'combat') UI.session();
};

// ---- home / map (combat paused) ----
UI.home = function () {
  const p = G.profile;
  const sel = p.selectedClass;
  const lp = levelProgress(sel);
  const info = pageInfo(p.node);
  const drafts = p.pendingDrafts.length;
  let h = '<div class="screen center">';
  h += '<h1 class="title">PATHBOUND</h1>';
  h += '<p class="subtitle">Idle Class Ascension</p>';
  h += '<div class="card" style="text-align:left">';
  h += '<div class="row-between"><b>' + esc(CLASSES[sel].name) + '</b><span class="dim">Lv ' + lp.level + '</span></div>';
  h += bar(lp.into, lp.need || 1, 'sh', lp.need ? (r0(lp.into) + ' / ' + r0(lp.need) + ' XP') : 'MAX');
  h += '<div class="small dim" style="margin-top:6px">' + pageLabel(p.node) + ' — "' + esc(info.chapterName) + '" · ' + r0(p.gold) + ' gold</div>';
  h += '</div>';
  if (drafts) h += '<div class="card" style="border-color:var(--gold)">You have ' + drafts + ' skill draft' + (drafts > 1 ? 's' : '') + ' waiting in the Skill Book.</div>';
  h += '<div class="menu">';
  h += '<button class="btn primary big" onclick="UI.enter()">Enter Combat</button>';
  h += '</div>';
  h += '<p class="small dim">Combat runs in real time. Tabs keep combat going; only returning here pauses it.</p>';
  h += '</div>';
  UI.show(h);
};

UI.enter = function () { startSession(); UI.tab = 'combat'; UI.render(); };
UI.exit = function () { endSession(); save(); UI.home(); };

// ---- session shell ----
UI.session = function () {
  let body;
  switch (UI.tab) {
    case 'inventory': body = UI.inventoryTab(); break;
    case 'tree': body = UI.treeTab(); break;
    case 'upgrades': body = UI.upgradesTab(); break;
    case 'book': body = UI.bookTab(); break;
    case 'settings': body = UI.settingsTab(); break;
    default: body = UI.combatTab();
  }
  const tabs = [
    ['combat', 'Combat'], ['inventory', 'Items'], ['tree', 'Classes'],
    ['upgrades', 'Upgrades'], ['book', 'Skills'], ['settings', 'More'],
  ];
  let tb = '<div class="tabbar">';
  tabs.forEach((t) => {
    tb += '<button class="tabbtn ' + (UI.tab === t[0] ? 'on' : '') + '" onclick="UI.setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  });
  tb += '</div>';
  UI.show('<div class="sessionwrap">' + body + '</div>' + tb);
};
UI.setTab = function (t) { UI.tab = t; UI.tipFor = null; UI.session(); };

// ================= Combat tab =================
UI.combatTab = function () {
  if (!C) return '<div class="screen">Loading…</div>';
  const p = C.player, e = C.enemy;
  const g = G.profile.node;
  const wins = winsOn(g), req = reqFor(g);
  const canNext = wins >= req && g < TOTAL_PAGES - 1;
  const info = C.info;

  let h = '<div class="screen combat">';

  h += '<div class="navbar">';
  h += '<button class="navbtn" ' + (g > 0 ? 'onclick="UI.go(-1)"' : 'disabled') + '>◀</button>';
  h += '<div class="navmid"><b>Ch' + info.chapter + ' · Page ' + info.page + (info.mult > 1 ? ' · ' + info.bookName : '') + '</b>' +
    '<span class="small dim">' + esc(info.chapterName) + ' · ' + wins + '/' + req + ' wins · ' + r0(G.profile.gold) + 'g</span></div>';
  h += '<button class="navbtn' + (G.profile.autoTravel ? ' on' : '') + '" onclick="UI.toggleAuto()" title="Auto-advance">⏩</button>';
  h += '<button class="navbtn" ' + (canNext ? 'onclick="UI.go(1)"' : 'disabled') + '>▶</button>';
  h += '</div>';

  // enemy
  h += '<div class="foe card" onclick="UI.toggleFoe()">';
  h += '<div class="row-between"><b>' + esc(e.name) + '</b>' +
    (e.bookTag ? '<span class="tag bad">' + e.bookTag + '</span>' : '') + '</div>';
  h += bar(e.hp, e.maxHp, 'hp');
  if (e.maxShield > 0) h += bar(e.shield, e.maxShield, 'sh', 'Shield ' + r0(e.shield) + ' / ' + r0(e.maxShield));
  h += statusChips(e);
  // enemy ability bars (hold for tooltip; ??? until first seen)
  h += '<div class="eslots">';
  e.abil.forEach((s, i) => {
    if (!s) return;
    const def = abilityDef(s.id);
    const seen = def.concept || G.profile.seen[s.id];
    const nm = seen ? def.name : '???';
    if (def.concept) {
      h += '<div class="eslot" onpointerdown="UI.press(\'e\',' + i + ',event)" onclick="event.stopPropagation()" oncontextmenu="return false">' +
        '<span class="ename" style="color:' + STAT_INFO[def.tag].color + '">' + nm + '</span>' +
        '<span class="small dim">passive' + (def.negative ? ' (negative)' : '') + '</span></div>';
      return;
    }
    const onCd = s.cd > 0;
    const pct = onCd ? 100 * s.cd / Math.max(0.1, cooldownOf(e, def)) : 100 * s.prog;
    h += '<div class="eslot" onpointerdown="UI.press(\'e\',' + i + ',event)" onclick="event.stopPropagation()" oncontextmenu="return false">' +
      '<span class="ename" style="color:' + (seen ? STAT_INFO[def.tag].color : 'var(--dim)') + '">' + nm +
      (s.ammo !== null ? ' ×' + s.ammo : '') + '</span>' +
      '<div class="fillbar"><div class="' + (onCd ? 'cdfill' : 'fillin') + '" style="width:' + pct + '%"></div></div></div>';
  });
  h += '</div>';
  if (UI.foeOpen) h += '<div class="foe-detail small"><div class="dim">' + statChips(effStats(e)) + '</div></div>';
  h += '</div>';

  if (C.over) h += '<div class="vs">' + (C.fled ? 'The enemy fled!' : C.enemy.hp <= 0 ? 'Victory!' : 'Defeated') + ' — next fight in a moment…</div>';
  else h += '<div class="vs small dim">atk ×' + p.atkSpeed.toFixed(2) + ' · cast ×' + p.castSpeed.toFixed(2) + '</div>';

  // player
  h += '<div class="me card">';
  h += '<div class="row-between"><b>' + esc(p.name) + '</b><span class="dim">Lv ' + p.level + '</span></div>';
  h += bar(p.hp, p.maxHp, 'hp');
  h += bar(p.shield, p.maxShield, 'sh', 'Shield ' + r0(p.shield) + ' / ' + r0(p.maxShield) + (p.shield > p.maxShield ? ' (overcap)' : ''));
  h += resRow(p);
  h += statusChips(p);
  h += '</div>';

  // 8 ability slots
  h += '<div class="slots">';
  for (let i = 0; i < CFG.slotCount; i++) {
    const s = p.abil[i];
    if (!s) { h += '<div class="slot empty">—</div>'; continue; }
    const def = abilityDef(s.id);
    if (def.concept) {
      h += '<button class="abil concept" style="--c:' + STAT_INFO[def.tag].color + '" ' +
        'onpointerdown="UI.press(\'p\',' + i + ',event)" oncontextmenu="return false">' +
        '<b>' + def.name + '</b><span>passive</span></button>';
      continue;
    }
    const onCd = s.cd > 0;
    const pct = onCd ? 100 * s.cd / Math.max(0.1, cooldownOf(p, def)) : 100 * s.prog;
    const ec = earlyCost(def, s.prog);
    const remaining = (ec.stam || 0) + (ec.mana || 0) + (ec.reson || 0);
    const resName = def.cost.stam ? 'stam' : def.cost.mana ? 'mana' : 'reson';
    let label;
    if (s.reloading) label = (def.charge ? 'recharging ' : 'reloading ') + r1(s.cd) + 's';
    else if (s.frozen > 0) label = 'frozen ' + r1(s.frozen) + 's';
    else if (onCd) label = 'cooldown ' + r1(s.cd) + 's';
    else if (stHas(p, 'blind') && s.prog >= 1) label = 'ready (blind!)';
    else if (remaining <= 0) label = 'ready!';
    else label = remaining + ' ' + resName;
    h += '<button class="abil' + (onCd || s.frozen > 0 ? ' oncd' : '') + '" style="--c:' + STAT_INFO[def.tag].color + '" ' +
      'onpointerdown="UI.press(\'p\',' + i + ',event)" oncontextmenu="return false">' +
      '<b>' + def.name + (s.ammo !== null ? ' ×' + Math.max(0, s.ammo) : '') + '</b><span>' + label + '</span>' +
      '<div class="fillbar"><div class="' + (onCd ? 'cdfill' : 'fillin') + '" style="width:' + pct + '%"></div></div>' +
      '</button>';
  }
  h += '</div>';

  if (UI.tipFor != null) h += abilityTip();

  h += '</div>';
  return h;
};

function abilityTip() {
  const t = UI.tipFor;
  const side = t.side === 'p' ? C.player : C.enemy;
  const s = side.abil[t.i];
  if (!s) return '';
  const def = abilityDef(s.id);
  const seen = t.side === 'p' || def.concept || G.profile.seen[s.id];
  if (!seen) {
    return '<div class="tipcard"><b>???</b><div class="small dim" style="margin-top:6px">This ability is a mystery until the enemy first uses it.</div></div>';
  }
  let h = '<div class="tipcard" style="--c:' + STAT_INFO[def.tag].color + '">';
  h += '<div class="row-between"><b style="color:' + STAT_INFO[def.tag].color + '">' + def.name + '</b>' +
    '<span class="small dim">' + (def.concept ? 'CONCEPT' : isSpell(def) ? 'SPELL' : 'SKILL') + ' · ' + STAT_INFO[def.tag].abbr +
    (def.tag2 ? '/' + STAT_INFO[def.tag2].abbr : '') + '</span></div>';
  if (def.desc) h += '<div class="small" style="margin:6px 0 2px">' + esc(def.desc) + '</div>';
  if (def.full && def.full.length) h += '<div class="small" style="margin:6px 0 2px">' + formulaOps(def.full, side).map(esc).join('<br>') + '</div>';
  if (t.side === 'p' && side.dmgByTag && side.dmgByTag[def.tag]) h += '<div class="small dim">+' + side.dmgByTag[def.tag] + ' damage from upgrades</div>';
  if (!def.concept) {
    const spell = isSpell(def);
    const speed = spell ? side.castSpeed : side.atkSpeed;
    let cdTxt;
    if (def.charge) cdTxt = 'Charge ×' + def.ammo + ' — no cooldown between uses, recharge ' + r1(rechargeCd(side, def)) + 's after the last';
    else if (def.ammo) cdTxt = 'Ammo ×' + def.ammo + ' — cooldown ' + cooldownOf(side, def) + 's, reload ' + r1(rechargeCd(side, def)) + 's after the last';
    else cdTxt = 'Cooldown ' + cooldownOf(side, def) + 's';
    h += '<div class="small dim" style="margin-top:6px">Cost ' + costText(def.cost) +
      ' · ' + (spell ? 'Cast' : 'Attack') + ' Time ' + r1(fillTimeOf(side, def) / Math.max(0.01, speed)) + 's (×' + speed.toFixed(2) + ')' +
      ' · ' + cdTxt + '</div>';
    if (t.side === 'p') h += '<div class="small dim">Fills on its own; fires free when full. Tap to fire early for the remaining cost.</div>';
  }
  h += '</div>';
  return h;
}

function resRow(s) {
  return '<div class="res-row small">' +
    '<span class="res" style="color:' + STAT_INFO.int.color + '">Mana ' + r0(s.mana) + '/' + r0(s.maxMana) + ' (+' + r1(s.manaRegen) + ')</span>' +
    '<span class="res" style="color:' + STAT_INFO.dex.color + '">Stam ' + r0(s.stam) + '/' + r0(s.maxStam) + ' (+' + r1(s.stamRegen) + ')</span>' +
    '<span class="res" style="color:' + STAT_INFO.fai.color + '">Reson ' + r0(s.reson) + '/' + r0(s.maxReson) + ' (+' + r1(s.resonRegen) + ')</span>' +
    '</div>';
}
function statusChips(s) {
  const t = [];
  Object.keys(s.status).forEach((k) => {
    const st = s.status[k], meta = STATUSES[k];
    if (k === 'dazed') return; // too flickery to show
    const dur = st.secs != null ? r1(st.secs) + 's' : '×' + st.count;
    t.push('<span class="tag ' + (meta.bad ? 'bad' : 'good') + '">' + meta.name + ' ' + dur + '</span>');
  });
  s.buffs.forEach((b) => t.push('<span class="tag good">+' + r0(b.amt) + ' dmg ' + r1(b.secs) + 's</span>'));
  s.weaks.forEach((w) => t.push('<span class="tag bad">-' + r0(w.amt) + ' dmg ' + r1(w.secs) + 's</span>'));
  s.dots.forEach((d) => t.push('<span class="tag bad">' + d.label + ' ' + r0(d.dps) + '/s ' + r1(d.secs) + 's</span>'));
  if (s.counter) t.push('<span class="tag good">counter ready</span>');
  if (s.fury > 0) t.push('<span class="tag good">fury +' + s.fury + '</span>');
  return t.length ? '<div class="status">' + t.join('') + '</div>' : '';
}

UI.toggleFoe = function () { UI.foeOpen = !UI.foeOpen; UI.session(); };
UI.toggleAuto = function () {
  G.profile.autoTravel = !G.profile.autoTravel;
  save(); UI.session();
};
UI.go = function (dir) {
  if (travel(dir)) { UI.foeOpen = false; newBattle(); }
  UI.session();
};

// press-and-hold: short press = fire early (player only), hold ≥380ms = tooltip
UI.press = function (side, i, ev) {
  if (ev && ev.preventDefault) ev.preventDefault();
  UI._press = side === 'p' ? i : null;
  clearTimeout(UI._holdT);
  UI._holdT = setTimeout(function () {
    UI.tipFor = { side: side, i: i }; UI._press = null;
    if (G.session && UI.tab === 'combat') UI.session();
  }, 380);
};
UI.release = function () {
  clearTimeout(UI._holdT);
  if (UI.tipFor != null) {
    UI.tipFor = null;
    if (G.session && UI.tab === 'combat') UI.session();
  } else if (UI._press != null) {
    const i = UI._press; UI._press = null;
    playerActivate(i);
    if (G.session && UI.tab === 'combat') UI.session();
  }
};

// ================= Inventory tab =================
UI.inventoryTab = function () {
  const p = G.profile;
  let h = '<div class="screen"><h2>Inventory <span class="small dim">· ' + r0(p.gold) + ' gold</span></h2>';

  h += '<h3>Equipped</h3><div class="card">';
  Object.keys(EQUIP_SLOTS).forEach((k) => {
    const it = p.equipment[k];
    h += '<div class="invrow" ' + (it ? 'onclick="UI.unequip(\'' + k + '\')"' : '') + '>' +
      '<span class="dim small" style="width:76px">' + EQUIP_SLOTS[k] + '</span>' +
      (it ? '<span>' + itemSummary(it) + ' <span class="small dim">(tap to unequip)</span></span>' : '<span class="dim">—</span>') +
      '</div>';
  });
  h += '</div>';

  h += '<h3>Bag (' + p.inventory.length + '/' + CFG.invSize + ')</h3>';
  if (!p.inventory.length) h += '<div class="dim small">Empty — enemies can drop gear (10%), runes (1%) and tomes (0.1%).</div>';
  p.inventory.forEach((it, idx) => {
    const on = UI.inv.sel === idx;
    h += '<div class="invrow sel-' + on + '" onclick="UI.invSelect(' + idx + ')">' + itemSummary(it) + '</div>';
    if (on) h += itemDetail(it, idx);
  });

  h += '</div>';
  return h;
};

function itemSummary(it) {
  if (it.kind === 'tome') {
    const def = abilityDef(it.skill);
    return '<b style="color:var(--gold)">Tome</b> · teaches <span style="color:' + STAT_INFO[def.tag].color + '">' + def.name + '</span>';
  }
  if (it.kind === 'rune') {
    return '<b style="color:' + STAT_INFO[it.stat].color + '">Rune</b> L' + it.level + ' · +' + it.amt + ' ' + STAT_INFO[it.stat].abbr +
      (it.mult > 1 ? ' <span class="small dim">(×' + it.mult + ')</span>' : '');
  }
  const parts = it.prefixes.filter(Boolean).map((p) =>
    '+' + p.amt + ' <span style="color:' + STAT_INFO[p.stat].color + '">' + STAT_INFO[p.stat].abbr + '</span>');
  return '<b>' + it.name + '</b> L' + it.level + ' · ' + (parts.length ? parts.join(', ') : '<span class="dim">no stats</span>');
}

function itemDetail(it, idx) {
  const p = G.profile;
  const m = UI.inv.mode;
  let h = '<div class="card" style="border-color:var(--accent)">';

  if (it.kind === 'tome') {
    const def = abilityDef(it.skill);
    h += '<div><b>' + def.name + '</b> <span class="small dim">(' + STAT_INFO[def.tag].abbr + ', ' + costText(def.cost) + ')</span></div>';
    if (def.desc) h += '<div class="small dim">' + esc(def.desc) + '</div>';
    if (def.full && def.full.length) h += '<div class="small dim">' + describeOps(def.full, characterStats()) + '</div>';
    h += '<div class="row"><button class="btn small primary" onclick="UI.learnTome(' + idx + ')">Learn (permanent)</button></div>';
    h += '</div>';
    return h;
  }
  if (it.kind === 'rune') {
    h += '<div>+' + it.amt + ' ' + STAT_INFO[it.stat].name + ' <span class="small dim">(' + it.base + (it.mult > 1 ? ' ×' + it.mult : '') + ')</span></div>';
    h += '<div class="row"><button class="btn small" onclick="UI.scrap(' + idx + ')">Scrap (+' + it.level + 'g)</button></div>';
    h += '<div class="small dim" style="margin-top:6px">Use via Augment: select a gear piece, pick a blank slot, then this rune.</div>';
    h += '</div>';
    return h;
  }

  it.prefixes.forEach((pf, pi) => {
    let row = pf
      ? '+' + pf.amt + ' ' + STAT_INFO[pf.stat].name + ' <span class="small dim">(' + pf.base + (pf.mult > 1 ? ' ×' + pf.mult : '') + ')</span>'
      : '<span class="dim">— blank</span>';
    let click = '';
    if ((m === 'reroll' || m === 'extract') && pf) click = 'onclick="UI.pickPfx(' + pi + ')"';
    if (m === 'augment' && !pf) click = 'onclick="UI.pickPfx(' + pi + ')"';
    const hot = click ? ' style="border-color:var(--gold);cursor:pointer"' : '';
    h += '<div class="pfxrow" ' + click + hot + '>' + row + '</div>';
  });

  if (m === 'reroll' && UI.inv.pfx == null) h += '<div class="small" style="color:var(--gold)">Tap a rolled stat above to reroll…</div>';
  if (m === 'reroll' && UI.inv.pfx != null) {
    h += '<div class="row"><button class="btn small primary" onclick="UI.doReroll(\'amt\')">Reroll amount</button>' +
      '<button class="btn small primary" onclick="UI.doReroll(\'stat\')">Reroll stat</button>' +
      '<button class="btn small" onclick="UI.invMode(null)">Cancel</button></div>';
  }
  if (m === 'extract') h += '<div class="small" style="color:var(--gold)">Tap a rolled stat to save as a rune (destroys the item)…</div>';
  if (m === 'augment' && UI.inv.pfx == null) h += '<div class="small" style="color:var(--gold)">Tap a blank slot above…</div>';
  if (m === 'augment' && UI.inv.pfx != null) {
    const runes = p.inventory.map((r, ri) => ({ r, ri })).filter((x) => x.r.kind === 'rune');
    if (!runes.length) h += '<div class="small bad-text">No runes in your bag.</div>';
    runes.forEach((x) => {
      h += '<div class="pfxrow" style="border-color:var(--gold);cursor:pointer" onclick="UI.doAugment(' + x.ri + ')">' +
        '+' + x.r.amt + ' ' + STAT_INFO[x.r.stat].name + ' (rune L' + x.r.level + ')</div>';
    });
    h += '<div class="row"><button class="btn small" onclick="UI.invMode(null)">Cancel</button></div>';
  }

  if (!m) {
    h += '<div class="row" style="flex-wrap:wrap">';
    h += '<button class="btn small primary" onclick="UI.equipGear(' + idx + ')">Equip</button>';
    h += '<button class="btn small" onclick="UI.scrap(' + idx + ')">Scrap (+' + it.level + 'g)</button>';
    h += '</div><div class="row" style="flex-wrap:wrap">';
    h += bsBtn('upgrade', 'Upgrade L+1', it.upgrades >= CFG.maxItemUpgrades, CFG.bsCosts.upgrade, it.upgrades + '/' + CFG.maxItemUpgrades);
    h += bsBtn('reroll', 'Reroll', it.rerolls >= CFG.maxRerolls, CFG.bsCosts.reroll, it.rerolls + '/' + CFG.maxRerolls);
    h += bsBtn('extract', 'Extract', !it.prefixes.some(Boolean), CFG.bsCosts.extract, '');
    h += bsBtn('augment', 'Augment', !it.prefixes.some((x) => !x), CFG.bsCosts.augment, '');
    h += '</div>';
  }
  h += '</div>';
  return h;
}
function bsBtn(mode, label, disabled, cost, sub) {
  const can = !disabled && G.profile.gold >= cost;
  return '<button class="btn small" ' + (can ? 'onclick="UI.invMode(\'' + mode + '\')"' : 'disabled') + '>' +
    label + ' <span class="small dim">' + cost + 'g' + (sub ? ' · ' + sub : '') + '</span></button>';
}

UI.invSelect = function (idx) {
  UI.inv = (UI.inv.sel === idx && !UI.inv.mode) ? { sel: null, mode: null, pfx: null } : { sel: idx, mode: null, pfx: null };
  UI.session();
};
UI.invMode = function (m) {
  if (m === 'upgrade') {
    const it = G.profile.inventory[UI.inv.sel];
    if (it && bsUpgrade(it)) rebuildPlayer();
    UI.session(); return;
  }
  UI.inv.mode = m; UI.inv.pfx = null; UI.session();
};
UI.pickPfx = function (pi) {
  const it = G.profile.inventory[UI.inv.sel];
  if (!it) return;
  if (UI.inv.mode === 'extract') {
    if (confirm('Destroy this ' + it.name + ' and save that stat as a rune? (' + CFG.bsCosts.extract + 'g)')) {
      if (bsExtract(UI.inv.sel, pi)) { UI.inv = { sel: null, mode: null, pfx: null }; }
    }
    UI.session(); return;
  }
  UI.inv.pfx = pi; UI.session();
};
UI.doReroll = function (mode) {
  const it = G.profile.inventory[UI.inv.sel];
  if (it && bsReroll(it, UI.inv.pfx, mode)) rebuildPlayer();
  UI.inv.mode = null; UI.inv.pfx = null; UI.session();
};
UI.doAugment = function (runeIdx) {
  const it = G.profile.inventory[UI.inv.sel];
  if (it && bsAugment(it, UI.inv.pfx, runeIdx)) {
    UI.inv = { sel: G.profile.inventory.indexOf(it), mode: null, pfx: null };
    rebuildPlayer();
  } else { UI.inv.mode = null; UI.inv.pfx = null; }
  UI.session();
};
UI.equipGear = function (idx) {
  if (equipItem(idx)) { UI.inv = { sel: null, mode: null, pfx: null }; rebuildPlayer(); }
  UI.session();
};
UI.unequip = function (slotKey) {
  if (unequipItem(slotKey)) rebuildPlayer();
  UI.session();
};
UI.scrap = function (idx) {
  const it = G.profile.inventory[idx];
  if (it && confirm('Scrap this for ' + it.level + ' gold?')) {
    scrapItem(idx);
    UI.inv = { sel: null, mode: null, pfx: null };
    rebuildPlayer();
  }
  UI.session();
};
UI.learnTome = function (idx) {
  if (learnTome(idx)) { UI.inv = { sel: null, mode: null, pfx: null }; rebuildPlayer(); }
  UI.session();
};

// ================= Class Tree tab =================
const TREE_POS = {
  classless:          [250, 560],
  'squire-trainee':   [65, 400],
  'scouts-runner':    [190, 400],
  'mages-apprentice': [315, 400],
  'assistant-scribe': [440, 400],
  fighter:            [40, 240],
  mercenary:          [125, 240],
  rogue:              [210, 240],
  monk:               [295, 240],
  mage:               [380, 240],
  deacon:             [465, 240],
  duelist:            [50, 80],
  knight:             [140, 80],
  ranger:             [230, 80],
  druid:              [320, 80],
  scholar:            [410, 80],
};

UI.treeTab = function () {
  const sel = G.profile.selectedClass;
  let h = '<div class="screen">';
  h += '<h2>Class Tree</h2>';
  h += '<p class="small dim">Tap a class to select it. XP cascades at 50% to every class below. Prestige-ready classes shine gold.</p>';

  h += '<div class="treewrap"><svg viewBox="0 0 500 640" xmlns="http://www.w3.org/2000/svg">';
  Object.keys(CLASSES).forEach((id) => {
    (CLASSES[id].parents || []).forEach((par) => {
      const a = TREE_POS[id], b = TREE_POS[par];
      if (!a || !b) return;
      const lit = classUnlocked(id);
      h += '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" ' +
        'stroke="' + (lit ? '#7c5cff' : '#3a3d52') + '" stroke-width="' + (lit ? 2.5 : 1.5) + '" />';
    });
  });
  Object.keys(CLASSES).forEach((id) => {
    const pos = TREE_POS[id];
    if (!pos) return;
    const c = CLASSES[id];
    const lvl = levelOf(id);
    const best = G.profile.maxLevel[id] || 0;
    const unlocked = classUnlocked(id);
    const ready = canPrestige(id);
    const isSel = id === sel;
    const stroke = ready || isSel ? '#e8c468' : unlocked ? '#7c5cff' : '#3a3d52';
    h += '<g class="tnode' + (unlocked ? '' : ' locked') + (ready ? ' ready' : '') + '" ' +
      (unlocked ? 'onclick="UI.selectClass(\'' + id + '\')"' : '') + '>';
    h += '<circle cx="' + pos[0] + '" cy="' + pos[1] + '" r="36" fill="' + (isSel ? '#2a2440' : '#1e2134') + '" ' +
      'stroke="' + stroke + '" stroke-width="' + (isSel || ready ? 3 : 2) + '" />';
    const words = c.name.split(' ');
    const line1 = words.length > 1 ? words.slice(0, -1).join(' ') : c.name;
    const line2 = words.length > 1 ? words[words.length - 1] : '';
    h += '<text x="' + pos[0] + '" y="' + (pos[1] - (line2 ? 12 : 6)) + '" class="tname">' + esc(line1) + (G.profile.prestiged[id] ? ' ★' : '') + '</text>';
    if (line2) h += '<text x="' + pos[0] + '" y="' + (pos[1] - 1) + '" class="tname">' + esc(line2) + '</text>';
    h += '<text x="' + pos[0] + '" y="' + (pos[1] + 13) + '" class="tlvl">' + (unlocked ? 'Lv ' + lvl : '🔒') + '</text>';
    h += '<text x="' + pos[0] + '" y="' + (pos[1] + 26) + '" class="tbest">best ' + best + '</text>';
    h += '</g>';
  });
  h += '</svg></div>';

  // your total stats
  const cs = characterStats();
  const d = derive(cs);
  h += '<div class="card"><h3 style="margin-top:0">Your total stats</h3>' + statChips(cs);
  h += '<div class="small dim" style="margin-top:6px">HP ' + r0(d.maxHp) + ' · Shield ' + r0(d.maxShield) +
    ' · Mana ' + r0(d.maxMana) + ' · Stam ' + r0(d.maxStam) + ' · Reson ' + r0(d.maxReson) +
    ' · atk ×' + d.atkSpeed.toFixed(2) + ' · cast ×' + d.castSpeed.toFixed(2) + '</div></div>';

  // selected class details
  const c = CLASSES[sel];
  const lp = levelProgress(sel);
  h += '<div class="card"><div class="row-between"><b>' + esc(c.name) + (G.profile.prestiged[sel] ? ' ★' : '') + '</b>' +
    '<span class="dim">Lv ' + lp.level + ' · best ' + (G.profile.maxLevel[sel] || 0) + '</span></div>';
  h += bar(lp.into, lp.need || 1, 'sh', lp.need ? (r0(lp.into) + ' / ' + r0(lp.need) + ' XP') : 'MAX');
  if (!classUnlocked(sel)) h += '<div class="small bad-text">' + unlockText(c) + '</div>';
  h += '<h3>Next 5 levels</h3>';
  const prev = previewNextLevels(sel, 5);
  if (Object.keys(prev).length === 0) h += '<div class="dim small">No stat gains in the next 5 levels.</div>';
  else h += STATS.filter((s) => prev[s]).map((s) =>
    '<span class="chip" style="--c:' + STAT_INFO[s].color + '">+' + prev[s] + ' ' + STAT_INFO[s].abbr + '</span>').join('');
  if (G.profile.prestiged[sel]) h += '<div class="small" style="color:var(--gold);margin-top:8px">★ Prestiged — levels ' + CFG.prestigeDivisor + '× faster.</div>';
  else if (canPrestige(sel)) {
    h += '<div style="margin-top:10px"><button class="btn primary" onclick="UI.prestige(\'' + sel + '\')">Prestige ' + esc(c.name) + '</button>';
    h += '<div class="small dim" style="margin-top:4px">Resets the run to Classless Lv1 (levels &amp; skills lost; tome skills kept). This class then costs ÷' + CFG.prestigeDivisor + ' XP, and every class levels faster. Completed chapters lower future win requirements.</div></div>';
  } else {
    h += '<div class="small dim" style="margin-top:8px">Reach Lv ' + CFG.prestigeLevel + ' to prestige (currently ' + lp.level + ').</div>';
  }
  h += '</div>';

  const pc = prestigeCount();
  h += '<div class="card small"><b>Prestige</b> — ' + pc + ' class' + (pc === 1 ? '' : 'es') +
    ' prestiged · all classes level ' + Math.round((prestigeSpeedMult() - 1) * 100) + '% faster (up to highest reached +' + pc + ').</div>';

  h += '</div>';
  return h;
};

function unlockText(c) {
  return 'Needs ' + c.unlock.map((r) => CLASSES[r.class].name + ' Lv' + r.level).join(' + ');
}
function previewNextLevels(classId, n) {
  const cur = levelOf(classId);
  const a = statGainCumulative(classId, cur);
  const b = statGainCumulative(classId, Math.min(CFG.levelCap, cur + n));
  const out = {};
  STATS.forEach((s) => { const d = b[s] - a[s]; if (d) out[s] = d; });
  return out;
}
UI.selectClass = function (id) {
  if (!classUnlocked(id)) return;
  G.profile.selectedClass = id;
  rebuildPlayer();
  save();
  UI.render();
};
UI.prestige = function (id) {
  if (!canPrestige(id)) return;
  if (!confirm('Prestige ' + CLASSES[id].name + '? The run restarts at Classless Lv1 (levels & skills lost; tome skills kept), but you gain permanent leveling speed and lower win requirements for completed chapters.')) return;
  doPrestige(id);
  endSession();
  UI.tab = 'combat';
  UI.home();
};

// ================= Upgrades tab =================
UI.upgradesTab = function () {
  let h = '<div class="screen"><h2>Upgrades <span class="small dim">· Tier 1</span></h2>';
  if (!upgradesUnlocked()) {
    h += '<div class="card dim">Unlocks at Classless level ' + CFG.upgradeUnlock + '. (You are ' + levelOf('classless') + '/' + CFG.upgradeUnlock + '.)</div></div>';
    return h;
  }
  h += '<p class="small dim">Spend each stat’s XP. Costs rise +1 then ×1.1 per purchase.</p>';
  UPGRADE_STATS.forEach((st) => {
    const info = STAT_INFO[st];
    h += '<div class="card"><div class="row-between" style="margin-bottom:6px">' +
      '<b style="color:' + info.color + '">' + info.name + '</b>' +
      '<span class="chip" style="--c:' + info.color + '">' + r0(G.profile.statXp[st]) + ' XP</span></div>';
    Object.keys(UPGRADES).filter((id) => UPGRADES[id].stat === st).forEach((id) => {
      const u = UPGRADES[id];
      const lvl = upgradeCount(id);
      const cost = upgradeCost(id);
      const can = canBuyUpgrade(id);
      h += '<div class="upg"><div><div>' + u.label + '</div>' +
        '<div class="small dim">owned ' + lvl + ' · cost ' + cost + '</div></div>' +
        '<button class="btn small ' + (can ? 'primary' : '') + '" ' + (can ? 'onclick="UI.buyUpg(\'' + id + '\')"' : 'disabled') + '>Buy</button></div>';
    });
    h += '</div>';
  });
  h += '</div>';
  return h;
};
UI.buyUpg = function (id) {
  if (buyUpgrade(id)) rebuildPlayer();
  UI.session();
};

// ================= Skill Book tab =================
UI.bookTab = function () {
  const p = G.profile;
  let h = '<div class="screen"><h2>Skill Book</h2>';

  if (p.pendingDrafts.length) {
    const offer = p.pendingDrafts[0];
    h += '<div class="card" style="border-color:var(--gold)"><h3 style="margin-top:0">Choose a skill (' + p.pendingDrafts.length + ' draft' + (p.pendingDrafts.length > 1 ? 's' : '') + ')</h3>';
    offer.forEach((id) => {
      const sk = ABILITIES[id];
      h += '<button class="btn big" style="text-align:left;margin-bottom:6px" onclick="UI.draftPick(\'' + id + '\')">' +
        '<b style="color:' + STAT_INFO[sk.tag].color + '">' + sk.name + '</b> <span class="small dim">(' + STAT_INFO[sk.tag].abbr + ', ' + costText(sk.cost) + ')</span><br>' +
        '<span class="small dim">' + describeOps(sk.full, characterStats()) + '</span></button>';
    });
    h += '</div>';
  }

  h += '<h3>Equipped (' + p.slots.filter(Boolean).length + '/' + CFG.slotCount + ')</h3>';
  for (let i = 0; i < CFG.slotCount; i++) {
    const id = p.slots[i];
    if (!id) { h += '<div class="tree-node locked"><span class="dim">empty slot ' + (i + 1) + '</span></div>'; continue; }
    const def = ABILITIES[id];
    h += '<div class="tree-node" style="border-color:' + STAT_INFO[def.tag].color + '">';
    h += '<div><b>' + def.name + '</b>' + (def.concept ? ' <span class="tag good">concept</span>' : '') +
      '<div class="small dim">' + costText(def.cost) + (def.desc ? ' · ' + esc(def.desc) : '') +
      (def.full && def.full.length ? ' · ' + describeOps(def.full, characterStats()) : '') + '</div></div>';
    h += '<button class="btn small" onclick="UI.unequipSkill(' + i + ')">Remove</button>';
    h += '</div>';
  }

  const equipped = p.slots.filter(Boolean);
  let bench = p.skills.filter((id) => equipped.indexOf(id) === -1);
  h += '<h3>Owned abilities</h3>';
  if (p.skills.length) {
    const ownTags = STATS.filter((s) => bench.some((id) => { const d = ABILITIES[id]; return d.tag === s || d.tag2 === s; }));
    h += '<div class="filterbar"><button class="filterbtn ' + (UI.bookFilter === 'all' ? 'on' : '') + '" onclick="UI.setFilter(\'all\')">All</button>';
    ownTags.forEach((s) => {
      h += '<button class="filterbtn ' + (UI.bookFilter === s ? 'on' : '') + '" style="--c:' + STAT_INFO[s].color + '" onclick="UI.setFilter(\'' + s + '\')">' + STAT_INFO[s].abbr + '</button>';
    });
    h += '</div>';
  }
  if (UI.bookFilter !== 'all') bench = bench.filter((id) => { const d = ABILITIES[id]; return d.tag === UI.bookFilter || d.tag2 === UI.bookFilter; });
  if (!bench.length) h += '<div class="dim small">Nothing here — level classes to unlock more abilities.</div>';
  bench.forEach((id) => {
    const def = ABILITIES[id];
    const full = p.slots.every(Boolean);
    h += '<div class="tree-node">';
    h += '<div><b>' + def.name + '</b>' + (def.concept ? ' <span class="tag good">concept</span>' : '') +
      '<div class="small dim">' + STAT_INFO[def.tag].abbr + ' · ' + costText(def.cost) +
      (def.desc ? ' · ' + esc(def.desc) : '') +
      (def.full && def.full.length ? ' · ' + describeOps(def.full, characterStats()) : '') + '</div></div>';
    h += '<button class="btn small" ' + (full ? 'disabled' : 'onclick="UI.equipSkill(\'' + id + '\')"') + '>Equip</button>';
    h += '</div>';
  });

  h += '</div>';
  return h;
};
UI.setFilter = function (s) { UI.bookFilter = s; UI.session(); };
UI.draftPick = function (id) {
  G.profile.skills.push(id);
  G.profile.pendingDrafts.shift();
  const empty = G.profile.slots.indexOf(null);
  if (empty !== -1) G.profile.slots[empty] = id;
  rebuildPlayer();
  save(); UI.session();
};
UI.equipSkill = function (id) {
  const empty = G.profile.slots.indexOf(null);
  if (empty === -1) return;
  G.profile.slots[empty] = id;
  rebuildPlayer();
  save(); UI.session();
};
UI.unequipSkill = function (i) {
  G.profile.slots[i] = null;
  rebuildPlayer();
  save(); UI.session();
};

// ================= Settings & Log tab =================
UI.settingsTab = function () {
  let h = '<div class="screen"><h2>Settings & Combat Log</h2>';
  h += '<button class="btn big" onclick="UI.exit()">◀ Back to Map (pause combat)</button>';
  h += '<div class="card" style="margin-top:10px"><div class="row-between">' +
    '<div><b>Auto-advance</b><div class="small dim">Move to the next page when its win requirement is met</div></div>' +
    '<button class="btn small ' + (G.profile.autoTravel ? 'primary' : '') + '" onclick="UI.toggleAuto()">' + (G.profile.autoTravel ? 'ON' : 'OFF') + '</button>' +
    '</div></div>';
  h += '<h3>Combat Log</h3>';
  h += '<div class="log">' + (C ? C.log.slice().reverse().map(esc).join('<br>') : 'No active combat.') + '</div>';
  h += '<h3>Danger zone</h3>';
  h += '<button class="btn small" onclick="UI.resetSave()">Reset save</button>';
  h += '<p class="small dim" style="margin-top:10px">Pathbound — idle rework (Milestone 4).</p>';
  h += '</div>';
  return h;
};
UI.resetSave = function () {
  if (!confirm('Erase all progress and start over?')) return;
  localStorage.removeItem(SAVE_KEY);
  G.profile = null; G.session = false; C = null;
  load(); UI.tab = 'combat'; UI.home();
};

// global release handler (targets re-render every tick; pointer may lift on a new element)
if (typeof document !== 'undefined') {
  document.addEventListener('pointerup', function () { UI.release(); });
  document.addEventListener('pointercancel', function () { clearTimeout(UI._holdT); UI._press = null; });
}
