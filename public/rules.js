// Shared grid math. The browser loads this as window.Rules and the server
// requires it, so both sides always agree on how far apart two squares are.
(function (root) {
  const GRID = { cols: 20, rows: 14, size: 48, feetPerSquare: 5 };

  // Standard 5e diagonals: a diagonal step costs the same as a straight one.
  function squareDistance(a, b) {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.max(dx, dy);
  }

  function feetBetween(a, b) {
    return squareDistance(a, b) * GRID.feetPerSquare;
  }

  function insideRoom(x, y) {
    return x >= 0 && y >= 0 && x < GRID.cols && y < GRID.rows;
  }

  const Rules = { GRID, squareDistance, feetBetween, insideRoom };

  if (typeof module !== 'undefined') {
    module.exports = Rules;
  } else {
    root.Rules = Rules;
  }
})(this);
