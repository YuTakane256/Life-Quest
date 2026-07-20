# Web / Mobile parity audit

> **Status (2026-07-17): historical planning document, superseded by implementation.**
> This audit was written as a pre-implementation plan after PR #472. All five
> phases described below (canonical contracts, repository interfaces, shared
> visual language, mobile feature parity, and authenticated cloud sync) have
> since shipped. Mobile now has feature-parity screens for Tasks, Habits,
> Character/Inventory, Map/Battle, Statistics, Settings, and Help, all backed
> by `@life-quest/core` shared logic and Supabase cloud sync (canonical
> snapshots, offline outbox, RLS, LWW conflict resolution, and reward
> idempotency ledgers). The "Current application surfaces" and "Executive
> summary" sections below describe the pre-implementation gap and are kept for
> historical context; do not treat them as the current feature matrix. As of
> 2026-07-17, Web also has a continuous cloud write path (task, subtask, and
> habit mutations enqueue to the same outbox engine Mobile uses, shared via
> `@life-quest/core/cloudOutboxController`), closing the previous one-directional
> (Mobile-only) sync gap. As of 2026-07-20, game operations (battle start/
> resolve, chest opening, item sale, equipment synthesis) are also
> cloud-authoritative on both Web and Mobile, via `@life-quest/core/gameCloud`'s
> request/response Edge Functions for non-deterministic server rolls (battle,
> chest, synthesis) and the outbox for the deterministic sell operation.
> Mobile also gained a resolve-failure retry path matching Web's. Tracking
> issue #473 remains open for residual follow-up work only (see its issue
> body for current status).

## Goal

Treat the Web application as the product reference while providing equivalent
features and recognizable visual language in the Expo application. Both clients
must eventually operate on the same user-owned data without losing existing
local data or granting rewards twice.

This document records the state after PR #472. It is an implementation guide,
not a promise to share React DOM and React Native UI components directly.

Tracking issue: #473. The first implementation slice is #474.

## Executive summary

- The Web application has six primary destinations plus Help and Inventory.
  Mobile currently has Tasks, Habits, and Character only.
- `@life-quest/core` already owns useful task, habit, equipment, progression,
  reward, and partial game-state rules. This is the correct shared boundary.
- Web and Mobile use different Zustand stores and different storage engines.
  That is acceptable, but their persisted payloads are not yet compatible.
- The same storage names do not mean the same schema. In particular, the habit
  and game payloads differ. Uploading these payloads as interchangeable cloud
  snapshots would risk data loss.
- UI should be rebuilt natively with shared tokens and behavior contracts.
  Sharing DOM components with React Native would add coupling without parity.
- Cloud sync must follow a canonical data contract and repository interface.
  It should not be added directly inside Zustand actions.

## Current application surfaces

| Product area | Web reference | Expo after #472 | Important gaps |
| --- | --- | --- | --- |
| Tasks | `src/pages/TasksPage.tsx` | `apps/mobile/src/screens/TasksScreen.tsx` | Editing, due dates, recurrence, tags, subtasks, search, sort, detailed filters, duplicate, bulk delete, and undo are missing. |
| Habits | `src/pages/HabitsPage.tsx` | `apps/mobile/app/(tabs)/habits.tsx` | Categories, sort/filter, memo, rest day, streak, completion rate, history heatmap, and statistics logging are missing. |
| Character | `src/pages/CharacterPage.tsx` | `apps/mobile/src/screens/CharacterScreen.tsx` | Web assets, titles, debuff display, chest history/milestones, presentation hierarchy, and separate inventory flow differ. |
| Inventory | `/character/inventory` in `CharacterPage.tsx` | Embedded in Character | Navigation and layout differ; behavior is only partially equivalent. |
| Map / battle | `src/pages/MapBattlePage.tsx` | Missing | Map selection, battle loop, skills, logs, history, replay, progression lock, and image assets are missing. |
| Statistics | `src/pages/StatsPage.tsx` | Missing | Heatmaps, summaries, achievements, titles, and best records are missing. |
| Settings | `src/pages/SettingsPage.tsx` | Missing | Theme, motion, notification, backup, storage health, and usage settings are missing. |
| Help | `src/pages/HelpPage.tsx` | Missing | Searchable product help and contextual navigation are missing. |
| Navigation | `src/components/layout/BottomNav.tsx` | `apps/mobile/app/(tabs)/_layout.tsx` | Mobile has three destinations, different icons/colors, no task badge, no map lock, and no light theme. |
| Global feedback | Overlays and snackbar in `src/App.tsx` | Character-local level-up modal | Login bonus, chest reveal, undo snackbar, error boundary, notifications, and consistent overlays are missing. |

