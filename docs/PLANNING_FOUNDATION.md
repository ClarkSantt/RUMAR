# Planning foundation

Planejamento is the temporal layer shared by the daily planner and Calendar. A planning occurrence is a commitment of time; it is not the same event as completing its source task, project, habit, workout, event or model.

## Invariants

- A task or project may have any number of planning occurrences on the same or different dates.
- Completing, skipping or cancelling an occurrence never completes or archives its task or project.
- Fixed-time, day-period and flexible occurrences use `planner_time_blocks`; Calendar and Planejamento never maintain duplicate schedules.
- Removing or archiving a source keeps existing occurrences readable through `title_snapshot`.
- Habit progress completes a linked occurrence only when exactly one pending occurrence for that habit and date exists. Ambiguous matches remain pending.
- Legacy routines and steps are copied into reusable planning models. The routine tables and their history remain unchanged for audit and review.

## Migration safety

Migration 29 extends the existing planner store, copies routine definitions into planning models and adds the explicit habit tracking type. The desktop invokes `pre_migration_backup` before `Database.load`, so the backup is created before SQLx applies a pending schema upgrade.

**Applied migrations must never be edited.** Migrations 1–28 are published and protected byte-for-byte by SHA-384 regression tests. Every future schema change must use a new forward-only migration.

## Visual behavior

Planejamento has four stable areas: Planejar, Hoje, Hábitos and Modelos. At desktop widths, active tasks and projects form a supporting side panel. At compact widths the panel moves above the plan and keeps search and add actions visible. Fixed blocks appear in the Calendar time grid; periods and flexible items appear in the all-day planning lane.

The interface uses the existing RUMAR tokens, controls and dialogs. Keyboard focus, native date/time controls, explicit labels and status-independent actions remain available at 900×620 through 2560×1440.
