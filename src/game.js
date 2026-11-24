import { bandOf } from './rating.js';
import { nextScore } from './score.js';
import { digitMask } from './sudoku.js';

export function createGame({ givens, solution, rating }) {
  return {
    givens: givens.slice(),
    solution: solution.slice(),
    rating,
    entries: Array(81).fill(0),
    notes: Array(81).fill(0),
    undoStack: [],
    selection: null,
    hintsUsed: 0,
    hint: null,
    hintExpanded: false,
    elapsedMs: 0,
    completion: null,
  };
}

export function numberAt(state, cell) {
  return state.givens[cell] || state.entries[cell];
}

// How many times each digit 1-9 is on the board (givens plus big entries). Index 0 is unused.
export function digitCounts(state) {
  const counts = Array(10).fill(0);
  for (let cell = 0; cell < 81; cell++) counts[numberAt(state, cell)]++;
  counts[0] = 0;
  return counts;
}

export function selectNumber(state, digit) {
  return { ...state, selection: state.selection === digit ? null : digit };
}

export function selectErase(state) {
  return { ...state, selection: state.selection === 'erase' ? null : 'erase' };
}

function changeCell(state, cell, entry, notes) {
  if (entry === state.entries[cell] && notes === state.notes[cell]) return state;
  const next = closeHint({
    ...state,
    entries: state.entries.slice(),
    notes: state.notes.slice(),
    undoStack: [...state.undoStack, { cell, entry: state.entries[cell], notes: state.notes[cell] }],
  });
  next.entries[cell] = entry;
  next.notes[cell] = notes;
  return next;
}

export function tap(state, cell) {
  if (state.completion) return state;
  const given = state.givens[cell];
  if (given) return state.selection === given ? state : { ...state, selection: given };
  if (state.selection === 'erase') return erase(state, cell);

  const entry = state.entries[cell];
  if (state.selection === null) return entry ? { ...state, selection: entry } : state;
  return changeCell(state, cell, entry === state.selection ? 0 : state.selection, state.notes[cell]);
}

export function longPress(state, cell) {
  if (state.completion || typeof state.selection !== 'number' || numberAt(state, cell)) return state;
  return changeCell(state, cell, 0, state.notes[cell] ^ digitMask(state.selection));
}

export function erase(state, cell) {
  if (state.completion || state.givens[cell]) return state;
  return changeCell(state, cell, 0, state.entries[cell] ? state.notes[cell] : 0);
}

export function undo(state) {
  const last = state.undoStack.at(-1);
  if (state.completion || !last) return state;
  const next = closeHint({
    ...state,
    entries: state.entries.slice(),
    notes: state.notes.slice(),
    undoStack: state.undoStack.slice(0, -1),
  });
  next.entries[last.cell] = last.entry;
  next.notes[last.cell] = last.notes;
  return next;
}

export function restart(state) {
  if (state.completion) return state;
  return closeHint({ ...state, entries: Array(81).fill(0), notes: Array(81).fill(0), undoStack: [] });
}

export function isFilled(state) {
  return state.givens.every((_, cell) => numberAt(state, cell) > 0);
}

export function isSolved(state) {
  return state.solution.every((digit, cell) => numberAt(state, cell) === digit);
}

export function showHint(state, result) {
  if (state.completion || state.hint || result?.kind === 'solved') return state;
  const countsAsHint = result?.kind === 'step' || result?.kind === 'mistake';
  return {
    ...state,
    hint: result ?? { kind: 'unavailable', summary: "I couldn't find a hint from here." },
    hintsUsed: state.hintsUsed + Number(countsAsHint),
    hintExpanded: false,
  };
}

export function closeHint(state) {
  return state.hint ? { ...state, hint: null, hintExpanded: false } : state;
}

export function toggleHintDetail(state) {
  return state.hint?.kind === 'step' ? { ...state, hintExpanded: !state.hintExpanded } : state;
}

export function recordCompletion(progress) {
  const { game, score, stats } = progress;
  if (!game || game.completion || !isFilled(game) || !isSolved(game)) return progress;
  return {
    ...progress,
    score: nextScore(score, { solved: true, hintsUsed: game.hintsUsed }),
    game: { ...closeHint(game), selection: null, completion: { previousScore: score } },
    stats: { solved: stats.solved + 1, cleanSolves: stats.cleanSolves + Number(game.hintsUsed === 0) },
  };
}

export function advancePuzzle(progress) {
  if (!progress.game) return progress;
  return {
    ...progress,
    score: progress.game.completion ? progress.score : nextScore(progress.score, { gaveUp: true }),
    game: null,
  };
}

export function matchesTarget(generatedTarget, actualTarget) {
  return Number.isFinite(generatedTarget) && Math.abs(generatedTarget - actualTarget) <= 6 &&
    bandOf(generatedTarget) === bandOf(actualTarget);
}