## Feature behavior differences

### Tasks

The shared `Task` type in `packages/core/src/tasks.ts` already contains the Web
fields, so Mobile is not blocked by the model. Mobile only exposes name and
priority and only implements add, toggle, and delete.

The Web store in `src/stores/useTaskStore.ts` additionally coordinates:

- automatic parent completion from subtasks;
- recurring task creation;
- five-second completion undo;
- XP and statistics logging;
- edit, duplicate, and bulk-delete operations.

These workflows need shared pure transitions before Mobile reproduces the UI.
Copying the Web Zustand actions would also copy browser timers and dynamic store
imports into the native client.

### Habits

The base `Habit` and `HabitDailyRecord` types are shared, but product behavior is
not. Web also owns `RestDay`, categories, memo editing, retention, statistics,
and reward dates. Mobile records only today's completion and reward eligibility.

The persisted shapes currently conflict:

| Meaning | Web field | Mobile field |
| --- | --- | --- |
| Daily records | `dailyRecords` | `records` |
| Rewarded/eligible dates | `allCompleteRewardDates` | `rewardEligibleDates` |
| Rest days | `restDays` | Missing |

Both stores use the logical key `quest-board-habits`, but they cannot safely be
treated as the same payload. A canonical habit snapshot and explicit migration
must precede sync.

### Game and rewards

Mobile uses `GameStateSnapshot` from `packages/core/src/gameState.ts`, including
an idempotency `rewardLedger`. Web shares equipment and reward rules but still
persists its own `CharacterStats`, `Debuff`, and `BattleState` shape in
`src/stores/useGameStore.ts`. Web does not persist the same reward ledger.

The canonical contract must cover the union of durable product state:

- character profile and progression;
- equipment and chest queue;
- reward idempotency ledger;
- debuff and battle progression;
- active title and achievement-related state where it is not derived.

Transient battle logs, open modals, undo timers, hydration flags, and animation
events must remain local and must never be synchronized.

## Visual parity

The Web palette is defined as CSS variables in `src/index.css`. Mobile currently
hard-codes a separate green/charcoal palette in its tab layout and screens.

Create a platform-neutral token module for semantic colors, spacing, radii,
typography roles, and rarity/priority colors. Web can map tokens to CSS custom
properties; React Native can consume the same TypeScript values in StyleSheet
objects. Light and dark token sets must be shared, while system-theme detection
and persistence remain platform-specific.

Visual parity means the same information hierarchy, assets, terminology,
states, and interaction outcome. It does not require pixel-identical layouts or
shared JSX. Mobile must use native navigation, lists, modals, accessibility, and
touch targets.

## Canonical sync domains

The first sync contract should use domain records rather than raw Zustand
persist envelopes.

| Domain | Canonical durable data | Sync notes |
| --- | --- | --- |
| Profile | Name, avatar, active title | User-scoped; validate lengths and known IDs. |
| Tasks | Full shared `Task` records | Per-record timestamps and tombstones are needed for multi-device delete/update conflicts. |
| Habits | Habits, daily records, rest days | Daily record identity is `(habitId, date)`; rest-day identity is `date`. |
| Progression | XP, stats, gacha count | Reward mutations must be idempotent and transactional. |
| Inventory | Equipment and chest queue | Equipment/chest IDs must be globally unique and user-owned. |
| Rewards | Claimed task IDs and habit dates | Server or transactional repository must enforce uniqueness. |
| Battle | Unlock and cleared-stage progression | Active animation/log state stays local; durable history can be a separate domain. |
| Statistics | Daily aggregates or source events | Prefer deriving from canonical task/habit/reward events; do not let two devices increment the same aggregate blindly. |
| Preferences | Theme, motion, sort modes | Theme and sort may sync; notification permission and schedules remain device-local. |

## Repository boundary

UI and Zustand stores should depend on platform-neutral repositories, for
example `TaskRepository`, `HabitRepository`, and `GameRepository`. Initial
implementations continue to use localStorage and AsyncStorage. A cloud-backed
implementation can later add authentication, pull, push, and an offline outbox
without changing screen actions.

The repository layer must provide:

