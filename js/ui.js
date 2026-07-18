// ===== Pathbound (Idle rework) — screens & rendering =====
'use strict';

const UI = {};
UI.tab = 'combat';
UI.foeOpen = false;
UI.bookView = 'possessed';   // skills tab: possessed | buyback
UI.bookSource = 'all';       // all | tome | class
UI.bookFilter = 'all';       // stat filter
UI.bookSel = null;           // selected ability id (popup)
UI.enhOpen = false;
UI.tip = null;               // {kind:'slot'|'eslot'|'ally'|'allyx'|'kw', arg}
UI.tipKw = null;             // nested keyword tooltip
UI.tipExpire = 0;
UI._holding = false;
UI.inv = { sel: null, mode: null, pfx: null };
UI.bestTab = 'settings';
UI.bestBook = 0;
UI.bestSource = 'all';
UI.bestStat = 'all';

const $app = () => document.getElementById('app');
UI.show = function (html) { $app().innerHTML = html; };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const r0 = (n) => Math.max(0, Math.round(n));
const r1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

// convert [[key|label]] / [[key]] markers into holdable keyword spans
function kwFmt(s) {
  return String(s).replace(/\[\[([a-z-]+)\]\]/g, function (_, key) {
    return '<span class="kw" onpointerdown="UI.press(\'kw\',\'' + key + '\',event)">ⓘ</span> ';
  });
}
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
function slotDisplayName(unit, def) {
  if (C && C.reverse && unit.isPlayer && !def.concept) return REVERSE_NAMES[def.tag] || def.name;
  return def.name;
}

// ---- root ----
UI.render = function () {
  if (!G.session) return UI.home();
  return UI.session();
};
UI.refresh = function () {
  // expire lingering tooltips (3s after release; nested first)
  if (UI.tip && !UI._holding && UI.tipExpire && Date.now() > UI.tipExpire) {
    if (UI.tipKw) { UI.tipKw = null; UI.tipExpire = Date.now() + CFG.tipLinger * 1000; }
    else UI.tip = null;
    if (G.session) UI.session();
  }
  if (G.session && UI.tab === 'combat') UI.session();
};

// ---- home ----
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
  h += '<div class="small dim" style="margin-top:6px">' + pageLabel(p.node) + ' — "' + esc(info.chapterName) + '" · ' + r0(p.gold) + ' gold · ' + p.ep + ' EP</div>';
  h += '</div>';
  if (drafts) h += '<div class="card" style="border-color:var(--gold)">You have ' + drafts + ' skill draft' + (drafts > 1 ? 's' : '') + ' waiting in the Skill Book.</div>';
  h += '<div class="menu"><button class="btn primary big" onclick="UI.enter()">Enter Combat</button></div>';
  h += '<p class="small dim">Combat runs in real time. Tabs keep combat going; only returning here pauses it.</p>';
  h += '</div>';
  UI.show(h);
};

UI.enter = function () { startSession(); UI.tab = 'combat'; UI.render(); };
UI.exit = function () { endSession(); save(); UI.home(); };

// ---- shell ----
UI.session = function () {
  let body;
  switch (UI.tab) {
    case 'inventory': body = UI.inventoryTab(); break;
    case 'tree': body = UI.treeTab(); break;
    case 'upgrades': body = UI.upgradesTab(); break;
    case 'book': body = UI.bookTab(); break;
    case 'bestiary': body = UI.bestiaryTab(); break;
    default: body = UI.combatTab();
  }
  const tabs = [
    ['combat', 'Combat'], ['inventory', 'Items'], ['tree', 'Classes'],
    ['upgrades', 'Upgrades'], ['book', 'Skills'], ['bestiary', 'Bestiary'],
  ];
  let tb = '<div class="tabbar">';
  tabs.forEach((t) => {
    tb += '<button class="tabbtn ' + (UI.tab === t[0] ? 'on' : '') + '" onclick="UI.setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
  });
  tb += '</div>';
  UI.show('<div class="sessionwrap">' + body + '</div>' + tb);
};
UI.setTab = function (t) { UI.tab = t; UI.tip = null; UI.tipKw = null; UI.session(); };

// ================= Combat tab =================
let _allyPickCache = { key: '', ids: [], until: 0 };
function pickDisplayAllies(list) {
  if (list.length <= 2) return { shown: list, hidden: [] };
  const key = list.map((a) => a.uid).join(',');
  const now = Date.now();
  if (_allyPickCache.key === key && now < _allyPickCache.until) {
    const shown = list.filter((a) => _allyPickCache.ids.indexOf(a.uid) !== -1);
    if (shown.length === 2) return { shown: shown, hidden: list.filter((a) => shown.indexOf(a) === -1) };
  }
  // prefer distinct names, then least health
  const sorted = list.slice().sort((a, b) => a.hp - b.hp);
  const shown = [];
  sorted.forEach((a) => { if (shown.length < 2 && !shown.some((x) => x.name === a.name)) shown.push(a); });
  sorted.forEach((a) => { if (shown.length < 2 && shown.indexOf(a) === -1) shown.push(a); });
  _allyPickCache = { key: key, ids: shown.map((a) => a.uid), until: now + 3000 };
  return { shown: shown, hidden: list.filter((a) => shown.indexOf(a) === -1) };
}

