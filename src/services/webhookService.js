const logger = require('../utils/logger');
const { sleep } = require('../utils/retry');

const processedWebhookIds = new Set();

const webhookLog = [];

async function deliver(event) {
  const { eventId, type, paymentId, status, payload } = event;
  const log = logger.forPayment(paymentId);

  if (processedWebhookIds.has(eventId)) {
    log.warn('Webhook duplicate detected – skipping', { eventId, type });
    return { delivered: false, duplicate: true };
  }

  const deliveryResult = await simulateHttpDelivery({ eventId, type, paymentId, status, payload });

  const entry = {
    eventId,
    type,
    paymentId,
    status,
    deliveredAt: new Date().toISOString(),
    success: deliveryResult.success,
    httpStatus: deliveryResult.httpStatus,
    attempts: deliveryResult.attempts,
  };
  webhookLog.push(entry);

  if (deliveryResult.success) {
    processedWebhookIds.add(eventId);
    log.info('Webhook delivered', { eventId, type, httpStatus: deliveryResult.httpStatus });
    return { delivered: true, duplicate: false };
  }

  log.error('Webhook delivery failed after retries', { eventId, attempts: deliveryResult.attempts });
  return { delivered: false, duplicate: false };
}

async function handleInboundCallback(callback, onStatusUpdate) {
  const { eventId, paymentId, gatewayStatus, transactionId } = callback;
  const log = logger.forPayment(paymentId);

  if (processedWebhookIds.has(eventId)) {
    log.warn('Inbound callback duplicate – ignoring', { eventId });
    return { processed: false, reason: 'duplicate' };
  }

  try {
    await onStatusUpdate(paymentId, gatewayStatus, transactionId);
    processedWebhookIds.add(eventId);
    log.info('Inbound callback processed', { eventId, gatewayStatus });
    return { processed: true };
  } catch (err) {
    log.error('Inbound callback processing failed', { eventId, error: err.message });
    return { processed: false, reason: err.message };
  }
}

async function simulateHttpDelivery(event) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(50); 

    const roll = Math.random();
    if (roll > 0.2) {
      return { success: true, httpStatus: 200, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await sleep(200 * attempt); 
    }
  }
  return { success: false, httpStatus: 503, attempts: maxAttempts };
}

function getWebhookLog() {
  return [...webhookLog];
}

function _reset() {
  processedWebhookIds.clear();
  webhookLog.length = 0;
}

module.exports = { deliver, handleInboundCallback, getWebhookLog, _reset };
