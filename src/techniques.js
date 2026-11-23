import {
  ALL_DIGITS, CELL_HOUSES, HOUSES, PEERS, boxOf, candidateCount, colOf,
  digitMask, friendlyBoxName, friendlyCellName, houseName, maskDigits, rowOf,
} from './sudoku.js';

const SEES = PEERS.map((peers) => {
  const seen = new Uint8Array(81);
  for (const peer of peers) seen[peer] = 1;
  return seen;
});

const listFormat = new Intl.ListFormat('en-US');
const namesOf = (cells) => listFormat.format(cells.map(friendlyCellName));
const cellsAt = (house, mask) => maskDigits(mask).map((position) => HOUSES[house][position - 1]);
const bitDigit = (bit) => 32 - Math.clz32(bit);

function housePositions(candidates) {
  return HOUSES.map((cells) => {
    const positions = new Uint16Array(9);
    for (let position = 0; position < 9; position++) {
      let digits = candidates[cells[position]];
      while (digits) {
        const bit = digits & -digits;
        positions[bitDigit(bit) - 1] |= 1 << position;
        digits ^= bit;
      }
    }
    return positions;
  });
}

function strongLinks(positions) {
  const byDigit = Array.from({ length: 9 }, () => []);
  for (let house = 0; house < 27; house++) {
    for (let index = 0; index < 9; index++) {
      const places = positions[house][index];
      if (candidateCount(places) === 2) {
        byDigit[index].push({ house, cells: cellsAt(house, places) });
      }
    }
  }
  return byDigit;
}

function joiningHouses(pairs) {
  const houses = new Set();
  for (const [a, b] of pairs) {
    for (const house of CELL_HOUSES[a]) {
      if (CELL_HOUSES[b].includes(house)) houses.add(house);
    }
  }
  return [...houses];
}

function removeFrom(candidates, cells, mask) {
  const eliminations = [];
  for (const cell of cells) {
    for (const digit of maskDigits(candidates[cell] & mask)) eliminations.push({ cell, digit });
  }
  return eliminations;
}

function sharedEliminations(candidates, digit, pattern, first, ...others) {
  const bit = digitMask(digit);
  return PEERS[first].filter((cell) =>
    (candidates[cell] & bit) && !pattern.includes(cell) && others.every((other) => SEES[other][cell]))
    .map((cell) => ({ cell, digit }));
}

function fullHouse({ grid, candidates }) {
  for (let house = 0; house < 27; house++) {
    let blank = -1;
    let present = 0;
    for (const cell of HOUSES[house]) {
      if (grid[cell]) present |= digitMask(grid[cell]);
      else if (blank === -1) blank = cell;
      else {
        blank = -1;
        break;
      }
    }
    const missing = ALL_DIGITS ^ present;
    if (blank === -1 || candidateCount(missing) !== 1 || !(candidates[blank] & missing)) continue;
    const digit = bitDigit(missing);
    return {
      pattern: [blank], houses: [house], digits: [digit], placements: [{ cell: blank, digit }],
      summary: `Look at the only empty square in ${houseName(house)}.`,
      reason: `${digit} is the only digit missing from ${houseName(house)}.`,
    };
  }
  return null;
}

function nakedSingle({ candidates }) {
  const cell = candidates.findIndex((mask) => candidateCount(mask) === 1);
  if (cell === -1) return null;
  const digit = bitDigit(candidates[cell]);
  return {
    pattern: [cell], houses: [...CELL_HOUSES[cell]], digits: [digit], placements: [{ cell, digit }],
    summary: `Check which digit is still possible at ${friendlyCellName(cell)}.`,
    reason: `Only ${digit} is possible at ${friendlyCellName(cell)}.`,
  };
}

