const { computeBackoffDelay, canRetry, nextRetryAt, withRetry } = require('../../src/utils/retry');
const { CircuitBreaker, CircuitState } = require('../../src/utils/circuitBreaker');

describe('computeBackoffDelay', () => {
  it('increases delay with each attempt', () => {
    const d1 = computeBackoffDelay(1, { baseDelayMs: 1000, maxDelayMs: 30000 });
    const d2Max = 2000; 
    const d3Max = 4000;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const ceiling = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      const d = computeBackoffDelay(attempt, { baseDelayMs: 1000, maxDelayMs: 30000 });
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(ceiling);
    }
  });

  it('never exceeds maxDelayMs', () => {
    for (let i = 0; i < 100; i++) {
      const d = computeBackoffDelay(20, { baseDelayMs: 1000, maxDelayMs: 5000 });
      expect(d).toBeLessThanOrEqual(5000);
    }
  });
});

describe('canRetry', () => {
  it('returns true when under maxAttempts', () => {
    expect(canRetry({ attempts: 0 })).toBe(true);
    expect(canRetry({ attempts: 2 })).toBe(true);
  });

  it('returns false when at maxAttempts', () => {
    expect(canRetry({ attempts: 3 })).toBe(false);
    expect(canRetry({ attempts: 10 })).toBe(false);
  });
});

describe('nextRetryAt', () => {
  it('returns a future ISO timestamp', () => {
    const ts = nextRetryAt(1, { baseDelayMs: 100, maxDelayMs: 1000 });
    expect(new Date(ts).getTime()).toBeGreaterThanOrEqual(Date.now());
  });
});

describe('withRetry', () => {
  it('succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return 'success';
    });
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 }))
      .rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry callback with attempt and error', async () => {
    const retries = [];
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok');

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
      onRetry: (attempt, err) => retries.push({ attempt, msg: err.message }),
    });

    expect(retries).toHaveLength(2);
    expect(retries[0]).toMatchObject({ attempt: 1, msg: 'fail1' });
    expect(retries[1]).toMatchObject({ attempt: 2, msg: 'fail2' });
  });
});

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, openTimeoutMs: 500, name: 'test' });
  });

  it('starts CLOSED', () => {
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it('passes through successful calls', async () => {
    const result = await cb.call(() => Promise.resolve('data'));
    expect(result).toBe('data');
    expect(cb.state).toBe(CircuitState.CLOSED);
    expect(cb.failureCount).toBe(0);
  });

  it('counts failures', async () => {
    const fail = () => Promise.reject(new Error('boom'));
    await expect(cb.call(fail)).rejects.toThrow('boom');
    await expect(cb.call(fail)).rejects.toThrow('boom');
    expect(cb.failureCount).toBe(2);
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 3; i++) {
      await expect(cb.call(fail)).rejects.toThrow();
    }
    expect(cb.state).toBe(CircuitState.OPEN);
  });

  it('fast-fails when OPEN', async () => {
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 3; i++) await expect(cb.call(fail)).rejects.toThrow();

    // Now open – should fail fast without calling fn
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(cb.call(fn)).rejects.toThrow(/Circuit breaker OPEN/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('transitions to HALF_OPEN after timeout and closes on success', async () => {
    cb = new CircuitBreaker({ failureThreshold: 2, openTimeoutMs: 50, name: 'test' });
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 2; i++) await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe(CircuitState.OPEN);

    // Wait for open timeout
    await new Promise((r) => setTimeout(r, 60));

    const result = await cb.call(() => Promise.resolve('probe ok'));
    expect(result).toBe('probe ok');
    expect(cb.state).toBe(CircuitState.CLOSED);
  });

  it('reopens if HALF_OPEN probe fails', async () => {
    cb = new CircuitBreaker({ failureThreshold: 2, openTimeoutMs: 50, name: 'test' });
    const fail = () => Promise.reject(new Error('boom'));
    for (let i = 0; i < 2; i++) await expect(cb.call(fail)).rejects.toThrow();

    await new Promise((r) => setTimeout(r, 60));
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.state).toBe(CircuitState.OPEN);
  });

  it('resets failure count on success', async () => {
    const fail = () => Promise.reject(new Error('boom'));
    await expect(cb.call(fail)).rejects.toThrow();
    await expect(cb.call(fail)).rejects.toThrow();
    expect(cb.failureCount).toBe(2);

    await cb.call(() => Promise.resolve('ok'));
    expect(cb.failureCount).toBe(0);
    expect(cb.state).toBe(CircuitState.CLOSED);
  });
});
