// =============================================================
// CHESS ENGINE — pure JS, zero dependencies
// =============================================================

/** Movement delta vectors for each piece type [rankDelta, fileDelta]. */
const PIECE_DIRS = {
  n: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]],
  k: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],
  b: [[-1,-1],[-1,1],[1,-1],[1,1]],
  r: [[-1,0],[1,0],[0,-1],[0,1]],
  q: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
};

/** FEN string for the standard chess starting position. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Compact chess engine supporting legal move generation, make/unmake,
 * SAN parsing and generation, castling, en passant, and promotion.
 *
 * Piece objects stored on the board take the form:
 *   `{ type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' }`
 *
 * Square coordinates use `{ r: 0–7, f: 0–7 }` where r=0 is rank 8
 * (Black's back rank) and f=0 is the a-file.
 */
class Chess {
  #history = [];
  #positionCounts = {};
  constructor(fen) {
    this.load(fen || START_FEN);
  }
  get history() { return this.#history; }

  // ===========================================================
  // PUBLIC API
  // ===========================================================

  /**
   * Reinitialise the engine from a FEN string.
   * @param {string} fen
   */
  load(fen) {
    this.#history = [];
    this.#positionCounts = {};
    const parts = fen.split(' ');
    this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const ranks = parts[0].split('/');
    for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
      let fileIndex = 0;
      for (const char of ranks[rankIndex]) {
        if (/\d/.test(char)) {
          fileIndex += +char;
        } else {
          this.board[rankIndex][fileIndex] = {
            type:  char.toLowerCase(),
            color: char === char.toUpperCase() ? 'w' : 'b'
          };
          fileIndex++;
        }
      }
    }
    this.turn_    = parts[1];
    this.castling = parts[2];
    this.ep       = parts[3] === '-' ? null : this.#algebraicToCoord(parts[3]);
    this.half     = +(parts[4] || 0);
    this.full     = +(parts[5] || 1);
    this.#positionCounts[this.#getPosHash()] = 1;
  }

