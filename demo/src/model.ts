import { SCENARIOS } from './cases.ts';

export type Phase =
  | 'ready' | 'checkpoint' | 'speculating' | 'reviewing' | 'rejected'
  | 'rollback' | 'rerunning' | 'approved' | 'committing' | 'feedback' | 'restarting' | 'complete';
export type EventKind =
  | 'checkpoint' | 'agent' | 'tool' | 'environment' | 'review'
  | 'rollback' | 'commit' | 'feedback' | 'complete';
export type Verdict = 'pending' | 'reject' | 'approve';

export interface WorldRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface Evidence {
  readonly id: string;
  readonly label: string;
  readonly sourcePath: string;
  readonly anchor: string;
  readonly kind: 'historical_quote' | 'source_fact';
  readonly content: string;
  readonly excerpt: string;
  readonly speaker: string;
  readonly createdAt: string;
}

export interface ReplayEvent {
  readonly id: string;
  readonly at: string;
  readonly kind: EventKind;
  readonly actor: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceIds: readonly string[];
  readonly provenance: 'scripted_replay';
  readonly branch: 'baseline' | 'attempt-1' | 'attempt-2' | 'attempt-3' | 'committed';
  readonly requiresWorldAdapter: boolean;
  readonly toolName?: string;
}

export interface Snapshot {
  readonly id: string;
  readonly revision: number;
  readonly rows: readonly WorldRow[];
  readonly stagedEffects: readonly string[];
}

export interface ReplayFrame {
  readonly phase: Phase;
  readonly kind: EventKind;
  readonly actor: string;
  readonly title: string;
  readonly detail: string;
  readonly evidenceIds: readonly string[];
  readonly branch: ReplayEvent['branch'];
  readonly action?: 'fork' | 'stage' | 'reject' | 'rollback' | 'approve' | 'commit' | 'feedback' | 'restart' | 'approve-readonly' | 'complete';
  readonly requiresWorldAdapter?: boolean;
  readonly toolName?: string;
  readonly rows?: readonly WorldRow[];
  readonly effects?: readonly string[];
}

export interface Scenario {
  readonly id: string;
  readonly origin: 'fictional' | 'historical';
  readonly tool: 'Email' | 'Web' | 'JSON';
  readonly title: string;
  readonly summary: string;
  readonly sourceRun: string;
  readonly sourceDate: string;
  readonly agent: string;
  readonly issue: string;
  readonly limitation: string;
  readonly worldRows: readonly WorldRow[];
  readonly evidence: readonly Evidence[];
  readonly replay: readonly ReplayFrame[];
  readonly effectText: string;
  readonly wrongEffectText: string;
}

export interface ReplayState {
  readonly scenarioId: string;
  readonly transactionNumber: 1 | 2 | 3;
  readonly step: number;
  readonly phase: Phase;
  readonly events: readonly ReplayEvent[];
  readonly checkpoint: Snapshot;
  readonly speculative: Snapshot;
  readonly committed: Snapshot;
  readonly outbox: readonly string[];
  readonly verdict: Verdict;
  readonly approvalValid: boolean;
  readonly rolledBack: boolean;
  readonly commitCount: number;
  readonly committedEffects: readonly string[];
  readonly discardedEffects: readonly string[];
  readonly finished: boolean;
  readonly statusTitle: string;
  readonly statusDetail: string;
}

export const TOTAL_STEPS = 14;

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshot(id: string, revision: number, rows: readonly WorldRow[], effects: readonly string[] = []): Snapshot {
  return freeze({ id, revision, rows: rows.map(row => ({ ...row })), stagedEffects: [...effects] });
}

export function getScenario(id: string): Scenario {
  const scenario = SCENARIOS.find(item => item.id === id);
  if (!scenario) throw new Error(`Unknown replay scenario: ${id}`);
  return scenario;
}

export function createInitialState(scenario: Scenario | string = SCENARIOS[0]): ReplayState {
  const selected = typeof scenario === 'string' ? getScenario(scenario) : getScenario(scenario.id);
  if (selected.replay.length !== TOTAL_STEPS || selected.worldRows.length !== 3) {
    throw new Error(`Invalid replay fixture: ${selected.id}`);
  }
  const committed = snapshot(`${selected.id}/world@0`, 0, selected.worldRows);
  return freeze({
    scenarioId: selected.id,
    transactionNumber: 1,
    step: 0,
    phase: 'ready',
    events: [],
    checkpoint: committed,
    speculative: snapshot(`${selected.id}/idle`, 0, selected.worldRows),
    committed,
    outbox: [],
    verdict: 'pending',
    approvalValid: false,
    rolledBack: false,
    commitCount: 0,
    committedEffects: [],
    discardedEffects: [],
    finished: false,
    statusTitle: 'Ready to run',
    statusDetail: 'Checkpoint the world, run a speculative branch, review the full trajectory, and release only an approved effect.',
  });
}

