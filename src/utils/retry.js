const config = require('../config');
const logger = require('../utils/logger');

function computeBackoffDelay(attempt, opts = {}) {
  const baseDelayMs = opts.baseDelayMs ?? config.retry.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? config.retry.maxDelayMs;

  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1));
  const jitter = Math.random(); 
  return Math.floor(exponential * jitter);
}


function nextRetryAt(attempt, opts = {}) {
  const delay = computeBackoffDelay(attempt, opts);
  return new Date(Date.now() + delay).toISOString();
}

function canRetry(payment) {
  const maxAttempts = config.retry.maxAttempts;
  return payment.attempts < maxAttempts;
}


async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? config.retry.maxAttempts;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts) {
        const delay = computeBackoffDelay(attempt, opts);
        if (opts.onRetry) opts.onRetry(attempt, err, delay);
        logger.debug(`withRetry: attempt ${attempt} failed – retrying in ${delay}ms`, { error: err.message });
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { computeBackoffDelay, nextRetryAt, canRetry, withRetry, sleep };