  /** Gets a position hash ignoring move clocks for 3-fold repetition check */
  #getPosHash() {
    return this.fen().split(' ').slice(0, 4).join(' ');
  }

  /**
   * Return the current position as a FEN string.
   * @returns {string}
   */
  fen() {
    let fenStr = '';
    for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
      let emptyCount = 0;
      for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
        const piece = this.board[rankIndex][fileIndex];
        if (piece) {
          if (emptyCount) {
            fenStr += emptyCount;
            emptyCount = 0;
          }
          fenStr += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
        } else {
          emptyCount++;
        }
      }
      if (emptyCount) fenStr += emptyCount;
      if (rankIndex < 7) fenStr += '/';
    }
    const epStr = this.ep ? this.#coordToAlgebraic(this.ep) : '-';
    return `${fenStr} ${this.turn_} ${this.castling || '-'} ${epStr} ${this.half} ${this.full}`;
  }

  /**
   * Return the side to move: `'w'` or `'b'`.
   * @returns {string}
   */
  turn() {
    return this.turn_;
  }

  /**
   * Return the piece at a board coordinate, or `null` if the square is empty
   * or out of bounds.
   * @param {number} row  0–7 (0 = rank 8)
   * @param {number} col  0–7 (0 = file a)
   * @returns {{ type: string, color: string } | null}
   */
  at(row, col) {
    return this.#inBounds(row, col) ? this.board[row][col] : null;
  }

  /**
   * Find the king of the given color and return its coordinate, or `null`
   * if the king is not on the board.
   * @param {string} color  `'w'` or `'b'`
   * @returns {{ r: number, f: number } | null}
   */
  kingPos(color) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = this.board[row][col];
        if (piece && piece.type === 'k' && piece.color === color) {
          return { r: row, f: col };
        }
      }
    }
    return null;
  }

  /**
   * Return `true` if the given color's king is currently in check.
   * Defaults to the side to move when no color is supplied.
   * @param {string} [color]
   * @returns {boolean}
   */
  inCheck(color) {
    color = color || this.turn_;
    const king = this.kingPos(color);
    if (!king) return false;
    return this.#isAttackedBy(king.r, king.f, color === 'w' ? 'b' : 'w');
  }

  /**
   * Generate all legal moves for the given color (default: side to move).
   *
   * Each move object has the shape:
   * ```
   * { from: {r,f}, to: {r,f}, piece: string, cap?: boolean,
   *   promo?: string, dbl?: boolean, ep?: boolean, castle?: string }
   * ```
   * @param {string} [color]
   * @returns {Array<Object>}
   */
  legalMoves(color) {
    color = color || this.turn_;
    const candidates = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = this.board[row][col];
        if (piece && piece.color === color) {
          candidates.push(...this.#pseudoMovesFor(row, col));
        }
      }
    }
    const legal = [];
    for (const move of candidates) {
      const undo = this.#applyMove(move);
      if (!this.inCheck(color)) legal.push(move);
      this.#revertMove(undo);
    }
    return legal;
  }

  /**
   * Play a move and record it in the history. Accepts either:
   * - A SAN string (e.g. `'e4'`, `'Nf3'`, `'O-O'`, `'exd8=Q'`)
   * - A coordinate object `{ from, to, promo? }` where `from`/`to` may be
   *   algebraic strings (`'e2'`) or `{ r, f }` coordinate objects.
   *
   * Returns a result object `{ from, to, piece, promo, san, cap, castle }`,
   * or `null` if the move is illegal.
   * @param {string|Object} input
   * @returns {Object|null}
   */
  move(input) {
    let matched;
    const legal = this.legalMoves();
    if (typeof input === 'string') {
      matched = this.parseSAN(input);
    } else if (input && input.from && input.to) {
      const fromCoord = typeof input.from === 'string' ? this.#algebraicToCoord(input.from) : input.from;
      const toCoord   = typeof input.to   === 'string' ? this.#algebraicToCoord(input.to)   : input.to;
      matched = legal.find(candidate =>
        candidate.from.r === fromCoord.r &&
        candidate.from.f === fromCoord.f &&
        candidate.to.r   === toCoord.r   &&
        candidate.to.f   === toCoord.f   &&
        (!input.promo || candidate.promo === input.promo)
      );
    }
    if (!matched) return null;
    const san  = this.toSAN(matched, legal);
    const undo = this.#applyMove(matched);
    
    const hash = this.#getPosHash();
    this.#positionCounts[hash] = (this.#positionCounts[hash] || 0) + 1;

    this.#history.push({ move: matched, undo, san, hash });
    return {
      from:   matched.from,
      to:     matched.to,
      piece:  matched.piece,
      promo:  matched.promo,
      san,
      cap:    matched.cap,
      castle: matched.castle
    };
  }

  /**
   * Undo the last move played via `move()`.
   * @returns {Object|null} The history entry that was undone, or `null` if
   *   the history is empty.
   */
  undo() {
    const entry = this.#history.pop();
    if (!entry) return null;
    
    if (this.#positionCounts[entry.hash]) {
      this.#positionCounts[entry.hash]--;
    }

    this.#revertMove(entry.undo);
    return entry;
  }

  /**
   * Generate SAN notation for a move object.
   * Must be called **before** the move is applied to the board.
   * @param {Object} move
   * @param {Array}  [legal]  Pre-computed legal moves (avoids redundant generation).
   * @returns {string}
   */
  toSAN(move, legal) {
    legal = legal || this.legalMoves();
    if (move.castle) {
      return (move.castle === 'K' || move.castle === 'k') ? 'O-O' : 'O-O-O';
    }
    const isCapture = !!(this.board[move.to.r][move.to.f]) || move.ep;
    const target    = this.#coordToAlgebraic(move.to);
    let fromStr = '';
    if (move.piece === 'p') {
      if (isCapture) fromStr = this.#coordToAlgebraic(move.from)[0];
    } else {
      const ambiguous = legal.filter(other =>
        other.piece    === move.piece &&
        other.to.r     === move.to.r  &&
        other.to.f     === move.to.f  &&
        !(other.from.r === move.from.r && other.from.f === move.from.f)
      );
      if (ambiguous.length) {
        const fromAlg  = this.#coordToAlgebraic(move.from);
        const sameFile = ambiguous.some(other => this.#coordToAlgebraic(other.from)[0] === fromAlg[0]);
        const sameRank = ambiguous.some(other => this.#coordToAlgebraic(other.from)[1] === fromAlg[1]);
        if (!sameFile)      fromStr = fromAlg[0];
        else if (!sameRank) fromStr = fromAlg[1];
        else                fromStr = fromAlg;
      }
    }
    const promoSuffix = move.promo ? '=' + move.promo.toUpperCase() : '';
    // Peek ahead to determine check / checkmate suffix
    const undo = this.#applyMove(move);
    let checkSuffix = '';
    if (this.inCheck()) {
      checkSuffix = this.legalMoves().length === 0 ? '#' : '+';
    }
    this.#revertMove(undo);
    const piecePrefix = move.piece === 'p' ? '' : move.piece.toUpperCase();
    return `${piecePrefix}${fromStr}${isCapture ? 'x' : ''}${target}${promoSuffix}${checkSuffix}`;
  }

  /**
   * Find the legal move that matches a SAN string.
   * Returns the move object, or `null` if no legal move matches.
   * @param {string} san
   * @returns {Object|null}
   */
  parseSAN(san) {
    san = san.replace(/[+#?!]+$/, '').trim();
    const legal = this.legalMoves();
    if (san === 'O-O'   || san === '0-0')   return legal.find(m => m.castle === 'K' || m.castle === 'k') || null;
    if (san === 'O-O-O' || san === '0-0-0') return legal.find(m => m.castle === 'Q' || m.castle === 'q') || null;
    const match = san.match(/^([NBRQK])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([NBRQnbrq]))?$/);
    if (!match) return null;
    const piece  = (match[1] || 'P').toLowerCase();
    const file   = match[2];
    const rank   = match[3];
    const target = match[5];
    const promo  = match[6];
    const to = this.#algebraicToCoord(target);
    const candidates = legal.filter(candidate => {
      if (candidate.piece !== piece)                                         return false;
      if (candidate.to.r !== to.r || candidate.to.f !== to.f)               return false;
      if (file  && this.#coordToAlgebraic(candidate.from)[0] !== file)      return false;
      if (rank  && this.#coordToAlgebraic(candidate.from)[1] !== rank)      return false;
      if (promo && candidate.promo !== promo.toLowerCase())                  return false;
      return true;
    });
    return candidates[0] || null;
  }

  /** @returns {boolean} True if the side to move is in checkmate. */
  isCheckmate() {
    return this.inCheck() && this.legalMoves().length === 0;
  }

  /** @returns {boolean} True if the side to move is in stalemate. */
  isStalemate() {
    return !this.inCheck() && this.legalMoves().length === 0;
  }

  /** @returns {boolean} True if the game is over (checkmate, stalemate, draw). */
  isGameOver() {
    return this.legalMoves().length === 0 || this.isDraw();
  }

  /** @returns {boolean} True if the position is a draw (stalemate, 50-move, 3-fold, insufficient material). */
  isDraw() {
    if (this.half >= 100) return true;
    if (this.#positionCounts[this.#getPosHash()] >= 3) return true;
    if (this.hasInsufficientMaterial()) return true;
    return !this.inCheck() && this.legalMoves().length === 0;
  }

  /** @returns {boolean} True if there is insufficient mating material. */
  hasInsufficientMaterial() {
    const pieces = { w: [], b: [] };
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = this.board[r][f];
        if (p) {
          if (p.type === 'p' || p.type === 'r' || p.type === 'q') return false;
          pieces[p.color].push(p.type);
        }
      }
    }
    const wc = pieces.w.length, bc = pieces.b.length;
    if (wc === 1 && bc === 1) return true; // K vs K
    if (wc === 2 && bc === 1) return true; // K+N or K+B vs K
    if (wc === 1 && bc === 2) return true; // K vs K+N or K+B
    return false;
  }

  // ===========================================================
  // PRIVATE HELPERS
  // ===========================================================

  /** Convert algebraic notation (e.g. `'e4'`) to a board coordinate `{ r, f }`. */
  #algebraicToCoord(alg) {
    return { r: 8 - +alg[1], f: alg.charCodeAt(0) - 97 };
  }

  /** Convert a board coordinate `{ r, f }` to algebraic notation (e.g. `'e4'`). */
  #coordToAlgebraic({ r, f }) {
    return String.fromCharCode(97 + f) + (8 - r);
  }

  /** Return `true` if `(row, col)` is within the 8×8 board. */
  #inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  /**
   * Generate pseudo-legal moves for the piece on `(row, col)`.
   * Results may leave the own king in check; filter with `legalMoves()`.
   */
  #pseudoMovesFor(row, col) {
    const piece  = this.board[row][col];
    if (!piece) return [];
    const moves  = [];
    const origin = { r: row, f: col };

    if (piece.type === 'p') {
      const direction = piece.color === 'w' ? -1 : 1;
      const startRank = piece.color === 'w' ? 6 : 1;
      const promoRank = piece.color === 'w' ? 0 : 7;

      // Single push
      if (this.#inBounds(row + direction, col) && !this.board[row + direction][col]) {
        if (row + direction === promoRank) {
          for (const promoPiece of ['q', 'r', 'b', 'n']) {
            moves.push({ from: origin, to: { r: row + direction, f: col }, piece: 'p', promo: promoPiece });
          }
        } else {
          moves.push({ from: origin, to: { r: row + direction, f: col }, piece: 'p' });
        }
        // Double push from the starting rank
        if (row === startRank && !this.board[row + 2 * direction][col]) {
          moves.push({ from: origin, to: { r: row + 2 * direction, f: col }, piece: 'p', dbl: true });
        }
      }

      // Diagonal captures (including en passant)
      for (const fileDelta of [-1, 1]) {
        if (!this.#inBounds(row + direction, col + fileDelta)) continue;
        const target = this.board[row + direction][col + fileDelta];
        if (target && target.color !== piece.color) {
          if (row + direction === promoRank) {
            for (const promoPiece of ['q', 'r', 'b', 'n']) {
              moves.push({ from: origin, to: { r: row + direction, f: col + fileDelta }, piece: 'p', promo: promoPiece, cap: true });
            }
          } else {
            moves.push({ from: origin, to: { r: row + direction, f: col + fileDelta }, piece: 'p', cap: true });
          }
        }
        if (this.ep && this.ep.r === row + direction && this.ep.f === col + fileDelta) {
          moves.push({ from: origin, to: { r: row + direction, f: col + fileDelta }, piece: 'p', cap: true, ep: true });
        }
      }

    } else if (piece.type === 'n' || piece.type === 'k') {
      for (const [rankDelta, fileDelta] of PIECE_DIRS[piece.type]) {
        const nextRow = row + rankDelta;
        const nextCol = col + fileDelta;
        if (!this.#inBounds(nextRow, nextCol)) continue;
        const target = this.board[nextRow][nextCol];
        if (!target || target.color !== piece.color) {
          moves.push({ from: origin, to: { r: nextRow, f: nextCol }, piece: piece.type, cap: !!target });
        }
      }

      // Castling (king only)
      if (piece.type === 'k' && this.castling) {
        const opponent = piece.color === 'w' ? 'b' : 'w';
        if (piece.color === 'w' && row === 7 && col === 4) {
          if (
            this.castling.includes('K') &&
            !this.board[7][5] && !this.board[7][6] &&
            this.board[7][7] && this.board[7][7].type === 'r' &&
            !this.#isAttackedBy(7, 4, opponent) &&
            !this.#isAttackedBy(7, 5, opponent) &&
            !this.#isAttackedBy(7, 6, opponent)
          ) {
            moves.push({ from: origin, to: { r: 7, f: 6 }, piece: 'k', castle: 'K' });
          }
          if (
            this.castling.includes('Q') &&
            !this.board[7][1] && !this.board[7][2] && !this.board[7][3] &&
            this.board[7][0] && this.board[7][0].type === 'r' &&
            !this.#isAttackedBy(7, 4, opponent) &&
            !this.#isAttackedBy(7, 3, opponent) &&
            !this.#isAttackedBy(7, 2, opponent)
          ) {
            moves.push({ from: origin, to: { r: 7, f: 2 }, piece: 'k', castle: 'Q' });
          }
        }
        if (piece.color === 'b' && row === 0 && col === 4) {
          if (
            this.castling.includes('k') &&
            !this.board[0][5] && !this.board[0][6] &&
            this.board[0][7] && this.board[0][7].type === 'r' &&
            !this.#isAttackedBy(0, 4, opponent) &&
            !this.#isAttackedBy(0, 5, opponent) &&
            !this.#isAttackedBy(0, 6, opponent)
          ) {
            moves.push({ from: origin, to: { r: 0, f: 6 }, piece: 'k', castle: 'k' });
          }
          if (
            this.castling.includes('q') &&
            !this.board[0][1] && !this.board[0][2] && !this.board[0][3] &&
            this.board[0][0] && this.board[0][0].type === 'r' &&
            !this.#isAttackedBy(0, 4, opponent) &&
            !this.#isAttackedBy(0, 3, opponent) &&
            !this.#isAttackedBy(0, 2, opponent)
          ) {
            moves.push({ from: origin, to: { r: 0, f: 2 }, piece: 'k', castle: 'q' });
          }
        }
      }

    } else {
      // Sliding pieces: bishop, rook, queen
      for (const [rankDelta, fileDelta] of PIECE_DIRS[piece.type]) {
        let nextRow = row + rankDelta;
        let nextCol = col + fileDelta;
        while (this.#inBounds(nextRow, nextCol)) {
          const target = this.board[nextRow][nextCol];
          if (!target) {
            moves.push({ from: origin, to: { r: nextRow, f: nextCol }, piece: piece.type });
          } else {
            if (target.color !== piece.color) {
              moves.push({ from: origin, to: { r: nextRow, f: nextCol }, piece: piece.type, cap: true });
            }
            break;
          }
          nextRow += rankDelta;
          nextCol += fileDelta;
        }
      }
    }

    return moves;
  }

  /**
   * Return `true` if square `(row, col)` is attacked by any piece of `byColor`.
   */
  #isAttackedBy(row, col, byColor) {
    // Knight attacks
    for (const [rankDelta, fileDelta] of PIECE_DIRS.n) {
      const piece = this.at(row + rankDelta, col + fileDelta);
      if (piece && piece.color === byColor && piece.type === 'n') return true;
    }
    // King attacks
    for (const [rankDelta, fileDelta] of PIECE_DIRS.k) {
      const piece = this.at(row + rankDelta, col + fileDelta);
      if (piece && piece.color === byColor && piece.type === 'k') return true;
    }
    // Pawn attacks — the attacking pawn must sit "above" the target from the attacker's perspective
    const pawnDirection = byColor === 'w' ? 1 : -1;
    for (const fileDelta of [-1, 1]) {
      const piece = this.at(row + pawnDirection, col + fileDelta);
      if (piece && piece.color === byColor && piece.type === 'p') return true;
    }
    // Rook / queen attacks (straight lines)
    for (const [rankDelta, fileDelta] of PIECE_DIRS.r) {
      let nextRow = row + rankDelta;
      let nextCol = col + fileDelta;
      while (this.#inBounds(nextRow, nextCol)) {
        const piece = this.board[nextRow][nextCol];
        if (piece) {
          if (piece.color === byColor && (piece.type === 'r' || piece.type === 'q')) return true;
          break;
        }
        nextRow += rankDelta;
        nextCol += fileDelta;
      }
    }
    // Bishop / queen attacks (diagonals)
    for (const [rankDelta, fileDelta] of PIECE_DIRS.b) {
      let nextRow = row + rankDelta;
      let nextCol = col + fileDelta;
      while (this.#inBounds(nextRow, nextCol)) {
        const piece = this.board[nextRow][nextCol];
        if (piece) {
          if (piece.color === byColor && (piece.type === 'b' || piece.type === 'q')) return true;
          break;
        }
        nextRow += rankDelta;
        nextCol += fileDelta;
      }
    }
    return false;
  }

  /**
   * Apply a move directly to the board and return an undo record.
   * Does **not** push to `history_` — use `move()` for that.
   */
  #applyMove(move) {
    const undo = {
      move,
      captured:       this.board[move.to.r][move.to.f],
      enPassant:      this.ep,
      castlingRights: this.castling,
      halfMoveClock:  this.half,
      fullMoveNumber: this.full,
      sideToMove:     this.turn_,
      epCapture:      null
    };

    const piece = this.board[move.from.r][move.from.f];
    this.board[move.to.r][move.to.f]     = move.promo ? { type: move.promo, color: piece.color } : piece;
    this.board[move.from.r][move.from.f] = null;

    // En passant capture — remove the captured pawn from its actual square
    if (move.ep) {
      undo.epCapture = {
        r:     move.from.r,
        f:     move.to.f,
        piece: this.board[move.from.r][move.to.f]
      };
      this.board[move.from.r][move.to.f] = null;
    }

    // Castling — move the rook to its post-castle square
    if (move.castle) {
      if      (move.castle === 'K') { this.board[7][5] = this.board[7][7]; this.board[7][7] = null; }
      else if (move.castle === 'Q') { this.board[7][3] = this.board[7][0]; this.board[7][0] = null; }
      else if (move.castle === 'k') { this.board[0][5] = this.board[0][7]; this.board[0][7] = null; }
      else if (move.castle === 'q') { this.board[0][3] = this.board[0][0]; this.board[0][0] = null; }
    }

    // Update castling rights
    let rights = this.castling || '';
    if (piece.type === 'k') {
      rights = piece.color === 'w' ? rights.replace(/[KQ]/g, '') : rights.replace(/[kq]/g, '');
    }
    if (piece.type === 'r') {
      if (move.from.r === 7 && move.from.f === 0) rights = rights.replace('Q', '');
      if (move.from.r === 7 && move.from.f === 7) rights = rights.replace('K', '');
      if (move.from.r === 0 && move.from.f === 0) rights = rights.replace('q', '');
      if (move.from.r === 0 && move.from.f === 7) rights = rights.replace('k', '');
    }
    // A rook being captured also forfeits castling rights on that side
    if (move.to.r === 7 && move.to.f === 0) rights = rights.replace('Q', '');
    if (move.to.r === 7 && move.to.f === 7) rights = rights.replace('K', '');
    if (move.to.r === 0 && move.to.f === 0) rights = rights.replace('q', '');
    if (move.to.r === 0 && move.to.f === 7) rights = rights.replace('k', '');
    this.castling = rights || '-';

    // Update en passant target square
    this.ep = move.dbl ? { r: (move.from.r + move.to.r) / 2, f: move.from.f } : null;

    // Update move clocks
    if (piece.type === 'p' || undo.captured) this.half = 0; else this.half++;
    if (this.turn_ === 'b') this.full++;
    this.turn_ = this.turn_ === 'w' ? 'b' : 'w';

    return undo;
  }

  /** Restore the board to the state captured in an undo record from `#applyMove`. */
  #revertMove(undo) {
    const move  = undo.move;
    const piece = this.board[move.to.r][move.to.f];
    this.board[move.from.r][move.from.f] = move.promo ? { type: 'p', color: piece.color } : piece;
    this.board[move.to.r][move.to.f]     = undo.captured;

    if (undo.epCapture) {
      this.board[undo.epCapture.r][undo.epCapture.f] = undo.epCapture.piece;
    }

    if (move.castle) {
      if      (move.castle === 'K') { this.board[7][7] = this.board[7][5]; this.board[7][5] = null; }
      else if (move.castle === 'Q') { this.board[7][0] = this.board[7][3]; this.board[7][3] = null; }
      else if (move.castle === 'k') { this.board[0][7] = this.board[0][5]; this.board[0][5] = null; }
      else if (move.castle === 'q') { this.board[0][0] = this.board[0][3]; this.board[0][3] = null; }
    }

    this.ep       = undo.enPassant;
    this.castling = undo.castlingRights;
    this.half     = undo.halfMoveClock;
    this.full     = undo.fullMoveNumber;
    this.turn_    = undo.sideToMove;
  }
}

export { Chess, START_FEN };
