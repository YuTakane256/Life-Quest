# Mobile parity screenshots

`capture-major-screens.yaml` captures the Mobile task, habit, statistics,
character, inventory, and settings screens from a fresh anonymous install.
`anonymous-critical-path.yaml` is a smoke regression that creates and
completes a task and habit, visits each enabled primary tab, then restarts
without clearing state and asserts both completed records through public UI.

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

For the behavior/persistence regression instead, run:

```bash
npm run mobile:parity:smoke
```

Both scripts preflight Maestro, a booted iOS simulator, and the installed fixed
parity bundle before the Maestro test starts. They select one checked-in YAML
file each; adding a flow does not change the other command's scope.

Both flows clear local app state before creating their anonymous sample task
and habit data. Do not run either against an app installation that contains
data you want to keep.