function hiddenSingle({ positions }) {
  for (let house = 0; house < 27; house++) {
    for (let index = 0; index < 9; index++) {
      const places = positions[house][index];
      if (candidateCount(places) !== 1) continue;
      const cell = HOUSES[house][bitDigit(places) - 1];
      const digit = index + 1;
      return {
        pattern: [cell], houses: [house], digits: [digit], placements: [{ cell, digit }],
        summary: `Look for a digit with only one possible square in ${houseName(house)}.`,
        reason: `The square at ${friendlyCellName(cell)} is the only place for ${digit} in ${houseName(house)}.`,
      };
    }
  }
  return null;
}

function pointing({ candidates, positions }) {
  for (let box = 18; box < 27; box++) {
    for (let index = 0; index < 9; index++) {
      const places = positions[box][index];
      const count = candidateCount(places);
      if (count < 2 || count > 3) continue;
      const pattern = cellsAt(box, places);
      const [row, column] = CELL_HOUSES[pattern[0]];
      for (const line of [row, column]) {
        if (!pattern.every((cell) => CELL_HOUSES[cell].includes(line))) continue;
        const eliminations = removeFrom(candidates, HOUSES[line].filter((cell) => boxOf(cell) !== box - 18), 1 << index);
        if (!eliminations.length) continue;
        const digit = index + 1;
        return {
          pattern, houses: [box, line], digits: [digit], eliminations,
          summary: `Look at how the highlighted squares in the ${friendlyBoxName(box)} line up in ${houseName(line)}.`,
          reason: `In the ${friendlyBoxName(box)}, ${digit} can only go in ${namesOf(pattern)}. Those squares are all in ${houseName(line)}, so that line gets its ${digit} inside the box.`,
        };
      }
    }
  }
  return null;
}

function claiming({ candidates, positions }) {
  for (let line = 0; line < 18; line++) {
    for (let index = 0; index < 9; index++) {
      const places = positions[line][index];
      const count = candidateCount(places);
      if (count < 2 || count > 3) continue;
      const pattern = cellsAt(line, places);
      const box = boxOf(pattern[0]);
      if (!pattern.every((cell) => boxOf(cell) === box)) continue;
      const eliminations = removeFrom(candidates, HOUSES[box + 18].filter((cell) => !CELL_HOUSES[cell].includes(line)), 1 << index);
      if (!eliminations.length) continue;
      const digit = index + 1;
      return {
        pattern, houses: [line, box + 18], digits: [digit], eliminations,
        summary: `Look at the highlighted squares where ${houseName(line)} crosses the ${friendlyBoxName(box + 18)}.`,
        reason: `In ${houseName(line)}, ${digit} can only go in ${namesOf(pattern)}. Those squares are in the same box, so that box gets its ${digit} on that line.`,
      };
    }
  }
  return null;
}

// Search for a size-item combination whose union also has exactly size bits.
function firstUnion(items, size, visit) {
  const chosen = [];
  function choose(start, union) {
    if (chosen.length === size) {
      return candidateCount(union) === size ? visit(chosen, union) : null;
    }
    const lastStart = items.length - (size - chosen.length);
    for (let index = start; index <= lastStart; index++) {
      const item = items[index];
      const combined = union | item.mask;
      if (candidateCount(combined) > size) continue;
      chosen.push(item);
      const result = choose(index + 1, combined);
      if (result) return result;
      chosen.pop();
    }
    return null;
  }
  return choose(0, 0);
}

function subsetSize(mask, size) {
  const count = candidateCount(mask);
  return count >= 2 && count <= size;
}

function nakedSubset({ candidates }, size) {
  for (let house = 0; house < 27; house++) {
    const cells = HOUSES[house];
    const items = cells.filter((cell) => subsetSize(candidates[cell], size))
      .map((cell) => ({ cell, mask: candidates[cell] }));
    const step = firstUnion(items, size, (selected, mask) => {
      const pattern = selected.map(({ cell }) => cell);
      const eliminations = removeFrom(candidates, cells.filter((cell) => !pattern.includes(cell)), mask);
      if (!eliminations.length) return null;
      const digits = maskDigits(mask);
      return {
        pattern, houses: [house], digits, eliminations,
        summary: `In ${houseName(house)}, compare the candidate lists in the highlighted squares.`,
        reason: `Between them, the squares at ${namesOf(pattern)} can only contain ${listFormat.format(digits.map(String))}. Those digits are taken, so they can't go elsewhere in ${houseName(house)}.`,
      };
    });
    if (step) return step;
  }
  return null;
}

