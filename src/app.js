import {
  advancePuzzle, closeHint, createGame, digitCounts, isFilled, longPress, matchesTarget, numberAt,
  recordCompletion, restart, selectErase, selectNumber, showHint, tap, toggleHintDetail, undo,
} from './game.js';
import { bandOf } from './rating.js';
import { randomSeed } from './rng.js';
import { BANDS, nextScore, nextTarget } from './score.js';
import { loadProgress, saveProgress } from './storage.js';
import { colOf, digitMask, friendlyCellName, maskDigits, rowOf } from './sudoku.js';

const byId = (id) => document.getElementById(id);
const elements = {
  timer: byId('timer'),
  timerValue: byId('timer-value'),
  score: byId('score-value'),
  band: byId('score-band'),
  track: byId('score-track'),
  bandLabels: byId('score-labels'),
  loading: byId('loading'),
  spinner: byId('spinner'),
  loadingMessage: byId('loading-message'),
  retry: byId('retry'),
  game: byId('game'),
  board: byId('board'),
  controls: byId('controls'),
  undo: byId('undo'),
  erase: byId('erase'),
  hint: byId('hint'),
  restart: byId('restart'),
  next: byId('next'),
  hintCard: byId('hint-card'),
  hintTitle: byId('hint-title'),
  hintSummary: byId('hint-summary'),
  hintClose: byId('hint-close'),
  hintMore: byId('hint-more'),
  hintDetail: byId('hint-detail'),
  pad: byId('pad'),
  gameMessage: byId('game-message'),
  completion: byId('completion'),
  completionTitle: byId('completion-title'),
  completionDetails: byId('completion-details'),
  completionScore: byId('completion-score'),
  completionNext: byId('completion-next'),
  dialog: byId('confirm-dialog'),
  confirmQuestion: byId('confirm-question'),
  confirmCancel: byId('confirm-cancel'),
  confirmAction: byId('confirm-action'),
};
const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const arrowMoves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const HOLD_THRESHOLD_MS = 250;
const PRESS_DRIFT_LIMIT_PX = 10;

let progress = recordCompletion(loadProgress());
let focusedCell = 0;
let activePress = null;
let nudge = false;
let nudgeTimeout;
let timerStartedAt = null;
let lastShownSecond = 0;
let hintRequest = null;
let nextGeneration = null;
let loading = false;
let generationFailed = false;
let pendingAction = null;

function setText(element, text) {
  const content = String(text);
  if (element.textContent !== content) element.textContent = content;
}

function buildBoard() {
  const cells = [];
  for (let row = 0; row < 9; row++) {
    const rowElement = document.createElement('div');
    rowElement.className = 'board-row';
    rowElement.setAttribute('role', 'row');
    for (let column = 0; column < 9; column++) {
      const square = document.createElement('div');
      square.className = 'square';
      square.setAttribute('role', 'gridcell');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cell';
      button.dataset.cell = cells.length;
      button.tabIndex = cells.length === 0 ? 0 : -1;

      const value = document.createElement('span');
      value.setAttribute('aria-hidden', 'true');
      const notes = document.createElement('span');
      notes.className = 'notes';
      notes.setAttribute('aria-hidden', 'true');
      const noteDigits = digits.map(() => notes.appendChild(document.createElement('span')));
      button.append(value, notes);
      square.append(button);
      rowElement.append(square);
      cells.push({ button, value, notes, noteDigits, label: `Row ${row + 1}, column ${column + 1}` });
    }
    elements.board.append(rowElement);
  }
  return cells;
}

const cells = buildBoard();
const keys = digits.map((digit) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'key';
  button.textContent = digit;
  button.addEventListener('click', () => applyGameAction((game) => selectNumber(game, digit)));
  elements.pad.append(button);
  return button;
});
const scoreSegments = BANDS.map(({ min, name }, index) => {
  const width = (BANDS[index + 1]?.min ?? 100) - min;
  const segment = document.createElement('div');
  segment.className = 'score-segment';
  segment.style.flexGrow = width;
  const fill = document.createElement('span');
  fill.className = 'score-fill';
  segment.append(fill);
  elements.track.append(segment);

  const label = document.createElement('span');
  label.textContent = name;
  label.style.flexGrow = width;
  elements.bandLabels.append(label);
  return { min, name, width, fill, label };
});

function elapsedTime() {
  const elapsedMs = progress.game?.elapsedMs ?? 0;
  return timerStartedAt === null ? elapsedMs : elapsedMs + performance.now() - timerStartedAt;
}

