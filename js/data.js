// ===== Pathbound (Idle rework) — game data & config =====
'use strict';

// Ten stats, five pairs + Soul + Perseverance. All start at CFG.startStat.
const STATS = ['str', 'end', 'dex', 'agi', 'int', 'wis', 'fai', 'pie', 'sol', 'per'];

const STAT_INFO = {
  str: { name: 'Strength',     abbr: 'STR', color: '#e8645a' },
  end: { name: 'Endurance',    abbr: 'END', color: '#e8945a' },
  dex: { name: 'Dexterity',    abbr: 'DEX', color: '#9de85a' },
  agi: { name: 'Agility',      abbr: 'AGI', color: '#5ae87a' },
  int: { name: 'Intelligence', abbr: 'INT', color: '#5aa9e8' },
  wis: { name: 'Wisdom',       abbr: 'WIS', color: '#5ae8c0' },
  fai: { name: 'Faith',        abbr: 'FAI', color: '#e8d65a' },
  pie: { name: 'Piety',        abbr: 'PIE', color: '#e8b85a' },
  sol: { name: 'Soul',         abbr: 'SOL', color: '#b07ae8' },
  per: { name: 'Perseverance', abbr: 'PER', color: '#e8c468' },
};

const CFG = {
  tickMs: 100,
  startStat: 5,
  slotCount: 8,
  cdSkill: 2,               // cooldown after a skill (stamina)
  cdSpell: 3,               // cooldown after a spell (mana/resonance)
  dazedSlow: 0.9,           // receiving damage: ability speed ×0.9...
  dazedSecs: 0.25,          // ...for this long
  winsToAdvance: 10,        // base victory requirement per page
  levelCap: 1000,
  classlessUnlock: 30,
  // upgrades
  upgradeFlatStep: 1,
  upgradeMult: 1.1,
  upgradeUnlock: 30,
  // prestige
  prestigeLevel: 100,
  prestigeDivisor: 9,
  prestigeSpeedPerClass: 0.5,
  // equipment / economy
  dropChance: 0.10,
  runeChance: 0.01,
  tomeChance: 0.001,        // tomes always fit in the bag, even when full
  goldPerChapter: 10,       // gold per kill = chapter × this (× book mult)
  invSize: 100,
  prefixChances: [1, 0.5, 0.1, 0.01, 0.001],
  multChances: [[2, 0.10], [3, 0.01], [4, 0.001]],
  maxItemUpgrades: 10,
  maxRerolls: 2,
  bsCosts: { upgrade: 100, reroll: 250, extract: 500, augment: 1500 },
  bookStatMult: 3,          // Hard/Nightmare/Hell multiply stats & rewards by this
  dmgScale: 1,
};

// ---- equipment ----
const EQUIP_SLOTS = {
  head: 'Helm', chest: 'Cuirass', legs: 'Leggings',
  feet: 'Greaves', hands: 'Gauntlets', shoulders: 'Pauldron',
};
const GEAR_STATS = ['str', 'end', 'dex', 'agi', 'int', 'wis', 'fai', 'pie'];

// ---- status keywords ----
// dur-based unless charge:true (consumed by damaging abilities).
const STATUSES = {
  guilt:       { name: 'Guilt',       charge: true, bad: true, desc: 'Next damaging ability deals half damage' },
  confusion:   { name: 'Confusion',   charge: true, bad: true, desc: 'Next damaging ability has a 50% chance to hit yourself' },
  empower:     { name: 'Empowerment', charge: true, desc: 'Next X damaging abilities deal bonus damage equal to your Piety' },
  blind:       { name: 'Blind',       bad: true, desc: 'Abilities cannot activate — they wait, ready, until Blind ends' },
  protection:  { name: 'Protection',  desc: 'Damage received reduced 25%' },
  frost:       { name: 'Frost',       bad: true, desc: 'Ability Speed −10% · health regen halved' },
  poison:      { name: 'Poison',      bad: true, desc: 'Health regen stops · lose 1% max health per second' },
  bruised:     { name: 'Bruised',     bad: true, desc: 'Skill damage received +50%' },
  interrupted: { name: 'Interrupted', bad: true, desc: 'Ability Speed stops' },
  intimidated: { name: 'Intimidated', bad: true, desc: 'Ability Speed −25%' },
  enlarged:    { name: 'Enlarged',    desc: '+30% Endurance and Strength' },
  shrink:      { name: 'Shrink',      desc: '20% chance to dodge damaging abilities' },
  agile:       { name: 'Agile',       desc: '+30% Attack Speed' },
  regen:       { name: 'Regen',       desc: 'Regenerate 5% max health per second' },
  unburdened:  { name: 'Unburdened',  desc: '+20% Strength, Agility and Dexterity' },
  dazed:       { name: 'Dazed',       bad: true, desc: 'Just hit: Ability Speed −10%' },
  cdfast:      { name: 'Momentum',    desc: 'Cooldowns 20% faster' },
  cdslow:      { name: 'Sluggish',    bad: true, desc: 'Cooldowns 20% slower' },
  // instant on application (not lingering on the bar):
  nausea:      { name: 'Nausea',      bad: true, instant: true, desc: 'A random ready ability immediately goes on cooldown; its bar restarts' },
  concuss:     { name: 'Concuss',     bad: true, instant: true, desc: 'A random ability\'s bar freezes for the duration' },
};