function hiddenSubset({ candidates, positions }, size) {
  for (let house = 0; house < 27; house++) {
    const items = Array.from(positions[house], (mask, index) => ({ digit: index + 1, mask }))
      .filter(({ mask }) => subsetSize(mask, size));
    const step = firstUnion(items, size, (selected, places) => {
      const pattern = cellsAt(house, places);
      const digits = selected.map(({ digit }) => digit);
      const keep = digits.reduce((mask, digit) => mask | digitMask(digit), 0);
      const eliminations = removeFrom(candidates, pattern, ALL_DIGITS ^ keep);
      if (!eliminations.length) return null;
      return {
        pattern, houses: [house], digits, eliminations,
        summary: `Look for digits that have to share the highlighted squares in ${houseName(house)}.`,
        reason: `In ${houseName(house)}, ${listFormat.format(digits.map(String))} can only go in ${namesOf(pattern)}. They take up those squares, so you can cross out the other candidates there.`,
      };
    });
    if (step) return step;
  }
  return null;
}

const lineGroup = (offset) => offset === 0 ? 'rows' : 'columns';

function fish({ candidates, positions }, size) {
  for (let index = 0; index < 9; index++) {
    for (const offset of [0, 9]) {
      const coverOffset = 9 - offset;
      const baseHouseIndex = offset === 0 ? 0 : 1;
      const items = Array.from({ length: 9 }, (_, line) => ({ house: offset + line, mask: positions[offset + line][index] }))
        .filter(({ mask }) => subsetSize(mask, size));
      const step = firstUnion(items, size, (selected, places) => {
        const bases = selected.map(({ house }) => house);
        const covers = maskDigits(places).map((position) => coverOffset + position - 1);
        const outside = covers.flatMap((house) => HOUSES[house]
          .filter((cell) => !bases.includes(CELL_HOUSES[cell][baseHouseIndex])));
        const eliminations = removeFrom(candidates, outside, 1 << index);
        if (!eliminations.length) return null;
        const digit = index + 1;
        const pattern = selected.flatMap(({ house, mask }) => cellsAt(house, mask));
        return {
          pattern, houses: [...bases, ...covers], digits: [digit], eliminations,
          summary: `Trace how the highlighted squares line up across ${lineGroup(offset)} and ${lineGroup(coverOffset)}.`,
          reason: `In ${listFormat.format(bases.map(houseName))}, the only places for ${digit} are ${namesOf(pattern)}. They span exactly ${size} ${lineGroup(coverOffset)}, so each of those ${lineGroup(coverOffset)} gets its ${digit} in a highlighted square.`,
        };
      });
      if (step) return step;
    }
  }
  return null;
}

function skyscraper({ candidates, positions }) {
  for (let index = 0; index < 9; index++) {
    for (const offset of [0, 9]) {
      for (let a = offset; a < offset + 8; a++) {
        const placesA = positions[a][index];
        if (candidateCount(placesA) !== 2) continue;
        for (let b = a + 1; b < offset + 9; b++) {
          const placesB = positions[b][index];
          const aligned = placesA & placesB;
          if (candidateCount(placesB) !== 2 || candidateCount(aligned) !== 1) continue;
          const [baseA] = cellsAt(a, aligned);
          const [baseB] = cellsAt(b, aligned);
          const [endA] = cellsAt(a, placesA ^ aligned);
          const [endB] = cellsAt(b, placesB ^ aligned);
          const pattern = [endA, baseA, baseB, endB];
          const digit = index + 1;
          const eliminations = sharedEliminations(candidates, digit, pattern, endA, endB);
          if (!eliminations.length) continue;
          const cross = 9 - offset + bitDigit(aligned) - 1;
          return {
            pattern, houses: [a, b, cross], digits: [digit], eliminations,
            summary: `Find the two highlighted squares that line up in ${houseName(cross)}, then follow each pair to its other end.`,
            reason: `There are two places for ${digit} in ${houseName(a)} and two in ${houseName(b)}. The squares at ${namesOf([baseA, baseB])} share ${houseName(cross)} and can't both contain ${digit}. At least one of the other ends at ${namesOf([endA, endB])} must contain it.`,
          };
        }
      }
    }
  }
  return null;
}

