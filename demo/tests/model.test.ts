import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { SCENARIOS } from '../src/cases.ts';
import { advance, createInitialState, getScenario, replayTo, reset, TOTAL_STEPS } from '../src/model.ts';

const packet = JSON.parse(readFileSync(new URL('./fixtures/source-packets.json', import.meta.url), 'utf8'));

for (const scenario of SCENARIOS) {
  test(`${scenario.id}: rejection atomically discards the branch without changing the world`, () => {
    const initial = createInitialState(scenario);
    const states = [initial];
    for (let step = 1; step <= 5; step += 1) states.push(advance(states.at(-1)!));
    assert.equal(states[4].verdict, 'reject');
    assert.equal(states[4].outbox.length, 2);
    assert.notDeepEqual(states[4].speculative.rows, initial.committed.rows);
    for (const state of states) {
      assert.strictEqual(state.committed, initial.committed);
      assert.equal(state.commitCount, 0);
      assert.equal(state.committedEffects.length, 0);
    }
    const rolledBack = states[5];
    assert.equal(rolledBack.rolledBack, true);
    assert.equal(rolledBack.outbox.length, 0);
    assert.deepEqual(rolledBack.speculative.rows, rolledBack.checkpoint.rows);
    assert.equal(rolledBack.speculative.stagedEffects.length, 0);
    assert.equal(rolledBack.discardedEffects.length, 2);
    assert.equal(rolledBack.approvalValid, false);
  });

  test(`${scenario.id}: fresh approval releases one effect, then feedback invalidates the tail`, () => {
    const rerun = replayTo(scenario, 6);
    assert.equal(rerun.verdict, 'pending');
    assert.equal(rerun.approvalValid, false);
    assert.equal(rerun.outbox.length, 2);
    const reviewed = advance(rerun);
    assert.equal(reviewed.phase, 'reviewing');
    assert.equal(reviewed.commitCount, 0);
    const approved = advance(reviewed);
    assert.equal(approved.verdict, 'approve');
    assert.equal(approved.approvalValid, true);
    assert.equal(approved.outbox.length, 2);
    const committed = advance(approved);
    assert.equal(committed.commitCount, 1);
    assert.deepEqual(committed.committedEffects, [scenario.effectText]);
    assert.equal(committed.outbox.length, 1);
    assert.equal(committed.committed.stagedEffects.length, 0);
    assert.equal(committed.committed.revision, 1);
    assert.equal(committed.approvalValid, false);
    assert.equal(approved.committed.revision, 0);
    const feedback = advance(committed);
    assert.equal(feedback.approvalValid, false);
    assert.equal(feedback.outbox.length, 0);
    assert.equal(feedback.speculative.stagedEffects.length, 0);
    assert.strictEqual(feedback.committed, committed.committed);
    assert.equal(feedback.discardedEffects.length, 3);
    const restarted = advance(feedback);
    assert.equal(restarted.phase, 'restarting');
    assert.equal(restarted.transactionNumber, 3);
    assert.strictEqual(restarted.checkpoint, committed.committed);
    assert.strictEqual(restarted.speculative, committed.committed);
    assert.equal(restarted.verdict, 'pending');
    assert.equal(restarted.outbox.length, 0);
    const observed = advance(restarted);
    assert.equal(observed.events.at(-1)!.kind, 'tool');
    assert.strictEqual(observed.committed, committed.committed);
    const judged = advance(observed);
    assert.equal(judged.verdict, 'approve');
    assert.equal(judged.approvalValid, false);
    assert.equal(judged.outbox.length, 0);
    const finished = advance(judged);
    assert.equal(finished.finished, true);
    assert.equal(finished.commitCount, 1);
    assert.equal(finished.step, TOTAL_STEPS);
    assert.strictEqual(advance(finished), finished);
  });

  test(`${scenario.id}: restarting reuses the external action checkpoint and highlights adapter boundaries`, () => {
    const baseline = replayTo(scenario, 0);
    const corrected = replayTo(scenario, 6);
    const committed = replayTo(scenario, 9);
    const restarted = replayTo(scenario, 11);
    assert.equal(baseline.transactionNumber, 1);
    assert.equal(corrected.transactionNumber, 2);
    assert.equal(restarted.transactionNumber, 3);
    assert.deepEqual(restarted.checkpoint, committed.committed);
    assert.deepEqual(restarted.speculative, committed.committed);
    assert.equal(restarted.checkpoint.revision, 1);
    assert.equal(restarted.checkpoint.stagedEffects.length, 0);
    for (let step = 11; step <= TOTAL_STEPS; step += 1) {
      const suffix = replayTo(scenario, step);
      assert.equal(suffix.commitCount, 1);
      assert.equal(suffix.outbox.length, 0);
      assert.deepEqual(suffix.committedEffects, [scenario.effectText]);
      assert.deepEqual(suffix.committed, committed.committed);
    }
    const final = replayTo(scenario, TOTAL_STEPS);
    for (const event of final.events) assert.equal(typeof event.requiresWorldAdapter, 'boolean');
    for (const index of [1, 2, 5, 8, 9]) {
      assert.equal(final.events[index].requiresWorldAdapter, true);
      assert.ok(final.events[index].toolName);
    }
    assert.equal(final.events[11].requiresWorldAdapter, scenario.tool !== 'JSON' && scenario.id !== 'E05');
    assert.equal(final.events[12].requiresWorldAdapter, false);
    assert.ok(!final.events.some(event => /\bdemo\b|\bscripted\b|\bsimulated\b/i.test(`${event.title} ${event.detail} ${event.actor}`)));
  });

  test(`${scenario.id}: replay is immutable, deterministic, and has three world rows throughout`, () => {
    let state = createInitialState(scenario);
    for (let step = 0; step <= TOTAL_STEPS; step += 1) {
      assert.deepEqual(state, replayTo(scenario.id, step));
      assert.equal(state.step, step);
      assert.equal(state.events.length, step);
      assert.equal(state.speculative.rows.length, 3);
      assert.equal(state.committed.rows.length, 3);
      assert.equal(state.checkpoint.rows.length, 3);
      assert.equal(new Set(state.events.map(event => event.id)).size, step);
      assert.ok(state.events.every(event => event.provenance === 'scripted_replay'));
      assert.ok(Object.isFrozen(state));
      assert.ok(Object.isFrozen(state.outbox));
      assert.ok(Object.isFrozen(state.speculative.rows[0]));
      const previous = JSON.stringify(state);
      const next = advance(state);
      assert.equal(JSON.stringify(state), previous);
      state = next;
    }
    assert.deepEqual(reset(state), createInitialState(scenario));
  });

  if (scenario.origin === 'historical') test(`${scenario.id}: displayed historical excerpts and complete content match exact local packets`, () => {
    const episode = packet.episodes.find((episode: { episode_id: string }) => episode.episode_id === scenario.id);
    assert.ok(episode);
    const historical = scenario.evidence.filter(evidence => evidence.kind === 'historical_quote');
    assert.ok(historical.length >= 3);
    for (const evidence of historical) {
      const message = episode.messages.find((message: { id: string }) => message.id === evidence.id);
      assert.ok(message, evidence.id);
      assert.equal(evidence.content, message.content);
      assert.equal(evidence.createdAt, message.created_at_utc);
      assert.equal(evidence.speaker, message.agent);
      assert.ok(evidence.content.includes(evidence.excerpt), evidence.id);
      assert.ok(evidence.anchor.includes(evidence.id));
      assert.equal(evidence.sourcePath, 'experiments/unexpected-v2/packets-extended.json');
    }
    assert.ok(scenario.evidence.some(evidence => evidence.sourcePath === 'experiments/unexpected-v1/results.json'));
    for (const frame of scenario.replay) {
      for (const id of frame.evidenceIds) assert.ok(scenario.evidence.some(evidence => evidence.id === id), id);
    }
  });
}

