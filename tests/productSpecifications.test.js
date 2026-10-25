import {
  getSpecificationType,
  specificationConfigFor,
  specificationSummary,
  validateSpecifications
} from '../shared/productSpecifications.js';

describe('restored product specification configuration', () => {
  it.each([
    [1, 'clothing', ['size', 'color']],
    [2, 'clothing', ['size', 'color']],
    [3, 'hoodie', ['size', 'color']],
    [4, 'schoolId', ['idSize', 'idStyle', 'lanyardColor']],
    [5, 'banner', ['width', 'height', 'unit']],
    [9, 'mug', []],
    [11, 'sticker', ['material', 'width', 'height', 'unit']]
  ])('restores legacy product %i (%s) when its stored type is general', (id, expectedType, required) => {
    const product = { id, specificationType: 'general' };
    const config = specificationConfigFor(product);

    expect(getSpecificationType(product)).toBe(expectedType);
    expect(config.required).toEqual(required);
  });

  it('requires and persists valid clothing selections in the order summary', () => {
    const product = { id: 1, specificationType: 'general' };
    expect(validateSpecifications(product, {})).toMatchObject({
      size: expect.any(String),
      color: expect.any(String)
    });
    const details = { size: 'XL', color: 'Navy' };
    expect(validateSpecifications(product, details)).toEqual({});
    expect(specificationSummary(product, details)).toBe('Size: XL\nColor: Navy');
  });

  it('uses Admin-configured fields instead of generic defaults for future products', () => {
    const product = {
      id: 40,
      specificationType: 'general',
      specificationFields: [
        { key: 'paperWeight', label: 'Paper weight', type: 'select', options: ['120 gsm', '200 gsm'], required: true }
      ]
    };

    expect(validateSpecifications(product, { paperWeight: 'Other' })).toHaveProperty('paperWeight');
    expect(validateSpecifications(product, { paperWeight: '120 gsm' })).toEqual({});
    expect(specificationSummary(product, { paperWeight: '120 gsm' })).toBe('Paper weight: 120 gsm');
  });
});