function twoStringKite({ candidates, links }) {
  for (let index = 0; index < 9; index++) {
    const rowLinks = links[index].filter(({ house }) => house < 9);
    const columnLinks = links[index].filter(({ house }) => house >= 9 && house < 18);
    for (const row of rowLinks) {
      for (const column of columnLinks) {
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            const nearA = row.cells[a];
            const nearB = column.cells[b];
            const endA = row.cells[1 - a];
            const endB = column.cells[1 - b];
            const box = boxOf(nearA);
            if (nearA === nearB || boxOf(nearB) !== box || boxOf(endA) === box || boxOf(endB) === box || endA === endB) continue;
            const pattern = [endA, nearA, nearB, endB];
            const digit = index + 1;
            const eliminations = sharedEliminations(candidates, digit, pattern, endA, endB);
            if (!eliminations.length) continue;
            return {
              pattern, houses: [row.house, column.house, box + 18], digits: [digit], eliminations,
              summary: `Find the highlighted row and column pairs with one square each in the ${friendlyBoxName(box + 18)}.`,
              reason: `There are two places for ${digit} in ${houseName(row.house)} and two in ${houseName(column.house)}. The squares at ${namesOf([nearA, nearB])} share a box and can't both contain ${digit}. At least one of the other ends at ${namesOf([endA, endB])} must contain it.`,
            };
          }
        }
      }
    }
  }
  return null;
}

function xyWing({ candidates }, pivotSize) {
  for (let pivot = 0; pivot < 81; pivot++) {
    const pivotMask = candidates[pivot];
    if (candidateCount(pivotMask) !== pivotSize) continue;
    const pincers = PEERS[pivot].filter((cell) => candidateCount(candidates[cell]) === 2 && candidates[cell] !== pivotMask);
    for (let i = 0; i < pincers.length - 1; i++) {
      const a = pincers[i];
      const maskA = candidates[a];
      for (let j = i + 1; j < pincers.length; j++) {
        const b = pincers[j];
        const maskB = candidates[b];
        const shared = maskA & maskB;
        const union = pivotMask | maskA | maskB;
        if (candidateCount(shared) !== 1 || candidateCount(union) !== 3) continue;
        if ((pivotSize === 2 && (shared & pivotMask)) || (pivotSize === 3 && union !== pivotMask)) continue;
        const pattern = [pivot, a, b];
        const digit = bitDigit(shared);
        const mustSee = pivotSize === 3 ? [b, pivot] : [b];
        const eliminations = sharedEliminations(candidates, digit, pattern, a, ...mustSee);
        if (!eliminations.length) continue;
        const pivotName = friendlyCellName(pivot);
        const forces = `If the square at ${pivotName} contains ${bitDigit(maskA ^ shared)}, ${friendlyCellName(a)} must contain ${digit}. If that first square contains ${bitDigit(maskB ^ shared)}, ${friendlyCellName(b)} must contain ${digit}.`;
        const reason = pivotSize === 2
          ? `${forces} A square that shares a row, column, or box with each of those two outer squares can't contain ${digit}.`
          : `${forces} The first square could also contain ${digit}. A square that shares a row, column, or box with each of the three highlighted squares can't contain ${digit}.`;
        return {
          pattern, houses: joiningHouses([[pivot, a], [pivot, b]]), digits: maskDigits(union), eliminations,
          summary: `Compare the candidates at ${pivotName} with those in the other two highlighted squares.`, reason,
        };
      }
    }
  }
  return null;
}

