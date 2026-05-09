const express = require('express');
const router = express.Router();

const paymentService = require('../services/paymentService');
const webhookService = require('../services/webhookService');
const { gatewayCircuitBreaker } = require('../utils/circuitBreaker');
const { rateLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

router.post('/', rateLimiter, async (req, res, next) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'] || null;
    const { amount, currency, merchantId, customerId, metadata } = req.body;

    const { payment, isExisting } = await paymentService.initiatePayment({
      amount,
      currency,
      merchantId,
      customerId,
      idempotencyKey,
      metadata,
    });

    const status = isExisting ? 200 : 202; 
    return res.status(status).json({
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      createdAt: payment.createdAt,
      idempotent: isExisting,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const payment = paymentService.getPayment(req.params.id);
    return res.json(payment);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/events', async (req, res, next) => {
  try {
    const payment = paymentService.getPayment(req.params.id);
    return res.json({ paymentId: payment.id, events: payment.events });
  } catch (err) {
    next(err);
  }
});

router.post('/webhooks/inbound', async (req, res, next) => {
  try {
    const { eventId, paymentId, gatewayStatus, transactionId } = req.body;

    if (!eventId || !paymentId || !gatewayStatus) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'eventId, paymentId, gatewayStatus are required' });
    }

    const result = await webhookService.handleInboundCallback(
      { eventId, paymentId, gatewayStatus, transactionId },
      async (pid, status, txId) => {
        const domainStatus = status === 'SUCCESS' ? 'SUCCESS' : 'FAILED';
        logger.forPayment(pid).info('Inbound gateway callback updating status', { domainStatus });
      }
    );

    return res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/system/health', (req, res) => {
  return res.json({
    status: 'ok',
    circuitBreaker: gatewayCircuitBreaker.getStatus(),
    webhookLog: webhookService.getWebhookLog().length,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
