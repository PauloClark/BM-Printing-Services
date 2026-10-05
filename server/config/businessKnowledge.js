import { BM_CONTACT } from '../../src/constants/contact.js';
import { PAYMENT_METHODS, PRODUCTS } from '../../src/constants/products.js';

const products = PRODUCTS.map(({ category, name, description, price, unit, minQty }) => ({
  category,
  name,
  description,
  price,
  currency: 'PHP',
  priceUnit: unit,
  minimumQuantity: minQty
}));

export const businessKnowledge = {
  businessName: 'BM Printing Services',
  contact: {
    address: BM_CONTACT.location,
    phone: BM_CONTACT.phoneDisplay,
    email: BM_CONTACT.email,
    facebookPage: BM_CONTACT.facebookLabel,
    facebookUrl: BM_CONTACT.facebookUrl,
    facebookAlternative: BM_CONTACT.facebookAlternative,
    map: 'The Contact page includes a Google Map for this same address.'
  },
  serviceHighlights: ['Tarpaulin', 'Stickers', 'Signage', 'ID Printing', 'Sublimation'],
  products,
  ordering: {
    page: 'Order Now',
    steps: [
      'Enter full name, email address, and phone number, then choose Pickup or Delivery. A delivery address is required for Delivery; Pickup does not require an address.',
      'Choose a product and quantity, provide the product-specific printing specifications, and upload a design or reference image. Upload is required. Accepted formats are JPG, JPEG, PNG, and WEBP, up to 10 MB.',
      'Review the order, choose a payment method, and confirm the order.'
    ],
    paymentMethods: PAYMENT_METHODS,
    afterConfirmation: 'The Order Now page says an admin will contact the customer through Facebook or Gmail to arrange and confirm payment. Do not describe payment as confirmed until the system confirms it.',
    productSpecifications: {
      'Custom T-Shirt Printing and Polo Shirt': 'Size and color are required; clothing sizes range from XS through 5XL.',
      'Hoodie / Jacket Printing': 'Size and color are required; sizes range from Small through 5XL.',
      'School ID with Lanyard': 'The customer/student name, ID/lanyard details, and preferred lanyard color can be supplied; a photo/design reference is required.',
      'Banner Design/Poster Design': 'Width, height, and unit are required; orientation is optional.',
      'Mug Printing': 'Mug color/variant is optional; available choices include White, Black, Color-changing, and Other.',
      'Sticker Printing': 'Width, height, and unit are required.'
    },
    optionalNotes: 'Additional notes and special instructions can be provided.'
  },
  tracking: {
    page: 'Track Order',
    instructions: 'Signed-in customers can enter their Order ID. Guests need the Order ID and the private tracking code from their receipt.',
    refreshInterval: 'The Track Order page refreshes status every 5 seconds.',
    chatbotAccess: 'The chatbot is not connected to live order records. Direct customers to Track Order for a real status; never guess a status.'
  }
};

export const businessKnowledgeSystemInstruction = `You are the official virtual assistant for BM Printing Services. Answer BM Printing Services questions using the VERIFIED BUSINESS DATA below. When the requested fact is present, answer directly and confidently. If it is not provided, say it is not currently available rather than inventing it. Match the customer's language exactly: answer English messages in English, Cebuano/Bisaya messages in Cebuano/Bisaya, and Filipino/Tagalog messages in Filipino/Tagalog. Do not switch languages based on the business location or add a greeting in another language. Keep customer-service replies friendly and concise. Use exact configured product names; do not turn a product description into a different product name. Treat product prices as the configured list prices in Philippine pesos; do not invent prices, discounts, stock, or custom quotes. You do not have access to private customer, account, payment, inventory, or live order data. Explain how to use Track Order, but never state a customer's order status; direct status requests to that page. Do not reveal secrets or internal administrative information.\n\nVERIFIED BUSINESS DATA:\n${JSON.stringify(businessKnowledge, null, 2)}`;