function allyCard(a, side) {
  let h = '<div class="ally" onpointerdown="UI.press(\'ally\',' + a.uid + ',event)" oncontextmenu="return false">';
  h += '<div class="ally-name">' + esc(a.name) + '</div>';
  h += '<div class="bar hp mini"><div style="width:' + (100 * a.hp / Math.max(1, a.maxHp)) + '%"></div></div>';
  if (a.maxShield > 0) h += '<div class="bar sh mini"><div style="width:' + (100 * a.shield / Math.max(1, a.maxShield)) + '%"></div></div>';
  a.abil.forEach((s) => {
    if (!s) return;
    const def = abilityDef(s.id);
    if (def.concept) return;
    const onCd = s.cd > 0 || s.reloading;
    const pct = onCd ? 100 * s.cd / Math.max(0.1, cooldownOf(a, def)) : 100 * s.prog;
    let nm = def.name.length > 11 ? def.name.slice(0, 10) + '…' : def.name;
    h += '<div class="ally-ab"><span style="color:' + STAT_INFO[def.tag].color + '">' + esc(nm) + '</span>' +
      '<div class="fillbar mini"><div class="' + (onCd ? 'cdfill' : 'fillin') + '" style="width:' + Math.min(100, pct) + '%"></div></div></div>';
  });
  h += '</div>';
  return h;
}
function allyStrip(list, label) {
  if (!list.length) return '';
  const picked = pickDisplayAllies(list);
  let h = '<div class="allyrow"><span class="small dim" style="width:34px">' + label + '</span>';
  picked.shown.forEach((a) => { h += allyCard(a); });
  if (picked.hidden.length) {
    h += '<button class="allyx" onpointerdown="UI.press(\'allyx\',\'' + (label === 'foes' ? 'e' : 'p') + '\',event)" oncontextmenu="return false">+' + picked.hidden.length + '</button>';
  }
  h += '</div>';
  return h;
}

UI.combatTab = function () {
  if (!C) return '<div class="screen">Loading…</div>';
  const p = C.player, e = C.enemy;
  const g = G.profile.node;
  const wins = winsOn(g), req = reqFor(g);
  const canNext = wins >= req && g < TOTAL_PAGES - 1;
  const info = C.info;

  let h = '<div class="screen combat pinned">';

  h += '<div class="navbar">';
  h += '<button class="navbtn" ' + (g > 0 ? 'onclick="UI.go(-1)"' : 'disabled') + '>◀</button>';
  h += '<div class="navmid"><b>' + esc(info.bookName) + ' · Ch' + info.chapter + ' · P' + info.page + '</b>' +
    '<span class="small dim">' + esc(info.chapterName) + ' · ' + wins + '/' + req + ' wins · ' + r0(G.profile.gold) + 'g · ' + G.profile.ep + ' EP</span></div>';
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
  h += '<div class="eslots">';
  e.abil.forEach((s, i) => {
    if (!s) return;
    const def = abilityDef(s.id);
    const seen = def.concept || G.profile.seen[s.id];
    const nm = seen ? def.name : '???';
    if (def.concept) {
      h += '<div class="eslot" onpointerdown="UI.press(\'eslot\',' + i + ',event)" onclick="event.stopPropagation()" oncontextmenu="return false">' +
        '<span class="ename" style="color:' + STAT_INFO[def.tag].color + '">' + nm + '</span>' +
        '<span class="small dim">passive' + (def.negative ? ' (negative)' : '') + '</span></div>';
      return;
    }
    const onCd = s.cd > 0;
    const pct = s.sustaining ? 100 : onCd ? 100 * s.cd / Math.max(0.1, cooldownOf(e, def)) : 100 * s.prog;
    h += '<div class="eslot" onpointerdown="UI.press(\'eslot\',' + i + ',event)" onclick="event.stopPropagation()" oncontextmenu="return false">' +
      '<span class="ename" style="color:' + (seen ? STAT_INFO[def.tag].color : 'var(--dim)') + '">' + nm +
      (s.ammo !== null ? ' ×' + Math.max(0, s.ammo) : '') + (s.sustaining ? ' ⟳' : '') + '</span>' +
      '<div class="fillbar"><div class="' + (onCd ? 'cdfill' : 'fillin') + '" style="width:' + pct + '%"></div></div></div>';
  });
  h += '</div>';
  if (UI.foeOpen) h += '<div class="foe-detail small"><div class="dim">' + statChips(effStats(e)) + '</div></div>';
  h += '</div>';

  // ally strips
  h += allyStrip(C.eAllies, 'foes');
  h += allyStrip(C.pAllies, 'allies');

  if (C.over) h += '<div class="vs">' + (C.fled ? 'The enemy fled!' : (C.reverse && C.enemy.hp <= 0) ? 'She didn\'t make it…' : C.enemy.hp <= 0 || C.noReward ? 'Victory!' : 'Defeated') + ' — next fight in a moment…</div>';
  else if (C.ending) h += '<div class="vs">…</div>';
  else h += '<div class="vs small dim">atk ×' + p.atkSpeed.toFixed(2) + ' · cast ×' + p.castSpeed.toFixed(2) + (C.reverse ? ' · <b>SAVE HER</b>' : '') + (C.silence ? ' · <b>you cannot act</b>' : '') + '</div>';

  // player
  h += '<div class="me card">';
  h += '<div class="row-between"><b>' + esc(p.name) + '</b><span class="dim">Lv ' + p.level + '</span></div>';
  h += bar(p.hp, p.maxHp, 'hp');
  h += bar(p.shield, p.maxShield, 'sh', 'Shield ' + r0(p.shield) + ' / ' + r0(p.maxShield) + (p.shield > p.maxShield ? ' (overcap)' : ''));
  h += resRow(p);
  h += statusChips(p);
  h += '</div>';
  h += '</div>'; // end scrolling screen

  // pinned ability bar (fixed above the tab bar — no jitter from the panels above)
  h += '<div class="slotdock"><div class="slots">';
  for (let i = 0; i < CFG.slotCount; i++) {
    const s = p.abil[i];
    if (!s) { h += '<div class="slot empty">—</div>'; continue; }
    const def = defFor(p, s.id);
    const dispName = slotDisplayName(p, def);
    if (def.concept) {
      h += '<button class="abil concept" style="--c:' + STAT_INFO[def.tag].color + '" ' +
        'onpointerdown="UI.press(\'slot\',' + i + ',event)" oncontextmenu="return false">' +
        '<b>' + esc(dispName) + '</b><span>passive</span></button>';
      continue;
    }
    const onCd = s.cd > 0;
    const pct = s.sustaining ? 100 : onCd ? 100 * s.cd / Math.max(0.1, cooldownOf(p, def)) : 100 * s.prog;
    const ec = earlyCost(def, s.prog, s);
    const remaining = (ec.stam || 0) + (ec.mana || 0) + (ec.reson || 0);
    const resName = def.cost.stam ? 'stam' : def.cost.mana ? 'mana' : 'reson';
    let label;
    if (s.sustaining) label = 'sustaining…';
    else if (s.reloading) label = (def.charge ? 'recharge ' : 'reload ') + r1(s.cd) + 's';
    else if (s.frozen > 0) label = 'frozen ' + r1(s.frozen) + 's';
    else if (onCd) label = 'cd ' + r1(s.cd) + 's';
    else if (remaining <= 0) label = 'ready!';
    else label = remaining + ' ' + resName;
    h += '<button class="abil' + (onCd || s.frozen > 0 ? ' oncd' : '') + '" style="--c:' + STAT_INFO[def.tag].color + '" ' +
      'onpointerdown="UI.press(\'slot\',' + i + ',event)" oncontextmenu="return false">' +
      '<b>' + esc(dispName) + (s.ammo !== null ? ' ×' + Math.max(0, s.ammo) : '') + '</b><span>' + label + '</span>' +
      '<div class="fillbar"><div class="' + (onCd ? 'cdfill' : 'fillin') + '" style="width:' + pct + '%"></div></div>' +
      '</button>';
  }
  h += '</div></div>';

  if (UI.tip) h += renderTip();

  return h;
};