test('INBOX: fictional default fixture uses a bounded Los Angeles calendar day and preserves today’s three emails', () => {
  const inbox = SCENARIOS[0];
  assert.equal(inbox.id, 'INBOX');
  assert.equal(inbox.origin, 'fictional');
  assert.equal(inbox.tool, 'Email');
  assert.equal(inbox.sourceRun, 'Fictional inbox fixture');
  assert.equal(createInitialState().scenarioId, 'INBOX');
  assert.ok(inbox.evidence.every(evidence => evidence.kind === 'source_fact'));
  assert.ok(inbox.evidence.every(evidence => evidence.sourcePath === 'demo/src/cases.ts'));
  assert.ok(inbox.limitation.includes('authored fixtures'));
  const mailbox = JSON.parse(inbox.evidence.find(evidence => evidence.id === 'INBOX-mailbox')!.content);
  const lower = Date.parse('2026-10-03T00:00:00-07:00');
  const upper = Date.parse('2026-10-04T00:00:00-07:00');
  const unbounded = mailbox.filter((message: { receivedAt: string }) => Date.parse(message.receivedAt) >= lower);
  const bounded = mailbox.filter((message: { receivedAt: string }) => Date.parse(message.receivedAt) >= lower && Date.parse(message.receivedAt) < upper);
  assert.equal(unbounded.length, 8);
  assert.deepEqual(bounded.map((message: { id: string }) => message.id), ['Y01', 'Y02', 'Y03', 'Y04', 'Y05']);
  assert.deepEqual(mailbox.filter((message: { receivedAt: string }) => Date.parse(message.receivedAt) >= upper).map((message: { id: string }) => message.id), ['T01', 'T02', 'T03']);
  assert.equal(replayTo(inbox, 0).committed.rows[0].value, '8 emails');
  assert.equal(replayTo(inbox, 2).speculative.rows[0].value, '0 emails');
  assert.equal(replayTo(inbox, 5).speculative.rows[0].value, '8 emails');
  assert.equal(replayTo(inbox, 6).speculative.rows[0].value, '3 emails');
  const final = replayTo(inbox, TOTAL_STEPS);
  assert.equal(final.committed.rows[0].value, '3 emails');
  assert.equal(final.committed.rows[1].value, '3 messages · today preserved');
  assert.equal(final.committed.rows[2].value, 'Nothing sent');
  assert.deepEqual(final.committedEffects, ['Delete the 5 messages received yesterday']);
  assert.ok(final.discardedEffects.includes('Send a “5 emails deleted” cleanup notification'));
  for (const frame of inbox.replay) {
    for (const id of frame.evidenceIds) assert.ok(inbox.evidence.some(evidence => evidence.id === id), id);
  }
});

test('presenter jumps clamp cleanly, unknown scenarios are rejected, and E06 does not invent a wrong URL', () => {
  assert.equal(replayTo('E05', -100).step, 0);
  assert.equal(replayTo('E05', 100).step, TOTAL_STEPS);
  assert.throws(() => getScenario('missing'), /Unknown replay scenario/);
  assert.throws(() => createInitialState('missing'), /Unknown replay scenario/);
  const wrongUrlBranch = replayTo('E06', 2);
  assert.equal(wrongUrlBranch.speculative.rows[0].value, 'Inspected target not bound to canonical exhibit');
  assert.ok(!wrongUrlBranch.speculative.rows[0].value.includes('http'));
});
