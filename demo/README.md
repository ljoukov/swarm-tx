# Swarm Transactions

A web tool for inspecting transactional agent runs across email, web verification, calendar constraints and structured state.

```sh
cd /Users/yaroslavvolovich/projects/smarm-tx/demo
npm install
npm run dev
```

Open **http://127.0.0.1:5178/**. The running server uses port 5178 and fails if that port is occupied.

Click **Run task** for continuous execution, **Step** for individual events, or use the stage controls to jump to a judgment, rollback, commit or restart. The source-record drawer exposes the original evidence. **Export run** downloads the current run, its evidence and provenance as JSON.

- `Space`: run / pause
- `→` / `←`: next / previous event
- `R`: reset
- `1`–`4`: switch task

The primary inbox task is an authored scenario. The other three cases use exact records from the downloaded AI Village dataset: E05 voting-window error, E02 nested JSON path error, E06 incorrect verification target. AI Village is an evidence source, not the target platform of the harness.

The browser runtime is deterministic and local. Agent actions, adapter responses and judgments are presentation fixtures; no live model or external account is connected. Historical transcripts retain their exact content, timestamps and IDs. Run exports preserve this distinction.

The transaction sequence checkpoints state, stages two effects, continues the trajectory, rejects and atomically rolls back, retries and reviews, commits the first approved effect, invalidates the remaining approval after world feedback, then restarts the agent from the committed result. The restarted trajectory receives its own judgment.

```sh
npm test
npm run build
```

The 21 tests validate immutable state, rollback isolation, one-effect commits, approval expiry, restart checkpoints, date-boundary selection and exact historical quotes. The production build is in `dist/`; fonts and all runtime assets are local.