function wWing({ candidates, links }) {
  for (let a = 0; a < 80; a++) {
    const mask = candidates[a];
    if (candidateCount(mask) !== 2) continue;
    for (let b = a + 1; b < 81; b++) {
      if (candidates[b] !== mask || SEES[a][b]) continue;
      const digits = maskDigits(mask);
      for (const linkDigit of digits) {
        const digit = bitDigit(mask ^ digitMask(linkDigit));
        const eliminations = sharedEliminations(candidates, digit, [a, b], a, b);
        if (!eliminations.length) continue;
        for (const { house, cells: [u, v] } of links[linkDigit - 1]) {
          const ordered = SEES[a][u] && SEES[b][v];
          if (!ordered && !(SEES[a][v] && SEES[b][u])) continue;
          const [nearA, nearB] = ordered ? [u, v] : [v, u];
          const pattern = [a, nearA, nearB, b];
          return {
            pattern, houses: [...new Set([house, ...joiningHouses([[a, nearA], [nearB, b]])])], digits, eliminations,
            summary: `Look for two highlighted squares with the same pair of candidates, then trace the link between them.`,
            reason: `In ${houseName(house)}, ${linkDigit} must go in either ${friendlyCellName(nearA)} or ${friendlyCellName(nearB)}. Either choice rules out ${linkDigit} in one of the matching squares at ${namesOf([a, b])}, so at least one of them must contain ${digit}.`,
          };
        }
      }
    }
  }
  return null;
}

function colorComponent(candidates, digit, start, graph, colors) {
  const pattern = [start];
  const houses = new Set();
  let consistent = true;
  colors[start] = 0;
  for (let position = 0; position < pattern.length; position++) {
    const cell = pattern[position];
    for (const { peer, house } of graph[cell]) {
      houses.add(house);
      if (colors[peer] === -1) {
        colors[peer] = 1 - colors[cell];
        pattern.push(peer);
      } else if (colors[peer] === colors[cell]) {
        consistent = false;
      }
    }
  }
  if (!consistent) return null;

  const groups = [[], []];
  for (const cell of pattern) groups[colors[cell]].push(cell);
  const summary = 'Follow the connections between the highlighted squares, imagining two colors that alternate at each link.';
  const linkReason = `Start at ${friendlyCellName(start)}. Each link joins two squares that are the only places for ${digit} in a row, column, or box. Use opposite colors for the two squares at each link. One color marks squares that contain ${digit}, and the other marks squares that rule it out.`;
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      const conflict = group.slice(i + 1).find((cell) => SEES[a][cell]);
      if (conflict === undefined) continue;
      return {
        pattern, houses: [...new Set([...houses, ...joiningHouses([[a, conflict]])])], digits: [digit],
        eliminations: group.map((cell) => ({ cell, digit })), summary,
        reason: `${linkReason} The squares at ${namesOf([a, conflict])} have the same color and share a row, column, or box. They can't both contain ${digit}, so that color rules it out.`,
      };
    }
  }

  const inside = new Set(pattern);
  const bit = digitMask(digit);
  const eliminations = [];
  for (let cell = 0; cell < 81; cell++) {
    if (!(candidates[cell] & bit) || inside.has(cell)) continue;
    if (groups.every((group) => group.some((other) => SEES[other][cell]))) eliminations.push({ cell, digit });
  }
  if (!eliminations.length) return null;
  return {
    pattern, houses: [...houses], digits: [digit], eliminations, summary,
    reason: `${linkReason} Any square outside this pattern that shares a row, column, or box with a square of each color can't contain ${digit}.`,
  };
}

function simpleColoring({ candidates, links }) {
  for (let index = 0; index < 9; index++) {
    const graph = Array.from({ length: 81 }, () => []);
    for (const { house, cells: [a, b] } of links[index]) {
      graph[a].push({ peer: b, house });
      graph[b].push({ peer: a, house });
    }
    const colors = new Int8Array(81).fill(-1);
    for (let start = 0; start < 81; start++) {
      if (!graph[start].length || colors[start] !== -1) continue;
      const step = colorComponent(candidates, index + 1, start, graph, colors);
      if (step) return step;
    }
  }
  return null;
}

