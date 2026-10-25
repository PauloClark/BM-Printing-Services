const CLOTHING_SIZES = ["XS", "Small", "Medium", "Large", "XL", "2XL", "3XL", "4XL", "5XL"];
const HOODIE_SIZES = CLOTHING_SIZES.slice(1);
export const SPECIFICATION_CONFIG = {
  clothing: {
    fields: [
      { key: "size", label: "Size", type: "select", options: CLOTHING_SIZES, required: true },
      { key: "color", label: "Color", required: true, placeholder: "e.g. Black" }
    ],
    uploadLabel: "Upload Design / Reference",
    required: ["size", "color"]
  },
  hoodie: {
    fields: [
      { key: "size", label: "Size", type: "select", options: HOODIE_SIZES, required: true },
      { key: "color", label: "Color", required: true, placeholder: "e.g. Black" }
    ],
    uploadLabel: "Upload Design / Reference",
    required: ["size", "color"]
  },
  schoolId: {
    fields: [
      { key: "studentName", label: "Customer / Student Name", placeholder: "Name to print on the ID" },
      { key: "idSize", label: "ID size", required: true },
      { key: "idStyle", label: "Lanyard style / type", required: true, placeholder: "e.g. PVC ID, preferred lanyard design" },
      { key: "lanyardColor", label: "Preferred Lanyard Color", required: true }
    ],
    uploadLabel: "Upload Photo / Design Reference",
    required: ["idSize", "idStyle", "lanyardColor"]
  },
  banner: {
    fields: [
      { key: "width", label: "Width", type: "number", min: "0.1", step: "any", required: true },
      { key: "height", label: "Height", type: "number", min: "0.1", step: "any", required: true },
      { key: "unit", label: "Unit", type: "select", options: ["cm", "inches", "feet", "meters"], required: true },
      { key: "orientation", label: "Orientation", type: "select", options: ["Portrait", "Landscape"] }
    ],
    uploadLabel: "Upload Design / Reference",
    required: ["width", "height", "unit"]
  },
  mug: {
    fields: [
      { key: "mugVariant", label: "Mug Color / Variant", type: "select", options: ["White", "Black", "Color-changing", "Other"] }
    ],
    uploadLabel: "Upload Design / Reference",
    required: []
  },
  sticker: {
    fields: [
      { key: "material", label: "Sticker material", type: "select", options: ["Vinyl", "Paper"], required: true },
      { key: "width", label: "Width", type: "number", min: "0.1", step: "any", required: true },
      { key: "height", label: "Height", type: "number", min: "0.1", step: "any", required: true },
      { key: "unit", label: "Unit", type: "select", options: ["mm", "cm", "inches"], required: true }
    ],
    uploadLabel: "Upload Design / Reference",
    required: ["material", "width", "height", "unit"]
  },
  backdrop: {
    fields: [
      { key: "width", label: "Width", type: "number", min: "0.1", step: "any", required: true },
      { key: "height", label: "Height", type: "number", min: "0.1", step: "any", required: true },
      { key: "unit", label: "Unit", type: "select", options: ["cm", "inches", "feet", "meters"], required: true }
    ],
    uploadLabel: "Upload Design / Reference",
    required: ["width", "height", "unit"]
  },
  general: {
    fields: [],
    uploadLabel: "Upload Design / Reference",
    required: []
  }
};


// Stable original catalog IDs restore records whose legacy default was general.
const LEGACY_TYPES = { 1: 'clothing', 2: 'clothing', 3: 'hoodie', 4: 'schoolId', 5: 'banner', 9: 'mug', 11: 'sticker' };
export function getSpecificationType(product) {
  const configured = product?.specificationType;
  if (configured && configured !== 'general' && SPECIFICATION_CONFIG[configured]) return configured;
  return LEGACY_TYPES[product?.id] || 'general';
}
export function specificationConfigFor(product) {
  const fields = product?.specificationFields;
  if (Array.isArray(fields) && fields.length) return { fields, required: fields.filter(f => f.required).map(f => f.key), uploadLabel: 'Upload Design / Reference' };
  return SPECIFICATION_CONFIG[getSpecificationType(product)];
}
export function validateSpecifications(product, details = {}) {
  const errors = {};
  for (const field of specificationConfigFor(product).fields) {
    const value = typeof details[field.key] === 'string' || typeof details[field.key] === 'number' ? String(details[field.key]).trim() : '';
    if (field.required && !value) errors[field.key] = field.label + ' is required.';
    else if (value && (value.length > 500 || (field.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) || (field.type === 'select' && !field.options.includes(value)))) errors[field.key] = 'Choose a valid ' + field.label + '.';
  }
  return errors;
}
export function specificationSummary(product, details = {}) {
  return specificationConfigFor(product).fields.filter(f => String(details[f.key] || '').trim()).map(f => f.label + ': ' + String(details[f.key]).trim()).join('\n');
}