function renderTip() {
  let h = '';
  const t = UI.tip;
  if (t.kind === 'slot' || t.kind === 'eslot') {
    const unit = t.kind === 'slot' ? C.player : C.enemy;
    const s = unit.abil[t.arg];
    if (s) h += abilityTipCard(unit, s, t.kind === 'slot');
  } else if (t.kind === 'ally') {
    const a = C.pAllies.concat(C.eAllies).find((x) => x.uid === t.arg);
    if (a) h += allyTipCard(a);
  } else if (t.kind === 'allyx') {
    const list = t.arg === 'e' ? C.eAllies : C.pAllies;
    const picked = pickDisplayAllies(list);
    h += '<div class="tipcard">' + (picked.hidden.length ? picked.hidden.map((a) => allyTipInner(a)).join('<hr class="tipsep">') : '<span class="dim">No hidden allies.</span>') + '</div>';
  }
  if (UI.tipKw && STATUSES[UI.tipKw]) {
    const m = STATUSES[UI.tipKw];
    h += '<div class="tipcard kw2"><b>' + m.name + '</b><div class="small" style="margin-top:4px">' + esc(m.desc) + '</div></div>';
  }
  return h;
}

function abilityTipCard(unit, s, isPlayer) {
  const def = defFor(unit, s.id);
  const seen = isPlayer || def.concept || G.profile.seen[s.id];
  if (!seen) {
    return '<div class="tipcard"><b>???</b><div class="small dim" style="margin-top:6px">This ability is a mystery until the enemy first uses it.</div></div>';
  }
  let h = '<div class="tipcard" style="--c:' + STAT_INFO[def.tag].color + '">';
  h += '<div class="row-between"><b style="color:' + STAT_INFO[def.tag].color + '">' + esc(slotDisplayName(unit, def)) + (def.__enh ? ' ✦' : '') + '</b>' +
    '<span class="small dim">' + (def.concept ? 'CONCEPT' : isSpell(def) ? 'SPELL' : 'SKILL') +
    (def.charge ? ' · CHARGE' : def.ammo ? ' · AMMO' : '') + (def.burst ? ' · BURST ' + def.burst : '') +
    (def.sustain ? ' · SUSTAIN' : '') + (def.initiate ? ' · INITIATE' : '') +
    ' · ' + STAT_INFO[def.tag].abbr + (def.tag2 ? '/' + STAT_INFO[def.tag2].abbr : '') + '</span></div>';
  if (def.desc) h += '<div class="small" style="margin:6px 0 2px">' + esc(def.desc) + '</div>';
  if (def.initOps && def.initOps.length) h += '<div class="small" style="margin:4px 0 2px"><span class="dim">Initiate:</span><br>' + formulaOps(def.initOps, unit).map((l) => kwFmt(esc(l))).join('<br>') + '</div>';
  if (def.full && def.full.length) h += '<div class="small" style="margin:6px 0 2px">' + formulaOps(def.full, unit).map((l) => kwFmt(esc(l))).join('<br>') + '</div>';
  if (isPlayer && unit.dmgByTag && unit.dmgByTag[def.tag]) h += '<div class="small dim">+' + unit.dmgByTag[def.tag] + ' damage from upgrades</div>';
  if (!def.concept) {
    const spell = isSpell(def);
    const speed = spell ? unit.castSpeed : unit.atkSpeed;
    let cdTxt;
    if (def.charge) cdTxt = 'Charge ×' + def.ammo + ' — no cooldown between uses, recharge ' + r1(rechargeCd(unit, def)) + 's after the last';
    else if (def.ammo) cdTxt = 'Ammo ×' + def.ammo + ' — cooldown ' + cooldownOf(unit, def) + 's, reload ' + r1(rechargeCd(unit, def)) + 's after the last';
    else if (def.sustain) cdTxt = 'Sustain — cooldown starts when the sustain breaks';
    else cdTxt = 'Cooldown ' + (cooldownOf(unit, def) * (1 + burstOf(def, s))) + 's';
    h += '<div class="small dim" style="margin-top:6px">Cost ' + costText(def.cost) +
      ' · ' + (spell ? 'Cast' : 'Attack') + ' Time ' + r1(fillTimeOf(unit, def, s) / Math.max(0.01, speed)) + 's (×' + speed.toFixed(2) + ')' +
      ' · ' + cdTxt + '</div>';
    if (isPlayer) h += '<div class="small dim">Hold ⓘ for keyword details. Tap to fire early for the remaining cost.</div>';
  }
  h += '</div>';
  return h;
}
function allyTipInner(a) {
  let h = '<b>' + esc(a.name) + '</b> <span class="small dim">' + r0(a.hp) + '/' + r0(a.maxHp) + ' HP · shield ' + r0(a.shield) + '</span>';
  h += '<div class="small dim" style="margin:4px 0">' + statChips(effStats(a)) + '</div>';
  a.abil.forEach((s) => {
    if (!s) return;
    const def = abilityDef(s.id);
    h += '<div class="small" style="margin-top:4px"><b style="color:' + STAT_INFO[def.tag].color + '">' + def.name + '</b> — ' +
      (def.concept ? esc(def.desc || 'passive') : formulaOps(def.full, a).map((l) => kwFmt(esc(l))).join('; ')) + '</div>';
  });
  return h;
}
function allyTipCard(a) { return '<div class="tipcard">' + allyTipInner(a) + '</div>'; }

