// =============================================================
// UI — rendering, event binding, modals, helpers
// =============================================================
import { App } from './state.js';
import { PIECE_SVG } from './pieces.js';
import { Repertoire } from './repertoire.js';
import { Store } from './storage.js';

let interactionStartSq = null;

document.addEventListener('pointerdown', (e) => {
  if (App.pendingPromo || App.busy) return;
  // Ignore right clicks
  if (e.button !== undefined && e.button !== 0) return;
  const sq = e.target.closest('.square');
  if (sq && sq.closest('.board')) {
    e.preventDefault();
    interactionStartSq = { r: +sq.dataset.r, f: +sq.dataset.f };
    handleSquareClick(interactionStartSq.r, interactionStartSq.f);
  } else {
    interactionStartSq = null;
  }
});

document.addEventListener('pointerup', (e) => {
  if (App.pendingPromo || App.busy || !interactionStartSq) return;
  
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sq = el ? el.closest('.square') : null;
  if (sq && sq.closest('.board')) {
    const r = +sq.dataset.r, f = +sq.dataset.f;
    // If dropped on a different square, fire handleSquareClick to attempt the move
    if (r !== interactionStartSq.r || f !== interactionStartSq.f) {
      handleSquareClick(r, f);
    }
  }
  interactionStartSq = null;
});

// =============================================================
// RENDERING
// =============================================================
function renderApp() {
  const root = document.getElementById('app');
  if (App.reps.length === 0) {
    root.innerHTML = renderWelcome();
    bindWelcome();
    return;
  }
  root.innerHTML = `
    ${renderHeader()}
    ${renderBoardArea()}
    ${renderStatus()}
    ${renderMovesPanel()}
    ${renderNav()}
  `;
  bindAll();
}

function renderWelcome() {
  return `
    <div class="welcome">
      <div class="welcome-icon">♞</div>
      <h2>Welcome to your<br>Repertoire Trainer</h2>
      <p>Build your opening repertoire and train against it. All your data stays on your phone — fully offline.</p>
      <div class="btn-row">
        <button class="btn btn-primary" id="welcome-new">Create First Repertoire</button>
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="welcome-import">Import from File</button>
      </div>
      <input type="file" id="welcome-import-input" accept=".json,application/json" style="display:none">
    </div>
  `;
}
function bindWelcome() {
  document.getElementById('welcome-new').onclick = () => openCreateModal();
  document.getElementById('welcome-import').onclick = () => document.getElementById('welcome-import-input').click();
  document.getElementById('welcome-import-input').onchange = (e) => {
    if (e.target.files[0]) App.importFile(e.target.files[0]);
  };
}

function renderHeader() {
  const rep = App.activeRep();
  return `
    <div class="header">
      <button class="icon-btn" id="btn-menu" aria-label="Menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      ${rep ? `<span class="header-badge ${App.mode==='edit'?'edit':''}">${App.mode==='edit'?'Edit':'Play'}</span>` : ''}
      <div style="flex:1"></div>
      ${App.mode === 'edit' && rep ? `
        <div style="display:flex;gap:6px;align-items:center">
          <button class="cancel-btn${App.dirty?' dirty':''}" id="btn-cancel">Cancel</button>
          <button class="save-btn${App.dirty?' dirty':''}" id="btn-save">${App.dirty ? 'Save' : '\u2713\u00a0Saved'}</button>
        </div>
      ` : `
        <button class="icon-btn" id="btn-flip" aria-label="Reset">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
          </svg>
        </button>
      `}
    </div>
  `;
}

