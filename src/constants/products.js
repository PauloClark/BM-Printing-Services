export const PRODUCTS = [
  { id: 1, category: "Clothing & Apparel", name: "Custom T-Shirt Printing", description: "Full-color sublimation or screen printing on quality fabric. Single to bulk orders.", price: 180, unit: "per piece", minQty: 1, image: "👕", popular: true },
  { id: 2, category: "Clothing & Apparel", name: "Polo Shirt", description: "Embroidered or printed polo shirts — perfect for uniforms and events.", price: 350, unit: "per piece", minQty: 5, image: "👔" },
  { id: 3, category: "Clothing & Apparel", name: "Hoodie / Jacket Printing", description: "Heat transfer or sublimation printing on hoodies and varsity jackets.", price: 550, unit: "per piece", minQty: 3, image: "🧥" },
  { id: 4, category: "School Supplies", name: "School ID with Lanyard", description: "PVC school ID with lamination + custom printed lanyard. Fast turnaround.", price: 65, unit: "per set", minQty: 10, image: "🪪", popular: true },
  { id: 5, category: "School Supplies", name: "Notebook / Journal Printing", description: "Custom-cover notebooks — great for giveaways and school supplies.", price: 95, unit: "per piece", minQty: 20, image: "📓" },
  { id: 6, category: "School Supplies", name: "Tote Bag Printing", description: "Sublimation-printed canvas or non-woven tote bags. Eco-friendly option.", price: 120, unit: "per piece", minQty: 10, image: "🛍️" },
  { id: 7, category: "Tarpaulins & Banners", name: "Tarpaulin Printing (per sqm)", description: "High-resolution full-color tarpaulin for events, stores, and announcements.", price: 45, unit: "per sqm", minQty: 1, image: "🖼️", popular: true },
  { id: 8, category: "Tarpaulins & Banners", name: "Pull-Up / Roll-Up Banner", description: "Premium pull-up banner with stand — ready to display anytime.", price: 850, unit: "per piece", minQty: 1, image: "📢" },
  { id: 9, category: "Promotional Items", name: "Mug Printing", description: "Sublimation-printed ceramic mugs. Perfect for giveaways and souvenirs.", price: 150, unit: "per piece", minQty: 6, image: "☕", popular: true },
  { id: 10, category: "Promotional Items", name: "Keychain / Button Pin", description: "Custom-designed keychains or button pins for events and giveaways.", price: 35, unit: "per piece", minQty: 20, image: "🔑" },
  { id: 11, category: "Promotional Items", name: "Sticker Printing", description: "Die-cut or standard cut stickers — vinyl or paper-based, any design.", price: 25, unit: "per piece", minQty: 50, image: "🏷️" },
  { id: 12, category: "Tarpaulins & Banners", name: "Event Backdrop / Streamer", description: "Large-format event backdrops, photo wall streamers, and step-and-repeat designs.", price: 55, unit: "per sqm", minQty: 1, image: "🎉" },
];

export const CATEGORIES = ["All", "Clothing & Apparel", "School Supplies", "Tarpaulins & Banners", "Promotional Items"];

export const PAYMENT_METHODS = ["GCash", "PayMaya", "Bank Transfer (BDO/BPI)", "Credit/Debit Card"];

export const STATUS_LIST = ["Pending", "Confirmed", "In Production", "Ready for Pickup", "Completed", "Cancelled"];

export const STATUS_COLORS = {
  "Pending": { bg: "#fef3e2", color: "#b45309" },
  "Confirmed": { bg: "#e3f0fc", color: "#1565c0" },
  "In Production": { bg: "#e8f5ff", color: "#0277bd" },
  "Ready for Pickup": { bg: "#f3e5f5", color: "#6a1b9a" },
  "Completed": { bg: "#e6f5ec", color: "#1a7a3a" },
  "Cancelled": { bg: "#fce8e8", color: "#c62828" },
};
