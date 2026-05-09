const config = {
  server: {
    port: process.env.PORT || 3000,
  },

  payment: {
    processingTimeoutMs: parseInt(process.env.PAYMENT_PROCESSING_TIMEOUT_MS, 10) || 30_000,
  },

  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS, 10) || 3,
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 1_000,
    maxDelayMs: parseInt(process.env.RETRY_MAX_DELAY_MS, 10) || 30_000,
  },

  circuitBreaker: {
    failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD, 10) || 5,
    openTimeoutMs: parseInt(process.env.CB_OPEN_TIMEOUT_MS, 10) || 60_000,
  },

  gateway: {
    successRate: parseFloat(process.env.GATEWAY_SUCCESS_RATE) || 0.7,
    timeoutRate: parseFloat(process.env.GATEWAY_TIMEOUT_RATE) || 0.1,
    minDelayMs: parseInt(process.env.GATEWAY_MIN_DELAY_MS, 10) || 200,
    maxDelayMs: parseInt(process.env.GATEWAY_MAX_DELAY_MS, 10) || 2_000,
    timeoutMs: parseInt(process.env.GATEWAY_TIMEOUT_MS, 10) || 5_000,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },
};

module.exports = config;
