import { computeCandidates, countSolutions, digitMask } from './sudoku.js';
import { applyStep, findStep } from './techniques.js';

export function getHint({ givens, solution, entries, notes }) {
  const grid = givens.slice();
  for (let cell = 0; cell < 81; cell++) {
    if (givens[cell] || entries[cell] === 0) continue;
    if (entries[cell] !== solution[cell]) {
      return {
        kind: 'mistake',
        summary: 'One of your numbers is wrong. Look over your recent moves.',
        pattern: [],
      };
    }
    grid[cell] = entries[cell];
  }
  if (!grid.includes(0)) return grid.every((digit, cell) => digit === solution[cell]) ? { kind: 'solved' } : null;

  let candidates = computeCandidates(grid);
  let unique;
  while (true) {
    let step = findStep(grid, candidates, { assumeUnique: unique !== false });
    if (step?.technique === 'unique-rectangle-type-1' && unique === undefined) {
      unique = countSolutions(givens) === 1;
      if (!unique) step = findStep(grid, candidates, { assumeUnique: false });
    }
    if (!step || step.placements.some(({ cell, digit }) => solution[cell] !== digit) ||
        step.eliminations.some(({ cell, digit }) => solution[cell] === digit)) return null;

    if (step.placements.length || !step.eliminations.every(({ cell, digit }) =>
      notes[cell] !== 0 && !(notes[cell] & digitMask(digit)))) return { kind: 'step', ...step };

    ({ candidates } = applyStep(grid, candidates, step));
  }
}
