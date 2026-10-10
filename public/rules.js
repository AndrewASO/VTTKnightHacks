// Shared grid math. The browser loads this as window.Rules and the server
// requires it, so both sides always agree on how far apart two squares are.
(function (root) {
  const GRID = { cols: 20, rows: 14, size: 48, feetPerSquare: 5 };

  // Squares between the near edges of two footprints. A missing size is one square.
  function axisGap(origin, span, otherOrigin, otherSpan) {
    const end = origin + span - 1;
    const otherEnd = otherOrigin + otherSpan - 1;
    if (end < otherOrigin) return otherOrigin - end;
    if (otherEnd < origin) return origin - otherEnd;
    return 0;
  }

  // Standard 5e diagonals: a diagonal step costs the same as a straight one.
  function squareDistance(a, b) {
    const dx = axisGap(a.x, a.w || a.width || 1, b.x, b.w || b.width || 1);
    const dy = axisGap(a.y, a.h || a.height || 1, b.y, b.h || b.height || 1);
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
