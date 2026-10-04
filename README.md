# Swarm Transactions

A general transaction boundary for agents and swarms: inspect the full trajectory, roll back rejected branches, commit one approved external effect, and restart from its returned observation.

The web app is in [`demo/`](demo/). It includes an inbox cleanup task and three source-backed cases from the real-world AI Village dataset.

```sh
cd demo
npm ci
npm run dev
```

For Vercel, use `demo` as the root directory. Framework: Vite. Build: `npm run build`. Output: `dist`.

See [`demo/README.md`](demo/README.md) for commands, evidence provenance, and validation.
