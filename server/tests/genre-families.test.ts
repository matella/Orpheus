import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadGenreFamilies,
  getGenreFamilies,
  classifyGenre,
  familyLabel,
  OTHER_FAMILY_ID,
} from '../src/intelligence/genre-families.js';

beforeAll(() => loadGenreFamilies());

describe('classifyGenre', () => {
  it.each([
    ['k-pop', 'k-pop'],
    ['k-pop girl group', 'k-pop'],
    ['K-Pop Boy Group', 'k-pop'],
    ['korean r&b', 'k-pop'],
    ['k-rap', 'k-pop'],
    ['j-pop', 'j-pop'],
    ['anime', 'j-pop'],
    ['dance pop', 'pop'],
    ['alternative r&b', 'r&b'],
    ['melodic drill', 'hip-hop'],
    ['deep house', 'house'],
    ['modern rock', 'rock'],
  ])('%s → %s', (genre, family) => {
    expect(classifyGenre(genre)).toBe(family);
  });

  it('puts unknown genres in "other"', () => {
    expect(classifyGenre('gregorian chant xyz')).toBe(OTHER_FAMILY_ID);
  });
});

describe('families', () => {
  it('loads families in file order with k-pop first', () => {
    const families = getGenreFamilies();
    expect(families.length).toBeGreaterThanOrEqual(20);
    expect(families[0]).toMatchObject({ id: 'k-pop', label: 'K-pop' });
  });

  it('labels', () => {
    expect(familyLabel('k-pop')).toBe('K-pop');
    expect(familyLabel(OTHER_FAMILY_ID)).toBe('Other');
    expect(familyLabel('nope')).toBe('nope');
  });
});
