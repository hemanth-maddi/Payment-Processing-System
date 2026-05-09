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
  isLocked,
  _reset,
} = require('../../src/models/payment');

beforeEach(() => _reset());

describe('Payment Model', () => {
  const validInput = {
    amount: 1000,
    currency: 'USD',
    merchantId: 'merchant_1',
    customerId: 'cust_1',
    idempotencyKey: 'key_1',
  };

  describe('createPayment', () => {
    it('creates a payment with PENDING status', () => {
      const p = createPayment(validInput);
      expect(p.status).toBe(PaymentStatus.PENDING);
      expect(p.id).toBeTruthy();
      expect(p.attempts).toBe(0);
      expect(p.events).toHaveLength(1);
      expect(p.events[0].status).toBe(PaymentStatus.PENDING);
    });

    it('uppercases currency', () => {
      const p = createPayment({ ...validInput, currency: 'eur' });
      expect(p.currency).toBe('EUR');
    });
  });

  describe('savePayment and getPaymentById', () => {
    it('persists and retrieves a payment', () => {
      const p = createPayment(validInput);
      savePayment(p);
      const retrieved = getPaymentById(p.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved.id).toBe(p.id);
    });

    it('returns null for unknown id', () => {
      expect(getPaymentById('nonexistent')).toBeNull();
    });

    it('updates updatedAt on save', () => {
      const p = createPayment(validInput);
      const before = p.updatedAt;
      return new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
        savePayment({ ...p, status: PaymentStatus.PROCESSING });
        const updated = getPaymentById(p.id);
        expect(updated.updatedAt).not.toBe(before);
      });
    });
  });

  describe('Idempotency key registry', () => {
    it('maps key to paymentId', () => {
      const p = createPayment(validInput);
      savePayment(p);
      registerIdempotencyKey('my-key', p.id);
      const found = getPaymentByIdempotencyKey('my-key');
      expect(found.id).toBe(p.id);
    });

    it('returns null for unknown key', () => {
      expect(getPaymentByIdempotencyKey('ghost')).toBeNull();
    });
  });

  describe('transitionStatus', () => {
    it('allows PENDING → PROCESSING', () => {
      const p = createPayment(validInput);
      savePayment(p);
      transitionStatus(p, PaymentStatus.PROCESSING);
      expect(p.status).toBe(PaymentStatus.PROCESSING);
      expect(p.events).toHaveLength(2);
    });

    it('allows PROCESSING → SUCCESS', () => {
      const p = createPayment(validInput);
      transitionStatus(p, PaymentStatus.PROCESSING);
      transitionStatus(p, PaymentStatus.SUCCESS);
      expect(p.status).toBe(PaymentStatus.SUCCESS);
    });

    it('allows PROCESSING → FAILED → PROCESSING (retry cycle)', () => {
      const p = createPayment(validInput);
      transitionStatus(p, PaymentStatus.PROCESSING);
      transitionStatus(p, PaymentStatus.FAILED);
      transitionStatus(p, PaymentStatus.PROCESSING);
      expect(p.status).toBe(PaymentStatus.PROCESSING);
    });

    it('throws on invalid transition PENDING → SUCCESS', () => {
      const p = createPayment(validInput);
      expect(() => transitionStatus(p, PaymentStatus.SUCCESS)).toThrow();
      expect(() => transitionStatus(p, PaymentStatus.SUCCESS)).toThrow(/Invalid status transition/);
    });

    it('throws when trying to leave SUCCESS (terminal)', () => {
      const p = createPayment(validInput);
      transitionStatus(p, PaymentStatus.PROCESSING);
      transitionStatus(p, PaymentStatus.SUCCESS);
      expect(() => transitionStatus(p, PaymentStatus.FAILED)).toThrow(/Invalid status transition/);
    });

    it('appends event with note and extra fields', () => {
      const p = createPayment(validInput);
      transitionStatus(p, PaymentStatus.PROCESSING, 'Attempt 1', { attempt: 1 });
      const ev = p.events[1];
      expect(ev.note).toBe('Attempt 1');
      expect(ev.attempt).toBe(1);
      expect(ev.from).toBe(PaymentStatus.PENDING);
    });
  });

  describe('Concurrency lock', () => {
    it('acquires lock when not held', () => {
      const p = createPayment(validInput);
      expect(acquireLock(p.id)).toBe(true);
    });

    it('fails to acquire lock if already held', () => {
      const p = createPayment(validInput);
      acquireLock(p.id);
      expect(acquireLock(p.id)).toBe(false);
    });

    it('allows re-acquisition after release', () => {
      const p = createPayment(validInput);
      acquireLock(p.id);
      releaseLock(p.id);
      expect(acquireLock(p.id)).toBe(true);
    });

    it('isLocked reflects lock state', () => {
      const p = createPayment(validInput);
      expect(isLocked(p.id)).toBe(false);
      acquireLock(p.id);
      expect(isLocked(p.id)).toBe(true);
      releaseLock(p.id);
      expect(isLocked(p.id)).toBe(false);
    });
  });
});
