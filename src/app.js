const express = require('express');
const logger = require('./utils/logger');
const paymentsRouter = require('./routes/payments');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use('/payments', paymentsRouter);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use((req, res) => {
  res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` });
});

app.use(errorHandler);

module.exports = app;