function startTimer() {
  if (timerStartedAt === null && progress.game && !progress.game.completion && !document.hidden) {
    timerStartedAt = performance.now();
  }
}

function pauseTimer() {
  if (timerStartedAt === null) return;
  const elapsedMs = Math.floor(elapsedTime());
  timerStartedAt = null;
  progress = { ...progress, game: { ...progress.game, elapsedMs } };
}

function persist() {
  const { game } = progress;
  saveProgress(game ? { ...progress, game: { ...game, elapsedMs: Math.floor(elapsedTime()) } } : progress);
}

function formatTime(elapsedMs) {
  const seconds = Math.floor(elapsedMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function renderTimer() {
  const elapsedMs = elapsedTime();
  const time = formatTime(elapsedMs);
  lastShownSecond = Math.floor(elapsedMs / 1000);
  setText(elements.timerValue, time);
  elements.timerValue.hidden = progress.timerHidden;
  elements.timer.setAttribute('aria-label', progress.timerHidden ? 'Show timer' : `Hide timer, ${time}`);
}

function renderScore() {
  const band = bandOf(progress.score);
  setText(elements.score, progress.score);
  setText(elements.band, band);
  for (const { min, name, width, fill, label } of scoreSegments) {
    const portion = Math.max(0, Math.min(1, (progress.score - min) / width));
    fill.style.setProperty('--fill', `${100 * portion}%`);
    label.classList.toggle('current-band', name === band);
  }
}

function renderBoard(game) {
  const selected = typeof game.selection === 'number' ? game.selection : 0;
  const selectedMask = selected ? digitMask(selected) : 0;
  const pattern = new Set(game.hint?.kind === 'step' ? game.hint.pattern : []);
  elements.board.setAttribute('aria-disabled', Boolean(game.completion));
  cells.forEach(({ button, value, notes, noteDigits, label }, cell) => {
    const number = numberAt(game, cell);
    const given = Boolean(game.givens[cell]);
    const notesMask = number ? 0 : game.notes[cell];
    const highlighted = pattern.has(cell);
    button.classList.toggle('given', given);
    button.classList.toggle('match-big', Boolean(number) && number === selected);
    button.classList.toggle('match-note', Boolean(notesMask & selectedMask));
    button.classList.toggle('hint-cell', highlighted);
    setText(value, number || '');
    notes.hidden = !notesMask;
    if (notesMask) {
      for (const digit of digits) {
        const note = noteDigits[digit - 1];
        const present = Boolean(notesMask & digitMask(digit));
        setText(note, present ? digit : '');
        note.classList.toggle('note-match', present && digit === selected);
      }
    }
    let contents = 'empty';
    if (number) contents = given ? `given ${number}` : `entered ${number}`;
    else if (notesMask) contents = `notes ${maskDigits(notesMask).join(', ')}`;
    button.setAttribute('aria-label', `${label}, ${contents}${highlighted ? ', hint' : ''}`);
  });
}

function hintText(text) {
  // A saved hint can still use square names from an earlier version.
  return String(text ?? '').replace(/\bR([1-9])C([1-9])\b/g, (_, row, column, offset) => {
    const name = friendlyCellName((row - 1) * 9 + (column - 1));
    return offset === 0 ? name[0].toUpperCase() + name.slice(1) : name;
  });
}

function renderHint(game) {
  const { hint, hintExpanded } = game;
  const open = Boolean(hintRequest || hint);
  elements.hintCard.hidden = !open;
  elements.hint.setAttribute('aria-expanded', open);
  if (!open) return;

  const step = hint?.kind === 'step';
  setText(elements.hintTitle, step ? hint.name : hint ? 'Hint' : 'Looking…');
  setText(elements.hintSummary, hintText(hint?.summary));
  elements.hintMore.hidden = !step;
  elements.hintMore.setAttribute('aria-expanded', hintExpanded);
  setText(elements.hintMore, hintExpanded ? 'Show less' : 'Explain more ›');
  elements.hintDetail.hidden = !step || !hintExpanded;
  setText(elements.hintDetail, hintText(hint?.detail));
}

function renderMessage() {
  const wrong = progress.game && !progress.game.completion && isFilled(progress.game);
  elements.gameMessage.classList.toggle('notice', Boolean(wrong || nudge));
  if (wrong) setText(elements.gameMessage, 'Not solved yet');
  else if (nudge) setText(elements.gameMessage, 'Pick a number first');
  else setText(elements.gameMessage, 'Pick a number, then tap a square. Hold for notes.');
}

function render() {
  renderScore();
  renderTimer();
  const { game, score } = progress;
  elements.loading.hidden = Boolean(game);
  elements.game.hidden = !game;
  elements.spinner.hidden = generationFailed;
  elements.retry.hidden = !generationFailed;
  setText(elements.loadingMessage, generationFailed ? 'Puzzle generation failed.' : 'Making your puzzle…');
  if (!game) return;

  renderBoard(game);
  const solved = Boolean(game.completion);
  elements.controls.hidden = solved;
  elements.completion.hidden = !solved;
  if (solved) {
    const hints = game.hintsUsed === 1 ? 'hint' : 'hints';
    setText(elements.completionDetails, `${formatTime(game.elapsedMs)} · ${game.hintsUsed} ${hints} used`);
    setText(elements.completionScore, `Score ${game.completion.previousScore} → ${score}`);
    return;
  }

  elements.undo.disabled = game.undoStack.length === 0;
  elements.erase.setAttribute('aria-pressed', game.selection === 'erase');
  const counts = digitCounts(game);
  keys.forEach((key, index) => {
    const digit = digits[index];
    const allPlaced = counts[digit] >= 9;
    key.setAttribute('aria-pressed', game.selection === digit);
    key.classList.toggle('all-placed', allPlaced);
    key.setAttribute('aria-label', allPlaced ? `${digit}, all nine placed` : String(digit));
  });
  renderHint(game);
  renderMessage();
}

function applyGameAction(action) {
  const { game } = progress;
  if (!game || game.completion) return false;
  const updated = action(game);
  if (updated === game) return false;

  clearTimeout(nudgeTimeout);
  nudge = false;
  progress = { ...progress, game: updated };
  if (updated.entries !== game.entries || updated.notes !== game.notes) {
    hintRequest = null;
    progress = recordCompletion(progress);
    if (progress.game.completion) pauseTimer();
  }
  persist();
  render();
  if (progress.game.completion) elements.completionTitle.focus({ preventScroll: true });
  return true;
}

function activateCell(cell, held) {
  const changed = applyGameAction((game) => held ? longPress(game, cell) : tap(game, cell));
  if (!held && !changed && progress.game?.selection === null && !progress.game.completion) {
    clearTimeout(nudgeTimeout);
    nudge = true;
    renderMessage();
    nudgeTimeout = setTimeout(() => {
      nudge = false;
      renderMessage();
    }, 2400);
  }
  return changed;
}

let worker = null;
let workerUnavailable = false;
let requestId = 0;
const workerRequests = new Map();

function disableWorker(error) {
  workerUnavailable = true;
  worker?.terminate();
  worker = null;
  for (const { reject } of workerRequests.values()) reject(error);
  workerRequests.clear();
}

function requestWorker(type, payload) {
  return new Promise((resolve, reject) => {
    try {
      if (!worker) {
        worker = new Worker(new URL('./gen-worker.js', import.meta.url), { type: 'module' });
        worker.addEventListener('message', ({ data: { id, result, error } }) => {
          const pending = workerRequests.get(id);
          if (!pending) return;
          workerRequests.delete(id);
          if (error !== undefined) pending.reject(new Error(error));
          else pending.resolve(result);
        });
        worker.addEventListener('error', (event) => {
          event.preventDefault();
          disableWorker(new Error(event.message));
        });
        worker.addEventListener('messageerror', () => disableWorker(new Error('Unreadable worker result')));
      }
      const id = ++requestId;
      workerRequests.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    } catch (error) {
      disableWorker(error);
      reject(error);
    }
  });
}

async function requestEngine(type, payload) {
  if (!workerUnavailable) {
    try {
      return await requestWorker(type, payload);
    } catch {
      // Give the loading message or hint card time to paint before running on this thread.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (type === 'generate') {
    const { generatePuzzle } = await import('./generator.js');
    return generatePuzzle(payload.target, { seed: payload.seed });
  }
  const { getHint } = await import('./hints.js');
  return getHint(payload);
}

async function requestHint() {
  const { game } = progress;
  if (!game || game.completion || game.hint || hintRequest) return;
  const request = {};
  hintRequest = request;
  renderHint(game);
  const { givens, solution, entries, notes } = game;
  let result = null;
  try {
    result = await requestEngine('hint', { givens, solution, entries, notes });
  } catch {
    // A failed engine request has no hint to display.
  }
  if (hintRequest !== request) return;
  hintRequest = null;
  if (!applyGameAction((current) => showHint(current, result))) render();
}

function dismissHint() {
  hintRequest = null;
  if (!applyGameAction(closeHint) && progress.game) renderHint(progress.game);
  elements.hint.focus({ preventScroll: true });
}

const generate = (target) => requestEngine('generate', { target, seed: randomSeed() });

function prepareNextPuzzle() {
  if (!progress.game || progress.game.completion || nextGeneration) return;
  const target = nextTarget(nextScore(progress.score, { solved: true }));
  if (progress.preGenerated?.target === target) return;

  const job = { target, promise: generate(target) };
  nextGeneration = job;
  job.promise.then((puzzle) => {
    if (nextGeneration !== job) return;
    nextGeneration = null;
    progress = { ...progress, preGenerated: { target, puzzle } };
    persist();
  }, () => {
    if (nextGeneration === job) nextGeneration = null;
  });
}

async function loadPuzzle() {
  if (loading || progress.game) return;
  loading = true;
  generationFailed = false;
  render();
  const target = nextTarget(progress.score);
  const preGenerated = progress.preGenerated;
  const job = nextGeneration;
  nextGeneration = null;
  try {
    let puzzle;
    if (matchesTarget(preGenerated?.target, target)) puzzle = preGenerated.puzzle;
    if (!puzzle && matchesTarget(job?.target, target)) puzzle = await job.promise.catch(() => null);
    if (!puzzle) puzzle = await generate(target);
    progress = { ...progress, game: createGame(puzzle), preGenerated: null };
    moveFocus(0);
    startTimer();
    persist();
  } catch {
    generationFailed = true;
  } finally {
    loading = false;
    render();
    prepareNextPuzzle();
  }
}

function nextPuzzle() {
  if (!progress.game) return;
  cancelPress();
  clearTimeout(nudgeTimeout);
  nudge = false;
  hintRequest = null;
  pauseTimer();
  progress = advancePuzzle(progress);
  persist();
  void loadPuzzle();
}

function confirm(question, buttonLabel, action) {
  if (elements.dialog.open) return;
  cancelPress();
  pendingAction = action;
  elements.confirmQuestion.textContent = question;
  elements.confirmAction.textContent = buttonLabel;
  elements.dialog.showModal();
}

function cancelConfirmation() {
  pendingAction = null;
  elements.dialog.close();
}

function moveFocus(cell) {
  cells[focusedCell].button.tabIndex = -1;
  focusedCell = cell;
  cells[focusedCell].button.tabIndex = 0;
}

function cancelPress() {
  if (!activePress) return;
  clearTimeout(activePress.timeout);
  activePress = null;
}

function movedBeyondPressLimit(press, { clientX, clientY }) {
  return Math.hypot(clientX - press.startX, clientY - press.startY) > PRESS_DRIFT_LIMIT_PX;
}

function activatePressedCell(cell, held) {
  const changed = activateCell(cell, held);
  if (held && changed) navigator.vibrate?.(10);
}

function containsPoint(element, { clientX, clientY }) {
  const { left, right, top, bottom } = element.getBoundingClientRect();
  return clientX >= left && clientX < right && clientY >= top && clientY < bottom;
}

elements.board.addEventListener('pointerdown', (event) => {
  const button = event.target.closest('.cell');
  if (!button || !event.isPrimary || event.button !== 0 || activePress || progress.game?.completion) return;
  const cell = Number(button.dataset.cell);
  moveFocus(cell);
  button.setPointerCapture(event.pointerId);
  const press = {
    id: event.pointerId,
    cell,
    held: false,
    startedAt: event.timeStamp,
    startX: event.clientX,
    startY: event.clientY,
  };
  activePress = press;
  press.timeout = setTimeout(() => {
    if (activePress !== press) return;
    press.held = true;
    activatePressedCell(cell, true);
  }, HOLD_THRESHOLD_MS);
});

elements.board.addEventListener('pointermove', (event) => {
  const press = activePress;
  if (press?.id === event.pointerId && movedBeyondPressLimit(press, event)) cancelPress();
});

elements.board.addEventListener('pointerup', (event) => {
  const press = activePress;
  if (press?.id !== event.pointerId) return;
  cancelPress();
  if (press.held || movedBeyondPressLimit(press, event)) return;
  activatePressedCell(press.cell, event.timeStamp - press.startedAt >= HOLD_THRESHOLD_MS);
});

for (const type of ['pointercancel', 'lostpointercapture']) {
  elements.board.addEventListener(type, (event) => {
    if (activePress?.id === event.pointerId) cancelPress();
  });
}

// iOS sends pointerdown before touchstart, so board cells can suppress the native touch gesture.
elements.board.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
elements.board.addEventListener('click', (event) => {
  if (event.detail !== 0 || event.pointerType) return;
  const cell = event.target.closest('.cell');
  if (cell) activateCell(Number(cell.dataset.cell), false);
});
elements.board.addEventListener('focusin', (event) => {
  const cell = event.target.closest('.cell');
  if (cell) moveFocus(Number(cell.dataset.cell));
});

for (const type of ['selectstart', 'contextmenu']) {
  document.addEventListener(type, (event) => event.preventDefault());
}

document.addEventListener('keydown', (event) => {
  if (!progress.game || progress.game.completion || elements.dialog.open) return;
  const { key, ctrlKey, metaKey, altKey, shiftKey, repeat } = event;
  if ((ctrlKey || metaKey) && !altKey && !shiftKey && key.toLowerCase() === 'z') {
    event.preventDefault();
    applyGameAction(undo);
    return;
  }
  if (ctrlKey || metaKey || altKey) return;
  if (/^[1-9]$/.test(key) || key === '0' || key === 'Backspace') {
    event.preventDefault();
    if (!repeat) {
      if (key === '0' || key === 'Backspace') applyGameAction(selectErase);
      else applyGameAction((game) => selectNumber(game, Number(key)));
    }
    return;
  }
  if (Object.hasOwn(arrowMoves, key)) {
    if (elements.hintCard.contains(event.target)) return;
    event.preventDefault();
    const [dx, dy] = arrowMoves[key];
    const column = Math.max(0, Math.min(8, colOf(focusedCell) + dx));
    const row = Math.max(0, Math.min(8, rowOf(focusedCell) + dy));
    moveFocus(row * 9 + column);
    cells[focusedCell].button.focus({ preventScroll: true });
    return;
  }
  if ((key === 'Enter' || key === ' ') && (elements.board.contains(event.target) || event.target === document.body)) {
    event.preventDefault();
    if (!repeat) activateCell(focusedCell, key === ' ' || shiftKey);
  }
});

elements.timer.addEventListener('click', () => {
  progress = { ...progress, timerHidden: !progress.timerHidden };
  renderTimer();
  persist();
});
elements.undo.addEventListener('click', () => applyGameAction(undo));
elements.erase.addEventListener('click', () => applyGameAction(selectErase));
elements.hint.addEventListener('click', requestHint);
elements.hintClose.addEventListener('click', dismissHint);
elements.hintMore.addEventListener('click', () => applyGameAction(toggleHintDetail));
elements.restart.addEventListener('click', () => {
  confirm('Start this puzzle over?', 'Restart', () => applyGameAction(restart));
});
elements.next.addEventListener('click', () => {
  confirm('Skip this puzzle? Your score goes down 5.', 'Skip puzzle', nextPuzzle);
});
elements.completionNext.addEventListener('click', nextPuzzle);
elements.retry.addEventListener('click', loadPuzzle);
elements.confirmAction.addEventListener('click', () => {
  const action = pendingAction;
  pendingAction = null;
  try {
    action?.();
  } finally {
    elements.dialog.close();
  }
});
elements.confirmCancel.addEventListener('click', cancelConfirmation);
elements.dialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelConfirmation();
});
elements.dialog.addEventListener('click', (event) => {
  if (event.target === elements.dialog && !containsPoint(elements.dialog, event)) cancelConfirmation();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelPress();
    pauseTimer();
  } else startTimer();
  renderTimer();
  persist();
});
window.addEventListener('pagehide', () => {
  cancelPress();
  pauseTimer();
  persist();
});
window.addEventListener('pageshow', () => {
  startTimer();
  renderTimer();
});
setInterval(() => {
  if (timerStartedAt !== null && Math.floor(elapsedTime() / 1000) !== lastShownSecond) {
    renderTimer();
    persist();
  }
}, 250);

navigator.serviceWorker?.register('./sw.js').catch((error) => console.warn('Service worker registration failed.', error));

if (progress.game) {
  startTimer();
  render();
  persist();
  prepareNextPuzzle();
} else void loadPuzzle();
