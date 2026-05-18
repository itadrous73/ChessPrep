// =============================================================
// REPERTOIRE — tree of opening lines
// =============================================================
// Node: { san?, comment?, children: [Node] }
// Root has no san. Children of root = 1st ply moves.

class Repertoire {
  constructor(name, color, positions) {
    this.name = name || 'New Repertoire';
    this.color = color || 'white';
    this.positions = positions || {};
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }
  static getPosHash(fen) {
    return fen.split(' ').slice(0, 4).join(' ');
  }
  static fromJSON(j) {
    const r = new Repertoire(j.name, j.color, j.positions);
    r.createdAt = j.createdAt || Date.now();
    r.updatedAt = j.updatedAt || Date.now();
    return r;
  }
  toJSON() {
    return { version: 2, name: this.name, color: this.color, positions: this.positions, createdAt: this.createdAt, updatedAt: this.updatedAt };
  }
  getPosition(fenHash) {
    return this.positions[fenHash] || { moves: [] };
  }
  addMove(fenHash, san, comment, nextFenHash) {
    if (!this.positions[fenHash]) {
      this.positions[fenHash] = { moves: [] };
    }
    let move = this.positions[fenHash].moves.find(m => m.san === san);
    if (!move) {
      move = { san, comment: comment || '', nextFenHash };
      this.positions[fenHash].moves.push(move);
    } else if (comment !== undefined) {
      move.comment = comment;
    }
    this.updatedAt = Date.now();
    return move;
  }
  deleteMove(fenHash, san) {
    if (!this.positions[fenHash]) return false;
    const idx = this.positions[fenHash].moves.findIndex(m => m.san === san);
    if (idx < 0) return false;
    this.positions[fenHash].moves.splice(idx, 1);
    this.updatedAt = Date.now();
    return true;
  }
  countMoves() {
    let count = 0;
    for (const fenHash in this.positions) {
      count += this.positions[fenHash].moves.length;
    }
    return count;
  }
}

export { Repertoire };