function uniqueRectangle({ candidates }) {
  for (let rowA = 0; rowA < 8; rowA++) {
    for (let rowB = rowA + 1; rowB < 9; rowB++) {
      const sameBand = Math.floor(rowA / 3) === Math.floor(rowB / 3);
      for (let colA = 0; colA < 8; colA++) {
        for (let colB = colA + 1; colB < 9; colB++) {
          // Exactly two boxes are needed for swapping the two digits to preserve them.
          if (sameBand === (Math.floor(colA / 3) === Math.floor(colB / 3))) continue;
          const pattern = [rowA * 9 + colA, rowA * 9 + colB, rowB * 9 + colA, rowB * 9 + colB];
          const pairs = pattern.filter((cell) => candidateCount(candidates[cell]) === 2);
          if (pairs.length !== 3) continue;
          const mask = candidates[pairs[0]];
          if (!pairs.every((cell) => candidates[cell] === mask)) continue;
          const extra = pattern.find((cell) => (candidates[cell] & mask) === mask && candidates[cell] !== mask);
          if (extra === undefined) continue;
          const digits = maskDigits(mask);
          return {
            pattern,
            houses: [rowA, rowB, 9 + colA, 9 + colB, ...new Set(pattern.map((cell) => boxOf(cell) + 18))],
            digits, eliminations: digits.map((digit) => ({ cell: extra, digit })),
            summary: `Compare the candidates in the four highlighted squares that form a rectangle across two boxes.`,
            reason: `The three corners at ${namesOf(pairs)} are limited to ${listFormat.format(digits.map(String))}. If the fourth corner at ${friendlyCellName(extra)} used either digit, the two digits would alternate around the rectangle. Swapping them would keep the same digits in each row, column, and box and give a second solution. The fourth corner needs a different digit.`,
          };
        }
      }
    }
  }
  return null;
}

const MAX_XY_CHAIN = 8;

function xyChain({ candidates }) {
  const bivalue = candidates.map((mask) => candidateCount(mask) === 2);
  const neighbors = PEERS.map((peers, cell) => bivalue[cell] ? peers.filter((peer) => bivalue[peer]) : []);

  for (let start = 0; start < 81; start++) {
    if (!bivalue[start]) continue;
    for (const digit of maskDigits(candidates[start])) {
      const endBit = digitMask(digit);
      const path = [start];

      function extend(cell, linkBit) {
        if (path.length >= 4 && linkBit === endBit) {
          const eliminations = sharedEliminations(candidates, digit, path, start, cell);
          if (eliminations.length) {
            const pairs = path.slice(1).map((next, index) => [path[index], next]);
            return {
              pattern: path.slice(), houses: joiningHouses(pairs),
              digits: maskDigits(path.reduce((mask, member) => mask | candidates[member], 0)), eliminations,
              summary: 'Follow the shared candidates through the highlighted squares.',
              reason: `Trace the chain through ${namesOf(path)} in that order. If the first square doesn't contain ${digit}, its other candidate rules out that choice in the next square. Then each square forces the next choice until the last square must contain ${digit}. A square that shares a row, column, or box with each end can't contain ${digit}.`,
            };
          }
        }
        if (path.length === MAX_XY_CHAIN) return null;
        for (const next of neighbors[cell]) {
          if (!(candidates[next] & linkBit) || path.includes(next)) continue;
          path.push(next);
          const step = extend(next, candidates[next] ^ linkBit);
          if (step) return step;
          path.pop();
        }
        return null;
      }

      const step = extend(start, candidates[start] ^ endBit);
      if (step) return step;
    }
  }
  return null;
}

