const config = require('../config');
const logger = require('../utils/logger');

const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

class CircuitBreaker {
  constructor({ failureThreshold, openTimeoutMs, name = 'gateway' } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold ?? config.circuitBreaker.failureThreshold;
    this.openTimeoutMs = openTimeoutMs ?? config.circuitBreaker.openTimeoutMs;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
  }


  async call(fn) {
    if (this.state === CircuitState.OPEN) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.openTimeoutMs) {
        const err = new Error(`Circuit breaker OPEN for ${this.name}. Retry after ${Math.ceil((this.openTimeoutMs - elapsed) / 1000)}s`);
        err.code = 'CIRCUIT_OPEN';
        throw err;
      }
      this._toHalfOpen();
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.info(`[CircuitBreaker:${this.name}] Probe succeeded – closing circuit`);
    }
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  _onFailure(err) {
    this.failureCount++;
    this.lastFailureAt = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      logger.warn(`[CircuitBreaker:${this.name}] Probe failed – reopening circuit`);
      this._toOpen();
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      logger.error(`[CircuitBreaker:${this.name}] Failure threshold reached (${this.failureCount}) – opening circuit`);
      this._toOpen();
    }
  }

  _toOpen() {
    this.state = CircuitState.OPEN;
    this.openedAt = Date.now();
  }

  _toHalfOpen() {
    logger.info(`[CircuitBreaker:${this.name}] Transitioning to HALF_OPEN`);
    this.state = CircuitState.HALF_OPEN;
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
    };
  }

  _reset() {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.lastFailureAt = null;
    this.openedAt = null;
  }
}

const gatewayCircuitBreaker = new CircuitBreaker({ name: 'external-gateway' });

module.exports = { CircuitBreaker, CircuitState, gatewayCircuitBreaker };
