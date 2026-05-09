const config = require('../config');
const logger = require('../utils/logger');

const windowMs = config.rateLimit.windowMs;
const maxRequests = config.rateLimit.maxRequests;

const requestLog = new Map();

function rateLimiter(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();

  if (!requestLog.has(key)) requestLog.set(key, []);

  const timestamps = requestLog.get(key).filter((ts) => now - ts < windowMs);
  timestamps.push(now);
  requestLog.set(key, timestamps);

  const remaining = Math.max(0, maxRequests - timestamps.length);
  const reset = Math.ceil((timestamps[0] + windowMs - now) / 1000);

  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', reset);

  if (timestamps.length > maxRequests) {
    logger.warn('Rate limit exceeded', { key, count: timestamps.length });
    return res.status(429).json({
      error: 'TOO_MANY_REQUESTS',
      message: `Rate limit exceeded. Try again in ${reset}s`,
      retryAfter: reset,
    });
  }

  next();
}

function _reset() {
  requestLog.clear();
}

module.exports = { rateLimiter, _reset };