/** Pure, deterministic presentation replay. It never invokes a model or external tool. */
export function advance(state: ReplayState): ReplayState {
  if (state.finished) return state;
  const scenario = getScenario(state.scenarioId);
  const frame = scenario.replay[state.step];
  if (!frame) return state;
  const step = state.step + 1;
  const event: ReplayEvent = freeze({
    id: `${scenario.id}/replay/${String(step).padStart(2, '0')}`,
    at: `T+${String(step * 4).padStart(2, '0')}s`,
    kind: frame.kind,
    actor: frame.actor,
    title: frame.title,
    detail: frame.detail,
    evidenceIds: [...frame.evidenceIds],
    provenance: 'scripted_replay',
    branch: frame.branch,
    requiresWorldAdapter: frame.requiresWorldAdapter ?? false,
    ...(frame.toolName ? { toolName: frame.toolName } : {}),
  });

  let speculative = state.speculative;
  let committed = state.committed;
  let checkpoint = state.checkpoint;
  let outbox = [...state.outbox];
  let verdict = state.verdict;
  let approvalValid = state.approvalValid;
  let rolledBack = state.rolledBack;
  let commitCount = state.commitCount;
  let committedEffects = [...state.committedEffects];
  let discardedEffects = [...state.discardedEffects];
  let transactionNumber = state.transactionNumber;

  if (frame.action === 'fork') {
    checkpoint = state.committed;
    speculative = snapshot(`${scenario.id}/attempt-1@1`, checkpoint.revision, checkpoint.rows);
  }
  if (frame.action === 'stage') {
    outbox = [...(frame.effects ?? [])];
    speculative = snapshot(`${scenario.id}/${frame.branch}@${step}`, checkpoint.revision, frame.rows ?? speculative.rows, outbox);
    verdict = 'pending';
    approvalValid = false;
    if (frame.branch === 'attempt-2') transactionNumber = 2;
  }
  if (frame.action === 'reject') {
    verdict = 'reject';
    approvalValid = false;
  }
  if (frame.action === 'rollback') {
    discardedEffects.push(...outbox);
    outbox = [];
    speculative = snapshot(`${scenario.id}/restored@${step}`, checkpoint.revision, checkpoint.rows);
    // committed never entered the speculative branch, so there is nothing to undo there.
    rolledBack = true;
    approvalValid = false;
  }
  if (frame.action === 'approve') {
    verdict = 'approve';
    approvalValid = true;
  }
  if (frame.action === 'commit') {
    if (verdict !== 'approve' || !approvalValid || outbox.length === 0 || commitCount !== 0) {
      throw new Error('Cannot release an effect without a fresh approved trajectory.');
    }
    const effect = outbox.shift()!;
    committedEffects.push(effect);
    commitCount += 1;
    committed = snapshot(`${scenario.id}/world@1`, state.committed.revision + 1, frame.rows ?? speculative.rows);
    speculative = snapshot(`${scenario.id}/attempt-2@${step}`, committed.revision, committed.rows, outbox);
    approvalValid = false;
  }
  if (frame.action === 'feedback') {
    // External feedback makes the simulated tail stale. It cannot inherit the earlier approval.
    discardedEffects.push(...outbox);
    outbox = [];
    approvalValid = false;
    speculative = snapshot(`${scenario.id}/replanned@${step}`, committed.revision, committed.rows);
  }
  if (frame.action === 'restart') {
    if (outbox.length !== 0) throw new Error('Cannot restart with an unreconciled speculative tail.');
    // Resume at the committed external action, with its returned response and current world.
    // The rejected/forecast suffix cannot become the next agent's starting checkpoint.
    checkpoint = committed;
    speculative = committed;
    transactionNumber = 3;
    verdict = 'pending';
    approvalValid = false;
  }
  if (frame.action === 'approve-readonly') {
    if (outbox.length !== 0) throw new Error('The completion trajectory must have no pending effects.');
    verdict = 'approve';
    approvalValid = false;
  }

  return freeze({
    ...state,
    step,
    transactionNumber,
    phase: frame.phase,
    events: [...state.events, event],
    checkpoint,
    speculative,
    committed,
    outbox,
    verdict,
    approvalValid,
    rolledBack,
    commitCount,
    committedEffects,
    discardedEffects,
    finished: frame.action === 'complete',
    statusTitle: frame.title,
    statusDetail: frame.detail,
  });
}

export function reset(stateOrScenario: ReplayState | Scenario | string = SCENARIOS[0]): ReplayState {
  if (typeof stateOrScenario === 'string') return createInitialState(stateOrScenario);
  return createInitialState('scenarioId' in stateOrScenario ? stateOrScenario.scenarioId : stateOrScenario.id);
}

/** Convenient for presenter jump controls; recomputes from the immutable checkpoint. */
export function replayTo(scenario: Scenario | string, step: number): ReplayState {
  let state = createInitialState(scenario);
  const target = Math.min(TOTAL_STEPS, Math.max(0, Math.floor(step)));
  for (let i = 0; i < target; i += 1) state = advance(state);
  return state;
}
