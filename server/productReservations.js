import { Product } from './db.js';
// The stock decrement and its order-specific ledger entry are one atomic write.
// Pending payments hold stock until explicit cancellation; never expire a paid reservation.
export async function reserveProductStock(product, quantity, orderId) {
  if (!product.trackStock) return;
  const reserved = await Product.findOneAndUpdate({ id: product.id, active: true, trackStock: true, stock: { $gte: quantity }, 'stockReservations.orderId': { $ne: orderId } }, { $inc: { stock: -quantity }, $push: { stockReservations: { orderId, quantity } } });
  if (!reserved) throw Object.assign(new Error('Stock changed or this submission is already being processed. Refresh your orders before retrying.'), { status: 409 });
}
export async function releaseProductStock(productId, orderId) {
  const product = await Product.findOne({ id: productId, 'stockReservations.orderId': orderId }).lean();
  const reservation = product?.stockReservations?.find(r => r.orderId === orderId);
  if (!reservation) return;
  const result = await Product.updateOne(
    { id: productId, stockReservations: { $elemMatch: { orderId, quantity: reservation.quantity } } },
    { $inc: { stock: reservation.quantity }, $pull: { stockReservations: { orderId, quantity: reservation.quantity } } }
  );
  if (result.modifiedCount === 0 && await Product.exists({ id: productId, 'stockReservations.orderId': orderId })) {
    throw Object.assign(new Error('Stock reservation changed during release. Retry cancellation to recover.'), { status: 409 });
  }
}
