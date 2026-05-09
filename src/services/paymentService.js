const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

const {
  PaymentStatus,
  createPayment,
  savePayment,
  getPaymentById,
  getPaymentByIdempotencyKey,
  registerIdempotencyKey,
  transitionStatus,
  acquireLock,
  releaseLock,
  getAllPayments,
} = require('../models/payment');

const { defaultGateway } = require('./gatewaySimulator');
const { gatewayCircuitBreaker } = require('../utils/circuitBreaker');
const { canRetry, nextRetryAt } = require('../utils/retry');
const webhookService = require('./webhookService');


function validatePaymentInput({ amount, currency, merchantId, customerId }) {
  const errors = [];
  if (typeof amount !== 'number' || amount <= 0) errors.push('amount must be a positive number');
  if (amount > 1_000_000) errors.push('amount exceeds maximum allowed value (1,000,000)');
  if (!merchantId || typeof merchantId !== 'string') errors.push('merchantId is required');
  if (!customerId || typeof customerId !== 'string') errors.push('customerId is required');
  if (currency && !/^[A-Z]{3}$/.test(currency.toUpperCase())) errors.push('currency must be a 3-letter ISO code');
  return errors;
}


async function initiatePayment(input) {
  const { idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = getPaymentByIdempotencyKey(idempotencyKey);
    if (existing) {
      logger.info('Idempotent request – returning existing payment', {
        paymentId: existing.id,
        idempotencyKey,
        status: existing.status,
      });
      return { payment: existing, isExisting: true };
    }
  }

  const errors = validatePaymentInput(input);
  if (errors.length > 0) {
    const err = new Error(`Validation failed: ${errors.join(', ')}`);
    err.code = 'VALIDATION_ERROR';
    err.details = errors;
    throw err;
  }

  const payment = createPayment(input);
  savePayment(payment);

  if (idempotencyKey) {
    registerIdempotencyKey(idempotencyKey, payment.id);
  }

  logger.forPayment(payment.id).info('Payment initiated', {
    amount: payment.amount,
    currency: payment.currency,
    merchantId: payment.merchantId,
  });

  processPayment(payment.id).catch((err) => {
    logger.forPayment(payment.id).error('Unhandled error during async processPayment', { error: err.message });
  });

  return { payment: getPaymentById(payment.id), isExisting: false };
}


async function processPayment(paymentId) {
  const log = logger.forPayment(paymentId);

  if (!acquireLock(paymentId)) {
    log.warn('Could not acquire lock – payment already being processed');
    return getPaymentById(paymentId);
  }

  try {
    let payment = getPaymentById(paymentId);
    if (!payment) throw new Error(`Payment not found: ${paymentId}`);

    if (![PaymentStatus.PENDING, PaymentStatus.FAILED].includes(payment.status)) {
      log.info(`Skipping processPayment – status is ${payment.status}`);
      return payment;
    }

    transitionStatus(payment, PaymentStatus.PROCESSING, `Attempt ${payment.attempts + 1}`);
    payment.attempts += 1;
    payment.lastAttemptAt = new Date().toISOString();
    payment.nextRetryAt = null;
    savePayment(payment);

    log.info(`Processing attempt ${payment.attempts}`, { attempt: payment.attempts });

    let gatewayResult;
    try {
      gatewayResult = await gatewayCircuitBreaker.call(() =>
        defaultGateway.charge({
          paymentId,
          amount: payment.amount,
          currency: payment.currency,
          merchantId: payment.merchantId,
        })
      );
    } catch (gatewayErr) {
      return await _handleGatewayError(payment, gatewayErr, log);
    }

    payment = getPaymentById(paymentId); 
    transitionStatus(payment, PaymentStatus.SUCCESS, 'Gateway approved');
    payment.gatewayTransactionId = gatewayResult.transactionId;
    payment.failureReason = null;
    savePayment(payment);

    log.info('Payment succeeded', { transactionId: gatewayResult.transactionId });

    _deliverWebhook(payment, 'payment.succeeded').catch((e) =>
      log.error('Webhook delivery error', { error: e.message })
    );

    return getPaymentById(paymentId);
  } finally {
    releaseLock(paymentId);
  }
}