// ---- abilities (player unlocks + all authored enemy abilities) ----
// schema: name, tag(+tag2), cost {stam|mana|reson}, full:[ops]
//   ops: dmg(base,mult,stat[,stat2],kind,pierce,leech) · heal · shield(overcap?)
//        st(key,dur|count,to:'self'|'foe'|'both') · dot (legacy draft skills)
// flags: concept (passive, no bar) · negative · ammo:n (uses per combat)
//        startCd · firstFree (first early-activation free) · followUp
//        speedLink:{id,mult} (hasten another of your abilities until it hits)
//        special:'flee'|'counter' · draft (in tier-1+ draft pool) · noLearn
const ABILITIES = {
  // ===== Classless =====
  'basic-strike':   { name: 'Basic Strike', tag: 'str', cost: { stam: 3 },
    full: [{ t: 'dmg', base: 1, mult: 1, stat: 'str', kind: 'phys' }] },
  'follow-up-slash':{ name: 'Follow-up Slash', tag: 'dex', cost: { stam: 5 }, followUp: true,
    desc: 'Whenever another skill deals damage, this skill\'s Attack Speed rises 25% (stacking). Resets when this deals damage.',
    full: [{ t: 'dmg', base: 2, mult: 1.3, stat: 'dex', kind: 'phys' }] },
  'magic-pebble':   { name: 'Magic Pebble', tag: 'int', cost: { mana: 3 },
    full: [{ t: 'dmg', base: 1, mult: 1, stat: 'int', kind: 'mag' }] },
  'protection':     { name: 'Protection', tag: 'fai', cost: { reson: 10 },
    full: [{ t: 'st', key: 'protection', dur: 5, to: 'self' }] },
  'body-bash':      { name: 'Body Bash', tag: 'end', cost: { stam: 12 },
    full: [{ t: 'dmg', base: 10, mult: 2, stat: 'end', kind: 'phys' }] },
  'leaping-strike': { name: 'Leaping Strike', tag: 'agi', cost: { stam: 8 },
    full: [{ t: 'dmg', base: 7, mult: 1.5, stat: 'agi', kind: 'phys' }] },
  'obscure-vision': { name: 'Obscure Vision', tag: 'wis', cost: { mana: 15 },
    full: [{ t: 'st', key: 'blind', dur: 6, to: 'foe' }] },
  'empowerment':    { name: 'Empowerment', tag: 'pie', cost: { reson: 12 },
    full: [{ t: 'st', key: 'empower', count: 2, to: 'self' }] },
  'determination':  { name: 'Determination', tag: 'sol', cost: {}, concept: true,
    desc: 'Increase Soul and Perseverance by 0.2% × highest Classless level reached.' },

  // ===== Tier 0.5 unlocks =====
  'preemptive-strike': { name: 'Preemptive Strike', tag: 'str', cost: { stam: 4 }, firstFree: true,
    desc: 'First activation each combat skips the stamina cost.',
    full: [{ t: 'dmg', base: 5, mult: 0.7, stat: 'str', kind: 'phys' }] },
  'remove-weights': { name: 'Remove Training Weights', tag: 'end', cost: { stam: 12 },
    full: [{ t: 'st', key: 'unburdened', dur: 5, to: 'self' }] },
  'disciplined':    { name: 'Disciplined', tag: 'end', cost: {}, concept: true,
    desc: 'Receiving damage does not slow your Ability Speed.' },
  'quick-flurry':   { name: 'Quick Flurry', tag: 'dex', cost: { stam: 2 }, ammo: 4, charge: true,
    full: [{ t: 'dmg', base: 3, mult: 1.1, stat: 'dex', kind: 'phys' }] },
  'momentum-shift': { name: 'Momentum Shift', tag: 'agi', cost: { stam: 8 },
    full: [{ t: 'st', key: 'cdfast', dur: 6, to: 'self' }, { t: 'st', key: 'cdslow', dur: 6, to: 'foe' }] },
  'tireless':       { name: 'Tireless', tag: 'agi', cost: {}, concept: true,
    desc: 'Your cooldowns are reduced by 0.5 seconds.' },
  'fire-bolt':      { name: 'Fire Bolt', tag: 'int', cost: { mana: 10 },
    full: [{ t: 'dmg', base: 14, mult: 2, stat: 'int', kind: 'mag' }] },
  'ward':           { name: 'Ward', tag: 'wis', cost: { mana: 8 },
    desc: 'Can Overcap: shield may exceed its maximum; excess decays 1%/s.',
    full: [{ t: 'shield', base: 5, mult: 0.7, stat: 'wis', overcap: true }] },
  'repeating-focus':{ name: 'Repeating Focus', tag: 'int', cost: {}, concept: true,
    desc: 'Each offensive spell\'s damage grows +1 every time you cast it, until combat ends.' },
  'read-scripture': { name: 'Read Scripture', tag: 'fai', cost: { reson: 10 },
    full: [{ t: 'st', key: 'regen', dur: 3, to: 'self' }] },
  'frost-scroll':   { name: 'Create Frost Scroll', tag: 'pie', cost: { reson: 7 },
    full: [{ t: 'st', key: 'frost', dur: 4, to: 'foe' },
           { t: 'dmg', base: 3, mult: 1.1, stat: 'pie', kind: 'mag' }] },
  'watched-over':   { name: 'Watched Over', tag: 'fai', cost: {}, concept: true,
    desc: 'Your Faith is added to your maximum health.' },

  // ===== Book 1 enemy abilities (learnable via Tomes unless noLearn) =====
  // Chapter 1
  'stare-menacingly': { name: 'Stare Menacingly', tag: 'end', cost: { stam: 6 },
    full: [{ t: 'st', key: 'interrupted', dur: 1, to: 'foe' }] },
  'intimidating-demeanor': { name: 'Intimidating Demeanor', tag: 'end', cost: { stam: 10 },
    full: [{ t: 'st', key: 'intimidated', dur: 4, to: 'foe' }] },
  'being-bigger':   { name: 'Being Bigger', tag: 'end', cost: { stam: 8 },
    full: [{ t: 'st', key: 'enlarged', dur: 5, to: 'self' }] },
  'buckle':         { name: 'Buckle', tag: 'end', cost: {}, concept: true, negative: true, noLearn: true,
    desc: 'Damage received accumulates; at 20% of max health, lose 10% max health and take 5% max health extra damage. Healing does not undo it.' },
  'left-fist':      { name: 'Left Fist', tag: 'str', cost: { stam: 2 },
    full: [{ t: 'dmg', base: 5, mult: 1, stat: 'str', kind: 'phys' }] },
  'right-fist':     { name: 'Right Fist', tag: 'str', cost: { stam: 2 }, startCd: true,
    full: [{ t: 'dmg', base: 10, mult: 1, stat: 'str', kind: 'phys' }] },
  // Chapter 2
  'weak-swing':     { name: 'Weak Swing', tag: 'str', cost: { stam: 3 },
    full: [{ t: 'dmg', base: 5, mult: 1.1, stat: 'str', kind: 'phys' }] },
  'drop-shield':    { name: 'Drop Shield', tag: 'end', cost: { stam: 4 },
    full: [{ t: 'st', key: 'guilt', count: 1, to: 'foe' }] },
  'cower':          { name: 'Cower', tag: 'dex', cost: { stam: 4 },
    full: [{ t: 'st', key: 'shrink', dur: 4, to: 'self' }] },
  'vengeful-strike':{ name: 'Vengeful Strike', tag: 'str', cost: { stam: 4 },
    full: [{ t: 'dmg', base: 5, mult: 1.3, stat: 'str', kind: 'phys' }] },
  'you-monster':    { name: 'You Monster!', tag: 'wis', cost: { mana: 5 },
    full: [{ t: 'st', key: 'guilt', count: 1, to: 'foe' }] },
  'skull-crack':    { name: 'Skull Crack', tag: 'str', cost: { stam: 12 },
    full: [{ t: 'st', key: 'concuss', dur: 3, to: 'foe' },
           { t: 'dmg', base: 20, mult: 1.5, stat: 'str', kind: 'phys' }] },
  'back-in-my-day': { name: 'Back in my Day..', tag: 'wis', cost: { mana: 8 },
    full: [{ t: 'st', key: 'intimidated', dur: 3, to: 'foe' }] }, // authored fill-in: a long boring story
  'where-am-i':     { name: 'Where am I??', tag: 'wis', cost: { mana: 10 },
    full: [{ t: 'st', key: 'confusion', count: 1, to: 'both' }] },
  'shuffle':        { name: 'Shuffle', tag: 'agi', cost: { stam: 6 },
    full: [{ t: 'st', key: 'agile', dur: 4, to: 'self' }] },
  'cane-swipe':     { name: 'Cane Swipes', tag: 'dex', cost: { stam: 3 }, ammo: 3, charge: true,
    full: [{ t: 'dmg', base: 4, mult: 1.1, stat: 'dex', kind: 'phys' }] },
  // Chapter 3
  'twin-strike':    { name: 'Twin Strike', tag: 'dex', cost: { stam: 5 },
    full: [{ t: 'dmg', base: 3, mult: 1.1, stat: 'dex', kind: 'phys' },
           { t: 'dmg', base: 3, mult: 1.1, stat: 'dex', kind: 'phys' }] },
  'throwing-dagger':{ name: 'Throwing Dagger', tag: 'dex', cost: { stam: 3 }, ammo: 3,
    full: [{ t: 'dmg', base: 3, mult: 1.8, stat: 'dex', kind: 'phys' }] },
  'leg-sweep':      { name: 'Leg Sweep', tag: 'agi', cost: { stam: 6 },
    full: [{ t: 'st', key: 'interrupted', dur: 1, to: 'foe' },
           { t: 'dmg', base: 6, mult: 1.2, stat: 'agi', kind: 'phys' }] },
  'viper-strike':   { name: 'Viper Strike', tag: 'agi', cost: { stam: 2 },
    full: [{ t: 'dmg', base: 3, mult: 1.2, stat: 'agi', kind: 'phys' }] },
  'poison-dagger':  { name: 'Poison Dagger', tag: 'dex', cost: { stam: 5 },
    full: [{ t: 'st', key: 'poison', dur: 3, to: 'foe' },
           { t: 'dmg', base: 1, mult: 1, stat: 'dex', kind: 'phys' }] },
  'distract':       { name: 'Distract', tag: 'wis', cost: { mana: 4 },
    full: [{ t: 'st', key: 'interrupted', dur: 1, to: 'foe' }] },
  'whirlwind-slash':{ name: 'Whirlwind Slash', tag: 'str', cost: { stam: 2 }, ammo: 3, charge: true,
    full: [{ t: 'dmg', base: 5, mult: 1.2, stat: 'str', kind: 'phys' }] },
  'icicle-darts':   { name: 'Icicle Darts', tag: 'int', cost: { mana: 2 }, ammo: 5, charge: true,
    full: [{ t: 'dmg', base: 1, mult: 1.1, stat: 'int', kind: 'mag' }] },
  'counter-strike': { name: 'Counter Strike', tag: 'str', cost: { stam: 6 }, special: 'counter',
    desc: 'Next time you receive damage, deal 50% of it back plus 3 + 1.1 × Strength.',
    full: [] },
  'glacial-fist':   { name: 'Glacial Fist', tag: 'str', tag2: 'int', cost: { stam: 8 },
    full: [{ t: 'dmg', base: 12, mult: 1, stat: 'str', stat2: 'int', kind: 'phys' }] },
  // Chapter 4
  'be-adorable':    { name: 'Be Adorable', tag: 'wis', cost: { mana: 3 },
    full: [{ t: 'st', key: 'guilt', count: 1, to: 'foe' }] },
  'knaw':           { name: 'Knaw', tag: 'str', cost: { stam: 2 },
    full: [{ t: 'dmg', base: 4, mult: 1.3, stat: 'str', kind: 'phys' }] },
  'skittish':       { name: 'Skittish', tag: 'agi', cost: {}, concept: true,
    desc: 'Damage dealt and received is halved · chance to hit and be hit is halved.' },
  'flee':           { name: 'Attempt to Flee', tag: 'agi', cost: { stam: 30 }, special: 'flee', noLearn: true,
    desc: 'Combat ends. No victory, no drops, no XP.',
    full: [] },
  'jump-attack':    { name: 'Jump Attack', tag: 'agi', cost: { stam: 3 },
    full: [{ t: 'dmg', base: 5, mult: 1.1, stat: 'agi', kind: 'phys' }] },
  'vibrate':        { name: 'Vibrate', tag: 'end', cost: { stam: 8 },
    full: [{ t: 'st', key: 'regen', dur: 3, to: 'self' }] },
  'diseased':       { name: 'Diseased', tag: 'end', cost: {}, concept: true, negative: true, noLearn: true,
    desc: 'No natural health regen.' },
  'projectile-bile':{ name: 'Projectile Bile', tag: 'end', cost: { stam: 8 },
    full: [{ t: 'st', key: 'poison', dur: 8, to: 'foe' },
           { t: 'dmg', base: 1, mult: 1, stat: 'end', kind: 'phys' }] },
  'gnash-teeth':    { name: 'Gnash Teeth', tag: 'end', cost: { stam: 10 },
    full: [{ t: 'st', key: 'intimidated', dur: 4, to: 'foe' }] },
  'putrid-smell':   { name: 'Putrid Smell', tag: 'end', cost: { stam: 6 },
    full: [{ t: 'st', key: 'nausea', dur: 4, to: 'foe' }] },
  // Chapter 5
  'rebound':        { name: 'Rebound', tag: 'agi', cost: {}, concept: true,
    desc: 'Agility skills have no cooldown.' },
  'gunk-shot':      { name: 'Gunk Shot', tag: 'end', cost: { stam: 8 },
    full: [{ t: 'st', key: 'interrupted', dur: 2, to: 'foe' },
           { t: 'dmg', base: 1, mult: 1.7, stat: 'end', kind: 'phys' }] },
  'serpentine':     { name: 'Serpentine Maneuver', tag: 'agi', cost: { stam: 7 },
    full: [{ t: 'st', key: 'agile', dur: 3, to: 'self' }] },
  'war-cry-smol':   { name: 'War Cry (smol)', tag: 'end', cost: { stam: 10 },
    full: [{ t: 'st', key: 'intimidated', dur: 6, to: 'foe' }] },
  'headbutt':       { name: 'Headbutt', tag: 'dex', tag2: 'end', cost: { stam: 10 },
    full: [{ t: 'dmg', base: 5, mult: 1, stat: 'dex', stat2: 'end', kind: 'phys' }] },
  'fury':           { name: 'Fury', tag: 'str', cost: {}, concept: true,
    desc: 'Whenever you take damage, your Strength skills deal +1 damage this combat.' },
  'claw-swipes':    { name: 'Claw Swipes', tag: 'dex', cost: { stam: 3 }, ammo: 3, charge: true,
    full: [{ t: 'dmg', base: 5, mult: 1.3, stat: 'dex', kind: 'phys' }] },
  'rock-throw':     { name: 'Rock Throw', tag: 'str', cost: { stam: 3 },
    full: [{ t: 'dmg', base: 1, mult: 1.2, stat: 'str', kind: 'phys' }] },
  // Book boss
  'knee-in-groin':  { name: 'Knee in Groin', tag: 'str', cost: { stam: 2 },
    full: [{ t: 'st', key: 'interrupted', dur: 2, to: 'foe' },
           { t: 'dmg', base: 10, mult: 1.3, stat: 'str', kind: 'phys' }] },
  'bonk-on-head':   { name: 'Bonk on Head', tag: 'str', cost: { stam: 2 }, startCd: true,
    full: [{ t: 'st', key: 'concuss', dur: 2, to: 'foe' },
           { t: 'dmg', base: 10, mult: 1.3, stat: 'str', kind: 'phys' }] },
  'wack':           { name: 'Wack', tag: 'str', cost: { stam: 5 }, speedLink: { id: 'thwack', mult: 2 },
    desc: 'Hastens Thwack: +100% Attack Speed until it deals damage.',
    full: [{ t: 'dmg', base: 5, mult: 1.5, stat: 'str', kind: 'phys' }] },
  'thwack':         { name: 'Thwack', tag: 'str', cost: { stam: 10 }, speedLink: { id: 'crack', mult: 2 },
    desc: 'Hastens Crack!: +100% Attack Speed until it deals damage.',
    full: [{ t: 'dmg', base: 10, mult: 2, stat: 'str', kind: 'phys' }] },
  'crack':          { name: 'Crack!', tag: 'str', cost: { stam: 20 },
    full: [{ t: 'st', key: 'bruised', dur: 8, to: 'foe' },
           { t: 'dmg', base: 20, mult: 2.5, stat: 'str', kind: 'phys' }] },
  'whats-uhh':      { name: 'What\'s uhh..', tag: 'wis', cost: { mana: 20 },
    full: [{ t: 'st', key: 'confusion', count: 5, to: 'self' }] },

  // ===== legacy draftable skills (tier 1+ classes still draft at 1/10/100) =====
  'slash':        { name: 'Slash', tag: 'str', cost: { stam: 5 }, draft: true,
    full: [{ t: 'dmg', base: 6, mult: 1.4, stat: 'str', kind: 'phys' }] },
  'heavy-blow':   { name: 'Heavy Blow', tag: 'str', cost: { stam: 9 }, draft: true,
    full: [{ t: 'dmg', base: 12, mult: 2.0, stat: 'str', kind: 'phys' }] },
  'rend':         { name: 'Rend', tag: 'str', cost: { stam: 6 }, draft: true,
    full: [{ t: 'dot', base: 3, mult: 0.6, stat: 'str', secs: 4, kind: 'phys', label: 'Bleed' }] },
  'shield-wall':  { name: 'Shield Wall', tag: 'end', cost: { stam: 6 }, draft: true,
    full: [{ t: 'shield', base: 8, mult: 2.0, stat: 'end' }] },
  'pierce':       { name: 'Pierce', tag: 'dex', cost: { stam: 5 }, draft: true,
    full: [{ t: 'dmg', base: 5, mult: 1.3, stat: 'dex', kind: 'phys', pierce: true }] },
  'swift-strike': { name: 'Swift Strike', tag: 'agi', cost: { stam: 4 }, draft: true,
    full: [{ t: 'dmg', base: 4, mult: 1.2, stat: 'agi', kind: 'phys' }] },
  'fireball':     { name: 'Fireball', tag: 'int', cost: { mana: 5 }, draft: true,
    full: [{ t: 'dmg', base: 8, mult: 1.8, stat: 'int', kind: 'mag' }] },
  'mend':         { name: 'Mend', tag: 'wis', cost: { mana: 5 }, draft: true,
    full: [{ t: 'heal', base: 8, mult: 2.0, stat: 'wis' }] },
  'smite':        { name: 'Smite', tag: 'fai', cost: { reson: 4 }, draft: true,
    full: [{ t: 'dmg', base: 6, mult: 1.5, stat: 'fai', kind: 'mag' }] },
  'blessing':     { name: 'Blessing', tag: 'fai', cost: { reson: 5 }, draft: true,
    full: [{ t: 'heal', base: 5, mult: 1.2, stat: 'fai' }] },
  'sanctify':     { name: 'Sanctify', tag: 'pie', cost: { reson: 5 }, draft: true,
    full: [{ t: 'shield', base: 6, mult: 1.5, stat: 'pie' }] },
  'soul-leech':   { name: 'Soul Leech', tag: 'sol', cost: { mana: 5 }, draft: true,
    full: [{ t: 'dmg', base: 5, mult: 1.2, stat: 'sol', kind: 'mag', leech: 0.5 }] },
  'spirit-burst': { name: 'Spirit Burst', tag: 'sol', cost: { mana: 6 }, draft: true,
    full: [{ t: 'dmg', base: 9, mult: 1.6, stat: 'sol', kind: 'mag' }] },
};
const SKILL_OR_BASIC = (id) => ABILITIES[id];
const SKILLS = ABILITIES; // legacy alias