function resRow(s) {
  return '<div class="res-row small">' +
    '<span class="res" style="color:' + STAT_INFO.int.color + '">Mana ' + r0(s.mana) + '/' + r0(s.maxMana) + ' (+' + r1(s.manaRegen) + ')</span>' +
    '<span class="res" style="color:' + STAT_INFO.dex.color + '">Stam ' + r0(s.stam) + '/' + r0(s.maxStam) + ' (+' + r1(s.stamRegen) + ')</span>' +
    '<span class="res" style="color:' + STAT_INFO.fai.color + '">Reson ' + r0(s.reson) + '/' + r0(s.maxReson) + ' (+' + r1(s.resonRegen) + ')</span>' +
    '</div>';
}
// stack format: (Stacks)×(Name) (min duration)
function statusChips(u) {
  const t = [];
  Object.keys(u.status).forEach((k) => {
    if (k === 'dazed') return;
    const meta = STATUSES[k];
    const e = u.status[k];
    let label;
    if (e.count != null) label = (e.count > 1 ? e.count + '×' : '') + meta.name;
    else {
      const n = e.stacks.length;
      label = (n > 1 ? n + '×' : '') + meta.name + ' ' + r1(stMinSecs(u, k));
    }
    t.push('<span class="tag ' + (meta.bad ? 'bad' : 'good') + '" onpointerdown="UI.press(\'kw\',\'' + k + '\',event)">' + label + '</span>');
  });
  u.buffs.forEach((b) => t.push('<span class="tag good">+' + r0(b.amt) + ' dmg ' + r1(b.secs) + 's</span>'));
  u.weaks.forEach((w) => t.push('<span class="tag bad">-' + r0(w.amt) + ' dmg ' + r1(w.secs) + 's</span>'));
  u.dots.forEach((d) => t.push('<span class="tag bad">' + d.label + ' ' + r0(d.dps) + '/s ' + r1(d.secs) + 's</span>'));
  if (u.counter) t.push('<span class="tag good">counter ready</span>');
  if (u.fury > 0) t.push('<span class="tag good">fury +' + u.fury + '</span>');
  return t.length ? '<div class="status">' + t.join('') + '</div>' : '';
}