const METHODS = [
  ['full-house', 'Full House', 1, 1, fullHouse],
  ['naked-single', 'Naked Single', 1, 2, nakedSingle],
  ['hidden-single', 'Hidden Single', 1, 4, hiddenSingle],
  ['pointing', 'Pointing', 2, 8, pointing],
  ['claiming', 'Claiming', 2, 9, claiming],
  ['naked-pair', 'Naked Pair', 3, 14, (state) => nakedSubset(state, 2)],
  ['hidden-pair', 'Hidden Pair', 3, 16, (state) => hiddenSubset(state, 2)],
  ['naked-triple', 'Naked Triple', 3, 18, (state) => nakedSubset(state, 3)],
  ['hidden-triple', 'Hidden Triple', 3, 20, (state) => hiddenSubset(state, 3)],
  ['naked-quad', 'Naked Quad', 4, 24, (state) => nakedSubset(state, 4)],
  ['hidden-quad', 'Hidden Quad', 4, 26, (state) => hiddenSubset(state, 4)],
  ['x-wing', 'X-Wing', 4, 29, (state) => fish(state, 2)],
  ['swordfish', 'Swordfish', 5, 37, (state) => fish(state, 3)],
  ['skyscraper', 'Skyscraper', 5, 39, skyscraper],
  ['two-string-kite', 'Two-String Kite', 5, 41, twoStringKite],
  ['xy-wing', 'XY-Wing', 5, 43, (state) => xyWing(state, 2)],
  ['xyz-wing', 'XYZ-Wing', 5, 45, (state) => xyWing(state, 3)],
  ['w-wing', 'W-Wing', 5, 47, wWing],
  ['simple-coloring', 'Simple Coloring', 5, 49, simpleColoring],
  ['jellyfish', 'Jellyfish', 6, 56, (state) => fish(state, 4)],
  ['unique-rectangle-type-1', 'Unique Rectangle Type 1', 6, 60, uniqueRectangle],
  ['xy-chain', 'XY-Chain', 6, 64, xyChain],
];

export const TECHNIQUES = Object.freeze(METHODS.map(([id, name, tier, weight]) =>
  Object.freeze({ id, name, tier, weight })));

export function findStep(grid, candidates, { maxTier = 6, technique, assumeUnique = true } = {}) {
  let positions;
  let links;
  const state = {
    grid, candidates,
    get positions() { return positions ??= housePositions(candidates); },
    get links() { return links ??= strongLinks(this.positions); },
  };

  for (const [id, name, tier, , find] of METHODS) {
    if (tier > maxTier) break;
    if (technique && id !== technique) continue;
    if (!assumeUnique && id === 'unique-rectangle-type-1') continue;
    const result = find(state);
    if (!result) continue;
    const { pattern, houses, digits, placements = [], eliminations = [], summary, reason } = result;
    const place = placements.map(({ cell, digit }) => `${digit} in ${friendlyCellName(cell)}`);
    const removalsByDigit = new Map();
    for (const { cell, digit } of eliminations) {
      if (!removalsByDigit.has(digit)) removalsByDigit.set(digit, []);
      removalsByDigit.get(digit).push(cell);
    }
    const remove = Array.from(removalsByDigit, ([digit, cells]) => `Remove ${digit} from ${namesOf(cells)}.`);
    const detail = [reason, place.length && `Place ${listFormat.format(place)}.`, ...remove]
      .filter(Boolean).join(' ');
    return { technique: id, name, tier, pattern, houses, digits, placements, eliminations, summary, detail };
  }
  return null;
}

export function applyStep(grid, candidates, { placements, eliminations }) {
  const nextGrid = grid.slice();
  const nextCandidates = candidates.slice();
  for (const { cell, digit } of placements) {
    nextGrid[cell] = digit;
    nextCandidates[cell] = 0;
    const keep = ~digitMask(digit);
    for (const peer of PEERS[cell]) nextCandidates[peer] &= keep;
  }
  for (const { cell, digit } of eliminations) nextCandidates[cell] &= ~digitMask(digit);
  return { grid: nextGrid, candidates: nextCandidates };
}