function renderBoardArea() {
  const rep = App.activeRep();
  const flip = rep && rep.color === 'black';
  const lastMove = App.lastMove;
  const sel = App.selectedSquare;
  const legalFromSel = sel ? App.chess.legalMoves().filter(m => m.from.r === sel.r && m.from.f === sel.f) : [];
  const inCheck = App.chess.inCheck();
  const checkSq = inCheck ? App.chess.kingPos(App.chess.turn()) : null;

  let squares = '';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const isLight = (r + f) % 2 === 0;
      const piece = App.chess.board[r][f];
      const classes = ['square', isLight ? 'light' : 'dark'];
      if (sel && sel.r === r && sel.f === f) classes.push('selected');
      if (lastMove) {
        if (lastMove.from.r === r && lastMove.from.f === f) classes.push('last-move-from');
        if (lastMove.to.r === r && lastMove.to.f === f) classes.push('last-move-to');
      }
      if (checkSq && checkSq.r === r && checkSq.f === f) classes.push('check');
      const isLegal = legalFromSel.some(m => m.to.r === r && m.to.f === f);
      let legalMark = '';
      if (isLegal) {
        legalMark = piece ? '<div class="legal-ring"></div>' : '<div class="legal-dot"></div>';
      }
      let coordHtml = '';
      const bottomRank = flip ? 0 : 7;
      const leftFile = flip ? 7 : 0;
      if (r === bottomRank) coordHtml += `<span class="coord file">${String.fromCharCode(97 + f)}</span>`;
      if (f === leftFile) coordHtml += `<span class="coord rank">${8 - r}</span>`;
      const pieceHtml = piece ? `<div class="piece">${PIECE_SVG[piece.color + piece.type]}</div>` : '';
      squares += `<div class="${classes.join(' ')}" data-r="${r}" data-f="${f}">${legalMark}${pieceHtml}${coordHtml}</div>`;
    }
  }

  // Promotion overlay
  let promoHtml = '';
  if (App.pendingPromo) {
    const turn = App.chess.turn();
    promoHtml = `
      <div class="promo-overlay" id="promo-overlay">
        <div class="promo-options">
          ${['q','r','b','n'].map(p => `
            <div class="promo-option" data-promo="${p}">
              <div style="width:48px;height:48px">${PIECE_SVG[turn + p]}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  return `
    <div class="board-wrap">
      <div class="board-container">
        <div class="board ${flip ? 'flipped' : ''}" id="board">${squares}</div>
        ${promoHtml}
      </div>
    </div>
  `;
}

function renderStatus() {
  if (App.mode === 'edit') return '';
  let msg = App.statusMsg;
  let type = App.statusType;

  if (!msg) {
    if (App.busy) { msg = 'Opponent is thinking…'; }
    else if (App.chess.isCheckmate()) { msg = 'Checkmate'; type = App.isUserTurn() ? 'error' : 'success'; }
    else if (App.chess.isStalemate()) { msg = 'Stalemate — draw'; type = 'normal'; }
    else if (App.mode === 'play') {
      if (App.isUserTurn()) {
        msg = 'Your move';
      } else {
        msg = `${App.chess.turn() === 'w' ? "White's" : "Black's"} move`;
      }
    }
  }

  return `<div class="status-bar ${type !== 'normal' ? type : ''}">${escapeHtml(msg)}</div>`;
}

