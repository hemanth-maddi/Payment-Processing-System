const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const { startWorkers, stopWorkers } = require('./workers/retryWorker');

const server = app.listen(config.server.port, () => {
  logger.info(`Payment Processing System started on port ${config.server.port}`);
  startWorkers();
});

function shutdown(signal) {
  logger.info(`${signal} received – shutting down gracefully`);
  stopWorkers();
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
});

module.exports = server;
