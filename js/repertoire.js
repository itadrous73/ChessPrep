// =============================================================
// REPERTOIRE — tree of opening lines
// =============================================================
// Node: { san?, comment?, children: [Node] }
// Root has no san. Children of root = 1st ply moves.

class Repertoire {
  constructor(name, color, root) {
    this.name = name || 'New Repertoire';
    this.color = color || 'white';      // user plays this color
    this.root = root || { children: [] };
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }
  static fromJSON(j) {
    const r = new Repertoire(j.name, j.color, j.root);
    r.createdAt = j.createdAt || Date.now();
    r.updatedAt = j.updatedAt || Date.now();
    return r;
  }
  toJSON() {
    return { version: 1, name: this.name, color: this.color, root: this.root, createdAt: this.createdAt, updatedAt: this.updatedAt };
  }
  // Navigate from root following SANs in path, return node or null
  nodeAt(path) {
    let n = this.root;
    for (const san of path) {
      const ch = n.children.find(c => c.san === san);
      if (!ch) return null;
      n = ch;
    }
    return n;
  }
  // Add a move; returns the new (or existing) child node
  addMove(path, san, comment) {
    const parent = this.nodeAt(path);
    if (!parent) return null;
    let child = parent.children.find(c => c.san === san);
    if (!child) {
      child = { san, comment: comment || '', children: [] };
      parent.children.push(child);
    } else if (comment !== undefined) {
      child.comment = comment;
    }
    this.updatedAt = Date.now();
    return child;
  }
  deleteAt(path) {
    if (path.length === 0) return false;
    const parent = this.nodeAt(path.slice(0, -1));
    if (!parent) return false;
    const idx = parent.children.findIndex(c => c.san === path[path.length-1]);
    if (idx < 0) return false;
    parent.children.splice(idx, 1);
    this.updatedAt = Date.now();
    return true;
  }
  // Count total moves in tree
  countMoves() {
    const walk = (n) => n.children.reduce((s, c) => s + 1 + walk(c), 0);
    return walk(this.root);
  }
}

export { Repertoire };
