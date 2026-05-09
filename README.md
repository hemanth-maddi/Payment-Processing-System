# Payment Processing System

A backend REST API built with **Node.js + Express** that simulates a real-world payment gateway — complete with retry logic, idempotency, circuit breaker, concurrency control, and webhook handling.

---

## Features

- **Payment lifecycle** — `PENDING → PROCESSING → SUCCESS / FAILED` state machine with guarded transitions
- **Idempotency** — duplicate requests via `Idempotency-Key` header return the original payment without re-charging
- **Retry with exponential backoff** — failed payments are automatically retried with jitter to avoid thundering-herd
- **Circuit breaker** — stops hammering a degraded gateway; auto-recovers after a cooldown period
- **Concurrency control** — per-payment lock prevents race conditions and double-processing
- **Gateway simulation** — configurable success rate, declines, delays, and timeouts
- **Webhook handling** — outbound event delivery with retry, plus inbound callback deduplication
- **Stuck payment recovery** — watchdog cron resets payments stuck in `PROCESSING` after a crash
- **Rate limiting** — sliding window per IP with `X-RateLimit-*` headers

---

## Tech Stack

- **Runtime** — Node.js
- **Framework** — Express
- **Testing** — Jest + Supertest (61 tests)
- **Logging** — Winston (structured, per-payment trace IDs)
- **Scheduler** — node-cron (retry worker + recovery worker)

---

## Getting Started

```bash
# Install dependencies
npm install

# Start the server (runs on port 3000)
npm start

# Run tests
npm test
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/payments` | Initiate a new payment |
| `GET` | `/payments/:id` | Get payment status and details |
| `GET` | `/payments/:id/events` | Full audit trail for a payment |
| `POST` | `/payments/webhooks/inbound` | Receive async gateway callbacks |
| `GET` | `/payments/system/health` | Circuit breaker state + system health |

### Initiate a payment

```bash
curl -X POST http://localhost:3000/payments \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-xyz-001" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "merchantId": "merchant_abc",
    "customerId": "cust_123"
  }'
```

```json
{
  "paymentId": "f47ac10b-...",
  "status": "PENDING",
  "amount": 5000,
  "currency": "USD",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "idempotent": false
}
```

---

## Configuration

Tune behaviour via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `RETRY_MAX_ATTEMPTS` | `3` | Max retries per payment |
| `RETRY_BASE_DELAY_MS` | `1000` | Backoff base delay (ms) |
| `CB_FAILURE_THRESHOLD` | `5` | Failures before circuit opens |
| `GATEWAY_SUCCESS_RATE` | `0.7` | Simulated gateway success rate |
| `GATEWAY_TIMEOUT_RATE` | `0.1` | Simulated gateway timeout rate |

---

## Project Structure

```
src/
├── config/          # Environment config
├── models/          # In-memory store + payment state machine
├── services/        # Core logic (payment, gateway, webhook)
├── utils/           # Circuit breaker, retry, logger
├── middleware/      # Error handler, rate limiter
├── routes/          # Express route definitions
├── workers/         # Background retry + recovery cron jobs
└── server.js        # Entry point
tests/
├── unit/            # Model, retry, circuit breaker
└── integration/     # API, webhooks, retry worker
```

---
