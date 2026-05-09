const { v4: uuidv4 } = require('uuid');

const PaymentStatus = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

const VALID_TRANSITIONS = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCESS, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [PaymentStatus.PROCESSING],
  [PaymentStatus.SUCCESS]: [],
};

const store = {
  payments: new Map(),
  idempotencyKeys: new Map(),
  locks: new Map(),
};

function createPayment({ amount, currency, merchantId, customerId, idempotencyKey, metadata = {} }) {
  const payment = {
    id: uuidv4(),
    amount,
    currency: (currency || 'USD').toUpperCase(),
    merchantId,
    customerId,
    idempotencyKey,
    status: PaymentStatus.PENDING,
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    gatewayTransactionId: null,
    failureReason: null,
    webhookDelivered: false,
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [{ status: PaymentStatus.PENDING, timestamp: new Date().toISOString(), note: 'Payment created' }],
  };
  return payment;
}

function savePayment(payment) {
  payment.updatedAt = new Date().toISOString();
  store.payments.set(payment.id, { ...payment });
  return store.payments.get(payment.id);
}

function getPaymentById(id) {
  return store.payments.get(id) || null;
}

function getPaymentByIdempotencyKey(key) {
  const paymentId = store.idempotencyKeys.get(key);
  return paymentId ? getPaymentById(paymentId) : null;
}

function registerIdempotencyKey(key, paymentId) {
  store.idempotencyKeys.set(key, paymentId);
}


function transitionStatus(payment, newStatus, note = '', extra = {}) {
  const allowed = VALID_TRANSITIONS[payment.status] || [];
  if (!allowed.includes(newStatus)) {
    const err = new Error(
      `Invalid status transition: ${payment.status} → ${newStatus} for payment ${payment.id}`
    );
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const event = {
    status: newStatus,
    from: payment.status,
    timestamp: new Date().toISOString(),
    note,
    ...extra,
  };

  payment.status = newStatus;
  payment.events = [...(payment.events || []), event];
  Object.assign(payment, { updatedAt: new Date().toISOString() });

  return payment;
}

function acquireLock(paymentId) {
  if (store.locks.has(paymentId)) return false;
  store.locks.set(paymentId, true);
  return true;
}

function releaseLock(paymentId) {
  store.locks.delete(paymentId);
}

function isLocked(paymentId) {
  return store.locks.has(paymentId);
}

function getAllPayments() {
  return Array.from(store.payments.values());
}

function _reset() {
  store.payments.clear();
  store.idempotencyKeys.clear();
  store.locks.clear();
}

module.exports = {
  PaymentStatus,
  VALID_TRANSITIONS,
  createPayment,
  savePayment,
  getPaymentById,
  getPaymentByIdempotencyKey,
  registerIdempotencyKey,
  transitionStatus,
  acquireLock,
  releaseLock,
  isLocked,
  getAllPayments,
  _reset,
};
