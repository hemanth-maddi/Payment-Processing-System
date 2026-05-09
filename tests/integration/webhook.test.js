const webhookService = require('../../src/services/webhookService');

beforeEach(() => webhookService._reset());

describe('Webhook Service', () => {
  const baseEvent = {
    eventId: 'evt_001',
    type: 'payment.succeeded',
    paymentId: 'pay_abc',
    status: 'SUCCESS',
    payload: { amount: 1000, currency: 'USD' },
  };

  describe('deliver', () => {
    it('delivers a new event', async () => {
      const result = await webhookService.deliver(baseEvent);
      expect(result.duplicate).toBe(false);
      expect(typeof result.delivered).toBe('boolean');
    });

    it('deduplicates events with the same eventId', async () => {
      await webhookService.deliver(baseEvent);
      const second = await webhookService.deliver(baseEvent);
      expect(second.duplicate).toBe(true);
      expect(second.delivered).toBe(false);
    });

    it('logs webhook events', async () => {
      await webhookService.deliver(baseEvent);
      const log = webhookService.getWebhookLog();
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0].eventId).toBe('evt_001');
    });
  });

  describe('handleInboundCallback', () => {
    it('processes a new callback', async () => {
      const onStatusUpdate = jest.fn().mockResolvedValue(undefined);
      const result = await webhookService.handleInboundCallback(
        { eventId: 'cb_1', paymentId: 'pay_1', gatewayStatus: 'SUCCESS', transactionId: 'gw_1' },
        onStatusUpdate
      );
      expect(result.processed).toBe(true);
      expect(onStatusUpdate).toHaveBeenCalledWith('pay_1', 'SUCCESS', 'gw_1');
    });

    it('deduplicates duplicate callbacks', async () => {
      const onStatusUpdate = jest.fn().mockResolvedValue(undefined);
      const cb = { eventId: 'cb_dup', paymentId: 'pay_1', gatewayStatus: 'SUCCESS' };

      await webhookService.handleInboundCallback(cb, onStatusUpdate);
      const second = await webhookService.handleInboundCallback(cb, onStatusUpdate);

      expect(second.processed).toBe(false);
      expect(second.reason).toBe('duplicate');
      expect(onStatusUpdate).toHaveBeenCalledTimes(1);
    });

    it('handles failing onStatusUpdate gracefully', async () => {
      const onStatusUpdate = jest.fn().mockRejectedValue(new Error('DB error'));
      const result = await webhookService.handleInboundCallback(
        { eventId: 'cb_fail', paymentId: 'pay_1', gatewayStatus: 'FAILED' },
        onStatusUpdate
      );
      expect(result.processed).toBe(false);
      expect(result.reason).toContain('DB error');
    });

    it('does not mark eventId as processed if onStatusUpdate fails', async () => {
      const onStatusUpdate = jest.fn().mockRejectedValue(new Error('fail'));
      const cb = { eventId: 'cb_err', paymentId: 'pay_1', gatewayStatus: 'FAILED' };

      await webhookService.handleInboundCallback(cb, jest.fn().mockRejectedValue(new Error('fail')));

      const onUpdate2 = jest.fn().mockResolvedValue(undefined);
      const retry = await webhookService.handleInboundCallback(cb, onUpdate2);
      expect(retry.processed).toBe(true);
    });
  });
});
