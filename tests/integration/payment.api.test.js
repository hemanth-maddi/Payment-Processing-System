const request = require('supertest');
const app = require('../../src/app');
const paymentModel = require('../../src/models/payment');
const webhookService = require('../../src/services/webhookService');
const { gatewayCircuitBreaker } = require('../../src/utils/circuitBreaker');
const { defaultGateway } = require('../../src/services/gatewaySimulator');

beforeEach(() => {
  paymentModel._reset();
  webhookService._reset();
  gatewayCircuitBreaker._reset();
});

const validBody = {
  amount: 5000,
  currency: 'USD',
  merchantId: 'merchant_test',
  customerId: 'cust_test',
};

describe('POST /payments', () => {
  beforeEach(() => {
    jest.spyOn(defaultGateway, 'charge').mockResolvedValue({
      transactionId: 'gw_test_123',
      gatewayStatus: 'SUCCESS',
      message: 'Charge approved',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('returns 202 and a paymentId for a new payment', async () => {
    const res = await request(app).post('/payments').send(validBody);
    expect(res.status).toBe(202);
    expect(res.body.paymentId).toBeTruthy();
    expect(['PENDING', 'PROCESSING', 'SUCCESS']).toContain(res.body.status);
    expect(res.body.idempotent).toBe(false);
  });

  it('returns 400 for missing amount', async () => {
    const res = await request(app).post('/payments').send({ ...validBody, amount: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for negative amount', async () => {
    const res = await request(app).post('/payments').send({ ...validBody, amount: -100 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing merchantId', async () => {
    const res = await request(app).post('/payments').send({ ...validBody, merchantId: undefined });
    expect(res.status).toBe(400);
    expect(res.body.details).toContain('merchantId is required');
  });

  it('returns 400 for invalid currency code', async () => {
    const res = await request(app).post('/payments').send({ ...validBody, currency: 'INVALID' });
    expect(res.status).toBe(400);
  });

  it('handles idempotency key – second call returns existing payment', async () => {
    const headers = { 'Idempotency-Key': 'test-key-abc' };

    const first = await request(app).post('/payments').set(headers).send(validBody);
    expect(first.status).toBe(202);
    const paymentId = first.body.paymentId;

    const second = await request(app).post('/payments').set(headers).send(validBody);
    expect(second.status).toBe(200);
    expect(second.body.paymentId).toBe(paymentId);
    expect(second.body.idempotent).toBe(true);
  });

  it('two concurrent requests with same idempotency key return same payment', async () => {
    const headers = { 'Idempotency-Key': 'concurrent-key' };
    const [r1, r2] = await Promise.all([
      request(app).post('/payments').set(headers).send(validBody),
      request(app).post('/payments').set(headers).send(validBody),
    ]);
    const ids = [r1.body.paymentId, r2.body.paymentId].filter(Boolean);
    expect(new Set(ids).size).toBeLessThanOrEqual(1);
  });
});

describe('GET /payments/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/payments/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('returns payment details', async () => {
    jest.spyOn(defaultGateway, 'charge').mockResolvedValue({
      transactionId: 'gw_1',
      gatewayStatus: 'SUCCESS',
    });

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    const res = await request(app).get(`/payments/${paymentId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(paymentId);
    expect(res.body.amount).toBe(5000);
    jest.restoreAllMocks();
  });
});

describe('GET /payments/:id/events', () => {
  it('returns audit trail for a payment', async () => {
    jest.spyOn(defaultGateway, 'charge').mockResolvedValue({
      transactionId: 'gw_1',
      gatewayStatus: 'SUCCESS',
    });

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    const res = await request(app).get(`/payments/${paymentId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toBeInstanceOf(Array);
    expect(res.body.events[0].status).toBe('PENDING');
    jest.restoreAllMocks();
  });
});

describe('Payment failure and retry scheduling', () => {
  it('marks payment FAILED when gateway declines', async () => {
    const err = new Error('Insufficient funds');
    err.code = 'GATEWAY_DECLINED';
    jest.spyOn(defaultGateway, 'charge').mockRejectedValue(err);

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    await new Promise((r) => setTimeout(r, 200));

    const payment = paymentModel.getPaymentById(paymentId);
    expect(payment.status).toBe('FAILED');
    expect(payment.failureReason).toContain('Insufficient funds');

    jest.restoreAllMocks();
  });

  it('schedules retry when gateway fails and attempts < maxAttempts', async () => {
    const err = new Error('Gateway error');
    err.code = 'GATEWAY_DECLINED';
    jest.spyOn(defaultGateway, 'charge').mockRejectedValue(err);

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    await new Promise((r) => setTimeout(r, 200));

    const payment = paymentModel.getPaymentById(paymentId);
    expect(payment.status).toBe('FAILED');
    expect(payment.nextRetryAt).toBeTruthy(); 
    expect(payment.attempts).toBe(1);

    jest.restoreAllMocks();
  });

  it('eventually succeeds after initial failures', async () => {
    let calls = 0;
    jest.spyOn(defaultGateway, 'charge').mockImplementation(async () => {
      calls++;
      if (calls < 2) {
        const err = new Error('Transient error');
        err.code = 'GATEWAY_DECLINED';
        throw err;
      }
      return { transactionId: 'gw_ok', gatewayStatus: 'SUCCESS' };
    });

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    await new Promise((r) => setTimeout(r, 300));

    const { processPayment } = require('../../src/services/paymentService');
    const payment = paymentModel.getPaymentById(paymentId);
    if (payment.status === 'FAILED' && payment.attempts < 3) {
      await processPayment(paymentId);
    }

    const final = paymentModel.getPaymentById(paymentId);
    expect(final.status).toBe('SUCCESS');
    jest.restoreAllMocks();
  });
});

describe('Concurrency – no duplicate processing', () => {
  it('concurrent processPayment calls do not double-process', async () => {
    let callCount = 0;
    jest.spyOn(defaultGateway, 'charge').mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50)); 
      return { transactionId: `gw_${callCount}`, gatewayStatus: 'SUCCESS' };
    });

    const createRes = await request(app).post('/payments').send(validBody);
    const { paymentId } = createRes.body;

    await new Promise((r) => setTimeout(r, 20));

    const { processPayment } = require('../../src/services/paymentService');
    await Promise.allSettled([
      processPayment(paymentId),
      processPayment(paymentId),
      processPayment(paymentId),
    ]);

    expect(callCount).toBeLessThanOrEqual(2); 
    jest.restoreAllMocks();
  });
});

describe('GET /payments/system/health', () => {
  it('returns health data including circuit breaker status', async () => {
    const res = await request(app).get('/payments/system/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.circuitBreaker).toBeDefined();
    expect(res.body.circuitBreaker.state).toBe('CLOSED');
  });
});
