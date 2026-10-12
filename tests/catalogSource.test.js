import { catalogSource } from '../src/utils/catalogSource.js';

const legacy = [{ id: 1 }, { id: 2 }];

describe('catalog compatibility source', () => {
  it('restores the legacy catalog for an older successful empty API response', () => {
    expect(catalogSource({ products: [] }, legacy)).toBe(legacy);
  });

  it('uses the legacy catalog when the server explicitly reports an unconfigured collection', () => {
    expect(catalogSource({ products: [], catalogConfigured: false }, legacy)).toBe(legacy);
  });

  it('preserves an intentionally empty managed catalog', () => {
    expect(catalogSource({ products: [], catalogConfigured: true }, legacy)).toEqual([]);
  });

  it('uses managed records from both old and new server response shapes', () => {
    const managed = [{ id: 9 }];
    expect(catalogSource({ products: managed }, legacy)).toBe(managed);
    expect(catalogSource({ products: managed, catalogConfigured: true }, legacy)).toBe(managed);
  });
});
