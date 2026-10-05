# RUMAR visual system

This document is the visual reference for UI migration after Phase 1. It describes the implemented foundation, not a redesign mandate for modules still pending.

## Visual principles

- Calm, precise, personal desktop UI. The current task and next useful action outrank decorative metrics.
- Use whitespace, type and dividers before adding a surface. A card needs a real semantic grouping.
- Preserve local-first trust: sensitive values follow the existing privacy preference; integration status is explicit.
- Keep interactions discoverable with visible labels, keyboard focus and clear feedback.

## Colors

Semantic tokens live in `src/styles/visual-foundation.css`. Light surfaces use `#F5F7FB`, white and `#F8FAFD`; dark surfaces use `#171A1F`, `#1F232A` and `#252A32`. The main blue is `#2869C8` light and `#9ABAF0` dark. Text and border tokens provide secondary and tertiary levels. Success, warning and danger each have a foreground and soft surface token. `--color-focus-ring` is separate from content color. Legacy aliases (`--surface`, `--primary`, etc.) remain while older screens migrate.

Use semantic tokens for new UI. Do not use `--color-primary-soft` or `--accent` as text. Check normal-text contrast in both themes before introducing a new combination.

## Typography

Use Segoe UI Variable, Segoe UI and system fallbacks. Body text is 14px with 1.55 line-height. Page titles are 28px/600, section headings 20px/600 and subsections 16px/600. Labels are about 13px/600; metadata is at least 12.5px when it conveys important information. Eyebrows should be rare, discreet and never replace a real heading.

## Spacing and radius

Use the 4, 8, 12, 16, 20, 24, 32, 40, 48 and 64px scale. Standard page padding is 32–40px. Use `--radius-control` (9px), `--radius-surface` (12px), `--radius-card` (14px) and `--radius-dialog` (16px). Pills may use a full radius when they represent a compact selected state. Avoid arbitrary one-off values in migrated modules.

## Elevation and motion

Ordinary lists and sections primarily use background, space and dividers. `--shadow-sm` is for a restrained raised control; `--shadow-md` is for dialogs, toasts and floating UI. Motion tokens are 120, 160 and 220ms with a gentle easing. Animate meaningful state changes, not every property. `prefers-reduced-motion: reduce` disables shell movement; new motion must respect the same preference.

## Components

The current shared components are `Dialog`, `EmptyState` and `QuickEntry`; buttons, fields, tabs, badges, progress and toasts also have shared classes in `global.css`. Phase 1 adjusts their underlying tokens and basic control states. Do not duplicate these components merely to change appearance. Icon-only controls need an accessible name and a tooltip/title, with at least a 36px target. Preserve loading and disabled feedback.

The sidebar is `AppSidebar`. Its grouping is Início, Organização, Rotina, Vida and Registros. The compact state stores only `rumar.sidebar.collapsed` in localStorage; it does not change database schema or user data. In compact mode, each destination retains an accessible name and native title tooltip.

## Interaction states

Default controls use the text and border hierarchy of their surface. Hover changes background or border subtly; active/selected states use the soft blue and primary foreground. Pressed buttons move one pixel only when motion is allowed. Keyboard focus uses a two-pixel ring with three-pixel offset, independent of the selected color. Disabled/loading actions retain their label, remain visibly unavailable and do not rely on a spinner alone. Danger uses the semantic foreground/surface pair and must be checked in both themes.

## Sidebar and Home

The sidebar remains fixed, with a scrollable navigation region and a persistent footer for Settings and local status. Expanded width is 232px (216px near the minimum window); collapsed width is 68px. It keeps the existing module order within the new groups. Add and Search remain at the top; the collapse button has an accessible label and the preference survives restart without a database migration.

Home uses an asymmetric grid above 1180px: tasks occupy the main column, while the next agenda entries, habits, routines and workout provide compact continuity. Inbox and overdue counts follow tasks. Projects, objectives, nutrition and finance appear below as lighter sections only when the source components have content. Near the minimum desktop width, the rail moves below tasks. Existing Finance privacy behavior remains in the source component.

## Accessibility

