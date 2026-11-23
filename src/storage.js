import { isSolved } from './game.js';
import { START_SCORE } from './score.js';
import { ALL_DIGITS } from './sudoku.js';

export const STORAGE_KEY = 'melissas-sudoku:v1';

export function defaultProgress() {
  return {
    score: START_SCORE,
    game: null,
    preGenerated: null,
    timerHidden: false,
    stats: { solved: 0, cleanSolves: 0 },
  };
}

const integerBetween = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const validScore = (value) => integerBetween(value, 0, 100);
const validCell = (value) => integerBetween(value, 0, 80);
const validBoard = (value, min, max) => Array.isArray(value) && value.length === 81 &&
  value.every((digit) => integerBetween(digit, min, max));

function validPuzzle(puzzle) {
  return validBoard(puzzle?.givens, 0, 9) && validBoard(puzzle.solution, 1, 9) &&
    validScore(puzzle.rating?.score) && puzzle.givens.every((digit, cell) => !digit || digit === puzzle.solution[cell]);
}

function validHint(hint) {
  if (hint === null) return true;
  if (typeof hint?.summary !== 'string') return false;
  if (hint.kind === 'mistake' || hint.kind === 'unavailable') return true;
  return hint.kind === 'step' && typeof hint.name === 'string' && typeof hint.detail === 'string' &&
    Array.isArray(hint.pattern) && hint.pattern.every(validCell);
}

function validGame(game) {
  if (!validPuzzle(game) || !validBoard(game.entries, 0, 9) || !validBoard(game.notes, 0, ALL_DIGITS)) return false;
  const validUndo = (move) => validCell(move?.cell) && !game.givens[move.cell] &&
    integerBetween(move.entry, 0, 9) && integerBetween(move.notes, 0, ALL_DIGITS);
  return game.givens.every((digit, cell) => !digit || (!game.entries[cell] && !game.notes[cell])) &&
    Array.isArray(game.undoStack) && game.undoStack.every(validUndo) &&
    (game.selection === null || game.selection === 'erase' || integerBetween(game.selection, 1, 9)) &&
    Number.isSafeInteger(game.hintsUsed) && game.hintsUsed >= 0 &&
    validHint(game.hint) && (game.hintExpanded === false || (game.hintExpanded === true && game.hint?.kind === 'step')) &&
    Number.isFinite(game.elapsedMs) && game.elapsedMs >= 0 &&
    (game.completion === null || (validScore(game.completion?.previousScore) && isSolved(game)));
}

function validProgress(progress) {
  if (!validScore(progress?.score) || typeof progress.timerHidden !== 'boolean') return false;
  const { game, preGenerated, stats } = progress;
  return (game === null || validGame(game)) &&
    (preGenerated === null || (validScore(preGenerated?.target) && validPuzzle(preGenerated.puzzle))) &&
    Number.isSafeInteger(stats?.solved) && stats.solved >= 0 &&
    integerBetween(stats.cleanSolves, 0, stats.solved);
}

export function loadProgress(storage) {
  try {
    const json = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
    if (json == null) return defaultProgress();
    const progress = JSON.parse(json);
    if (validProgress(progress)) return progress;
  } catch {
    // Access and parsing can both fail when opening the app.
  }
  return defaultProgress();
}

export function saveProgress(progress, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
