// ===== Pathbound (Idle rework) — boot + master tick loop =====
'use strict';

load();
UI.render();

// real-time master loop: drives combat and refreshes the live view
let _lastT = performance.now();
setInterval(function () {
  const now = performance.now();
  let dt = (now - _lastT) / 1000;
  _lastT = now;
  if (dt > 0.5) dt = 0.5; // clamp after backgrounding

  if (G.session && C) {
    if (!C.over) combatTick(dt);
    else maybeRestart(dt);
  }
  UI.refresh();
}, CFG.tickMs);

// PWA service worker (only works over http(s); skipped silently on file://)
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  navigator.serviceWorker.register('sw.js').catch(function () {});
}
