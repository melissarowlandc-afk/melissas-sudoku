export const ALL_DIGITS = 0x1ff;

export const rowOf = (cell) => Math.floor(cell / 9);
export const colOf = (cell) => cell % 9;
export const boxOf = (cell) => Math.floor(rowOf(cell) / 3) * 3 + Math.floor(colOf(cell) / 3);

export const cellName = (cell) => `R${rowOf(cell) + 1}C${colOf(cell) + 1}`;
export const friendlyCellName = (cell) => `row ${rowOf(cell) + 1}, column ${colOf(cell) + 1}`;

export function houseName(house) {
  if (house < 9) return `row ${house + 1}`;
  if (house < 18) return `column ${house - 8}`;
  return `box ${house - 17}`;
}

const BOX_NAMES = [
  'top-left', 'top-middle', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-middle', 'bottom-right',
];

export const friendlyBoxName = (house) => `${BOX_NAMES[house - 18]} box`;

export const CELL_HOUSES = Object.freeze(Array.from({ length: 81 }, (_, cell) =>
  Object.freeze([rowOf(cell), 9 + colOf(cell), 18 + boxOf(cell)])));

const houses = Array.from({ length: 27 }, () => []);
for (let cell = 0; cell < 81; cell++) {
  for (const house of CELL_HOUSES[cell]) houses[house].push(cell);
}
export const HOUSES = Object.freeze(houses.map((house) => Object.freeze(house)));

export const PEERS = Object.freeze(CELL_HOUSES.map((cellHouses, cell) => {
  const peers = new Set(cellHouses.flatMap((house) => HOUSES[house]));
  peers.delete(cell);
  return Object.freeze([...peers].sort((a, b) => a - b));
}));

const POPCOUNT = new Uint8Array(ALL_DIGITS + 1);
for (let mask = 1; mask <= ALL_DIGITS; mask++) {
  POPCOUNT[mask] = POPCOUNT[mask >> 1] + (mask & 1);
}

export const digitMask = (digit) => 1 << (digit - 1);
export const candidateCount = (mask) => POPCOUNT[mask];

export function maskDigits(mask) {
  const digits = [];
  while (mask) {
    const bit = mask & -mask;
    digits.push(32 - Math.clz32(bit));
    mask ^= bit;
  }
  return digits;
}

export function parseGrid(str) {
  if (typeof str !== 'string' || str.length !== 81 || /[^.0-9]/.test(str)) {
    throw new TypeError('A grid string must contain 81 digits or periods.');
  }
  return Array.from(str, (char) => char === '.' ? 0 : Number(char));
}

export function gridToString(grid) {
  return grid.map((digit) => digit || '.').join('');
}

export function isValidPlacement(grid, cell, digit) {
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 &&
    PEERS[cell]?.every((peer) => grid[peer] !== digit) === true;
}

export function computeCandidates(grid) {
  const used = new Uint16Array(27);
  for (let cell = 0; cell < 81; cell++) {
    if (!grid[cell]) continue;
    const bit = digitMask(grid[cell]);
    for (const house of CELL_HOUSES[cell]) used[house] |= bit;
  }
  return Array.from({ length: 81 }, (_, cell) => {
    if (grid[cell]) return 0;
    const [row, column, box] = CELL_HOUSES[cell];
    return ALL_DIGITS & ~(used[row] | used[column] | used[box]);
  });
}

function search(input, limit, capture, rng) {
  const result = { count: 0, solution: null };
  if (input.length !== 81 || limit <= 0) return result;

  const grid = [...input];
  const used = new Uint16Array(27);
  const empty = [];
  for (let cell = 0; cell < 81; cell++) {
    const digit = grid[cell];
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) return result;
    if (digit === 0) {
      empty.push(cell);
      continue;
    }
    const [row, column, box] = CELL_HOUSES[cell];
    const bit = digitMask(digit);
    if ((used[row] | used[column] | used[box]) & bit) return result;
    used[row] |= bit;
    used[column] |= bit;
    used[box] |= bit;
  }

  function visit(depth) {
    if (depth === empty.length) {
      result.count++;
      if (capture) result.solution = grid.slice();
      return;
    }

    let bestIndex = depth;
    let bestMask = 0;
    let bestCount = 10;
    for (let index = depth; index < empty.length; index++) {
      const [row, column, box] = CELL_HOUSES[empty[index]];
      const mask = ALL_DIGITS & ~(used[row] | used[column] | used[box]);
      const count = POPCOUNT[mask];
      if (!count) return;
      if (count < bestCount) {
        bestIndex = index;
        bestMask = mask;
        bestCount = count;
        if (count === 1) break;
      }
    }

    const cell = empty[bestIndex];
    empty[bestIndex] = empty[depth];
    empty[depth] = cell;
    const [row, column, box] = CELL_HOUSES[cell];
    while (bestMask && result.count < limit) {
      let bit = bestMask & -bestMask;
      if (rng && bestCount > 1) {
        let index = Math.floor(rng() * bestCount);
        let choices = bestMask;
        while (index-- > 0) choices &= choices - 1;
        bit = choices & -choices;
      }
      bestMask ^= bit;
      bestCount--;
      grid[cell] = 32 - Math.clz32(bit);
      used[row] |= bit;
      used[column] |= bit;
      used[box] |= bit;
      visit(depth + 1);
      used[row] ^= bit;
      used[column] ^= bit;
      used[box] ^= bit;
    }
    grid[cell] = 0;
    empty[depth] = empty[bestIndex];
    empty[bestIndex] = cell;
  }

  visit(0);
  return result;
}

export function countSolutions(grid, limit = 2) {
  return search(grid, limit, false).count;
}

export function solve(grid) {
  return search(grid, 1, true).solution;
}

export function generateSolution(rng) {
  return search(Array(81).fill(0), 1, true, rng).solution;
}
