# Mobile parity screenshots

`capture-major-screens.yaml` captures the Mobile task, habit, statistics,
character, inventory, and settings screens from a fresh anonymous install.

Run it through the repository command rather than calling Maestro directly:

```bash
npm run mobile:ios
```

Keep Metro running, then run `npm run mobile:parity:screenshots` in another
terminal. The flow only ever targets the parity-only local development bundle
identifier `com.yutakane.lifequest.parity`; it does not accept an app
identifier from the shell.
See `docs/mobile-parity-checklist.md` for the simulator setup. Maestro writes
the named screenshots to its test output for the completed run.

The flow clears local app state before creating the demo task and habit. Do not
run it against an app installation that contains data you want to keep.
