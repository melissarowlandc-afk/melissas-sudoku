import { generatePuzzle } from './generator.js';
import { getHint } from './hints.js';

self.addEventListener('message', ({ data: { id, type, payload } }) => {
  try {
    const result = type === 'generate'
      ? generatePuzzle(payload.target, { seed: payload.seed })
      : getHint(payload);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
});
