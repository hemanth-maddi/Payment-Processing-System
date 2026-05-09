const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const { sleep } = require('../utils/retry');

class GatewaySimulator {
  constructor(overrides = {}) {
    this.successRate = overrides.successRate ?? config.gateway.successRate;
    this.timeoutRate = overrides.timeoutRate ?? config.gateway.timeoutRate;
    this.minDelayMs = overrides.minDelayMs ?? config.gateway.minDelayMs;
    this.maxDelayMs = overrides.maxDelayMs ?? config.gateway.maxDelayMs;
    this.timeoutMs = overrides.timeoutMs ?? config.gateway.timeoutMs;
  }

  async charge(params) {
    const { paymentId, amount, currency } = params;
    const log = logger.forPayment(paymentId);

    const roll = Math.random();

    if (roll < this.timeoutRate) {
      log.warn('Gateway simulator: simulating timeout', { roll });
      await sleep(this.timeoutMs);
      const err = new Error('Gateway timeout: no response within the allowed window');
      err.code = 'GATEWAY_TIMEOUT';
      throw err;
    }

    const delay = this._randomDelay();
    log.debug(`Gateway simulator: processing delay ${delay}ms`);
    await sleep(delay);

    if (roll < this.timeoutRate + this.successRate) {
      const transactionId = `gw_${uuidv4()}`;
      log.info('Gateway simulator: charge approved', { transactionId, amount, currency });
      return {
        transactionId,
        gatewayStatus: 'SUCCESS',
        message: 'Charge approved',
      };
    }

    const reason = this._pickFailureReason(amount);
    log.warn('Gateway simulator: charge declined', { reason, amount, currency });
    const err = new Error(reason);
    err.code = 'GATEWAY_DECLINED';
    throw err;
  }

  _randomDelay() {
    return Math.floor(this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs));
  }

  _pickFailureReason(amount) {
    const reasons = [
      'Insufficient funds',
      'Card expired',
      'Do not honor',
      'Invalid card number',
      'Transaction limit exceeded',
      'Suspected fraud',
    ];
    if (amount > 10_000) return 'Transaction limit exceeded';
    return reasons[Math.floor(Math.random() * reasons.length)];
  }
}

const defaultGateway = new GatewaySimulator();

module.exports = { GatewaySimulator, defaultGateway };
