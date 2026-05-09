const { createLogger, format, transports } = require('winston');

const { combine, timestamp, printf, colorize, errors } = format;

const logFormat = printf(({ level, message, timestamp, paymentId, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` | ${JSON.stringify(meta)}` : '';
  const pidStr = paymentId ? ` [payment:${paymentId}]` : '';
  return `${timestamp} ${level}${pidStr}: ${message}${metaStr}`;
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    logFormat
  ),
  transports: [
    new transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss.SSS' }), logFormat),
      silent: process.env.NODE_ENV === 'test',
    }),
  ],
});

logger.forPayment = (paymentId) => logger.child({ paymentId });

module.exports = logger;
