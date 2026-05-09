const paymentModel = require('../../src/models/payment');
const paymentService = require('../../src/services/paymentService');
const webhookService = require('../../src/services/webhookService');
const { gatewayCircuitBreaker } = require('../../src/utils/circuitBreaker');
const { defaultGateway } = require('../../src/services/gatewaySimulator');

beforeEach(() => {
  paymentModel._reset();
  webhookService._reset();
  gatewayCircuitBreaker._reset();
  jest.restoreAllMocks();
});

describe('processScheduledRetries', () => {
  it('re-processes FAILED payments whose nextRetryAt is in the past', async () => {
    jest.spyOn(defaultGateway, 'charge').mockResolvedValue({
      transactionId: 'gw_retry_ok',
      gatewayStatus: 'SUCCESS',
    });

    const p = paymentModel.createPayment({
      amount: 1000, currency: 'USD', merchantId: 'm1', customerId: 'c1',
    });
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.PROCESSING);
    p.attempts = 1;
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.FAILED, 'test');
    p.failureReason = 'transient';
    p.nextRetryAt = new Date(Date.now() - 1000).toISOString(); 
    paymentModel.savePayment(p);

    await paymentService.processScheduledRetries();

    await new Promise((r) => setTimeout(r, 200));

    const updated = paymentModel.getPaymentById(p.id);
    expect(updated.status).toBe(paymentModel.PaymentStatus.SUCCESS);
  });

  it('does not retry payments whose nextRetryAt is in the future', async () => {
    const chargeSpy = jest.spyOn(defaultGateway, 'charge').mockResolvedValue({
      transactionId: 'gw_1',
      gatewayStatus: 'SUCCESS',
    });

    const p = paymentModel.createPayment({
      amount: 1000, currency: 'USD', merchantId: 'm1', customerId: 'c1',
    });
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.PROCESSING);
    p.attempts = 1;
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.FAILED);
    p.failureReason = 'test';
    p.nextRetryAt = new Date(Date.now() + 60_000).toISOString(); 
    paymentModel.savePayment(p);

    await paymentService.processScheduledRetries();

    expect(chargeSpy).not.toHaveBeenCalled();
    expect(paymentModel.getPaymentById(p.id).status).toBe(paymentModel.PaymentStatus.FAILED);
  });

  it('does not retry payments that have exhausted maxAttempts', async () => {
    const chargeSpy = jest.spyOn(defaultGateway, 'charge');

    const p = paymentModel.createPayment({
      amount: 1000, currency: 'USD', merchantId: 'm1', customerId: 'c1',
    });
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.PROCESSING);
    p.attempts = 3; 
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.FAILED);
    p.nextRetryAt = new Date(Date.now() - 1000).toISOString();
    paymentModel.savePayment(p);

    await paymentService.processScheduledRetries();

    expect(chargeSpy).not.toHaveBeenCalled();
  });
});

describe('recoverStuckPayments', () => {
  it('resets PROCESSING payments older than the processing timeout', async () => {
    const originalTimeout = require('../../src/config').payment.processingTimeoutMs;
    require('../../src/config').payment.processingTimeoutMs = 0;

    const p = paymentModel.createPayment({
      amount: 1000, currency: 'USD', merchantId: 'm1', customerId: 'c1',
    });
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.PROCESSING);
    p.attempts = 1;
    paymentModel.savePayment(p);

    await new Promise((r) => setTimeout(r, 10)); 

    await paymentService.recoverStuckPayments();

    const updated = paymentModel.getPaymentById(p.id);
    expect(updated.status).toBe(paymentModel.PaymentStatus.FAILED);
    expect(updated.failureReason).toContain('watchdog');

    require('../../src/config').payment.processingTimeoutMs = originalTimeout;
  });

  it('does not touch recent PROCESSING payments', async () => {
    const p = paymentModel.createPayment({
      amount: 1000, currency: 'USD', merchantId: 'm1', customerId: 'c1',
    });
    paymentModel.transitionStatus(p, paymentModel.PaymentStatus.PROCESSING);
    paymentModel.savePayment(p);

    await paymentService.recoverStuckPayments();

    expect(paymentModel.getPaymentById(p.id).status).toBe(paymentModel.PaymentStatus.PROCESSING);
  });
});
