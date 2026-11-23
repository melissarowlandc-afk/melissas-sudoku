export const START_SCORE = 20;

export const BANDS = Object.freeze([
  Object.freeze({ name: 'Medium', min: 0, max: 33 }),
  Object.freeze({ name: 'Hard', min: 34, max: 66 }),
  Object.freeze({ name: 'Expert', min: 67, max: 100 }),
]);

export function nextScore(score, { solved, hintsUsed = 0, gaveUp }) {
  let change = 0;
  if (gaveUp) change = -5;
  else if (solved) change = hintsUsed ? -Math.min(hintsUsed, 4) : 2;
  return Math.max(0, Math.min(100, score + change));
}

export const nextTarget = (score) => score;