// ---- class tree ----
// unlocks: abilities granted at class level 1/10/100 (auto-equip when possible).
// Classes WITHOUT an unlocks table still trigger a 3-skill draft at 1/10/100.
const CLASSES = {
  classless: {
    name: 'Classless', tier: 0, core: [], parents: [], unlock: [],
    baseXp: 10, flatStep: 5, xpMult: 1.025, // (10 + 5·(L−1)) × 1.025^(L−1)
    unlocks: {
      1: ['basic-strike', 'follow-up-slash', 'magic-pebble', 'protection'],
      10: ['body-bash', 'leaping-strike', 'obscure-vision', 'empowerment'],
      100: ['determination'],
    },
    gains: [
      { everyN: 5, add: { str: 1, end: 1, dex: 1, agi: 1 } },
      { everyN: 6, add: { int: 1, wis: 1 } },
      { everyN: 7, add: { fai: 1, pie: 1 } },
      { everyN: 8, add: { sol: 1 } },
    ],
  },

  // ---- Tier 0.5 ----
  'squire-trainee': {
    name: 'Squire Trainee', tier: 0.5, core: ['str', 'end'],
    parents: ['classless'], unlock: [{ class: 'classless', level: 30 }],
    baseXp: 500, xpMult: 1.05,
    unlocks: { 1: ['preemptive-strike'], 10: ['remove-weights'], 100: ['disciplined'] },
    gains: [
      { everyN: 5, add: { str: 2, end: 2 } },
      { everyN: 6, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 7, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 8, add: { sol: 1 } },
    ],
  },
  'scouts-runner': {
    name: "Scout's Runner", tier: 0.5, core: ['dex', 'agi'],
    parents: ['classless'], unlock: [{ class: 'classless', level: 30 }],
    baseXp: 500, xpMult: 1.05,
    unlocks: { 1: ['quick-flurry'], 10: ['momentum-shift'], 100: ['tireless'] },
    gains: [
      { everyN: 5, add: { dex: 2, agi: 2 } },
      { everyN: 6, add: { str: 1, end: 1, dex: 1, agi: 1 } },
      { everyN: 7, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 8, add: { sol: 1 } },
    ],
  },
  'mages-apprentice': {
    name: "Mage's Apprentice", tier: 0.5, core: ['int', 'wis'],
    parents: ['classless'], unlock: [{ class: 'classless', level: 30 }],
    baseXp: 500, xpMult: 1.05,
    unlocks: { 1: ['fire-bolt'], 10: ['ward'], 100: ['repeating-focus'] },
    gains: [
      { everyN: 5, add: { int: 2, wis: 2 } },
      { everyN: 6, add: { int: 1, wis: 1, fai: 1, pie: 1 } },
      { everyN: 7, add: { str: 1, end: 1, dex: 1, agi: 1 } },
      { everyN: 8, add: { sol: 1 } },
    ],
  },
  'assistant-scribe': {
    name: 'Assistant Scribe', tier: 0.5, core: ['fai', 'pie'],
    parents: ['classless'], unlock: [{ class: 'classless', level: 30 }],
    baseXp: 500, xpMult: 1.05,
    unlocks: { 1: ['read-scripture'], 10: ['frost-scroll'], 100: ['watched-over'] },
    gains: [
      { everyN: 5, add: { fai: 2, pie: 2 } },
      { everyN: 6, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 7, add: { str: 1, end: 1, dex: 1, agi: 1 } },
      { everyN: 8, add: { sol: 1 } },
    ],
  },

  // ---- Tier 1 (draft-based unlocks) ----
  fighter: {
    name: 'Fighter', tier: 1, core: ['str', 'end'],
    parents: ['squire-trainee'], unlock: [{ class: 'squire-trainee', level: 40 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { str: 2, end: 2 } },
      { everyN: 5, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 6, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 7, add: { sol: 1, str: 1, end: 1 } },
    ],
  },
  rogue: {
    name: 'Rogue', tier: 1, core: ['dex', 'agi'],
    parents: ['scouts-runner'], unlock: [{ class: 'scouts-runner', level: 40 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { dex: 2, agi: 2 } },
      { everyN: 5, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 6, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 7, add: { sol: 1, dex: 1, agi: 1 } },
    ],
  },
  mercenary: {
    name: 'Mercenary', tier: 1, core: ['dex', 'end'],
    parents: ['squire-trainee', 'scouts-runner'],
    unlock: [{ class: 'squire-trainee', level: 25 }, { class: 'scouts-runner', level: 25 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { dex: 2, end: 2 } },
      { everyN: 5, add: { str: 1, end: 1, dex: 1, agi: 1 } },
      { everyN: 6, add: { int: 1, wis: 1, pie: 1, fai: 1 } },
      { everyN: 7, add: { sol: 1, dex: 1, end: 1 } },
    ],
  },
  monk: {
    name: 'Monk', tier: 1, core: ['pie', 'str'],
    parents: ['squire-trainee', 'assistant-scribe'],
    unlock: [{ class: 'squire-trainee', level: 25 }, { class: 'assistant-scribe', level: 25 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { pie: 2, str: 2 } },
      { everyN: 5, add: { fai: 1, pie: 1, str: 1, end: 1 } },
      { everyN: 6, add: { dex: 1, agi: 1, int: 1, wis: 1 } },
      { everyN: 7, add: { sol: 1, pie: 1, str: 1 } },
    ],
  },
  mage: {
    name: 'Mage', tier: 1, core: ['int', 'wis'],
    parents: ['mages-apprentice'], unlock: [{ class: 'mages-apprentice', level: 40 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { int: 2, wis: 2 } },
      { everyN: 5, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 6, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 7, add: { sol: 1, int: 1, wis: 1 } },
    ],
  },
  deacon: {
    name: 'Deacon', tier: 1, core: ['pie', 'fai'],
    parents: ['assistant-scribe'], unlock: [{ class: 'assistant-scribe', level: 40 }],
    baseXp: 1000, xpMult: 1.1,
    gains: [
      { everyN: 4, add: { pie: 2, fai: 2 } },
      { everyN: 5, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 6, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 7, add: { sol: 1, pie: 1, fai: 1 } },
    ],
  },

  // ---- Tier 1.5 (draft-based unlocks) ----
  duelist: {
    name: 'Duelist', tier: 1.5, core: ['str', 'dex'],
    parents: ['fighter'], unlock: [{ class: 'fighter', level: 50 }],
    baseXp: 1500, xpMult: 1.15,
    gains: [
      { everyN: 3, add: { str: 2, dex: 2 } },
      { everyN: 4, add: { dex: 1, end: 1, str: 1, agi: 1 } },
      { everyN: 5, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 6, add: { sol: 1, str: 1, dex: 1 } },
    ],
  },
  ranger: {
    name: 'Ranger', tier: 1.5, core: ['dex', 'agi'],
    parents: ['rogue'], unlock: [{ class: 'rogue', level: 50 }],
    baseXp: 1500, xpMult: 1.15,
    gains: [
      { everyN: 3, add: { dex: 2, agi: 2 } },
      { everyN: 4, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 5, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 6, add: { sol: 1, dex: 1, agi: 1 } },
    ],
  },
  knight: {
    name: 'Knight', tier: 1.5, core: ['dex', 'str', 'end'],
    parents: ['fighter', 'mercenary'],
    unlock: [{ class: 'fighter', level: 50 }, { class: 'mercenary', level: 50 }],
    baseXp: 1500, xpMult: 1.15,
    gains: [
      { everyN: 3, add: { dex: 2, end: 2, str: 2 } },
      { everyN: 4, add: { str: 1, end: 1, dex: 1, agi: 1, sol: 1 } },
      { everyN: 5, add: { int: 1, wis: 1, pie: 1, fai: 1 } },
      { everyN: 6, add: { sol: 1, dex: 1, end: 1, str: 1 } },
    ],
  },
  druid: {
    name: 'Druid', tier: 1.5, core: ['fai', 'dex', 'agi'],
    parents: ['rogue', 'deacon'],
    unlock: [{ class: 'rogue', level: 50 }, { class: 'deacon', level: 50 }],
    baseXp: 1500, xpMult: 1.15,
    gains: [
      { everyN: 3, add: { fai: 2, dex: 2, agi: 2 } },
      { everyN: 4, add: { sol: 1, pie: 1, fai: 1, dex: 1, agi: 1 } },
      { everyN: 5, add: { str: 1, end: 1, int: 1, wis: 1 } },
      { everyN: 6, add: { sol: 1, fai: 1, dex: 1, agi: 1 } },
    ],
  },
  scholar: {
    name: 'Scholar', tier: 1.5, core: ['int', 'wis'],
    parents: ['mage'], unlock: [{ class: 'mage', level: 50 }],
    baseXp: 1500, xpMult: 1.15,
    gains: [
      { everyN: 3, add: { int: 2, wis: 2 } },
      { everyN: 4, add: { fai: 1, pie: 1, int: 1, wis: 1 } },
      { everyN: 5, add: { dex: 1, agi: 1, str: 1, end: 1 } },
      { everyN: 6, add: { sol: 1, int: 1, wis: 1 } },
    ],
  },
};

