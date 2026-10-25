import { Inventory, StockMovement } from './db.js';

const round3 = value => Math.round(value * 1000) / 1000;
const cents = value => Math.round(Number(value || 0) * 100);
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };

async function recordMovement(key, material, job, actor, movementType, reason, quantity, costPerUnit = null, notes = '') {
  if (!(quantity > 0)) return null;
  return StockMovement.findOneAndUpdate({ idempotencyKey: key }, { $setOnInsert: {
    idempotencyKey: key, orderId: job.orderId, jobOrderId: job.jobOrderId,
    inventoryId: material.inventoryId, material: material.material, materialType: material.type || '', unit: material.unit,
    quantity, movementType, reason, performedBy: actor.id, performedByName: actor.name || actor.email || '', notes,
    unitCostSnapshot: costPerUnit, directCostCents: costPerUnit == null ? null : cents(quantity * costPerUnit),
    costDataComplete: costPerUnit != null
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

export async function reserveMaterial(material, job, actor) {
  const reservationId = material.reservationId;
  let item = await Inventory.findOne({ _id: material.inventoryId, 'materialReservations.reservationId': reservationId }).lean();
  let claim = item?.materialReservations?.find(row => row.reservationId === reservationId);
  if (claim) {
    if (claim.jobOrderId !== job.jobOrderId || claim.orderId !== job.orderId || claim.quantity !== material.quantity) fail('A reservation ID is already associated with different job data.');
    if (claim.status !== 'RESERVED') fail(`Reservation ${reservationId} is already ${claim.status.toLowerCase()}.`);
  } else {
    const createdAt = new Date();
    item = await Inventory.findOneAndUpdate({
      _id: material.inventoryId,
      'materialReservations.reservationId': { $ne: reservationId },
      $expr: { $gte: [{ $subtract: ['$quantity', { $ifNull: ['$reservedQuantity', 0] }] }, material.quantity] }
    }, {
      $inc: { reservedQuantity: material.quantity },
      $push: { materialReservations: {
        reservationId, operationId: material.operationId, jobOrderId: job.jobOrderId, orderId: job.orderId,
        quantity: material.quantity, status: 'RESERVED', actorId: actor.id, movementKeys: [`${reservationId}:reserve`], createdAt, updatedAt: createdAt
      } }
    }, { new: true, runValidators: true }).lean();
    if (!item) {
      const raced = await Inventory.findOne({ _id: material.inventoryId, 'materialReservations.reservationId': reservationId }).lean();
      if (raced) return reserveMaterial(material, job, actor);
      const exists = await Inventory.exists({ _id: material.inventoryId });
      fail(exists ? `Insufficient available stock for ${material.material}.` : `Inventory material ${material.inventoryId} no longer exists.`, exists ? 409 : 404);
    }
    claim = item.materialReservations.find(row => row.reservationId === reservationId);
  }
  await recordMovement(`${reservationId}:reserve`, { ...material, type: item.type }, job, actor, 'RESERVE', 'PRODUCTION_RESERVATION', material.quantity);
  return { item, claim };
}

export async function releaseMaterial(material, job, actor, reason = 'Reservation released.') {
  const item = await Inventory.findById(material.inventoryId).lean();
  const claim = item?.materialReservations?.find(row => row.reservationId === material.reservationId);
  if (!item || !claim) return; // No claim means this row never reserved stock.
  if (claim.jobOrderId !== job.jobOrderId || claim.orderId !== job.orderId) fail('Refusing to release a reservation owned by another job.', 403);
  if (claim.status === 'FINALIZED') fail('Consumed material cannot be released.');
  await recordMovement(`${material.reservationId}:reserve`, { ...material, type: item.type }, job, actor, 'RESERVE', 'PRODUCTION_RESERVATION', claim.quantity);
  if (claim.status === 'RESERVED') {
    const updated = await Inventory.findOneAndUpdate({
      _id: item._id, reservedQuantity: { $gte: claim.quantity },
      materialReservations: { $elemMatch: { reservationId: material.reservationId, status: 'RESERVED', jobOrderId: job.jobOrderId, orderId: job.orderId } }
    }, {
      $inc: { reservedQuantity: -claim.quantity },
      $set: { 'materialReservations.$.status': 'RELEASED', 'materialReservations.$.releasedQuantity': claim.quantity,
        'materialReservations.$.releasedBy': actor.id, 'materialReservations.$.releaseReason': reason,
        'materialReservations.$.releasedAt': new Date(), 'materialReservations.$.updatedAt': new Date() },
      $addToSet: { 'materialReservations.$.movementKeys': `${material.reservationId}:release` }
    }, { new: true, runValidators: true }).lean();
    if (!updated) {
      const current = await Inventory.findById(item._id).lean();
      const currentClaim = current?.materialReservations?.find(row => row.reservationId === material.reservationId);
      if (currentClaim?.status !== 'RELEASED') fail(`Reservation ${material.reservationId} release failed and needs reconciliation.`);
    }
  }
  await recordMovement(`${material.reservationId}:release`, { ...material, type: item.type }, job, actor, 'RELEASE', 'PRODUCTION_RELEASE', claim.quantity, null, reason);
}

export async function finalizeMaterial(material, usage, job, actor) {
  const item = await Inventory.findById(material.inventoryId).lean();
  const claim = item?.materialReservations?.find(row => row.reservationId === material.reservationId);
  if (!item || !claim || claim.jobOrderId !== job.jobOrderId || claim.orderId !== job.orderId) fail(`Reservation ${material.reservationId} is missing or belongs to another job.`);
  if (claim.status === 'RESERVED') {
    const consumed = round3(usage.usedQuantity + usage.wastedQuantity);
    const costKnown = item.costBasisKnown === true;
    const unitCost = costKnown ? item.costPerUnit : null;
    const finalizedAt = new Date();
    const updated = await Inventory.findOneAndUpdate({
      _id: item._id,
      reservedQuantity: { $gte: claim.quantity },
      $expr: { $gte: ['$quantity', consumed] },
      materialReservations: { $elemMatch: { reservationId: material.reservationId, status: 'RESERVED', jobOrderId: job.jobOrderId, orderId: job.orderId, quantity: material.quantity } },
      costPerUnit: item.costPerUnit, costBasisKnown: costKnown
    }, {
      $inc: { quantity: -consumed, reservedQuantity: -claim.quantity },
      $set: {
        'materialReservations.$.status': 'FINALIZED', 'materialReservations.$.usedQuantity': usage.usedQuantity,
        'materialReservations.$.wastedQuantity': usage.wastedQuantity,
        'materialReservations.$.releasedQuantity': usage.unusedQuantity,
        'materialReservations.$.unitCostSnapshot': unitCost, 'materialReservations.$.costDataComplete': costKnown,
        'materialReservations.$.finalizedAt': finalizedAt, 'materialReservations.$.finalizedBy': actor.id,
        'materialReservations.$.wasteReason': usage.wasteReason || '', 'materialReservations.$.updatedAt': finalizedAt
      },
      $addToSet: { 'materialReservations.$.movementKeys': { $each: [
        ...(consumed > 0 ? [`${material.reservationId}:consumed`] : []),
        ...(usage.wastedQuantity > 0 ? [`${material.reservationId}:waste`] : []),
        ...(usage.unusedQuantity > 0 ? [`${material.reservationId}:unused`] : [])
      ] } }
    }, { new: true, runValidators: true }).lean();
    if (!updated) fail(`Could not finalize ${material.material}; stock or cost basis changed. Retry reconciliation.`);
  } else if (claim.status !== 'FINALIZED') fail(`Reservation ${material.reservationId} is ${claim.status.toLowerCase()} and cannot be consumed.`);

  const finalItem = await Inventory.findById(material.inventoryId).lean();
  const finalClaim = finalItem.materialReservations.find(row => row.reservationId === material.reservationId);
  const unitCost = finalClaim.costDataComplete ? finalClaim.unitCostSnapshot : null;
  const consumedQuantity = round3(finalClaim.usedQuantity + finalClaim.wastedQuantity);
  await recordMovement(`${material.reservationId}:consumed`, { ...material, type: finalItem.type }, job, actor, 'OUT', 'ORDER_PICKUP', consumedQuantity, unitCost, 'Production material finalized before pickup; quantity includes good use and waste for legacy archive compatibility.');
  await recordMovement(`${material.reservationId}:waste`, { ...material, type: finalItem.type }, job, actor, 'WASTE', 'PRODUCTION_WASTE', finalClaim.wastedQuantity, unitCost, usage.wasteReason || 'Production waste.');
  await recordMovement(`${material.reservationId}:unused`, { ...material, type: finalItem.type }, job, actor, 'RELEASE', 'PRODUCTION_RELEASE', finalClaim.releasedQuantity, null, 'Unused quantity returned to available stock.');
  return finalClaim;
}

export async function reconcileReservationMaterial(material, job, actor) {
  const item = await Inventory.findById(material.inventoryId).lean();
  const claim = item?.materialReservations?.find(row => row.reservationId === material.reservationId);
  if (!claim) return reserveMaterial(material, job, actor);
  if (claim.jobOrderId !== job.jobOrderId || claim.orderId !== job.orderId) fail('Reservation reconciliation found a claim owned by another job.', 403);
  if (claim.status === 'RESERVED') return reserveMaterial(material, job, actor);
  if (claim.status === 'FINALIZED') return claim;
  fail(`Reservation ${material.reservationId} was released; it cannot be silently recreated.`);
}
