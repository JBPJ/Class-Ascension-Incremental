# Pathbound

A mobile-friendly browser **idle ARPG**: real-time 1v1 auto-combat where you grind
a single-path node map, level a branching **class tree**, and ascend through
prestige. Built as a zero-dependency Progressive Web App — plain HTML/CSS/JS, no
build step, no frameworks. Works offline once visited and installs to a phone.

> **Status:** Milestone 5. Authored **Books 1 & 2** (including ally fights, a
> silent... something, a reverse-combat rescue, and a Sustain-feasting boss),
> stacking conditions with snapshots (2×Bleed 5 format), **Burst / Sustain /
> Rally / Initiate** ability types, Charge & Ammo reloads, **EP** (Sacrifice /
> Enhance / Buy Back), a pinned ability dock, nested hold-tooltips with keyword
> lookups, allies with priority display, Tier-1 class ability tracks, and the
> **Bestiary** (enemies, classes, abilities, keywords).

## Run it locally

Either double-click `index.html`, or serve it properly (recommended — enables the
service worker and avoids file:// quirks):

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
# then open http://localhost:8123
```

## How it plays

- **Fill-bar combat.** Every equipped ability (8 slots) has a bar that fills on its
  own; when full it fires **free** and goes on cooldown (2s skills / 3s spells).
  Tap an ability to fire early — the cost shown shrinks as the bar fills (rounded
  up). Hold any ability — yours or the enemy's — for a tooltip with the formula.
- **Ability Speed** covers both: skills fill at **attack speed** `1+Agi/100`,
  spells at **cast speed** `1+Wis/100` (Soul no longer affects speed).
  **Ability Time** = resource cost in seconds ÷ speed. Receiving damage slows
  Ability Speed 10% for 0.25s.
- **Ammo abilities** reload at 5× cooldown once empty; **Charge abilities** have
  no cooldown while charges remain, then recharge at +50% cooldown per charge.
- **Statuses:** Guilt, Confusion, Empowerment, Blind, Protection, Nausea, Frost,
  Poison, Concuss, Bruised, Interrupted, Intimidated, Enlarged, Shrink, Agile,
  Regen, Unburdened — plus **Overcap** shields. **Concepts** are passive abilities
  that occupy a slot (some enemy ones are negative).
- Classes grant **fixed abilities** at levels 1/10/100 (Classless starts at Lv1
  with four); tier 1+ classes still draft. Enemy abilities display as **???**
  until you first see them used. **Tomes** (0.1% drop) permanently teach an enemy
  ability — they survive prestige and always fit in the bag.
- **Resources:** Health, Mana, Stamina, **Mana Shield** (starts full, no regen,
  blocks half of non-DoT hits), and **Resonance** (starts empty).

## Loot & Blacksmith

- From Node 1 on, kills drop **gold** (node × 10), **gear** (10%), and **runes** (1%).
- Gear rolls up to 5 prefixes (1st guaranteed, then 50% / 10% / 1% / 0.1%), each a
  flat stat from 1..node with ×2 (10%) / ×3 (1%) / ×4 (0.1%) multiplier chances.
- Six equipment slots: Helm, Cuirass, Leggings, Greaves, Gauntlets, Pauldron.
- **Blacksmith** (Items tab): Upgrade item level (100g, ×10 max), Reroll a stat's
  amount or type (250g, ×2 max), Extract a stat into a rune (500g, destroys the
  item), Augment a blank slot with a rune (1500g). Scrap anything for gold = its
  item level. Bag holds 100.

## Stats (10)

STR/END · DEX/AGI · INT/WIS · FAI/PIE, plus **Soul** and **Perseverance**. All start
at 1 and grow automatically as your classes level. The derived-stat formulas live in
`derive()` in `js/core.js`.

## Class tree & progression

- Start **Classless**. XP comes from kills: 100% to your **selected** class and a
  cascading **50% to every class below it** in the tree, plus stat XP split across
  the selected class's core stats (Classless has none).
- **Tier 0.5** (Squire Trainee, Scout's Runner, Mage's Apprentice, Assistant Scribe)
  unlocks at **Classless 30**. **Tier 1** (Fighter, Rogue, Mercenary, Monk, Mage,
  Deacon) unlocks from its parent class levels.
- Each class grants stats per level on its own cadence, and **+1 Perseverance at
  level 100**. Levels 101–1000 double the cadence between stat gains.
- Switch your selected class any time, in or out of combat.

## Upgrades & Prestige

- **Upgrades** (unlock at Classless 30): spend each stat's banked XP on flat boosts —
  +Health/Mana/Stamina/Resonance totals & regen, and +damage to that stat's skills.
  Each purchase costs more (+1 then ×1.1 compounding).
- **Prestige** a class at level 100: a prestige-ready class glows on the tree. You
  reset to Classless L0 (levels and skills lost), but that class then costs **÷9** XP
  to level, and **every** class levels **+50% faster per prestiged class** (up to its
  highest level reached, +1 per prestige) — so a prestiged class with three prestiges
  levels ~22.5× faster.

## Map — Books · Chapters · Pages

**Book 1** has 5 authored chapters (Training Ground → the Outpost Gate) plus a Book
Boss, 16 pages total; each fight is hand-built. Completing a chapter grants a large
one-time XP reward (re-earnable after prestige). **10 wins** unlock the next page —
auto-advance moves you on the moment you qualify (toggle in Settings or the ⏩
button). Chapters you complete before prestiging permanently reduce their pages'
win requirement by 1 per completed run (to a minimum of 0), so veteran runs start
chapters deep with the completion rewards already banked. Beyond Book 1: **Hard /
Nightmare / Hell** repeats at ×3 stats each. Gold per kill = chapter × 10; gear
and rune drop levels match the chapter.

## UI (5 tabs)

Combat · Class Tree · Upgrades · Skill Book · Settings & Combat Log. Combat keeps
running while you browse tabs — only returning to the Map pauses it.

## Tuning knobs

All balance constants live in `CFG` at the top of `js/data.js` (XP per kill, enemy
node scaling, wins-to-advance, the global `dmgScale` test knob, etc.). Skills,
classes, and the class tree are plain data tables in the same file. `js/core.js`
holds derived stats / leveling / enemy generation, `js/combat.js` the real-time
engine, `js/ui.js` the screens, `js/main.js` the master tick loop.

## Share it via a link

Upload the folder to any static host — no build step:

- **GitHub Pages**: push this folder to a repo, enable Pages on the main branch.
- **Netlify / Cloudflare Pages**: drag-and-drop the folder in their dashboard.

## Convert to a downloadable app later

Static web app, so it wraps directly:

- **Android/iOS**: [Capacitor](https://capacitorjs.com) — point `webDir` here.
- **Windows/Mac/Linux**: [Tauri](https://tauri.app) or Electron.