// ---- Tier-1 upgrades (Upgrades tab) ----
const UPGRADES = {
  'str-hp':       { stat: 'str', cost: 100,  kind: 'hp',        amt: 10,  label: '+10 Health' },
  'str-hpreg':    { stat: 'str', cost: 1000, kind: 'hpRegen',   amt: 0.1, label: '+0.1 Health regen/s' },
  'str-dmg':      { stat: 'str', cost: 100,  kind: 'dmg', tag: 'str', amt: 1, label: '+1 Strength ability damage' },
  'end-hp':       { stat: 'end', cost: 100,  kind: 'hp',        amt: 10,  label: '+10 Health' },
  'end-hpreg':    { stat: 'end', cost: 1000, kind: 'hpRegen',   amt: 0.1, label: '+0.1 Health regen/s' },
  'end-dmg':      { stat: 'end', cost: 100,  kind: 'dmg', tag: 'end', amt: 1, label: '+1 Endurance ability damage' },
  'dex-stam':     { stat: 'dex', cost: 100,  kind: 'stam',      amt: 1,   label: '+1 Stamina' },
  'dex-stamreg':  { stat: 'dex', cost: 1000, kind: 'stamRegen', amt: 0.01, label: '+0.01 Stamina regen/s' },
  'dex-dmg':      { stat: 'dex', cost: 100,  kind: 'dmg', tag: 'dex', amt: 1, label: '+1 Dexterity ability damage' },
  'agi-stam':     { stat: 'agi', cost: 100,  kind: 'stam',      amt: 10,  label: '+10 Stamina' },
  'agi-stamreg':  { stat: 'agi', cost: 1000, kind: 'stamRegen', amt: 0.01, label: '+0.01 Stamina regen/s' },
  'agi-dmg':      { stat: 'agi', cost: 100,  kind: 'dmg', tag: 'agi', amt: 1, label: '+1 Agility ability damage' },
  'int-mana':     { stat: 'int', cost: 100,  kind: 'mana',      amt: 10,  label: '+10 Mana' },
  'int-manareg':  { stat: 'int', cost: 1000, kind: 'manaRegen', amt: 0.01, label: '+0.01 Mana regen/s' },
  'int-dmg':      { stat: 'int', cost: 100,  kind: 'dmg', tag: 'int', amt: 1, label: '+1 Intelligence ability damage' },
  'wis-mana':     { stat: 'wis', cost: 100,  kind: 'mana',      amt: 10,  label: '+10 Mana' },
  'wis-manareg':  { stat: 'wis', cost: 1000, kind: 'manaRegen', amt: 0.01, label: '+0.01 Mana regen/s' },
  'wis-dmg':      { stat: 'wis', cost: 100,  kind: 'dmg', tag: 'wis', amt: 1, label: '+1 Wisdom ability damage' },
  'fai-reson':    { stat: 'fai', cost: 100,  kind: 'reson',     amt: 10,  label: '+10 Resonance' },
  'fai-resonreg': { stat: 'fai', cost: 1000, kind: 'resonRegen', amt: 0.01, label: '+0.01 Resonance regen/s' },
  'fai-dmg':      { stat: 'fai', cost: 100,  kind: 'dmg', tag: 'fai', amt: 1, label: '+1 Faith ability damage' },
  'pie-reson':    { stat: 'pie', cost: 100,  kind: 'reson',     amt: 10,  label: '+10 Resonance' },
  'pie-resonreg': { stat: 'pie', cost: 1000, kind: 'resonRegen', amt: 0.01, label: '+0.01 Resonance regen/s' },
  'pie-dmg':      { stat: 'pie', cost: 100,  kind: 'dmg', tag: 'pie', amt: 1, label: '+1 Piety ability damage' },
};
const UPGRADE_STATS = ['str', 'end', 'dex', 'agi', 'int', 'wis', 'fai', 'pie'];

