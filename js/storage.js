// =============================================================
// STORAGE — localStorage-backed persistence
// =============================================================
import { Repertoire } from './repertoire.js';

const STORAGE_KEY = 'repertoires_v1';
const STATE_KEY = 'app_state_v1';

const Store = {
  loadAll() {
    try {
      const j = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return j.map(Repertoire.fromJSON);
    } catch (e) { return []; }
  },
  saveAll(reps) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reps.map(r => r.toJSON())));
  },
  loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
  },
  saveState(s) {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  }
};

export { Store };
