# Mobile / Web parity screenshot checklist

This document makes the visual and behavioral comparison in Issue #507
repeatable on a macOS development machine. It is intentionally local-only:
CI does not boot iOS simulators or retain screenshots.

## Capture Mobile reference screens

Prerequisites:

1. Install [Maestro](https://docs.maestro.dev/getting-started/installing-maestro) yourself. The repository command never installs it.
2. Boot an iPhone 13 or iPhone 14 simulator. Both use a 390 x 844 point portrait viewport.
3. Build, install, and open the local iOS development build. This is required
   for Maestro; Expo Go is not used for these captures.

Run:

```bash
npm run mobile:ios
```

`mobile:ios` explicitly runs `LIFE_QUEST_APP_VARIANT=parity expo run:ios` for
the local development bundle identifier `com.yutakane.lifequest.parity`. The
default app configuration and the existing `ios` script retain the normal
release identifier `com.yutakane.lifequest`; this separation means the capture
command can only clear its dedicated local app. On the first run Expo creates
the native iOS project as needed, installs the app on the selected simulator,
and starts Metro. Keep that terminal running. In a second terminal, run:

```bash
npm run mobile:parity:screenshots
```

The command verifies Maestro, Xcode's simulator tools, a booted simulator, and
the installed `com.yutakane.lifequest.parity` development app before it runs.
It never reads an app identifier from an environment variable. If a prerequisite
is unavailable, it exits without installing tools or clearing app data and
prints the next setup step.

The flow at `.maestro/mobile-parity/capture-major-screens.yaml` clears the
fixed `com.yutakane.lifequest.parity` local development app state and creates
only these anonymous values:

- task: `デモ: 朝の振り返り`
- habit: `デモ: 読書`

It captures six named images: tasks, habits, statistics, character, inventory,
and settings. Keep the resulting Maestro output local or attach it only to a
review artifact. Never use a signed-in build or include account addresses,
tokens, notification identifiers, or production data in screenshots.

After launch, the flow waits up to 10 seconds for the first-run
`ログインボーナス` modal, which is guaranteed by the fresh anonymous state, then
closes its backdrop and waits for the modal to disappear before it starts the
capture actions. This avoids missing a delayed hydration-time modal.

To inspect the two resolved configurations without building an app:

```bash
npm exec --workspace @life-quest/mobile expo config -- --type public
LIFE_QUEST_APP_VARIANT=parity npm exec --workspace @life-quest/mobile expo config -- --type public
```

The first reports `com.yutakane.lifequest`; the second reports
`com.yutakane.lifequest.parity`.

## Compare with Web

Capture the matching Web routes at the same review point with the existing
Playwright setup (`npm run e2e`) or a clean local browser profile. Web is the
product reference; native layouts may adapt for touch and safe areas, but the
following must agree.

| Area | Web reference | Check |
| --- | --- | --- |
| Tasks | `/tasks` | Design tokens, task count, add/complete/edit affordances, undo and empty states use the same terminology and reward result. |
| Habits | `/habits` | Category, completion, memo/rest-day states, streak/heatmap entry point, and reward result agree. |
| Statistics | `/stats` | Summary cards, achievements/titles, heatmap mode and activity data reflect the same anonymous task and habit actions. |
| Character | `/character` | Avatar, character name, XP/progress, stats, equipment slots, chest feedback, rarity tokens, and information order agree. |
| Inventory | `/character/inventory` | Filters, sort order, item state, equip/sell/synthesis controls, and the no-items state agree. Mobile presents it below Character rather than as a separate route. |
| Settings | `/settings` | Theme/motion options, sync status, notification behavior, help route, data import/export wording, and logged-out state agree. |

For every pair, verify all four perspectives:

1. **Tokens:** dark/light palette, typography hierarchy, spacing, border and card treatment, priority and rarity colors, and supplied image assets.
2. **Information structure:** screen title, navigation label, summary placement, section ordering, and empty/error/loading states.
3. **State:** the same anonymous record, progression, completion status, and logged-out/auth state render consistently after relaunch.
4. **Operations:** each visible add, edit, complete, filter, navigation, retry, and destructive action has the same outcome. Mobile may use touch-native controls and safe-area spacing.

Record any mismatch as a screen-specific issue with the Web route, Mobile
screen, reproducible anonymous state, expected behavior, actual behavior, and
both screenshot filenames. Do not treat pixel-identical layout as a requirement.

## Scope boundary

This is a manual regression aid. It does not add a simulator to CI, automatic
pixel diffs, production credentials, test-only app screens, or product UI
changes.