// ---- Book 1: Chapters → Pages (authored fights) ----
// Enemy stats not authored by the user are filled with 3 + 2×chapter.
// killXp per chapter is a tuning fill-in (goal: Book 1 ≈ classless prestige).
const T05_IDS = ['squire-trainee', 'scouts-runner', 'mages-apprentice', 'assistant-scribe'];
const T1_IDS = ['fighter', 'rogue', 'mercenary', 'monk', 'mage', 'deacon'];
const KILLXP_BY_CH = [50, 80, 180, 320, 600, 1200];

const BOOK1 = [
  { name: 'Training Ground', reward: { classless: 2500 }, pages: [
    { id: 'dummy1', name: 'Training Dummy', hp: 25, stats: { end: 8 }, noRegen: true, noShield: true,
      abilities: ['stare-menacingly'] },
    { id: 'dummy2', name: 'Bigger Training Dummy', hp: 100, stats: { end: 12 },
      abilities: ['intimidating-demeanor', 'being-bigger', 'buckle'] },
    { id: 'dummy3', name: 'Rotating Dummy', hp: 50, stats: { str: 10, end: 8 },
      abilities: ['left-fist', 'right-fist'] },
  ]},
  { name: 'Learning the Basics', reward: { classless: 4000, t05: 4000 }, pages: [
    { id: 'billy', name: 'Trainee Billy (8)', hp: 150, stats: { str: 15, end: 10, dex: 8 },
      abilities: ['weak-swing', 'drop-shield', 'cower'] },
    { id: 'billys-mom', name: "Billy's Mom (32)", hp: 250, stats: { str: 20, wis: 10, end: 12 },
      abilities: ['vengeful-strike', 'you-monster', 'skull-crack'] },
    { id: 'james', name: 'Retiree James (108)', hp: 185, stats: { dex: 10, agi: 10, wis: 10 },
      abilities: ['back-in-my-day', 'where-am-i', 'shuffle', 'cane-swipe'] },
  ]},
  { name: 'Adventure Guild Entrance Practical', reward: { classless: 9000, t05: 9000 }, pages: [
    { id: 'florance', name: 'Rankless Adventurer Florance', hp: 350, stats: { dex: 16, agi: 12, end: 10 },
      abilities: ['twin-strike', 'throwing-dagger', 'leg-sweep'] },
    { id: 'amanda', name: 'Rankless Adventurer Amanda', hp: 320, stats: { agi: 16, dex: 12, wis: 10 },
      abilities: ['viper-strike', 'poison-dagger', 'distract'] },
    { id: 'martin', name: 'Low Copper Rank Martin', hp: 450, stats: { str: 18, int: 16, end: 12 },
      abilities: ['whirlwind-slash', 'icicle-darts', 'counter-strike', 'glacial-fist'] },
  ]},
  { name: 'First Quest: Clean out the Sewer', reward: { classless: 16000, t05: 16000 }, pages: [
    { id: 'baby-rat', name: 'Baby Rat (Awww)', hp: 120, stats: { agi: 14, wis: 8 },
      abilities: ['skittish', 'be-adorable', 'knaw', 'flee'] },
    { id: 'feeble-slime', name: 'Feeble Slime', hp: 220, stats: { end: 14, agi: 12 },
      abilities: ['jump-attack', 'vibrate', 'cower'] }, // Deflate = Cower renamed
    { id: 'diseased-rat', name: 'Diseased Rat', hp: 400, stats: { end: 20, str: 12 },
      abilities: ['diseased', 'projectile-bile', 'gnash-teeth', 'putrid-smell'] },
  ]},
  { name: 'Explore Just Outside the Outpost Gate', reward: { classless: 30000, t05: 30000 }, pages: [
    { id: 'slime', name: 'Slime', hp: 520, stats: { agi: 22, end: 16 },
      abilities: ['jump-attack', 'rebound', 'gunk-shot', 'serpentine'] },
    { id: 'horned-rabbit', name: 'Horned Rabbit', hp: 560, stats: { dex: 20, end: 20, agi: 16 },
      abilities: ['war-cry-smol', 'headbutt', 'flee'] }, // Scurry Away = Attempt to Flee
    { id: 'angry-mole', name: 'Angry Mole (You Stepped On His Home)', hp: 680, stats: { str: 24, dex: 20, end: 16 },
      abilities: ['fury', 'claw-swipes', 'rock-throw'] },
  ]},
  { name: 'First Goblin, How Hard Could It Be?', reward: { classless: 50000, t05: 50000, t1: 50000 }, boss: true, pages: [
    { id: 'goblin', name: 'Wandering Goblin', hp: 1400, stats: { str: 30, wis: 12, end: 20, agi: 18 },
      abilities: ['knee-in-groin', 'bonk-on-head', 'wack', 'thwack', 'crack', 'whats-uhh'] },
  ]},
];

// difficulty repeats of Book 1 for late-game testing
const BOOKS = [
  { name: 'Book 1', mult: 1 },
  { name: 'Book 1 Hard', mult: 3 },
  { name: 'Book 1 Nightmare', mult: 9 },
  { name: 'Book 1 Hell', mult: 27 },
];
const PAGES_PER_BOOK = BOOK1.reduce((a, c) => a + c.pages.length, 0); // 16
const TOTAL_PAGES = PAGES_PER_BOOK * BOOKS.length;
