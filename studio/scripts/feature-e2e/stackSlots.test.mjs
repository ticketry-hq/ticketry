import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireStackSlot, admissionDecision, availableMemoryMb, liveSlots, slotWaitReporter, stackSlotPolicy } from './stackSlots.mjs';

const withDirectory = async (body) => {
  const directory = mkdtempSync(join(tmpdir(), 'stack-slots-'));
  try { await body(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
};
const policy = (directory, overrides = {}) => ({ directory, maxStacks: 2, stackMemoryMb: 1000, memoryFloorMb: 2000, ...overrides });
const slots = (directory) => readdirSync(directory).filter((name) => name.startsWith('slot-'));

test('policy scales the stack cap with installed memory and honours overrides', () => {
  assert.equal(stackSlotPolicy({}, 16384).maxStacks, 2);
  assert.equal(stackSlotPolicy({}, 4096).maxStacks, 1);
  assert.equal(stackSlotPolicy({ TICKETRY_E2E_MAX_STACKS: '5' }, 16384).maxStacks, 5);
  assert.throws(() => stackSlotPolicy({ TICKETRY_E2E_MAX_STACKS: '0' }), /at least 1/);
  assert.throws(() => stackSlotPolicy({ TICKETRY_E2E_STACK_MEMORY_MB: 'lots' }), /non-negative integer/);
});

test('macOS availability uses the kernel memory level rather than free pages', () => {
  const run = () => '25\n17179869184\n';
  assert.equal(availableMemoryMb({ run, os: 'darwin' }), 4096);
});

test('the cap and the memory floor both gate admission, but an idle machine always admits one stack', () => {
  const now = 1_000_000;
  const old = { admittedAt: now - 120_000, owner: 'a' };
  const fresh = { admittedAt: now - 1_000, owner: 'b' };
  const p = policy('/unused');
  assert.equal(admissionDecision({ live: [], availableMb: 100, policy: p, now }).admitted, true);
  assert.equal(admissionDecision({ live: [old], availableMb: 3500, policy: p, now }).admitted, true);
  assert.equal(admissionDecision({ live: [old], availableMb: 2500, policy: p, now }).admitted, false);
  // A stack admitted moments ago has not allocated yet, so its budget is reserved.
  assert.equal(admissionDecision({ live: [fresh], availableMb: 3500, policy: p, now }).admitted, false);
  assert.equal(admissionDecision({ live: [old, old], availableMb: 64_000, policy: p, now }).admitted, false);
});

test('dead holders are reclaimed and released slots disappear', async () => withDirectory(async (directory) => {
  writeFileSync(join(directory, 'slot-dead.json'), JSON.stringify({ pid: 999_999, owner: 'crashed', admittedAt: Date.now() }));
  assert.deepEqual(liveSlots(directory, { isAlive: () => false }), []);
  assert.deepEqual(slots(directory), []);
  const slot = await acquireStackSlot({ owner: 'case', policy: policy(directory), readMemory: () => 64_000 });
  assert.equal(slots(directory).length, 1);
  slot.release();
  assert.equal(slots(directory).length, 0);
}));

test('a full queue waits, reports why, and admits once a holder releases', async () => withDirectory(async (directory) => {
  const p = policy(directory, { maxStacks: 1 });
  const first = await acquireStackSlot({ owner: 'first', policy: p, readMemory: () => 64_000 });
  const waits = [];
  const second = await acquireStackSlot({
    owner: 'second', policy: p, readMemory: () => 64_000,
    onWait: (decision) => waits.push(decision),
    sleep: async () => { if (waits.length === 2) first.release(); },
  });
  assert.equal(waits.length, 2);
  assert.deepEqual(waits[0].owners, ['first']);
  assert.equal(slots(directory).length, 1);
  second.release();
}));

test('waiting can be cancelled', async () => withDirectory(async (directory) => {
  const p = policy(directory, { maxStacks: 1 });
  const held = await acquireStackSlot({ owner: 'held', policy: p, readMemory: () => 64_000 });
  let stop = false;
  await assert.rejects(acquireStackSlot({ owner: 'waiting', policy: p, readMemory: () => 64_000,
    sleep: async () => { stop = true; }, shouldStop: () => stop }), /Stopped while waiting/);
  held.release();
}));

test('wait reports are throttled', () => {
  let clock = 0;
  const lines = [];
  const report = slotWaitReporter('case', { now: () => clock, write: (line) => lines.push(line), intervalMs: 10 });
  const decision = { held: 2, maxStacks: 2, availableMb: 1, reservedMb: 0, headroomMb: 0, memoryFloorMb: 0, owners: [] };
  report(decision); clock = 5; report(decision); clock = 11; report(decision);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /2\/2 e2e stacks running/);
});