function renderMovesPanel() {
  const rep = App.activeRep();
  if (!rep) return '';
  const pos = App.currentPosition();
  let currentMove = null;
  if (App.path.length > 0) {
    const last = App.path[App.path.length - 1];
    const prevFenHash = App.path.length > 1 ? App.path[App.path.length - 2].fenHash : Repertoire.getPosHash("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    const prevPos = rep.getPosition(prevFenHash);
    if (prevPos) currentMove = prevPos.moves.find(m => m.san === last.san);
  }
  const commentText = currentMove ? currentMove.comment : '';
  const comment = commentText ? `<div class="comment-display">${escapeHtml(commentText)}</div>` : '';

  // Build move list from path — only shown in edit mode
  let moveList = '';
  if (App.mode === 'edit') {
    if (App.path.length === 0) {
      moveList = `<div class="moves-empty">Make a move on the board to start building your repertoire.</div>`;
    } else {
      let rows = [];
      const START_FEN_HASH = Repertoire.getPosHash("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      for (let i = 0; i < App.path.length; i += 2) {
        const num = Math.floor(i / 2) + 1;
        const w = App.path[i];
        const b = App.path[i + 1];
        const wFenHash = i === 0 ? START_FEN_HASH : App.path[i - 1].fenHash;
        const wAlts = countSiblingAlternatives(rep, wFenHash);
        const bAlts = b ? countSiblingAlternatives(rep, w.fenHash) : 0;
        const wIsCurrent = (i + 1 === App.path.length);
        const bIsCurrent = (i + 2 === App.path.length);
        rows.push(`<div class="move-num">${num}.</div>`);
        rows.push(`<div class="move-cell ${wIsCurrent?'current':''}" data-go-idx="${i+1}">${escapeHtml(w.san)}${wAlts>0?` <span class="alt-count">+${wAlts}</span>`:''}</div>`);
        rows.push(`<div class="move-cell ${bIsCurrent?'current':''} ${!b?'empty':''}" ${b?`data-go-idx="${i+2}"`:''}>${b?escapeHtml(b.san):'…'}${bAlts>0?` <span class="alt-count">+${bAlts}</span>`:''}</div>`);
      }
      moveList = `<div class="moves-list">${rows.join('')}</div>`;
    }
  }

  // Variations list — only shown in edit mode
  let variations = '';
  if (App.mode === 'edit') {
    if (pos && pos.moves && pos.moves.length > 0) {
      const turn = App.chess.turn();
      const isUserTurn = turn === rep.color[0];
      const heading = isUserTurn
        ? (pos.moves.length > 1 ? `Your options here (${pos.moves.length})` : 'Continue with')
        : `Opponent replies in your book (${pos.moves.length})`;
      variations = `
        <div style="padding:10px 14px 4px;font-size:12px;color:#8a8784;font-weight:600;text-transform:uppercase;letter-spacing:.5px">${heading}</div>
        <div style="padding:0 10px 12px">
          <div class="variations-list">
            ${pos.moves.map(c => `
              <div class="variation-item" data-play-san="${escapeHtml(c.san)}">
                <span class="var-move">${escapeHtml(c.san)}</span>
                <span class="var-desc">${escapeHtml(c.comment || '')}</span>
                ${rep.getPosition(c.nextFenHash)?.moves?.length>0 ? `<span class="var-children">${countDAGMoves(rep, c.nextFenHash)} mv</span>` : ''}
                <button class="icon-btn" data-del-san="${escapeHtml(c.san)}" style="width:28px;height:28px" aria-label="Delete variation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg></button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    } else {
      variations = `<div style="padding:14px;text-align:center;color:#8a8784;font-size:13px">Make a move on the board to add it here.</div>`;
    }
  }

  // Edit-mode add comment button
  let commentBtn = '';
  if (App.mode === 'edit' && App.path.length > 0) {
    commentBtn = `
      <div style="padding:0 14px 10px">
        <button class="btn btn-secondary" id="btn-comment" style="font-size:13px;padding:8px">
          ${currentMove && currentMove.comment ? 'Edit comment' : 'Add comment to this move'}
        </button>
      </div>
    `;
  }

  return `
    <div class="moves-panel">
      ${moveList}
      ${comment}
      ${variations}
      ${commentBtn}
      <div style="height:8px"></div>
    </div>
  `;
}

function countSiblingAlternatives(rep, fenHash) {
  const pos = rep.getPosition(fenHash);
  if (!pos || !pos.moves) return 0;
  return Math.max(0, pos.moves.length - 1);
}
function countDAGMoves(rep, fenHash, visited = new Set()) {
  if (visited.has(fenHash)) return 0;
  visited.add(fenHash);
  const pos = rep.getPosition(fenHash);
  if (!pos || !pos.moves) return 0;
  return pos.moves.reduce((s, m) => s + 1 + countDAGMoves(rep, m.nextFenHash, visited), 0);
}

function renderNav() {
  const hasBack = App.path.length > 0;
  const pos = App.currentPosition();
  const hasFwd = pos && pos.moves && pos.moves.length > 0;
  return `
    <div class="nav-bar">
      <button class="nav-btn" id="nav-back" ${!hasBack?'disabled style="opacity:.4"':''} aria-label="Back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <button class="nav-btn ${App.mode==='play'?'active':''}" id="nav-play" aria-label="Play mode">
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        Play
      </button>
      <button class="nav-btn ${App.mode==='edit'?'active':''}" id="nav-edit" aria-label="Edit mode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        Edit
      </button>
      <button class="nav-btn" id="nav-forward" ${!hasFwd?'disabled style="opacity:.4"':''} aria-label="Forward">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        Forward
      </button>
    </div>
  `;
}

// =============================================================
// EVENT BINDING
// =============================================================
function bindAll() {
  // Header buttons
  const menuBtn = document.getElementById('btn-menu');
  if (menuBtn) menuBtn.onclick = openMenuModal;
  const flipBtn = document.getElementById('btn-flip');
  if (flipBtn) flipBtn.onclick = () => openResetModal();
  const saveBtn = document.getElementById('btn-save');
  if (saveBtn) saveBtn.onclick = () => {
    Store.saveAll(App.reps);
    App.clearDirty();
    App.setSnapshot(JSON.stringify(App.activeRep().toJSON()));
    App.render();
    toast('Changes saved');
  };
  const cancelBtn = document.getElementById('btn-cancel');
  if (cancelBtn) cancelBtn.onclick = () => {
    if (!App.dirty) { App.setMode('play', { force: true }); return; }
    openUnsavedChangesModal();
  };

  // Promotion
  if (App.pendingPromo) {
    document.querySelectorAll('.promo-option').forEach(el => {
      el.onclick = () => {
        const promo = el.dataset.promo;
        const { from, to } = App.pendingPromo;
        App.pendingPromo = null;
        App.attemptMove(from, to, promo);
      };
    });
    document.getElementById('promo-overlay').onclick = (e) => {
      if (e.target.id === 'promo-overlay') {
        App.pendingPromo = null;
        App.render();
      }
    };
  }

  // Moves list — click to jump
  document.querySelectorAll('[data-go-idx]').forEach(el => {
    el.onclick = () => {
      const idx = +el.dataset.goIdx;
      App.goToPath(App.path.slice(0, idx));
    };
  });

  // Variations — click to play that move
  document.querySelectorAll('[data-play-san]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('[data-del-san]')) return;
      const san = el.dataset.playSan;
      const m = App.chess.move(san);
      if (m) {
        App.lastMove = m;
        App.path = [...App.path, {san, fenHash: App.currentFenHash()}];
        App.statusMsg = ''; App.statusType = 'normal';
        App.render();
        if (App.mode === 'play') setTimeout(() => App.maybeOppMove(), 350);
      }
    };
  });

  // Delete variation
  document.querySelectorAll('[data-del-san]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const san = el.dataset.delSan;
      openDeleteVariationModal(san, () => {
        App.activeRep().deleteMove(App.currentFenHash(), san);
        Store.saveAll(App.reps);
        App.markDirty();
        App.render();
      });
    };
  });

  // Comment
  const commentBtn = document.getElementById('btn-comment');
  if (commentBtn) commentBtn.onclick = () => openCommentModal();

  // Nav
  document.getElementById('nav-back').onclick = () => App.goBack();
  document.getElementById('nav-forward').onclick = () => App.goForward();
  document.getElementById('nav-play').onclick = () => App.setMode('play');
  document.getElementById('nav-edit').onclick = () => App.setMode('edit');
}

