import { PAYMENT_METHODS, PRODUCT_CATALOG } from '../../shared/productCatalog.js';
import { publicAsset } from '../utils/assets.js';

export { PAYMENT_METHODS };

export const PRODUCTS = PRODUCT_CATALOG.map(product => ({
  ...product,
  image: publicAsset(product.image)
}));

export const CATEGORIES = ["All", "Clothing & Apparel", "School Supplies", "Tarpaulins & Banners", "Promotional Items"];

export const STATUS_LIST = ["Pending", "Confirmed", "Processing", "Ready for Pickup", "Completed", "Cancelled"];

export const STATUS_COLORS = {
  "Pending": { bg: "#fef3e2", color: "#b45309" },
  "Confirmed": { bg: "#e3f0fc", color: "#1565c0" },
  "Processing": { bg: "#e8f5ff", color: "#0277bd" },
  "Ready for Pickup": { bg: "#f3e5f5", color: "#6a1b9a" },
  "Picked Up": { bg: "#e6f5ec", color: "#1a7a3a" },
  "Completed": { bg: "#e6f5ec", color: "#1a7a3a" },
  "Cancelled": { bg: "#fce8e8", color: "#c62828" },
};