async function _handleGatewayError(payment, err, log) {
  const paymentId = payment.id;

  payment = getPaymentById(paymentId);

  const isRetryable = err.code !== 'CIRCUIT_OPEN' || err.code === 'GATEWAY_TIMEOUT';

  if (isRetryable && canRetry(payment)) {
    const retryAt = nextRetryAt(payment.attempts);
    transitionStatus(payment, PaymentStatus.FAILED, `Gateway error (will retry): ${err.message}`, {
      failureReason: err.message,
      retryScheduledAt: retryAt,
    });
    payment.failureReason = err.message;
    payment.nextRetryAt = retryAt;
    savePayment(payment);

    log.warn('Payment failed – scheduled for retry', {
      attempts: payment.attempts,
      maxAttempts: config.retry.maxAttempts,
      nextRetryAt: retryAt,
      reason: err.message,
    });
  } else {
    transitionStatus(payment, PaymentStatus.FAILED, `Terminal failure: ${err.message}`, {
      failureReason: err.message,
      terminal: true,
    });
    payment.failureReason = err.message;
    payment.nextRetryAt = null;
    savePayment(payment);

    log.error('Payment failed terminally', { attempts: payment.attempts, reason: err.message });

    _deliverWebhook(payment, 'payment.failed').catch((e) =>
      log.error('Webhook delivery error', { error: e.message })
    );
  }

  return getPaymentById(paymentId);
}

async function _deliverWebhook(payment, eventType) {
  await webhookService.deliver({
    eventId: `evt_${uuidv4()}`,
    type: eventType,
    paymentId: payment.id,
    status: payment.status,
    payload: {
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      merchantId: payment.merchantId,
      customerId: payment.customerId,
      gatewayTransactionId: payment.gatewayTransactionId,
      failureReason: payment.failureReason,
    },
  });
  const p = getPaymentById(payment.id);
  if (p) {
    p.webhookDelivered = true;
    savePayment(p);
  }
}


async function processScheduledRetries() {
  const now = new Date();
  const candidates = getAllPayments().filter((p) => {
    return (
      p.status === PaymentStatus.FAILED &&
      p.nextRetryAt &&
      new Date(p.nextRetryAt) <= now &&
      canRetry(p)
    );
  });

  if (candidates.length === 0) return;

  logger.info(`Retry worker: found ${candidates.length} payment(s) due for retry`);

  await Promise.allSettled(
    candidates.map(async (payment) => {
      logger.forPayment(payment.id).info('Retry worker: re-processing');
      await processPayment(payment.id);
    })
  );
}

async function recoverStuckPayments() {
  const cutoff = new Date(Date.now() - config.payment.processingTimeoutMs);
  const stuck = getAllPayments().filter(
    (p) => p.status === PaymentStatus.PROCESSING && new Date(p.updatedAt) < cutoff
  );

  for (const payment of stuck) {
    logger.forPayment(payment.id).warn('Recovering stuck PROCESSING payment');
    transitionStatus(payment, PaymentStatus.FAILED, 'Recovered: stuck in PROCESSING', { terminal: !canRetry(payment) });
    payment.failureReason = 'Processing timeout – recovered by watchdog';
    payment.nextRetryAt = canRetry(payment) ? nextRetryAt(payment.attempts) : null;
    savePayment(payment);
  }
}


function getPayment(paymentId) {
  const payment = getPaymentById(paymentId);
  if (!payment) {
    const err = new Error(`Payment not found: ${paymentId}`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  return payment;
}

module.exports = {
  initiatePayment,
  processPayment,
  getPayment,
  processScheduledRetries,
  recoverStuckPayments,
};
