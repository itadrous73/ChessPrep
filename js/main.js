// =============================================================
// MAIN — composition root, wires all modules together
// =============================================================
import { App } from './state.js';
import { renderApp, closeModal, setTheme } from './ui.js';

// Wire the render function into state
App.render = renderApp;

// Restore saved theme before first render
(function () {
  const t = localStorage.getItem('theme_v1');
  if (t) document.documentElement.className = t;
})();

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {/* offline-first — ignore registration errors */});
  });
}

// Prevent zoom on double-tap (mobile UX)
let lastTouch = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouch < 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });

// Fix iOS PWA viewport height — window.innerHeight is the only reliable value
function syncAppHeight() {
  document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
}
syncAppHeight();
window.addEventListener('resize', syncAppHeight);

// Boot
App.init();
