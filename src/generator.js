import { createRng, randomSeed } from './rng.js';
import { bandOf, ratePuzzle } from './rating.js';
import { countSolutions, generateSolution, parseGrid, solve } from './sudoku.js';

const CELLS = Array.from({ length: 81 }, (_, cell) => cell);
const GROUPS_OF_THREE = [0, 1, 2];
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const DIG_SETTINGS = {
  Medium: { maxClues: 54, maxTier: 2 },
  Hard: { maxClues: 36, maxTier: 4 },
  Expert: { maxClues: 36, maxTier: 6 },
};

// These locally generated puzzles guarantee a starting point in either rarer band.
const WITNESSES = {
  Hard: [
    '...28..3.3.....1...9......26....98...7.8.....82..154.7.3.9..74.9.7...2.618.7.6...',
    '8..4..71..7..53.642........421....76.65...3...............7198.9.3.2.........9...',
    '1......7..89216.....4.....8.2.1.....3....59..8.....4.1...9685.......2.13....5....',
  ],
  Expert: [
    '215367849.8......73.684..2........1.6.91..73..3......419.......5289..47.4...52.9.',
    '9..157.........2...5....9......9...8.6.7.....8...2.67.1....9..42..6.8...7.3...861',
    '......19..1......6..8.9..3.....3.6..7..4.....1...5..4...9..5..8..3..87...6.92....',
    '...28..3.3.....1...9......26....98...7.8.....8...154...3.9..74...7.....618.7.6...',
  ],
};

function shuffled(values, rng) {
  const list = values.slice();
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function dig(rng, band, visit) {
  const { maxClues, maxTier } = DIG_SETTINGS[band];
  const solution = generateSolution(rng);
  const givens = solution.slice();
  let clues = 81;
  for (const cell of shuffled(CELLS, rng)) {
    givens[cell] = 0;
    if (countSolutions(givens) !== 1) {
      givens[cell] = solution[cell];
      continue;
    }
    if (--clues > maxClues) continue;
    const rating = ratePuzzle(givens, { maxTier });
    if (rating.solvable && rating.band === band && visit(givens, solution, rating)) return true;
  }
  return false;
}

function shuffleLines(rng) {
  return shuffled(GROUPS_OF_THREE, rng).flatMap((group) =>
    shuffled(GROUPS_OF_THREE, rng).map((line) => 3 * group + line));
}

function transformBoard(rng) {
  const rows = shuffleLines(rng);
  const columns = shuffleLines(rng);
  const digits = [0, ...shuffled(DIGITS, rng)];
  const transpose = rng() < 0.5;
  const cells = rows.flatMap((row) => columns.map((column) =>
    transpose ? column * 9 + row : row * 9 + column));
  return (grid) => cells.map((cell) => digits[grid[cell]]);
}

function tryWitnesses(band, rng, consider) {
  const originals = [];
  for (const text of WITNESSES[band]) {
    const givens = parseGrid(text);
    if (countSolutions(givens) !== 1) continue;
    const solution = solve(givens);
    originals.push({ givens, solution });
    for (let attempt = 0; attempt < 4; attempt++) {
      const transform = transformBoard(rng);
      if (consider(transform(givens), transform(solution))) return;
    }
  }
  for (const { givens, solution } of originals) {
    if (consider(givens, solution)) return;
  }
}

export function generatePuzzle(targetScore, { seed = randomSeed(), timeBudgetMs = 4000 } = {}) {
  const target = Math.max(0, Math.min(100, targetScore));
  if (Number.isNaN(target)) throw new TypeError('Target score must be a number.');
  const band = bandOf(target);
  const rng = createRng(seed);
  const budget = Number.isFinite(timeBudgetMs) ? timeBudgetMs : 4000;
  // A repeatable work allowance keeps the seed independent of the device's speed.
  const attempts = Math.max(1, Math.ceil(budget / 20));
  let best;
  let bestDistance = Infinity;

  function consider(givens, solution, rating, fromFallback = false) {
    if (!rating.solvable || rating.band !== band) return false;
    const distance = Math.abs(rating.score - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { givens: givens.slice(), solution, rating, seed, fromFallback };
    }
    return distance === 0;
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (dig(rng, band, consider) || bestDistance <= 4) return best;
  }
  if (best) return best;

  const considerFallback = (givens, solution) => consider(givens, solution, ratePuzzle(givens), true);
  if (band !== 'Medium') {
    tryWitnesses(band, rng, considerFallback);
  } else {
    const solution = generateSolution(rng);
    const givens = solution.slice();
    const row = Math.floor(9 * rng());
    givens.fill(0, 9 * row, 9 * (row + 1));
    considerFallback(givens, solution);
  }
  while (!best) dig(rng, band, consider);
  return best;
}
