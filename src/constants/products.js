export const PRODUCTS = [
  { id: 1, category: "Clothing & Apparel", name: "Custom T-Shirt Printing", description: "Full-color sublimation or screen printing on quality fabric. Single to bulk orders.", price: 400, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/tshirt-cutout.png", imageFit: "contain", popular: true },
  { id: 2, category: "Clothing & Apparel", name: "Polo Shirt", description: "Embroidered or printed polo shirts — perfect for uniforms and events.", price: 500, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/polo-cutout.png", imageFit: "contain" },
  { id: 3, category: "Clothing & Apparel", name: "Hoodie / Jacket Printing", description: "Heat transfer or sublimation printing on hoodies and varsity jackets.", price: 600, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/hoodie-cutout.png", imageFit: "contain" },
  { id: 4, category: "School Supplies", name: "School ID with Lanyard", description: "PVC school ID with lamination + custom printed lanyard. Fast turnaround.", price: 65, unit: "per set", minQty: 1, image: "/image/hero/products/cutouts/school-id-cutout.png", imageFit: "contain", popular: true },
  { id: 5, category: "School Supplies", name: "Banner Design/Poster Design", description: "Custom-cover notebooks — great for giveaways and school supplies.", price: 150, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/banner-cutout.png", imageFit: "contain" },
  { id: 9, category: "Promotional Items", name: "Mug Printing", description: "Sublimation-printed ceramic mugs. Perfect for giveaways and souvenirs.", price: 150, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/mug-cutout.png", imageFit: "contain", popular: true },
  { id: 11, category: "Promotional Items", name: "Sticker Printing", description: "Die-cut or standard cut stickers — vinyl or paper-based, any design.", price: 25, unit: "per piece", minQty: 1, image: "/image/hero/products/cutouts/sticker-cutout.png", imageFit: "contain" },
];

export const CATEGORIES = ["All", "Clothing & Apparel", "School Supplies", "Tarpaulins & Banners", "Promotional Items"];

export const PAYMENT_METHODS = ["GCash", "PayMaya", "Bank Transfer (BDO/BPI)", "Credit/Debit Card"];

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
