const cron = require('node-cron');
const logger = require('../utils/logger');
const { processScheduledRetries, recoverStuckPayments } = require('../services/paymentService');

let retryTask = null;
let recoveryTask = null;

function startWorkers() {
  retryTask = cron.schedule('*/10 * * * * *', async () => {
    try {
      await processScheduledRetries();
    } catch (err) {
      logger.error('Retry worker error', { error: err.message });
    }
  });

  recoveryTask = cron.schedule('*/60 * * * * *', async () => {
    try {
      await recoverStuckPayments();
    } catch (err) {
      logger.error('Recovery worker error', { error: err.message });
    }
  });

  logger.info('Background workers started (retry: 10s, recovery: 60s)');
}

function stopWorkers() {
  if (retryTask) { retryTask.stop(); retryTask = null; }
  if (recoveryTask) { recoveryTask.stop(); recoveryTask = null; }
  logger.info('Background workers stopped');
}

module.exports = { startWorkers, stopWorkers };
