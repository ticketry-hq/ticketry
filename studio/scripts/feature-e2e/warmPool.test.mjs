import test from 'node:test';
import assert from 'node:assert/strict';
import { createWarmPool, warmLookahead } from './warmPool.mjs';

const fakeStarts = () => {
  const events = [];
  const start = async (index) => {
    events.push(`start ${index}`);
    if (index === 2) throw new Error('boot failed');
    return { stop: async () => { events.push(`stop ${index}`); } };
  };
  return { events, start };
};

test('taking an invocation warms the next one, which is then reused', async () => {
  const { events, start } = fakeStarts();
  const pool = createWarmPool({ count: 3, start, lookahead: 1 });
  await pool.take(0);
  assert.deepEqual(events, ['start 0', 'start 1']);
  assert.equal(pool.warmed(0), false);
  await pool.take(1);
  assert.equal(pool.warmed(1), true);
  assert.deepEqual(events.filter((event) => event === 'start 1'), ['start 1']);
});

test('cold-start invocations are never warmed ahead of their turn', async () => {
  const { events, start } = fakeStarts();
  const pool = createWarmPool({ count: 2, start, lookahead: 1, isCold: (index) => index === 1 });
  await pool.take(0);
  assert.deepEqual(events, ['start 0']);
});

test('lookahead zero keeps the old one-at-a-time behaviour', async () => {
  const { events, start } = fakeStarts();
  const pool = createWarmPool({ count: 3, start, lookahead: 0 });
  await pool.take(0);
  assert.deepEqual(events, ['start 0']);
});

test('a failed warm start surfaces when its invocation takes it', async () => {
  const { start } = fakeStarts();
  const pool = createWarmPool({ count: 3, start, lookahead: 1 });
  await pool.take(0);
  await pool.take(1);
  await assert.rejects(pool.take(2), /boot failed/);
});

test('closing stops only servers that were warmed but never taken', async () => {
  const { events, start } = fakeStarts();
  const pool = createWarmPool({ count: 2, start, lookahead: 1 });
  await pool.take(0);
  assert.deepEqual(await pool.close(), [1]);
  assert.deepEqual(events, ['start 0', 'start 1', 'stop 1']);
});

test('lookahead is configurable and validated', () => {
  assert.equal(warmLookahead({}), 1);
  assert.equal(warmLookahead({ TICKETRY_E2E_LOOKAHEAD: '0' }), 0);
  assert.throws(() => warmLookahead({ TICKETRY_E2E_LOOKAHEAD: '-1' }), /non-negative/);
});