UI.toggleFoe = function () { UI.foeOpen = !UI.foeOpen; UI.session(); };
UI.toggleAuto = function () { G.profile.autoTravel = !G.profile.autoTravel; save(); UI.session(); };
UI.go = function (dir) {
  if (travel(dir)) { UI.foeOpen = false; newBattle(); }
  UI.session();
};

// press-and-hold: quick press on a player slot = fire early; hold = tooltip.
// After release a tooltip lingers CFG.tipLinger seconds; keywords inside can
// be held for a nested tooltip, which restores the parent timer when it ends.
UI.press = function (kind, arg, ev) {
  if (ev) { if (ev.preventDefault) ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation(); }
  UI._press = (kind === 'slot') ? arg : null;
  clearTimeout(UI._holdT);
  UI._holdT = setTimeout(function () {
    UI._holding = true;
    UI._press = null;
    if (kind === 'kw') UI.tipKw = arg;
    else { UI.tip = { kind: kind, arg: arg }; UI.tipKw = null; }
    if (G.session) UI.session();
  }, 380);
};
UI.release = function () {
  clearTimeout(UI._holdT);
  if (UI._holding) {
    UI._holding = false;
    UI.tipExpire = Date.now() + CFG.tipLinger * 1000;
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
    h += '<div class="row"><button class="btn small primary" onclick="UI.learnTome(' + idx + ')">Learn (permanent)</button>' +
      '<button class="btn small" onclick="UI.scrap(' + idx + ')">Scrap (+' + scrapValue(it) + 'g)</button></div>';
    h += '</div>';
    return h;
  }
  if (it.kind === 'rune') {
    h += '<div>+' + it.amt + ' ' + STAT_INFO[it.stat].name + ' <span class="small dim">(' + it.base + (it.mult > 1 ? ' ×' + it.mult : '') + ')</span></div>';
    h += '<div class="row"><button class="btn small" onclick="UI.scrap(' + idx + ')">Scrap (+' + scrapValue(it) + 'g)</button></div>';
    h += '<div class="small dim" style="margin-top:6px">Use via Augment on a gear piece with a blank slot.</div>';
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
    h += '<button class="btn small" onclick="UI.scrap(' + idx + ')">Scrap (+' + scrapValue(it) + 'g)</button>';
    h += '</div><div class="row" style="flex-wrap:wrap">';
    h += bsBtn('upgrade', 'Upgrade L+1', it.upgrades >= CFG.maxItemUpgrades, CFG.bsCosts.upgrade, it.upgrades + '/' + CFG.maxItemUpgrades);
    h += bsBtn('reroll', 'Reroll', it.rerolls >= CFG.maxRerolls, rerollCostOf(it), it.rerolls + '/' + CFG.maxRerolls);
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
  if (it && confirm('Scrap this for ' + scrapValue(it) + ' gold?')) {
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
  'squire-trainee':   [65, 400], 'scouts-runner': [190, 400],
  'mages-apprentice': [315, 400], 'assistant-scribe': [440, 400],
  fighter: [40, 240], mercenary: [125, 240], rogue: [210, 240],
  monk: [295, 240], mage: [380, 240], deacon: [465, 240],
  duelist: [50, 80], knight: [140, 80], ranger: [230, 80], druid: [320, 80], scholar: [410, 80],
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
  const cs = characterStats();
  const d = derive(cs);
  h += '<div class="card"><h3 style="margin-top:0">Your total stats</h3>' + statChips(cs);
  h += '<div class="small dim" style="margin-top:6px">HP ' + r0(d.maxHp) + ' · Shield ' + r0(d.maxShield) +
    ' · Mana ' + r0(d.maxMana) + ' · Stam ' + r0(d.maxStam) + ' · Reson ' + r0(d.maxReson) +
    ' · atk ×' + d.atkSpeed.toFixed(2) + ' · cast ×' + d.castSpeed.toFixed(2) + '</div></div>';
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
    h += '<div class="small dim" style="margin-top:4px">Resets the run to Classless Lv1 (levels, skills, EP lost; tome skills kept). Completed chapters lower future win requirements.</div></div>';
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
  if (!confirm('Prestige ' + CLASSES[id].name + '? The run restarts at Classless Lv1 (levels, skills & EP lost; tome skills kept), but you gain permanent leveling speed and lower win requirements for completed chapters.')) return;
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
function abilitySource(id) {
  return G.profile.tomeSkills.indexOf(id) !== -1 ? 'tome' : 'class';
}
UI.bookTab = function () {
  const p = G.profile;
  let h = '<div class="screen"><h2>Skill Book <span class="small dim">· ' + p.ep + ' EP</span></h2>';

  if (p.pendingDrafts.length) {
    const offer = p.pendingDrafts[0];
    h += '<div class="card" style="border-color:var(--gold)"><h3 style="margin-top:0">Choose a skill (' + p.pendingDrafts.length + ' draft' + (p.pendingDrafts.length > 1 ? 's' : '') + ')</h3>';
    offer.forEach((id) => {
      const sk = ABILITIES[id];
      h += '<button class="btn big" style="text-align:left;margin-bottom:6px" onclick="UI.draftPick(\'' + id + '\')">' +
        '<b style="color:' + STAT_INFO[sk.tag].color + '">' + sk.name + '</b> <span class="small dim">(' + STAT_INFO[sk.tag].abbr + ', ' + costText(sk.cost) + ')</span><br>' +
        '<span class="small dim">' + (sk.desc ? esc(sk.desc) + ' · ' : '') + describeOps(sk.full, characterStats()) + '</span></button>';
    });
    h += '</div>';
  }

  h += '<h3>Equipped (' + p.slots.filter(Boolean).length + '/' + CFG.slotCount + ')</h3>';
  for (let i = 0; i < CFG.slotCount; i++) {
    const id = p.slots[i];
    if (!id) { h += '<div class="tree-node locked"><span class="dim">empty slot ' + (i + 1) + '</span></div>'; continue; }
    const def = enhancedDef(id);
    h += '<div class="tree-node" style="border-color:' + STAT_INFO[def.tag].color + '">';
    h += '<div><b>' + def.name + (def.__enh ? ' ✦' : '') + '</b>' + (def.concept ? ' <span class="tag good">concept</span>' : '') +
      '<div class="small dim">' + costText(def.cost) + (def.desc ? ' · ' + esc(def.desc) : '') +
      (def.full && def.full.length ? ' · ' + describeOps(def.full, characterStats()) : '') + '</div></div>';
    h += '<button class="btn small" onclick="UI.unequipSkill(' + i + ')">Remove</button>';
    h += '</div>';
  }

  // view filters: Possessed / Buy Back → Tome / Class → stat
  h += '<div class="filterbar" style="margin-top:10px">';
  [['possessed', 'Possessed'], ['buyback', 'Buy Back (1 EP)']].forEach((v) => {
    h += '<button class="filterbtn ' + (UI.bookView === v[0] ? 'on' : '') + '" onclick="UI.setView(\'' + v[0] + '\')">' + v[1] + '</button>';
  });
  h += '</div><div class="filterbar">';
  [['all', 'All'], ['tome', 'Tome'], ['class', 'Class']].forEach((v) => {
    h += '<button class="filterbtn ' + (UI.bookSource === v[0] ? 'on' : '') + '" onclick="UI.setSource(\'' + v[0] + '\')">' + v[1] + '</button>';
  });
  h += '</div>';

  let list = (UI.bookView === 'possessed')
    ? p.skills.filter((id) => p.slots.indexOf(id) === -1)
    : p.sacrificed.slice();
  if (UI.bookSource !== 'all') list = list.filter((id) => abilitySource(id) === UI.bookSource);
  const ownTags = STATS.filter((s) => list.some((id) => { const d = ABILITIES[id]; return d.tag === s || d.tag2 === s; }));
  h += '<div class="filterbar"><button class="filterbtn ' + (UI.bookFilter === 'all' ? 'on' : '') + '" onclick="UI.setFilter(\'all\')">All</button>';
  ownTags.forEach((s) => {
    h += '<button class="filterbtn ' + (UI.bookFilter === s ? 'on' : '') + '" style="--c:' + STAT_INFO[s].color + '" onclick="UI.setFilter(\'' + s + '\')">' + STAT_INFO[s].abbr + '</button>';
  });
  h += '</div>';
  if (UI.bookFilter !== 'all') list = list.filter((id) => { const d = ABILITIES[id]; return d.tag === UI.bookFilter || d.tag2 === UI.bookFilter; });

  if (!list.length) h += '<div class="dim small">Nothing here.</div>';
  list.forEach((id) => {
    const def = enhancedDef(id);
    const on = UI.bookSel === id;
    h += '<div class="tree-node" style="cursor:pointer' + (on ? ';border-color:var(--accent)' : '') + '" onclick="UI.bookSelect(\'' + id + '\')">';
    h += '<div><b>' + def.name + (def.__enh ? ' ✦' : '') + '</b>' + (def.concept ? ' <span class="tag good">concept</span>' : '') +
      ' <span class="small dim">' + abilitySource(id) + '</span>' +
      '<div class="small dim">' + STAT_INFO[def.tag].abbr + ' · ' + costText(def.cost) +
      (def.desc ? ' · ' + esc(def.desc) : '') +
      (def.full && def.full.length ? ' · ' + describeOps(def.full, characterStats()) : '') + '</div></div>';
    h += '</div>';
    if (on) h += abilityPopup(id);
  });

  h += '</div>';
  return h;
};
function abilityPopup(id) {
  const p = G.profile;
  let h = '<div class="card" style="border-color:var(--accent)">';
  if (UI.bookView === 'buyback') {
    h += '<div class="row"><button class="btn small primary" ' + (p.ep >= 1 ? 'onclick="UI.buyBack(\'' + id + '\')"' : 'disabled') + '>Buy Back (1 EP)</button></div>';
    h += '</div>';
    return h;
  }
  const full = p.slots.every(Boolean);
  h += '<div class="row" style="flex-wrap:wrap">';
  h += '<button class="btn small primary" ' + (full ? 'disabled' : 'onclick="UI.equipSkill(\'' + id + '\')"') + '>Equip</button>';
  h += '<button class="btn small" onclick="UI.sacrifice(\'' + id + '\')">Sacrifice (+1 EP)</button>';
  h += '<button class="btn small ' + (UI.enhOpen ? 'primary' : '') + '" onclick="UI.toggleEnh()">Enhance…</button>';
  h += '</div>';
  if (UI.enhOpen) {
    const e = enhOf(id);
    h += '<div class="small dim" style="margin:6px 0">EP spent here: ' + e.spent + ' — every EP adds +1 flat damage (damage abilities); every 2 EP adds +1 resource cost.</div>';
    enhanceOptions(id).forEach((o) => {
      const can = p.ep >= o.cost;
      h += '<div class="upg"><div>' + o.label + ' <span class="small dim">' + o.cost + ' EP</span></div>' +
        '<button class="btn small ' + (can ? 'primary' : '') + '" ' + (can ? 'onclick="UI.doEnhance(\'' + id + '\',\'' + o.key + '\',' + o.cost + ')"' : 'disabled') + '>Buy</button></div>';
    });
    if (!enhanceOptions(id).length) h += '<div class="small dim">No enhancement options for this ability.</div>';
  }
  h += '</div>';
  return h;
}
UI.setView = function (v) { UI.bookView = v; UI.bookSel = null; UI.session(); };
UI.setSource = function (v) { UI.bookSource = v; UI.session(); };
UI.setFilter = function (s) { UI.bookFilter = s; UI.session(); };
UI.bookSelect = function (id) { UI.bookSel = UI.bookSel === id ? null : id; UI.enhOpen = false; UI.session(); };
UI.sacrifice = function (id) {
  if (sacrificeAbility(id)) { UI.bookSel = null; rebuildPlayer(); }
  UI.session();
};
UI.buyBack = function (id) {
  if (buyBackAbility(id)) { UI.bookSel = null; rebuildPlayer(); }
  UI.session();
};
UI.toggleEnh = function () { UI.enhOpen = !UI.enhOpen; UI.session(); };
UI.doEnhance = function (id, key, cost) {
  if (buyEnhance(id, key, cost)) rebuildPlayer();
  UI.session();
};
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
  UI.bookSel = null;
  rebuildPlayer();
  save(); UI.session();
};
UI.unequipSkill = function (i) {
  G.profile.slots[i] = null;
  rebuildPlayer();
  save(); UI.session();
};

// ================= Bestiary tab =================
UI.bestiaryTab = function () {
  let h = '<div class="screen"><h2>Bestiary</h2>';
  h += '<div class="filterbar">';
  [['settings', 'Settings & Log'], ['enemies', 'Enemies'], ['classes', 'Classes'], ['abilities', 'Abilities'], ['keywords', 'Keywords']].forEach((v) => {
    h += '<button class="filterbtn ' + (UI.bestTab === v[0] ? 'on' : '') + '" onclick="UI.setBest(\'' + v[0] + '\')">' + v[1] + '</button>';
  });
  h += '</div>';
  if (UI.bestTab === 'settings') h += bestSettings();
  else if (UI.bestTab === 'enemies') h += bestEnemies();
  else if (UI.bestTab === 'classes') h += bestClasses();
  else if (UI.bestTab === 'abilities') h += bestAbilities();
  else h += bestKeywords();
  h += '</div>';
  return h;
};
UI.setBest = function (t) { UI.bestTab = t; UI.session(); };
function bestSettings() {
  let h = '<button class="btn big" onclick="UI.exit()">◀ Back to Map (pause combat)</button>';
  h += '<div class="card" style="margin-top:10px"><div class="row-between">' +
    '<div><b>Auto-advance</b><div class="small dim">Move to the next page when its win requirement is met</div></div>' +
    '<button class="btn small ' + (G.profile.autoTravel ? 'primary' : '') + '" onclick="UI.toggleAuto()">' + (G.profile.autoTravel ? 'ON' : 'OFF') + '</button>' +
    '</div></div>';
  h += '<h3>Combat Log</h3>';
  h += '<div class="log">' + (C ? C.log.slice().reverse().map(esc).join('<br>') : 'No active combat.') + '</div>';
  h += '<h3>Danger zone</h3>';
  h += '<button class="btn small" onclick="UI.resetSave()">Reset save</button>';
  h += '<p class="small dim" style="margin-top:10px">Pathbound — idle rework (Milestone 5).</p>';
  return h;
}
function bestEnemies() {
  let h = '<div class="filterbar">';
  BOOKS.slice(0, 2).forEach((b, bi) => {
    h += '<button class="filterbtn ' + (UI.bestBook === bi ? 'on' : '') + '" onclick="UI.bestBook=' + bi + ';UI.session()">' + b.name + '</button>';
  });
  h += '</div>';
  const content = BOOKS[UI.bestBook].content;
  let any = false;
  content.forEach((ch, ci) => {
    const met = ch.pages.filter((pg) => G.profile.metEnemies[pg.id]);
    if (!met.length) return;
    any = true;
    h += '<h3>Ch' + (ci + 1) + ' — ' + esc(ch.name) + '</h3>';
    met.forEach((pg) => {
      h += '<div class="card"><b>' + esc(pg.name) + '</b> <span class="small dim">' + pg.hp + ' HP</span>';
      const filler = 3 + 2 * (ci + 1) + (UI.bestBook >= 1 ? 10 : 0);
      const stats = {}; STATS.forEach((s) => (stats[s] = (pg.stats && pg.stats[s]) || filler));
      h += '<div class="small" style="margin:4px 0">' + statChips(stats) + '</div>';
      pg.abilities.forEach((id) => {
        const def = ABILITIES[id];
        const seen = def.concept || G.profile.seen[id];
        if (!seen) { h += '<div class="small dim">??? — not yet witnessed</div>'; return; }
        h += '<div class="small"><b style="color:' + STAT_INFO[def.tag].color + '">' + def.name + '</b>' +
          (def.concept ? ' <span class="dim">(passive)</span>' : ' <span class="dim">(' + costText(def.cost) + ')</span>') +
          ' — ' + (def.desc ? esc(def.desc) + ' ' : '') + describeOps(def.full, stats) + '</div>';
      });
      h += '</div>';
    });
  });
  if (!any) h += '<div class="dim small">No enemies witnessed in this book yet.</div>';
  return h;
}
function bestClasses() {
  let h = '';
  Object.keys(CLASSES).forEach((id) => {
    const c = CLASSES[id];
    h += '<div class="card"><div class="row-between"><b>' + esc(c.name) + '</b><span class="dim small">Tier ' + c.tier + '</span></div>';
    h += '<div class="small dim">Level cost: ' + c.baseXp + (c.flatStep ? ' +' + c.flatStep + '/level' : '') + ' XP, ×' + c.xpMult + ' compounding' +
      (c.unlock.length ? ' · ' + unlockText(c) : '') + '</div>';
    if (c.unlocks) {
      h += '<div class="small">Unlocks: ' + [1, 10, 100].map((m) =>
        'Lv' + m + ': ' + (c.unlocks[m] || []).map((aid) => ABILITIES[aid].name).join(', ')).join(' · ') + '</div>';
    } else {
      h += '<div class="small dim">Unlocks: skill drafts at Lv 1 / 10 / 100</div>';
    }
    h += '<div class="small dim">Gains: ' + c.gains.map((g) =>
      'every ' + g.everyN + ': ' + Object.keys(g.add).map((s) => '+' + g.add[s] + ' ' + STAT_INFO[s].abbr).join(' ')).join(' · ') + '</div>';
    h += '</div>';
  });
  return h;
}
function bestAbilities() {
  let h = '<div class="filterbar">';
  [['all', 'All'], ['tome', 'Tome'], ['class', 'Class']].forEach((v) => {
    h += '<button class="filterbtn ' + (UI.bestSource === v[0] ? 'on' : '') + '" onclick="UI.bestSource=\'' + v[0] + '\';UI.session()">' + v[1] + '</button>';
  });
  h += '</div><div class="filterbar">';
  ['all'].concat(STATS).forEach((s) => {
    h += '<button class="filterbtn ' + (UI.bestStat === s ? 'on' : '') + '" ' + (s !== 'all' ? 'style="--c:' + STAT_INFO[s].color + '"' : '') +
      ' onclick="UI.bestStat=\'' + s + '\';UI.session()">' + (s === 'all' ? 'All' : STAT_INFO[s].abbr) + '</button>';
  });
  h += '</div>';
  let known = G.profile.skills.concat(G.profile.sacrificed, G.profile.tomeSkills.filter((id) => G.profile.skills.indexOf(id) === -1));
  known = known.filter((id, i) => known.indexOf(id) === i);
  if (UI.bestSource !== 'all') known = known.filter((id) => abilitySource(id) === UI.bestSource);
  if (UI.bestStat !== 'all') known = known.filter((id) => { const d = ABILITIES[id]; return d.tag === UI.bestStat || d.tag2 === UI.bestStat; });
  if (!known.length) return h + '<div class="dim small">No known abilities match.</div>';
  known.forEach((id) => {
    const def = ABILITIES[id];
    h += '<div class="card small"><b style="color:' + STAT_INFO[def.tag].color + '">' + def.name + '</b>' +
      ' <span class="dim">(' + (def.concept ? 'concept' : costText(def.cost)) + ' · ' + abilitySource(id) + ')</span>' +
      (def.desc ? '<br>' + esc(def.desc) : '') +
      (def.full && def.full.length ? '<br>' + describeOps(def.full, characterStats()) : '') + '</div>';
  });
  return h;
}
function bestKeywords() {
  let h = '<h3>Ability types</h3>';
  Object.keys(TYPE_KEYWORDS).forEach((k) => {
    h += '<div class="card small"><b>' + k + '</b> — ' + esc(TYPE_KEYWORDS[k]) + '</div>';
  });
  h += '<h3>Conditions</h3>';
  h += '<div class="card small dim">Format: (Stacks)×(Condition) (Duration) — e.g. "2×Bleed 5". The timer shown is the stack closest to expiring.</div>';
  Object.keys(STATUSES).forEach((k) => {
    const m = STATUSES[k];
    h += '<div class="card small"><b>' + m.name + '</b> <span class="dim">(' + m.kind + (m.bad ? ', debuff' : '') + ')</span> — ' + esc(m.desc) + '</div>';
  });
  return h;
}
UI.resetSave = function () {
  if (!confirm('Erase all progress and start over?')) return;
  localStorage.removeItem(SAVE_KEY);
  G.profile = null; G.session = false; C = null;
  load(); UI.tab = 'combat'; UI.home();
};

// global release handler
if (typeof document !== 'undefined') {
  document.addEventListener('pointerup', function () { UI.release(); });
  document.addEventListener('pointercancel', function () { clearTimeout(UI._holdT); UI._press = null; UI._holding = false; });
}
