const logger = require('../utils/logger');

function errorHandler(err, req, res, next) { 
  const statusMap = {
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    INVALID_TRANSITION: 409,
    CIRCUIT_OPEN: 503,
    LOCK_CONFLICT: 409,
  };

  const status = statusMap[err.code] || 500;

  if (status >= 500) {
    logger.error('Unhandled error', { path: req.path, method: req.method, error: err.message, stack: err.stack });
  } else {
    logger.warn('Client error', { path: req.path, method: req.method, code: err.code, message: err.message });
  }

  return res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message,
    ...(err.details && { details: err.details }),
  });
}

module.exports = { errorHandler };
