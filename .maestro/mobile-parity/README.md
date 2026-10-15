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

Keep Metro running on its default port 8081, then run `npm run mobile:parity:screenshots` in another
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
After clearing state, both flows open the parity-only development-client link
to `http://127.0.0.1:8081` and dismiss any iOS launch confirmation. They wait
for and dismiss the first-run bonus modal before checking background tabs.

Both flows clear local app state before creating their anonymous sample task
and habit data. Do not run either against an app installation that contains
data you want to keep.

## Anonymous progression / persistence

Stop any reference Metro first, then start an anonymous, persistent runtime:

```bash
npm run mobile:start:anonymous
# In another terminal:
npm run mobile:parity:progression
```

This clears only the fixed parity app's disposable local data. It earns five
task rewards through public UI, opens the starter chest, unlocks Map, wins
stage 1, then restarts without clearing data. It compares the visible XP and
task count before/after re-completing the same task and after restart, and
checks that the starter chest cannot be reopened and stage 2 remains unlocked.
Replaying a stage is intentionally allowed to earn a new battle reward; this
test does not treat a new battle as a duplicate result.

The runner now checks Metro's manifest **before any clearing flow starts**
(screenshots, smoke, progression). It requires `appVariant=parity`, the boolean
`parityLocalOnly=true`, and no capture theme/profile. Missing metadata,
release/preview, cloud configuration, and memory-only reference mode fail
closed. The flag contains no URL/key. Normal and preview app storage are not
targets. Use the same anonymous Metro for the existing smoke/screenshots flows.

This is local anonymous evidence, not signed-in synchronization, real-device
authentication, Android behavior, or release approval. See
[progression quality checks](../../docs/anonymous-progression-quality.md).

## Task undo / add clearance (#721)

Start `npm run mobile:reference:light` (or `:dark`), then run
`node scripts/run-mobile-parity-screenshots.mjs undo` in another terminal.
This guarded memory-only daily-reference flow keeps `clearState:false`.
It opens Add during the five-second undo window, explicitly undoes the completion,
and checks form entry and layout after expiry. It never changes the undo duration.
Input captures do not imply software-keyboard visibility; see
[scope and manual checks](../../docs/mobile-task-undo-quality.md).