Keep the skip link, semantic headings, native dialog focus behavior and visible focus ring. Text hover/focus must remain legible; never apply a soft background token to text. For search suggestions, the focused combobox references the active option via `aria-activedescendant`. Test keyboard navigation, 200% zoom when possible, and both color themes.

## Light and dark

The same information hierarchy applies in both themes. Dark surfaces are charcoal rather than pure black; the blue becomes lighter. Feature CSS should read semantic tokens rather than hardcoding a theme-specific color. Existing feature screens may still use legacy aliases until their migration.

## Visual verification

The local preview harness in `scripts/ui-preview/` renders synthetic data only. From the repository root, run `npx vite --host 127.0.0.1 --port 4175`, then `node scripts/ui-preview/capture.mjs` in another terminal. Screenshots are written to the Git-ignored `artifacts/ui-phase1/` directory. This checks layout and themes without starting a Tauri binary or opening personal SQLite data.

For Tasks and Inbox, run `node scripts/ui-preview/capture-tasks-inbox.mjs`. It captures both themes at 900×620, 1280×720, 1366×768, 1440×900, 1920×1080 and 2560×1440 under the ignored `artifacts/ui-tasks-inbox/` directory and rejects horizontal overflow or page errors.

For Projects and Objectives, run `node scripts/ui-preview/capture-projects-objectives.mjs` against the same local Vite preview. It captures list and detail presentations in both themes at the same six desktop sizes under ignored `artifacts/ui-projects-objectives/`. The fixtures are invented and never query the personal database.

## Mockup translation: Tasks and Inbox

The approved concepts guide contextual headers, compact tabs, light list rows, prominent Inbox capture and restrained blue accents. The implementation keeps the existing four task views, QuickEntry, task drawer, conversions, editing, deletion and undo behavior. It does not add conceptual task filters, Inbox item types or a new database-backed master/detail route. Less frequent Inbox actions live in a keyboard-accessible disclosure menu; converting to a task remains visible on the row. The task drawer remains the existing editing surface so no behavior is lost.

## Mockup translation: Projects and Objectives

Projects emphasize execution. The overview preserves the real active, paused, completed and archived filters and presents status, task completion, next action and deadline from existing project data. Detail keeps sections, task rows, section ordering, creation, templates, linked habits and attachments. Rare project and section actions use a disclosure menu with Escape and focus return. An empty status filter has different copy from a genuinely empty project collection. The current status filter is remembered only in memory while the app runs.

Objectives emphasize direction. The list uses real categories, existing linked-item counts and the repository's existing progress calculation, including its financial privacy state; only a real percentage receives a ring with text. Detail puts the established milestones ahead of related items, attachments and updates. Category filtering uses existing categories and is remembered only in memory. No featured objective, cover image, new relationship, timeline query, project cover, schema change or migration was introduced to reproduce the conceptual art.

## Do / don't

| Do                                                       | Don't                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| Use a section heading and divider for related rows       | Nest cards solely to create separation      |
| Put the immediate action first                           | Give every statistic equal visual weight    |
| Show text labels and focus states                        | Rely on color or icon alone                 |
| Verify contrast in both themes                           | Use soft surface colors as text             |
| Keep desktop width comfortable and scrolling predictable | Fill every wide screen with oversized cards |

## UI migration status

| Area                  | Status  |
| --------------------- | ------- |
| Foundation            | DONE    |
| Shell                 | DONE    |
| Sidebar               | DONE    |
| Home                  | DONE    |
| Tasks                 | DONE    |
| Inbox                 | DONE    |
| Projects              | DONE    |
| Objectives            | DONE    |
| Habits                | PENDING |
| Routines              | PENDING |
| Calendar              | PENDING |
| Workouts              | PENDING |
| Body Progress         | PENDING |
| Nutrition             | PENDING |
| Finance               | PENDING |
| Financial Connections | PENDING |
| Thoughts              | PENDING |
| Timeline              | PENDING |
| Reviews               | PENDING |
| Settings              | PENDING |

The contrast fix in Reviews and error-color fix in Nutrition are foundational corrections only; those screens remain pending full visual migration.
