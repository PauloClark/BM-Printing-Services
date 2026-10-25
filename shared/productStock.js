export const PRODUCT_LOW_STOCK_MAX = 5;

export function productAvailability(product) {
  if (!product?.active) return { code: 'inactive', label: 'Inactive' };
  if (!product.trackStock) return { code: 'made-to-order', label: 'Made to Order' };
  const stock = Number(product.stock || 0);
  if (stock <= 0) return { code: 'out-of-stock', label: 'Out of Stock' };
  if (stock <= Number(product.lowStockThreshold ?? PRODUCT_LOW_STOCK_MAX)) return { code: 'low-stock', label: `Low Stock: ${stock} left` };
  return { code: 'in-stock', label: `In Stock: ${stock} available` };
}
