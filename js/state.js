// =============================================================
// APP STATE
// =============================================================
import { Chess } from './chess.js';
import { Repertoire } from './repertoire.js';
import { Store } from './storage.js';

const App = {
  reps: [],
  activeRepIdx: -1,
  mode: 'play',         // 'play' | 'edit'
  chess: new Chess(),
  path: [],             // SAN path from root
  oppChoices: [],       // Context chain of opponent branch choices for SRS logic
  lastMove: null,       // last move object for highlight
  selectedSquare: null, // selected square in coord {r,f}
  pendingPromo: null,   // pending promotion move
  statusMsg: '',
  statusType: 'normal',
  awaitingOpp: false,
  busy: false,          // prevent input during opponent move
  dirty: false,         // unsaved edits in edit mode
  editSnapshot: null,   // JSON snapshot taken when entering edit mode
  showVariations: false,

  // State mutators for UI to use
  markDirty() { this.dirty = true; },
  clearDirty() { this.dirty = false; },
  setSnapshot(snap) { this.editSnapshot = snap; },

  // Wired by main.js after all modules are loaded
  render() {},

  init() {
    this.reps = Store.loadAll();
    const st = Store.loadState();
    this.activeRepIdx = (typeof st.activeRepIdx === 'number' && st.activeRepIdx < this.reps.length) ? st.activeRepIdx : -1;
    this.mode = st.mode || 'play';
    this.path = [];
    this.oppChoices = [];
    this.chess = new Chess();
    this.lastMove = null;
    this.render();
    // If active rep & play mode, schedule opponent move if needed
    setTimeout(() => this.maybeOppMove(), 300);
  },
  persistState() {
    Store.saveState({ activeRepIdx: this.activeRepIdx, mode: this.mode });
  },
  activeRep() {
    return this.activeRepIdx >= 0 ? this.reps[this.activeRepIdx] : null;
  },
  isUserTurn() {
    const rep = this.activeRep(); if (!rep) return true;
    return this.chess.turn() === rep.color[0];
  },
  currentFenHash() {
    return Repertoire.getPosHash(this.chess.fen());
  },
  currentPosition() {
    const rep = this.activeRep(); if (!rep) return null;
    return rep.getPosition(this.currentFenHash());
  },
  reset() {
    this.chess = new Chess();
    this.path = [];
    this.oppChoices = [];
    this.lastMove = null;
    this.selectedSquare = null;
    this.statusMsg = '';
    this.statusType = 'normal';
    this.render();
    setTimeout(() => this.maybeOppMove(), 300);
  },

  // ========== USER MAKES A MOVE ON THE BOARD ==========
  attemptMove(from, to, promo) {
    if (this.busy) return false;
    // Get matching legal moves (filter by from/to ignoring promo)
    const candidates = this.chess.legalMoves().filter(m =>
      m.from.r === from.r && m.from.f === from.f &&
      m.to.r === to.r && m.to.f === to.f
    );
    if (candidates.length === 0) return false;
    // If any candidate requires promotion and user hasn't picked, show dialog
    if (candidates.some(m => m.promo) && !promo) {
      this.pendingPromo = { from, to };
      this.render();
      return false;
    }
    // Make the move
    const realMove = this.chess.move({ from, to, promo });
    if (!realMove) return false;
    this.lastMove = realMove;
    this.selectedSquare = null;
    this.pendingPromo = null;

    // Now handle based on mode
    const rep = this.activeRep();
    if (this.mode === 'edit' && rep) {
      // Revert move to get prev FEN
      this.chess.undo();
      const prevFenHash = this.currentFenHash();
      this.chess.move(realMove);
      const nextFenHash = this.currentFenHash();

      // Always add to repertoire
      rep.addMove(prevFenHash, realMove.san, '', nextFenHash);
      this.path = [...this.path, {san: realMove.san, fenHash: nextFenHash}];
      Store.saveAll(this.reps);
      this.markDirty();
      this.statusMsg = '';
    } else if (this.mode === 'play' && rep) {
      this.chess.undo();
      const prevFenHash = this.currentFenHash();
      this.chess.move(realMove);
      const nextFenHash = this.currentFenHash();

      const pos = rep.getPosition(prevFenHash);
      const child = pos ? pos.moves.find(c => c.san === realMove.san) : null;
      if (this.isUserTurnBefore()) {
        // User just moved (now it's not user's turn).
        // Check correctness only when it was user's turn
        // Wait — we want to check if the move was in repertoire
        if (!child) {
          // Wrong move! Undo and show not-in-repertoire modal
          this.chess.undo();
          
          // Apply +10 SRS penalty to all opponent choices that led here
          this.oppChoices.forEach(choice => {
            const pos = rep.getPosition(choice.fenHash);
            if (pos) {
              const m = pos.moves.find(x => x.san === choice.san);
              if (m) {
                m.weight = (m.weight !== undefined ? m.weight : 10) + 10;
              }
            }
          });
          if (this.oppChoices.length > 0) Store.saveAll(this.reps);

          const h = this.chess.history[this.chess.history.length-1];
          this.lastMove = h ? { from: h.move.from, to: h.move.to } : null;
          this.render();
          document.dispatchEvent(new CustomEvent('app:not-in-repertoire', { detail: { san: realMove.san } }));
          return true;
        } else {
          // Correct move! Reward the opponent choices that led here with -1
          this.oppChoices.forEach(choice => {
            const pos = rep.getPosition(choice.fenHash);
            if (pos) {
              const m = pos.moves.find(x => x.san === choice.san);
              if (m) {
                m.weight = Math.max(1, (m.weight !== undefined ? m.weight : 10) - 1);
              }
            }
          });
          if (this.oppChoices.length > 0) Store.saveAll(this.reps);

          this.path = [...this.path, {san: realMove.san, fenHash: nextFenHash}];
          this.statusType = 'success';
          this.statusMsg = 'Correct!';
        }
      } else {
        // This shouldn't happen — user can't move opponent's pieces — but handle defensively
        this.path = [...this.path, {san: realMove.san, fenHash: nextFenHash}];
      }
    } else {
      // No rep, freeplay
      this.statusMsg = '';
    }
    this.render();
    // Schedule opponent move
    if (this.mode === 'play') setTimeout(() => this.maybeOppMove(), 350);
    return true;
  },

  // helper to know whose turn it was before the just-made move
  isUserTurnBefore() {
    const rep = this.activeRep(); if (!rep) return false;
    // After move turn_ has switched. So before, it was the opposite of current.
    const before = this.chess.turn() === 'w' ? 'b' : 'w';
    return before === rep.color[0];
  },

  // ========== OPPONENT MOVE (auto) ==========
  maybeOppMove() {
    if (this.mode !== 'play') return;
    const rep = this.activeRep(); if (!rep) return;
    if (this.chess.isGameOver()) {
      document.dispatchEvent(new CustomEvent('app:line-complete'));
      return;
    }
    if (this.isUserTurn()) {
      const pos = this.currentPosition();
      if (pos && pos.moves.length === 0 && this.path.length > 0) {
        document.dispatchEvent(new CustomEvent('app:line-complete'));
      }
      return;
    }
    const pos = this.currentPosition(); if (!pos || !pos.moves.length) {
      document.dispatchEvent(new CustomEvent('app:line-complete'));
      return;
    }
    this.busy = true;
    this.render();
    
    // Dynamic realistic delay
    let delay = 300 + Math.random() * 500;
    if (Math.random() < 0.15) delay += 800; // Occasional longer think
    
    setTimeout(() => {
      // Weighted random selection
      const moves = pos.moves;
      let totalWeight = 0;
      for (const m of moves) {
        totalWeight += (m.weight !== undefined ? m.weight : 10);
      }
      
      let randomVal = Math.random() * totalWeight;
      let choice = moves[0];
      for (const m of moves) {
        randomVal -= (m.weight !== undefined ? m.weight : 10);
        if (randomVal <= 0) {
          choice = m;
          break;
        }
      }
      
      // Cache the opponent choice context for SRS adjustment
      this.oppChoices.push({ fenHash: this.currentFenHash(), san: choice.san });

      const m = this.chess.move(choice.san);
      if (m) {
        this.lastMove = m;
        this.path = [...this.path, {san: choice.san, fenHash: this.currentFenHash()}];
        this.statusType = 'normal';
        this.statusMsg = '';
      }
      this.busy = false;
      this.render();
      
      if (this.chess.isGameOver()) {
        setTimeout(() => document.dispatchEvent(new CustomEvent('app:line-complete')), 500);
        return;
      }
      
      // Check if the user has no more moves stored (end of line)
      const newPos = this.currentPosition();
      if (newPos && newPos.moves.length === 0) {
        setTimeout(() => document.dispatchEvent(new CustomEvent('app:line-complete')), 500);
      }
    }, 450);
  },

  // ========== NAVIGATION ==========
  goToPath(newPath) {
    this.chess = new Chess();
    this.oppChoices = [];
    const resolvedPath = [];
    for (const step of newPath) {
      const san = typeof step === 'string' ? step : step.san;
      this.chess.move(san);
      resolvedPath.push({san, fenHash: this.currentFenHash()});
    }
    this.path = resolvedPath;
    this.lastMove = null;
    if (this.chess.history.length > 0) {
      const h = this.chess.history[this.chess.history.length-1];
      this.lastMove = { from: h.move.from, to: h.move.to };
    }
    this.selectedSquare = null;
    this.statusMsg = '';
    this.render();
  },
  goBack() {
    if (this.path.length === 0) return;
    this.goToPath(this.path.slice(0, -1));
  },
  goForward() {
    const pos = this.currentPosition();
    if (!pos || pos.moves.length === 0) return;
    // Take first variation (or only one)
    const san = pos.moves[0].san;
    this.goToPath([...this.path, {san}]);
  },

  // ========== MODE SWITCH ==========
  setMode(mode, opts) {
    // Guard: warn before leaving edit mode with unsaved changes
    if (mode === 'play' && this.dirty && !(opts && opts.force)) {
      document.dispatchEvent(new CustomEvent('app:unsaved-changes'));
      return;
    }
    // Snapshot repertoire state when entering edit mode
    if (mode === 'edit' && this.activeRep()) {
      this.editSnapshot = JSON.stringify(this.activeRep().toJSON());
    }
    if (mode === 'play') { this.dirty = false; this.editSnapshot = null; }
    this.mode = mode;
    this.statusMsg = '';
    this.persistState();
    this.render();
    if (mode === 'play') setTimeout(() => this.maybeOppMove(), 200);
  },

  // ========== REPERTOIRE MANAGEMENT ==========
  setActiveRep(idx) {
    this.activeRepIdx = idx;
    this.path = [];
    this.oppChoices = [];
    this.chess = new Chess();
    this.lastMove = null;
    this.persistState();
    this.render();
    setTimeout(() => this.maybeOppMove(), 200);
  },
  createRep(name, color) {
    const r = new Repertoire(name, color);
    this.reps.push(r);
    this.activeRepIdx = this.reps.length - 1;
    this.path = [];
    this.oppChoices = [];
    this.chess = new Chess();
    this.lastMove = null;
    Store.saveAll(this.reps);
    this.persistState();
  },
  deleteRep(idx) {
    this.reps.splice(idx, 1);
    if (this.activeRepIdx === idx) {
      this.activeRepIdx = this.reps.length ? 0 : -1;
      this.path = [];
      this.oppChoices = [];
      this.chess = new Chess();
      this.lastMove = null;
    } else if (this.activeRepIdx > idx) {
      this.activeRepIdx--;
    }
    Store.saveAll(this.reps);
    this.persistState();
  },
  renameRep(idx, name) {
    this.reps[idx].name = name;
    this.reps[idx].updatedAt = Date.now();
    Store.saveAll(this.reps);
  },

  // ========== EXPORT / IMPORT ==========
  exportRep(idx) {
    const rep = this.reps[idx]; if (!rep) return;
    const json = JSON.stringify(rep.toJSON(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (rep.name || 'repertoire').replace(/[^\w\-]+/g, '_');
    a.download = `${safeName}.repertoire.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'Exported! Save to Files/Drive to keep it safe.' } }));
  },
  exportAll() {
    const json = JSON.stringify({ version: 1, repertoires: this.reps.map(r => r.toJSON()) }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all_repertoires_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'All repertoires exported!' } }));
  },
  importFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.repertoires && Array.isArray(data.repertoires)) {
          // Multi-rep file
          let count = 0;
          for (const r of data.repertoires) {
            this.reps.push(Repertoire.fromJSON(r));
            count++;
          }
          document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: `Imported ${count} repertoire${count===1?'':'s'}` } }));
        } else if ((data.positions || data.root) && data.color) {
          this.reps.push(Repertoire.fromJSON(data));
          this.activeRepIdx = this.reps.length - 1;
          this.path = [];
          this.oppChoices = [];
          this.chess = new Chess();
          this.lastMove = null;
          document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'Imported!' } }));
        } else {
          document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'Invalid repertoire file', type: 'error' } }));
          return;
        }
        Store.saveAll(this.reps);
        this.persistState();
        this.render();
      } catch (err) {
        console.error(err);
        document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'Failed to read file: ' + err.message, type: 'error' } }));
      }
    };
    reader.onerror = () => document.dispatchEvent(new CustomEvent('app:toast', { detail: { msg: 'Could not read file', type: 'error' } }));
    reader.readAsText(file);
  }
};

export { App };
