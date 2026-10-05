export class PaymentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
