const CENTAVOS_PER_PESO = 100;
const PRECISION_TOLERANCE = 1e-7;

export function toCentavos(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const scaled = amount * CENTAVOS_PER_PESO;
  const centavos = Math.round(scaled);
  if (!Number.isSafeInteger(centavos) || Math.abs(scaled - centavos) > PRECISION_TOLERANCE) return null;
  return centavos;
}

export function paymentMatchesOrderTotal(paymentAmount, orderTotal) {
  const paymentCentavos = toCentavos(paymentAmount);
  const orderCentavos = toCentavos(orderTotal);
  return paymentCentavos !== null && orderCentavos !== null && paymentCentavos === orderCentavos;
}