- schema version and sanitization on every read;
- atomic writes per domain operation;
- stable mutation IDs for retry safety;
- `updatedAt` or revision metadata for conflict detection;
- tombstones for deletions;
- import of existing Web and Mobile envelopes;
- observable sync status and recoverable errors;
- no dependency on React, Zustand, DOM, or React Native.

## Cloud sync constraints

A provider has not been selected in this repository. Supabase is a reasonable
candidate, but provider code should follow the repository contract rather than
define it.

Recommended conflict policy for the first synchronized release:

- task/profile edits: last accepted revision per record, with stale-write
  detection instead of silent overwrite;
- habit daily records: merge by `(habitId, date)`, then last accepted revision;
- deletes: tombstones win over older updates;
- reward claims: unique mutation key and one transactional grant;
- equipment/chests: server-validated ownership and transactional mutations;
- preferences: last-write-wins is acceptable;
- offline work: durable outbox, retry with the same mutation ID, then pull the
  authoritative revision.

Never synchronize the entire localStorage or AsyncStorage blob as a single
last-write-wins document. It would cause unrelated edits to overwrite each
other and would make reward integrity difficult to guarantee.

## Existing-data migration

1. Read the existing platform envelope without deleting it.
2. Sanitize it through the existing Web or Mobile sanitizer.
3. Convert it to the canonical versioned snapshot.
4. Persist a migration marker and checksum alongside the canonical local copy.
5. Upload with an idempotent migration ID after authentication.
6. Keep the old envelope until the canonical copy has reloaded and passed a
   count/checksum verification.
7. On failure, keep using local data and surface a retryable sync state.

Web backup import/export in `src/utils/dataBackup.ts` should become a migration
input, not the cloud protocol itself.

## Implementation order

### Phase 1: canonical contracts

- Add canonical, versioned task/habit/game/profile snapshots to
  `@life-quest/core`.
- Move remaining durable types such as rest days and battle progression to the
  shared package.
- Add conversion and round-trip tests for current Web and Mobile envelopes.
- Align reward idempotency semantics before any remote write exists.

### Phase 2: repository interfaces and local adapters

- Define repository operations and sync metadata outside Zustand.
- Implement Web localStorage and Mobile AsyncStorage adapters.
- Make both clients pass the same repository contract tests.
- Preserve current keys as migration sources.

### Phase 3: shared visual language

- Extract semantic design tokens and asset identifiers.
- Map Web CSS variables and Mobile StyleSheets to the same tokens.
- Add dark, light, and system theme behavior to Mobile.
- Rebuild the six-item navigation with the same labels, lock state, and badge.

### Phase 4: mobile feature parity

Implement vertical slices in this order so each one can be accepted visually
and behaviorally: Tasks, Habits, Character/Inventory, Statistics, Map/Battle,
then Settings/Help and global overlays.

Each slice needs shared transition tests, native screen tests, a smartphone
visual check, and a parity checklist against its Web reference.

### Phase 5: authenticated cloud sync

- Select and configure the provider and authentication UX.
- Implement normalized user-owned storage and row-level authorization.
- Add the offline outbox, conflict handling, and sync status UI.
- Run two-client tests covering offline edits, retries, deletes, and duplicate
  reward attempts.
- Roll out migration behind a feature flag with backup/restore retained.

## Proposed PR boundaries

1. Canonical task and habit snapshot contracts with legacy converters.
2. Canonical game/profile/battle snapshot and reward-ledger alignment.
3. Repository interfaces plus shared contract tests.
4. Web and Mobile local repository adapters with non-destructive migration.
5. Shared design tokens and Mobile theme support.
6. Navigation parity and empty routes for remaining product areas.
7. One PR per Mobile feature slice.
8. Provider schema, authentication, and authorization policy.
9. Offline sync engine and two-client integration tests.
10. Existing-data cloud migration and guarded rollout.

These boundaries intentionally keep visual work separate from persistence and
cloud changes, reducing conflicts and making regressions easier to isolate.

## Decisions needed before Phase 5

- Authentication methods: anonymous-first, email magic link, OAuth, or a
  combination.
- Whether one account can intentionally merge two existing local profiles.
- Which preferences are account-level versus device-level.
- Backend provider and deployment ownership.
- Whether battle rewards must become server-authoritative in the first sync
  release or in a later anti-cheat phase.

None of these decisions block Phases 1 through 4.