function handleSquareClick(r, f) {
  const piece = App.chess.at(r, f);
  if (App.selectedSquare) {
    // Try to move
    if (App.selectedSquare.r === r && App.selectedSquare.f === f) {
      App.selectedSquare = null;
      App.render();
      return;
    }
    const legalMoves = App.chess.legalMoves().filter(m =>
      m.from.r === App.selectedSquare.r && m.from.f === App.selectedSquare.f &&
      m.to.r === r && m.to.f === f
    );
    if (legalMoves.length > 0) {
      App.attemptMove(App.selectedSquare, { r, f });
      return;
    }
    // Clicked another own-color piece? select it
    if (piece && piece.color === App.chess.turn() && (App.mode === 'edit' || piece.color === App.activeRep().color[0])) {
      App.selectedSquare = { r, f };
      App.render();
      return;
    }
    App.selectedSquare = null;
    App.render();
    return;
  }
  // No selection — only pick up own piece on user's turn
  if (!piece) return;
  if (piece.color !== App.chess.turn()) return;
  // In play mode, only allow user to pick own-color pieces
  if (App.mode === 'play') {
    const rep = App.activeRep();
    if (rep && piece.color !== rep.color[0]) return;
  }
  App.selectedSquare = { r, f };
  App.render();
}

// =============================================================
// MODALS
// =============================================================
function openMenuModal() {
  const currentTheme = document.documentElement.className;
  showModal({
    title: 'Repertoires',
    body: `
      <div style="margin-bottom:14px">
        ${App.reps.map((r, i) => `
          <div class="rep-card ${i===App.activeRepIdx?'active':''}" data-rep="${i}">
            <div class="rep-color ${r.color}"></div>
            <div class="rep-info">
              <div class="rep-name">${escapeHtml(r.name)}</div>
              <div class="rep-meta">${r.countMoves()} moves · ${r.color}</div>
            </div>
            <div class="rep-actions">
              <button class="icon-btn" data-rep-rename="${i}" aria-label="Rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
              <button class="icon-btn" data-rep-export="${i}" aria-label="Export"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
              <button class="icon-btn" data-rep-delete="${i}" aria-label="Delete" style="color:#fa412d"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
            </div>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="m-new">+ New Repertoire</button>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-secondary" id="m-import">Import File</button>
        <button class="btn btn-secondary" id="m-export-all">Export All</button>
      </div>
      <input type="file" id="m-import-input" accept=".json,application/json" style="display:none">
      <div style="margin-top:16px;border-top:1px solid #1a1816;padding-top:14px">
        <div class="hint" style="margin-bottom:8px">Theme</div>
        <div class="theme-picker">
          <button class="theme-opt${currentTheme===''?' active':''}" data-theme="" title="Blue"><span class="theme-swatch" style="background:#2060c8"></span>Blue</button>
          <button class="theme-opt${currentTheme==='theme-pink'?' active':''}" data-theme="theme-pink" title="Pink"><span class="theme-swatch" style="background:#c75c8e"></span>Pink</button>
          <button class="theme-opt${currentTheme==='theme-green'?' active':''}" data-theme="theme-green" title="Green"><span class="theme-swatch" style="background:#81b64c"></span>Green</button>
          <button class="theme-opt${currentTheme==='theme-amber'?' active':''}" data-theme="theme-amber" title="Amber"><span class="theme-swatch" style="background:#d4943a"></span>Amber</button>
        </div>
      </div>
      <div class="hint" style="margin-top:14px;text-align:center">Exported files save to your phone's Downloads. Keep them safe — re-import anytime.</div>
    `
  });
  // Bindings
  document.querySelectorAll('[data-rep]').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return;
      App.setActiveRep(+el.dataset.rep);
      closeModal();
    };
  });
  document.querySelectorAll('[data-rep-rename]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const i = +el.dataset.repRename;
      const newName = prompt('Rename repertoire:', App.reps[i].name);
      if (newName && newName.trim()) {
        App.renameRep(i, newName.trim());
        closeModal();
        openMenuModal();
      }
    };
  });
  document.querySelectorAll('[data-rep-export]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      App.exportRep(+el.dataset.repExport);
    };
  });
  document.querySelectorAll('[data-rep-delete]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      const i = +el.dataset.repDelete;
      openDeleteRepModal(i);
    };
  });
  document.getElementById('m-new').onclick = () => { closeModal(); openCreateModal(); };
  document.getElementById('m-import').onclick = () => document.getElementById('m-import-input').click();
  document.getElementById('m-import-input').onchange = (e) => {
    if (e.target.files[0]) { App.importFile(e.target.files[0]); closeModal(); }
  };
  document.getElementById('m-export-all').onclick = () => App.exportAll();
  document.querySelectorAll('.theme-opt').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      setTheme(el.dataset.theme);
      closeModal();
      openMenuModal();
    };
  });
}

let selectedColor = 'white';
function openCreateModal() {
  selectedColor = 'white';
  showModal({
    title: 'New Repertoire',
    body: `
      <label>Name</label>
      <input type="text" id="new-name" placeholder="e.g. My White Italian" autofocus>
      <label>You play as</label>
      <div class="color-choice">
        <div class="color-opt selected" data-color="white">
          <div class="color-disc white"></div>White
        </div>
        <div class="color-opt" data-color="black">
          <div class="color-disc black"></div>Black
        </div>
      </div>
      <div class="hint">Pick the side you want to train. Edit mode lets you add moves; Play mode tests your memory.</div>
      <div style="height:14px"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="new-cancel">Cancel</button>
        <button class="btn btn-primary" id="new-create">Create</button>
      </div>
    `
  });
  document.querySelectorAll('.color-opt').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.color-opt').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selectedColor = el.dataset.color;
    };
  });
  document.getElementById('new-cancel').onclick = closeModal;
  document.getElementById('new-create').onclick = () => {
    const name = document.getElementById('new-name').value.trim() || 'My Repertoire';
    App.createRep(name, selectedColor);
    closeModal();
    App.render();
  };
}

function openUnsavedChangesModal() {
  showModal({
    title: 'Save Changes First',
    body: `
      <p class="modal-body" style="margin:0 0 18px;color:#b1b1b1;font-size:14px;line-height:1.5">You have unsaved changes in your repertoire. What would you like to do?</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary" id="usc-save">Save &amp; Continue to Play</button>
        <button class="btn btn-danger" id="usc-discard">Discard Changes</button>
        <button class="btn btn-secondary" id="usc-stay">Keep Editing</button>
      </div>
    `
  });
  document.getElementById('usc-save').onclick = () => {
    Store.saveAll(App.reps);
    App.clearDirty();
    App.setSnapshot(null);
    closeModal();
    App.setMode('play', { force: true });
  };
  document.getElementById('usc-discard').onclick = () => {
    if (App.editSnapshot && App.activeRep()) {
      try {
        App.reps[App.activeRepIdx] = Repertoire.fromJSON(JSON.parse(App.editSnapshot));
        Store.saveAll(App.reps);
      } catch(e) {}
    }
    App.clearDirty();
    App.setSnapshot(null);
    closeModal();
    App.setMode('play', { force: true });
  };
  document.getElementById('usc-stay').onclick = () => closeModal();
}

function openResetModal() {
  showModal({
    title: 'Reset Board',
    body: `
      <p>The board will return to the starting position. Your saved repertoire won't be affected.</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-secondary" id="reset-cancel">Cancel</button>
        <button class="btn btn-danger" id="reset-confirm">Reset</button>
      </div>
    `
  });
  document.getElementById('reset-cancel').onclick = closeModal;
  document.getElementById('reset-confirm').onclick = () => { closeModal(); App.reset(); };
}

function openDeleteVariationModal(san, onConfirm) {
  showModal({
    title: 'Delete Variation',
    body: `
      <p>Delete this variation and all sub-lines branching from it?</p>
      <div class="confirm-chip">${escapeHtml(san)}</div>
      <p style="color:#8a8784;font-size:13px;margin:0 0 16px">This cannot be undone.</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-secondary" id="dv-cancel">Cancel</button>
        <button class="btn btn-danger" id="dv-confirm">Delete Variation</button>
      </div>
    `
  });
  document.getElementById('dv-cancel').onclick = closeModal;
  document.getElementById('dv-confirm').onclick = () => { closeModal(); onConfirm(); };
}

function openDeleteRepModal(repIndex) {
  const repName = App.reps[repIndex].name;
  closeModal();
  showModal({
    title: 'Delete Repertoire',
    body: `
      <p>Permanently delete this repertoire?</p>
      <div class="confirm-chip">${escapeHtml(repName)}</div>
      <p style="color:#8a8784;font-size:13px;margin:0 0 16px">This cannot be undone. Export it first if you want to keep a backup.</p>
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-secondary" id="dr-cancel">Cancel</button>
        <button class="btn btn-danger" id="dr-confirm">Delete</button>
      </div>
    `
  });
  document.getElementById('dr-cancel').onclick = () => { closeModal(); openMenuModal(); };
  document.getElementById('dr-confirm').onclick = () => {
    App.deleteRep(repIndex);
    closeModal();
    App.render();
    if (App.reps.length > 0) openMenuModal();
  };
}

function openCommentModal() {
  const rep = App.activeRep();
  if (!rep || App.path.length === 0) return;
  const last = App.path[App.path.length - 1];
  const prevFenHash = App.path.length > 1 ? App.path[App.path.length - 2].fenHash : Repertoire.getPosHash("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const prevPos = rep.getPosition(prevFenHash);
  if (!prevPos) return;
  const currentMove = prevPos.moves.find(m => m.san === last.san);
  if (!currentMove) return;

  const curComment = currentMove.comment || '';
  showModal({
    title: 'Comment for ' + last.san,
    body: `
      <label>Notes / annotation</label>
      <textarea id="comment-text" placeholder="e.g. 'Main line', 'Avoid pawn structure trap'…">${escapeHtml(curComment)}</textarea>
      <div style="height:14px"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="cmt-cancel">Cancel</button>
        <button class="btn btn-primary" id="cmt-save">Save</button>
      </div>
    `
  });
  setTimeout(() => document.getElementById('comment-text').focus(), 100);
  document.getElementById('cmt-cancel').onclick = closeModal;
  document.getElementById('cmt-save').onclick = () => {
    const text = document.getElementById('comment-text').value;
    currentMove.comment = text;
    App.activeRep().updatedAt = Date.now();
    Store.saveAll(App.reps);
    App.markDirty();
    closeModal();
    App.render();
  };
}

// =============================================================
// RESULT MODALS
// =============================================================
function showRepertoireCompleteModal() {
  closeModal();
  const moveCount = App.path.length;
  const div = document.createElement('div');
  div.className = 'result-overlay';
  div.id = 'modal';
  div.innerHTML = `
    <div class="result-card" onclick="event.stopPropagation()">
      <div class="result-icon complete">♛</div>
      <h2>Line Complete!</h2>
      <p class="result-sub">You reached the end of this repertoire line.</p>
      <div class="result-stat">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${moveCount} move${moveCount !== 1 ? 's' : ''}
      </div>
      <div class="result-btns">
        <button class="btn btn-primary" id="rc-again">Play Again</button>
        <button class="btn btn-secondary" id="rc-edit">Edit Line</button>
      </div>
    </div>
  `;
  div.onclick = () => closeModal();
  document.body.appendChild(div);
  document.getElementById('rc-again').onclick = () => { closeModal(); App.reset(); };
  document.getElementById('rc-edit').onclick = () => { closeModal(); App.setMode('edit'); };
}

function showNotInRepertoireModal(san) {
  closeModal();
  const div = document.createElement('div');
  div.className = 'result-overlay';
  div.id = 'modal';
  div.innerHTML = `
    <div class="result-card" onclick="event.stopPropagation()">
      <div class="result-icon wrong">✕</div>
      <h2>Not in Repertoire</h2>
      <p class="result-sub">That move isn't in your repertoire.</p>
      <p class="result-sub" style="margin-bottom:22px">Switch to Edit mode to add it and continue building this line.</p>
      <div class="result-btns">
        <button class="btn btn-primary" id="nr-retry">Try Again</button>
        <button class="btn btn-secondary" id="nr-edit">Go to Edit Mode</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  document.getElementById('nr-edit').onclick = () => { closeModal(); App.setMode('edit'); };
  document.getElementById('nr-retry').onclick = () => { closeModal(); App.reset(); };
}

function showModal({ title, body }) {
  const div = document.createElement('div');
  div.className = 'modal-overlay';
  div.id = 'modal';
  div.innerHTML = `
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="icon-btn" id="modal-close-btn" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">${body}</div>
    </div>
  `;
  div.onclick = () => closeModal();
  document.body.appendChild(div);
  document.getElementById('modal-close-btn').onclick = (e) => { e.stopPropagation(); closeModal(); };
}

function closeModal() {
  const m = document.getElementById('modal');
  if (m) m.remove();
}

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function setTheme(cls) {
  document.documentElement.className = cls;
  localStorage.setItem('theme_v1', cls);
}

// =============================================================
// CUSTOMEVENT LISTENERS (bridge from state.js → ui.js)
// =============================================================
document.addEventListener('app:not-in-repertoire', (e) => showNotInRepertoireModal(e.detail.san));
document.addEventListener('app:line-complete', () => showRepertoireCompleteModal());
document.addEventListener('app:unsaved-changes', () => openUnsavedChangesModal());
document.addEventListener('app:toast', (e) => toast(e.detail.msg, e.detail.type));

export { renderApp, openMenuModal, openCreateModal, closeModal, toast, escapeHtml, setTheme };
