import './style.css';
import './tool.css';
import { SCENARIOS } from './cases.ts';
import { advance, createInitialState, TOTAL_STEPS, type ReplayState, type ReplayEvent, type Scenario, type Snapshot } from './model.ts';

const icons: Record<string, string> = {
  logo: '<path d="M8 4H4v16h4m8-16h4v16h-4M9 9l6 6m0-6-6 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  pause: '<path d="M8 5v14m8-14v14"/>',
  step: '<path d="m5 5 10 7-10 7Z"/><path d="M19 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1.7 8M3 4v6h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  branch: '<path d="M6 5v14m0-7h8a4 4 0 0 0 4-4V5"/><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="4" r="2"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  book: '<path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Zm0 0v15"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  json: '<path d="M8 3H6v7l-3 2 3 2v7h2m8-18h2v7l3 2-3 2v7h-2"/>',
  link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m-2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(2 0)"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
};
function icon(name: string, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.branch}</svg>`; }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const app = document.querySelector<HTMLDivElement>('#app')!;
const initialCase = SCENARIOS.find(s => s.id === new URLSearchParams(location.search).get('case')) ?? SCENARIOS[0];
let state: ReplayState = createInitialState(initialCase.id);
let playing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let speed = 1;
let modal: 'evidence' | 'architecture' | 'trace' | null = null;
let lastFocusId = '';
const getCase = () => SCENARIOS.find(s => s.id === state.scenarioId)!;
const caseUI: Record<string, { title: string; subtitle: string; category: string; icon: string; question: string; takeaway: string }> = {
  INBOX: { title: 'A small cleanup. A big overreach.', subtitle: 'Delete yesterday’s emails. Keep today’s inbox intact.', category: 'Scope & side effects', icon: 'mail', question: 'What if a date filter deletes more than you asked for?', takeaway: 'Let the agent see the consequences before they become yours.' },
  E05: { title: 'The vote that closed too early.', subtitle: 'A calendar constraint acknowledged. Then forgotten.', category: 'Temporal reasoning', icon: 'clock', question: 'What if “tomorrow” quietly becomes “today”?', takeaway: 'The agent remembers the time. The harness checks the date.' },
  E02: { title: 'The metrics that weren’t missing.', subtitle: 'The right file. The wrong place to look.', category: 'Incomplete inspection', icon: 'json', question: 'What if a shallow check becomes a confident report?', takeaway: 'A missing top-level key is not a missing metric.' },
  E06: { title: 'The right exhibit. The wrong URL.', subtitle: 'A verification result attached to the wrong target.', category: 'Target confusion', icon: 'link', question: 'What if the agent verifies the wrong thing?', takeaway: 'Verify the target before trusting the result.' },
};
const ui = () => caseUI[state.scenarioId] ?? caseUI.E05;

function world(snapshot: Snapshot, speculative: boolean) {
  const changed = snapshot.rows.some((r, i) => r.value !== state.committed.rows[i]?.value);
  const colorClass = speculative ? (state.verdict === 'reject' && !state.rolledBack ? 'world-bad' : 'world-spec') : 'world-real';
  return `<section class="world ${colorClass}" aria-label="${speculative ? 'Speculative world' : 'Committed world'}">
    <div class="world-heading"><span class="world-symbol">${icon(speculative ? 'branch' : 'lock')}</span><div><h3>${speculative ? 'Speculative world' : 'Committed world'}</h3><p>${speculative ? 'An isolated branch. Free to be wrong.' : 'Only approved effects cross this boundary.'}</p></div><span class="world-tag">${speculative ? (state.rolledBack && state.step === 5 ? 'RESTORED' : 'SANDBOX') : 'PROTECTED'}</span></div>
    <div class="world-rows" data-testid="${speculative ? 'speculative' : 'committed'}-state">${snapshot.rows.map((r, i) => `<div class="world-row ${speculative && r.value !== state.committed.rows[i]?.value ? 'mutated' : ''}"><span>${esc(r.label)}</span><strong title="${esc(r.value)}">${esc(r.value)}</strong></div>`).join('')}</div>
    <div class="world-bottom"><span class="tiny-dot ${speculative && changed ? 'amber' : ''}"></span><span>${speculative ? (changed ? 'Branch differs from checkpoint' : 'Matches committed snapshot') : `${state.commitCount} external effect${state.commitCount === 1 ? '' : 's'} committed`}</span><span class="revision">${speculative ? `branch / ${state.step >= 6 ? '02' : '01'}` : `revision / ${String(state.commitCount).padStart(2, '0')}`}</span></div>
  </section>`;
}
function eventIcon(event: ReplayEvent) {
  const map: Record<string, string> = { agent: 'branch', tool: 'json', environment: 'clock', review: 'shield', rollback: 'reset', commit: 'check', feedback: 'arrow', complete: 'check', checkpoint: 'lock' };
  return icon(map[event.kind] || 'branch');
}
function toolCode(event: ReplayEvent) {
  const step = Number(event.id.split('/').at(-1));
  const commands: Record<string, Record<number,string>> = {
    INBOX:{2:'mail.search(after="2026-10-03") → delete_batch(8 ids)',3:'mail.list(day="2026-10-04") → 0 messages',6:'mail.search(after="2026-10-03", before="2026-10-04") → 5 ids',9:'commit(mail.move_to_trash, 5 ids) → receipt r1',11:'agent.resume(checkpoint=r1, observation=commit.receipt)',12:'mail.list() → 3 messages; notifications=false'},
    E05:{2:'stage(vote.close, day=477) → 2 effects held',3:'calendar.read() → canonical_day=478',6:'stage(readiness.correct, canonical_day=478)',9:'commit(readiness.correct) → receipt r1',11:'agent.resume(checkpoint=r1, observation=commit.receipt)'},
    E02:{2:'inspect(json.keys) → ecosystem_stability_metrics absent',3:'inspect(era10_self_evolution.ecosystem_stability_metrics)',6:'report(nested_metrics, timestamp_checked=true)',9:'commit(metrics.report) → receipt r1',11:'agent.resume(checkpoint=r1, observation=commit.receipt)'},
    E06:{2:'verify(exhibit, target=unbound) → stage(FAIL)',3:'resolve(exhibit.canonical_url) → target mismatch',6:'verify(canonical_url) → stage(PASS)',9:'commit(exhibit.verification) → receipt r1',11:'agent.resume(checkpoint=r1, observation=commit.receipt)'},
  };
  const command = commands[state.scenarioId]?.[step];
  return command ? `<code class="event-tool-code">${esc(command)}</code>` : '';
}
function trajectory(withSources = true) {
  if (!state.events.length) return `<div class="log-empty"><div class="empty-line"></div><span class="empty-node">${icon('branch')}</span><div><h4>A trajectory is waiting to unfold.</h4><p>Start the run to watch an error emerge before it reaches the world.</p></div><span class="empty-line last"></span></div>`;
  return state.events.map((event, i) => `<article class="event event-${esc(event.kind)} ${i === state.events.length - 1 ? 'event-latest' : ''} ${event.requiresWorldAdapter ? 'event-world' : ''}" data-event="${esc(event.id)}"><div class="event-line">${eventIcon(event)}</div><div class="event-body"><div class="event-meta"><span>${esc(event.actor)}</span><span>${esc(event.at)}</span>${event.requiresWorldAdapter ? `<span class="world-adapter-tag">WORLD ADAPTER${event.toolName ? ` / ${esc(event.toolName)}` : ''}</span>` : ''}${withSources && event.evidenceIds?.length ? `<button class="source-chip" data-action="evidence" aria-label="View original evidence for ${esc(event.title)}">${icon('book')} RECORD</button>` : ''}</div><h4>${esc(event.title)}</h4><p>${esc(event.detail)}</p>${toolCode(event)}${event.kind === 'review' ? `<div class="event-judgment ${event.id.endsWith('/04') ? 'judge-reject' : event.id.endsWith('/08') || event.id.endsWith('/13') ? 'judge-approve' : ''}">${icon('shield')} FULL TRAJECTORY ${event.id.endsWith('/04') ? 'REJECTED' : event.id.endsWith('/08') || event.id.endsWith('/13') ? 'APPROVED' : 'UNDER REVIEW'}</div>` : ''}</div><span class="event-num">${String(i + 1).padStart(2, '0')}</span></article>`).join('');
}
function statusTone() { return state.phase === 'rollback' || state.verdict === 'reject' ? 'rejected' : state.commitCount || state.verdict === 'approve' ? 'accepted' : 'neutral'; }
function draw() {
  const active = getCase();
  const focusedId = document.activeElement?.id;
  const transaction = state.step >= 11 ? 3 : state.step >= 6 ? 2 : 1;
  const names: Record<string,string> = {INBOX:'Inbox cleanup',E05:'Voting window',E02:'Metrics inspection',E06:'Exhibit verification'};
  const statuses: Record<string,string> = {ready:'Ready',checkpoint:'Checkpoint',speculating:'Running',reviewing:'Reviewing',rejected:'Rejected',rollback:'Rolled back',rerunning:'Retrying',approved:'Approved',committing:'Committing',feedback:'World feedback',restarting:'Restarting',complete:'Completed'};
  const currentStatus = statuses[state.phase] || state.phase;
  const reviewed = state.phase === 'rejected' || state.phase === 'rollback' || state.phase === 'approved' || state.phase === 'committing';
  const reviewText = state.approvalValid ? 'APPROVE' : state.verdict === 'reject' && state.step <= 5 ? 'REJECT' : state.step >= 11 ? (state.finished ? 'COMPLETE' : state.step === 13 ? 'APPROVE / NO WRITES' : 'REVIEW NEXT TRAJECTORY') : state.commitCount ? 'COMMITTED' : 'AWAITING REVIEW';
  app.innerHTML = `<header class="topbar tool-topbar"><a class="brand" href="/" aria-label="Swarm Transactions home"><span class="brandmark">${icon('logo')}</span><span>Swarm Transactions</span></a><span class="header-divider"></span><span class="header-subtitle">WORKSPACE</span><div class="header-right"><span class="runtime-indicator"><span class="tiny-dot ${playing ? 'pulse' : ''}"></span>${playing ? 'Runner active' : 'Runner ready'}</span><button id="architecture" class="text-button" data-action="architecture">Architecture ${icon('arrow')}</button><button id="present" class="icon-button" data-action="present" aria-label="Toggle fullscreen presentation">${icon('expand')}</button></div></header>
  <div class="app-layout tool-layout"><aside class="sidebar tool-sidebar"><div class="workspace-label">${icon('branch')} Workspace <span>TX</span></div><div class="eyebrow task-library-label">SAVED TASKS <span>${String(SCENARIOS.length).padStart(2,'0')}</span></div><nav class="case-list" aria-label="Scenarios">${SCENARIOS.map((s,i)=>`<button class="case-button ${s.id === state.scenarioId ? 'selected' : ''}" data-case="${esc(s.id)}" aria-pressed="${s.id === state.scenarioId}"><span class="task-icon">${icon((caseUI[s.id] ?? caseUI.E05).icon)}</span><span class="case-text"><strong>${esc(names[s.id])}</strong><span class="case-source">${esc(s.tool)} · ${esc(s.id)}</span></span><span class="task-key">${i+1}</span></button>`).join('')}</nav><div class="sidebar-run-info"><div class="eyebrow">CURRENT RUN</div><code>tx-${esc(state.scenarioId.toLowerCase())}-001</code><div><span>Status</span><strong>${currentStatus}</strong></div><div><span>Iteration</span><strong>${String(transaction).padStart(2,'0')}</strong></div><div><span>Released effects</span><strong>${state.commitCount}</strong></div></div><div class="tool-sidebar-bottom"><button id="evidence" class="evidence-button" data-action="evidence">${icon('book')} Source records ${icon('arrow')}</button><button id="export" class="evidence-button" data-action="export">${icon('download')} Export run ${icon('arrow')}</button><div class="sidebar-version">SWARM TX <span>v1.0</span></div></div></aside>
  <main id="main-content" class="tool-main"><div class="task-toolbar"><div><div class="task-breadcrumb">Workspace <span>/</span> ${esc(active.tool)} <span>/</span> ${esc(active.id)}</div><h1>${esc(names[active.id])}</h1><p>${esc(active.id === 'INBOX' ? 'Delete yesterday’s emails. Keep today’s messages intact.' : active.summary)}</p></div><div class="run-controls"><label class="speed-control"><span class="sr-only">Replay speed</span><select id="speed" aria-label="Replay speed"><option value="0.5" ${speed === .5 ? 'selected' : ''}>0.5×</option><option value="1" ${speed === 1 ? 'selected' : ''}>1×</option><option value="2" ${speed === 2 ? 'selected' : ''}>2×</option></select></label><button id="reset" class="icon-button" data-action="reset" aria-label="Reset scenario">${icon('reset')}</button><button id="step" class="secondary-button" data-action="step" ${state.finished ? 'disabled' : ''}>${icon('step')} Step</button><button id="play" class="primary-button ${playing ? 'is-playing' : ''}" data-action="play" aria-label="${playing ? 'Pause replay' : state.finished ? 'Replay scenario' : state.step ? 'Resume replay' : 'Run scenario'}">${icon(playing ? 'pause' : 'play')} ${playing ? 'Pause' : state.finished ? 'Run again' : state.step ? 'Resume' : 'Run task'}</button></div></div>
  <div class="run-summary"><span class="run-status ${statusTone()}"><span class="tiny-dot ${playing ? 'pulse' : ''}"></span>${currentStatus}</span><span>Iteration <strong>${String(transaction).padStart(2,'0')}</strong></span><span>${icon('lock')} Checkpoint <strong>r${state.committed.revision}</strong></span><span>Staged <strong data-testid="outbox-count">${state.outbox.length}</strong></span><span>Committed <strong>${state.commitCount}</strong></span><button id="trace" class="text-button" data-action="trace">${icon('book')} Full trajectory</button></div>
  <div class="runtime-grid"><section class="runtime-log"><div class="log-toolbar"><div>${icon('branch')} <strong>Agent actions</strong><span class="log-live-label">${playing ? 'LIVE' : 'EVENT LOG'}</span></div><span class="log-world-key"><span></span> EXTERNAL WORLD BOUNDARY</span></div><div class="event-list" aria-label="Replay event log">${state.events.length ? trajectory() : `<div class="runtime-empty"><span>${icon('branch')}</span><h3>Ready to execute</h3><p>Run the task to inspect its actions, tool results,<br>trajectory judgments and commits.</p><code>$ swarm-tx run ${esc(active.id.toLowerCase())}</code></div>`}</div><div class="log-bottom"><span><span class="tiny-dot"></span> ${state.events.length} events</span><span>BRANCH ${transaction} <span>·</span> WORLD r${state.committed.revision}</span><span>STEP ${String(state.step).padStart(2,'0')}/${TOTAL_STEPS}</span></div></section>
  <aside class="runtime-inspector"><div class="inspector-heading">World & transaction state <span>${icon('shield')}</span></div><div class="inspector-scroll"><div class="runtime-worlds">${world(state.speculative,true)}${world(state.committed,false)}</div><section class="judgment-card ${statusTone()}"><div><span>${icon('shield')} Trajectory judgment</span><strong>${reviewText}</strong></div><p>${state.phase === 'rejected' ? esc(state.statusDetail) : state.step === 5 ? 'Branch state and its effects discarded. Committed checkpoint unchanged.' : state.step >= 11 ? 'Agent restarted from the committed tool result. A new trajectory is being checked.' : state.commitCount ? 'First approved effect released. Remaining actions must be reviewed against fresh world feedback.' : state.approvalValid ? 'All planned actions checked against the full trajectory. Only the first external effect may cross.' : 'The reviewer receives the complete action and observation history before any effect is released.'}</p></section><section class="runtime-outbox"><div class="outbox-heading"><span>EXTERNAL EFFECT QUEUE</span><span class="outbox-counter">${state.outbox.length}</span></div>${state.outbox.length ? `<ol>${state.outbox.map((effect,i)=>`<li><span class="effect-number">0${i+1}</span><span>${esc(effect)}</span><span class="effect-state">${state.approvalValid && i === 0 ? 'APPROVED' : 'HELD'}</span></li>`).join('')}</ol>` : `<p class="queue-empty">${state.commitCount ? 'Queue cleared. Remaining effects discarded for replanning.' : state.rolledBack ? 'Rejected effects discarded.' : 'No effects waiting.'}</p>`}</section>${state.committedEffects.length ? `<section class="commit-receipt"><div>${icon('check')} COMMIT RECEIPT <span>r${state.committed.revision}</span></div><p>${esc(state.committedEffects[0])}</p><small>${state.step >= 11 ? 'Agent restarted from this result.' : 'Awaiting world feedback before continuing.'}</small></section>` : ''}</div></aside></div>
  <div class="status-callout ${statusTone()}" aria-live="polite"><span class="status-icon">${icon(state.phase === 'rollback' ? 'reset' : state.phase === 'restarting' ? 'branch' : state.commitCount ? 'check' : 'shield')}</span><div><strong data-testid="status-title">${esc(state.statusTitle)}</strong><p>${esc(state.statusDetail)}</p></div></div><nav class="runtime-stages" aria-label="Replay stages">${['Run','Observe','Judge','Roll back','Retry','Commit','Restart'].map((label,i)=>`<button data-seek="${[2,3,4,5,6,9,11][i]}" aria-label="Jump to ${label}" class="${state.step >= [2,3,4,5,6,9,11][i] ? 'stage-reached' : ''}"><span>${String(i+1).padStart(2,'0')}</span>${label}</button>`).join('')}<span class="keyboard-hint"><kbd>Space</kbd> run / pause <kbd>→</kbd> step</span></nav>
  </main></div>`;
  bind();
  const log = document.querySelector<HTMLDivElement>('.event-list');
  if (log) log.scrollTop = log.scrollHeight;
  if (focusedId) document.getElementById(focusedId)?.focus({preventScroll:true});
  if (modal) openModal(modal);
  document.documentElement.dataset.phase = state.phase;
  document.documentElement.dataset.step = String(state.step);
  document.documentElement.dataset.scenario = state.scenarioId;
}
function stop() { playing = false; clearTimeout(timer); timer = undefined; }
function advanceOne() { if (!state.finished) state = advance(state); if (state.finished) stop(); draw(); }
function queueNext() {
  if (!playing || state.finished) return;
  const hold = state.phase === 'rollback' || state.verdict === 'reject' || state.phase === 'committing' ? 3100 : 2100;
  timer = setTimeout(() => { advanceOne(); queueNext(); }, hold / speed);
}
function togglePlay() {
  if (playing) stop();
  else { if (state.finished) state = createInitialState(state.scenarioId); playing = true; advanceOne(); queueNext(); }
  draw();
}
function seek(target: number) { stop(); const id = state.scenarioId; state = createInitialState(id); for (let i = 0; i < target; i++) state = advance(state); draw(); }
function selectCase(id: string) { stop(); state = createInitialState(id); const url = new URL(location.href); url.searchParams.set('case', id); history.replaceState(null, '', url); draw(); }
function bind() {
  app.querySelectorAll<HTMLButtonElement>('[data-case]').forEach(b => b.addEventListener('click', () => selectCase(b.dataset.case!)));
  app.querySelectorAll<HTMLButtonElement>('[data-seek]').forEach(b => b.addEventListener('click', () => seek(Number(b.dataset.seek))));
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(b => b.addEventListener('click', () => {
    switch (b.dataset.action) {
      case 'play': togglePlay(); break;
      case 'step': stop(); advanceOne(); break;
      case 'reset': stop(); state = createInitialState(state.scenarioId); draw(); break;
      case 'evidence': stop(); modal = 'evidence'; draw(); break;
      case 'architecture': stop(); modal = 'architecture'; draw(); break;
      case 'trace': stop(); modal = 'trace'; draw(); break;
      case 'present': if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); break;
      case 'export': exportReplay(); break;
    }
  }));
  document.querySelector<HTMLSelectElement>('#speed')?.addEventListener('change', e => { speed = Number((e.target as HTMLSelectElement).value); clearTimeout(timer); queueNext(); });
}
function evidenceContent(scenario: Scenario) {
  const fictional = scenario.id === 'INBOX';
  return `<div class="modal-eyebrow">${fictional ? 'TASK CONFIGURATION / INBOX' : `SOURCE RECORD / ${esc(scenario.id)}`}</div><h2>${fictional ? 'Task inputs' : 'Source records'}</h2><p class="modal-intro">${esc(ui().takeaway)}</p><div class="provenance-banner">${icon('book')} ${fictional ? 'Task scope: one calendar day in America/Los_Angeles. Eight input messages: five from yesterday, three from today.' : 'These source records come from the real-world AI Village dataset and establish the action, constraint and subsequent correction.'}</div><div class="evidence-list">${scenario.evidence.map(e => `<article class="evidence-record"><div class="evidence-record-heading"><span>${esc(fictional ? e.label.replace(/Fictional |Authored |simulated /g, '') : e.label)}</span><span>${esc(fictional ? 'Task input' : e.speaker)} · ${esc(e.createdAt)}</span></div><blockquote>${esc(e.excerpt || e.content)}</blockquote><details><summary>Inspect full ${fictional ? 'fixture' : 'source'} record</summary><pre>${esc(e.content)}</pre><div class="source-anchor"><span>${fictional ? 'FIXTURE ID' : 'MESSAGE ID'}</span><code>${esc(e.anchor)}</code><span>SOURCE</span><code>${esc(e.sourcePath)}</code></div></details></article>`).join('')}</div><div class="modal-bottom-note">${fictional ? 'The transaction boundary applies to any tool with external effects: email, files, databases, APIs and multi-agent workflows. The source records below define the task and its inputs.' : 'AI Village supplies real agent mistakes to test and illustrate a general-purpose harness. The historical messages establish the mistakes and corrections; the source records are chat messages rather than complete historical tool traces.'}</div>`;
}
function architectureContent() {
  return `<div class="modal-eyebrow">SWARM TRANSACTIONS / RUNTIME ARCHITECTURE</div><h2>Transaction loop</h2><p class="modal-intro">Route agent tool calls through a transaction boundary before releasing their external effects.</p><div class="architecture-loop">${[{n:'01',title:'Fork the world',body:'Tool adapters route writes and outgoing messages into a private world. Reads begin from a checkpoint.',ic:'branch'},{n:'02',title:'Let the run continue',body:'World adapters supply tool observations and peer responses inside the branch. Let the swarm finish; collect the consequences.',ic:'clock'},{n:'03',title:'Review the whole trajectory',body:'Check the evidence, constraints and targets. Rejecting discards the branch and its outbox.',ic:'shield'},{n:'04',title:'Commit one effect. Replan.',body:'After approval, release only the first external effect. Real feedback replaces the speculative tail.',ic:'check'}].map(s=>`<div class="architecture-step"><span>${s.n}</span><div class="architecture-icon">${icon(s.ic)}</div><div><h3>${s.title}</h3><p>${s.body}</p></div></div>`).join('')}</div><div class="provenance-banner">${icon('info')} Approval applies to one trajectory and world revision. A committed action returns fresh world feedback; the agent restarts at that boundary.</div>`;
}
function traceContent() {
  return `<div class="modal-eyebrow">${esc(getCase().id)} / FULL TRAJECTORY</div><h2>Run transcript</h2><p class="modal-intro">${esc(state.statusTitle)} · Step ${state.step} of ${TOTAL_STEPS}</p><div class="trace-events">${trajectory(false)}</div><div class="provenance-banner">${icon('lock')} ${state.outbox.length} effects staged · ${state.commitCount} effect committed · ${state.discardedEffects.length} effects discarded. Approval is scoped to the current world revision.</div>`;
}
function openModal(kind: 'evidence' | 'architecture' | 'trace') {
  document.querySelector('dialog')?.remove();
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-label', kind === 'evidence' ? 'Source evidence' : kind === 'trace' ? 'Trajectory event log' : 'How the harness works');
  dialog.innerHTML = `<button id="close-modal" class="icon-button modal-close" aria-label="Close dialog">${icon('close')}</button><div class="modal-content">${kind === 'evidence' ? evidenceContent(getCase()) : kind === 'trace' ? traceContent() : architectureContent()}</div>`;
  document.body.append(dialog);
  lastFocusId = document.activeElement?.id || (kind === 'evidence' ? 'evidence' : kind === 'trace' ? 'trace' : 'architecture');
  const close = () => { modal = null; dialog.close(); dialog.remove(); document.getElementById(lastFocusId)?.focus({ preventScroll: true }); };
  dialog.querySelector('button')!.addEventListener('click', close);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  dialog.showModal();
}
function exportReplay() {
  const source = getCase();
  const artifact = { kind: 'scripted-evidence-replay', scenario: source.id, origin: source.origin, tool: source.tool, sourceRun: source.sourceRun, provenance: source.origin === 'fictional' ? 'Authored fictional scenario. Tool calls, reviewer decisions and world state are scripted.' : 'Historical quotes from AI Village. Harness execution, tool calls, reviewer decisions and world state are scripted.', evidence: source.evidence, replay: state };
  const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `swarm-transactions-${state.scenarioId}-step-${state.step}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('keydown', e => {
  if (modal || e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement)?.closest('input, select, textarea, a, summary')) return;
  if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('button')) { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); stop(); advanceOne(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(Math.max(0, state.step - 1)); }
  else if (e.key.toLowerCase() === 'r') { stop(); state = createInitialState(state.scenarioId); draw(); }
  else if (['1','2','3','4'].includes(e.key)) selectCase(SCENARIOS[Number(e.key) - 1].id);
});
draw();
