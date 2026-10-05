# RUMAR visual system

This document describes the implemented RUMAR visual system. The global recalibration strengthens the existing foundation without changing module workflows or migrating Thoughts, Timeline, Reviews or Settings.

## Visual principles

- Calm, precise, personal desktop UI. The current task and next useful action outrank decorative metrics.
- Use whitespace, type and dividers before adding a surface. A card needs a real semantic grouping.
- Preserve local-first trust: sensitive values follow the existing privacy preference; integration status is explicit.
- Keep interactions discoverable with visible labels, keyboard focus and clear feedback.

## Colors

Semantic tokens live in `src/styles/visual-foundation.css`. Light mode separates a `#F1F4F8` canvas, white content surfaces and a `#F7F9FC` subtle surface with restrained borders. The navigation rail is deep navy (`#172B49`) in light mode, a deliberate RUMAR signature; dark mode retains charcoal content surfaces and a quieter navy rail. The main blue remains `#2869C8` light and `#9ABAF0` dark. Text and border tokens provide secondary and tertiary levels. Success, warning, danger and info each have a foreground and soft surface token. `--color-focus-ring` is separate from content color. Legacy aliases (`--surface`, `--primary`, etc.) remain while older screens migrate.

Use semantic tokens for new UI. Do not use `--color-primary-soft` or `--accent` as text. Check normal-text contrast in both themes before introducing a new combination.

## Typography

Use Segoe UI Variable, Segoe UI and system fallbacks. Body text is 14px with 1.55 line-height. Page titles are 28px/600, section headings 20px/600 and subsections 16px/600. Labels are about 13px/600; shared metadata and chart labels use 13px where they convey important information. Captions below 12px are reserved for truly incidental information. Eyebrows should be rare, discreet and never replace a real heading.

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

The sidebar remains fixed, with a scrollable navigation region and a persistent footer for Settings and local status. Expanded width is 232px (216px near the minimum window); collapsed width is 68px. It keeps the existing module order within the new groups. A visible **Mais seções** control appears only when destinations remain below the viewport and advances the navigation independently of the page. Short windows reduce rail padding and group gaps without shrinking labels below legibility. Add and Search remain at the top; the global Add control is intentionally quieter than the contextual primary button. The collapse button has an accessible label and the preference survives restart without a database migration.

Home uses an asymmetric grid above 1180px: tasks occupy the main column, while the next agenda entries, habits, routines and workout provide compact continuity. Inbox and overdue counts follow tasks. Projects, objectives, nutrition and finance appear below as lighter sections only when the source components have content. Near the minimum desktop width, the rail moves below tasks. Existing Finance privacy behavior remains in the source component.

## Accessibility

Keep the skip link, semantic headings, native dialog focus behavior and visible focus ring. Text hover/focus must remain legible; never apply a soft background token to text. For search suggestions, the focused combobox references the active option via `aria-activedescendant`. Test keyboard navigation, 200% zoom when possible, and both color themes.

## Light and dark

The same information hierarchy applies in both themes. Dark surfaces are charcoal rather than pure black; the blue becomes lighter. Feature CSS should read semantic tokens rather than hardcoding a theme-specific color. Existing feature screens may still use legacy aliases until their migration.

## Visual verification

The local preview harness in `scripts/ui-preview/` renders synthetic data only. From the repository root, run `npx vite --host 127.0.0.1 --port 4175`, then `node scripts/ui-preview/capture.mjs` in another terminal. Screenshots are written to the Git-ignored `artifacts/ui-phase1/` directory. This checks layout and themes without starting a Tauri binary or opening personal SQLite data.

For Tasks and Inbox, run `node scripts/ui-preview/capture-tasks-inbox.mjs`. It captures both themes at 900×620, 1280×720, 1366×768, 1440×900, 1920×1080 and 2560×1440 under the ignored `artifacts/ui-tasks-inbox/` directory and rejects horizontal overflow or page errors.

For Projects and Objectives, run `node scripts/ui-preview/capture-projects-objectives.mjs` against the same local Vite preview. It captures list and detail presentations in both themes at the same six desktop sizes under ignored `artifacts/ui-projects-objectives/`. The fixtures are invented and never query the personal database.

For Habits and Routines, run `node scripts/ui-preview/capture-habits-routines.mjs`. It captures both themes for the habit overview, routine overview and routine execution at the same six desktop sizes under ignored `artifacts/ui-habits-routines/`. The preview reuses the app's presentational cards with invented entries and occurrences; it never queries personal data.

For Calendar, Workouts and Body Progress, run `node scripts/ui-preview/capture-temporal-fitness.mjs` with the same local Vite preview. The synthetic harness captures the month, daily planner, workout Today and body overview in both themes at all six desktop sizes. Week planning, an active workout and workout history are captured at 1366×768 and 1920×1080. Files go to ignored `artifacts/ui-calendar-workouts-body/`; the fixtures contain no personal data.

For Nutrition, Finance and Financial Connections, run `node scripts/ui-preview/capture-nutrition-finance.mjs`. It checks light and dark at 1366×768 and 1920×1080, plus the six desktop sizes for the principal views, rejecting horizontal overflow and page errors. Optional screen names limit recapture after a focused change. Captures go to ignored `artifacts/ui-nutrition-finance/`. All meals, accounts and transactions in this harness are invented.

## Mockup translation: Tasks and Inbox

The approved concepts guide contextual headers, compact tabs, light list rows, prominent Inbox capture and restrained blue accents. The implementation keeps the existing four task views, QuickEntry, task drawer, conversions, editing, deletion and undo behavior. It does not add conceptual task filters, Inbox item types or a new database-backed master/detail route. Less frequent Inbox actions live in a keyboard-accessible disclosure menu; converting to a task remains visible on the row. The task drawer remains the existing editing surface so no behavior is lost.

## Mockup translation: Projects and Objectives

Projects emphasize execution. The overview preserves the real active, paused, completed and archived filters and presents status, task completion, next action and deadline from existing project data. Detail keeps sections, task rows, section ordering, creation, templates, linked habits and attachments. Rare project and section actions use a disclosure menu with Escape and focus return. An empty status filter has different copy from a genuinely empty project collection. The current status filter is remembered only in memory while the app runs.

Objectives emphasize direction. The list uses real categories, existing linked-item counts and the repository's existing progress calculation, including its financial privacy state; only a real percentage receives a ring with text. Detail puts the established milestones ahead of related items, attachments and updates. Category filtering uses existing categories and is remembered only in memory. No featured objective, cover image, new relationship, timeline query, project cover, schema change or migration was introduced to reproduce the conceptual art.

## Mockup translation: Habits and Routines

Habits communicate **consistency** and put **check-in** first. The overview shows only metrics derived from existing entries: completed eligible habits today, weekly registrations and 30-day consistency. Cards adapt to the existing boolean and quantity types, retain a native checkbox or explicit quantity form, and show seven days of actual records without a new streak, score or reminder rule. Editing, past-record correction, project association, pause and archive remain in the existing drawer.

Routines communicate **sequence** and put **execution** first. An active occurrence expands to show ordered native-checkbox steps, completion count, the next incomplete step and the established start, complete and reopen actions. Other routines stay compact until expanded. The editor retains ordering, item editing, templates, calendar visibility and Google mirror controls. Home summaries keep their compact rendering. No new duration model, occurrence state, schema change or migration was introduced.

## Mockup translation: Calendar, Workouts and Body Progress

Calendar communicates **time**; its primary action is **plan**. The month grid carries the visual weight, with a distinct today marker, compact source-aware events and a separate selected-day outline. Day and week retain the existing hour grid, all-day items, overlapping blocks, drag/drop, resize, current-time line and keyboard creation. The unscheduled list stays secondary and can be hidden; below 1200px it moves beneath the time grid so the page does not overflow. No new calendar source, event type or Google sync behavior was introduced.

Workouts communicate **execution**; the primary action is **train**. The scheduled or active session leads, while plan context becomes a quieter line. Existing tabs, plan actions, library, history and session persistence remain. During a session, exercise headings, previous loads and editable set rows receive a clearer hierarchy without adding estimated duration, invented training scores or new records.

Body Progress communicates **evolution**; the primary action is **track**. Existing weight, body-fat and left/right measurements form the summary and compact measure list. The line chart gains quiet grid lines and an area cue, while the existing history table supplies a full textual alternative; each SVG point has a date/value label. Measurement removal now uses the shared accessible Dialog instead of a browser confirm. No photo tracking, body composition model, goal metric or medical interpretation was added from the concept art.

## Mockup translation: Nutrition, Finance and Financial Connections

Nutrition communicates **daily tracking**; the primary action is **log**. Today leads with calories consumed and remaining, macro progress and recorded meals. Micronutrients and planning stay available with less visual competition. The established Diary, Progress, Diet, Meals, Shopping, Foods and History routes retain their behavior. Progress bars and charts use the shared color tokens in both themes rather than a separate green identity.

Finance communicates **clarity**; its primary actions are **understand and control**. The overview leads with balance, income and expenses, then planning, categories and recent transactions. Transactions lead with search, filters and a full-width list; the form and administrative tools are disclosed when needed. Budget, goal and patrimony figures continue to use the existing calculations and privacy preference. Hidden values stay masked in readouts and preview rows, and monetary editing is disabled while values are hidden.

Financial Connections communicates **trust**; its primary actions are **connect, review and import**. Connection state, external account and explicit RUMAR destination lead into a preview of individual transactions already supplied by the existing repository flow. The visual list is limited to 12 rows, with the total still shown. The shared Dialog presents the actual source, destination, period and counts before an explicit import action. No new import, synchronization, provider, credential or gateway rule was introduced.

## Do / don't

| Do                                                       | Don't                                       |
| -------------------------------------------------------- | ------------------------------------------- |
| Use a section heading and divider for related rows       | Nest cards solely to create separation      |
| Put the immediate action first                           | Give every statistic equal visual weight    |
| Show text labels and focus states                        | Rely on color or icon alone                 |
| Verify contrast in both themes                           | Use soft surface colors as text             |
| Keep desktop width comfortable and scrolling predictable | Fill every wide screen with oversized cards |

## Global visual recalibration

### Color system and visual identity

The rail's navy field, a single calm blue for selection/action, and the distinction between canvas and useful surfaces are the three recurring RUMAR cues. Do not echo the primary blue on every icon or add decorative gradients. The rail has its own ink, muted text, divider, hover and selected tokens so its contrast does not depend on content-surface colors. Success, warning, danger and info keep their semantic meaning across modules; Nutrition and Finance should not invent parallel palettes.

### Surfaces, radius and elevation

`--color-bg` is the canvas; `--color-surface` holds grouped content; `--color-surface-subtle` supports quiet controls and empty states; `--color-surface-raised` is reserved for overlays. `--color-interactive-surface` and `--color-selected-surface` identify interactive and selected regions. Rows and sections should generally use spacing and a divider instead of another card. Controls use the 9px radius, ordinary surfaces 12–14px and dialogs 16px. Ordinary cards do not need a floating shadow; `--shadow-md` belongs to dialogs, popovers and toasts.

### Page layout and headers

Page padding is 32–56px depending on window width. `--page-width-narrow`, `--page-width-standard` and `--page-width-wide` are 960, 1280 and 1480px; wide Calendar, Finance, Nutrition and Body Progress content may use the wider ceiling only on very large monitors. A page header contains a clear title, optional explanatory subtitle and contextual action. Subtitles stay short and are omitted when the title already explains the page. The Home's asymmetric composition is preserved.

### Buttons, inputs, tabs and badges

Primary buttons mean the page's next contextual action. Secondary and ghost controls support it; the sidebar Add control is a global shortcut and has a quieter treatment. Shared buttons and icon buttons retain 40px and at least 36px targets respectively. Inputs and selects keep a 42px minimum height, a semantic border and the shared focus ring; disabled and error states must remain readable. Tabs remain one navigation strip, scroll horizontally when needed and expose an unmistakable selected state. A status badge communicates state in words as well as color; category chips and tags should not be styled as status messages.

### Rows, tables and empty states

Lists remain rows with quiet dividers, visible hover/selection and metadata at a readable size. Tables use a light horizontal rhythm, restrained headers, horizontal scrolling in narrow containers and a row hover that does not obscure content. The shared `EmptyState` accepts an icon, contextual title, useful description, primary action and optional secondary action. It uses a subtle surface rather than a large illustration. A Home empty state remains unboxed so it does not create a card inside a section. Distinguish no records, no records for this filter and a completed day in copy supplied by each module.

### Charts

`--chart-grid`, `--chart-axis` and `--chart-fill` define the quiet chart grammar. Use the primary blue for the principal data series and semantic colors only for their actual meaning. Axes and dates must remain legible; chart tooltips or data-point titles provide exact values where available. Place the current value and relevant trend in visible text near the chart. Body Progress, Nutrition and Workouts map their existing charts to the shared grid/axis and 13px label scale; their existing history or summary views provide textual alternatives. Do not add invented comparison metrics to decorate a chart.

### Dialogs, drawers, menus and motion

Dialogs and drawers keep the existing focus trap, Escape behavior, focus return and header/footer structure. Secondary-action menus retain their keyboard and disclosure behavior. Scrollbars remain thin but visible, particularly in the navigation rail and long drawers. Motion uses the 120/160/220ms tokens for state changes, without bounce or continuous scroll effects. `prefers-reduced-motion` removes shell and control transitions without hiding information.

### Responsive rules

At 900×620, the sidebar navigation scrolls independently and its explicit cue exposes destinations below the fold while Settings remains anchored. At 1366×768, the content uses the standard page gutter and the major screens keep their existing hierarchy. At 1920×1080, standard content is capped instead of stretching indefinitely. At 2560×1440, data-dense modules may use the wide ceiling. Tabs and tables scroll within their own regions rather than causing page-wide horizontal overflow.

### Core experience polish

Home answers “what matters now?” with a four-item quick summary (today's tasks, workout, nutrition and habits), followed by actionable tasks and compact continuity from the existing agenda, projects, objectives and routines. The quick summary never repeats the task list. At wider desktop widths the page uses the existing content ceiling and real secondary content rather than enlarging cards.

Workouts Today puts the scheduled or active session first. Existing schedule, plan exercises and completed sessions provide a compact weekly count, an exercise preview, last-session context and upcoming scheduled workouts. These are read-only queries over existing records; estimated durations and new training scores are not implied. The session editor is unchanged.

Body Progress charts must explain their scale and period in visible text and in an accessible name. Axes, dates, a current-point marker and date/value titles support interpretation; the existing table remains the complete textual alternative. Derived change is descriptive and uses the same recorded measurements.

Habit overview rows prioritize the native check-in or existing quantity form, with short weekly history visible and longer-term consistency quiet. Nutrition gives Today, Diary and Progress the leading navigation group while Diet, Meals, Shopping, Foods and History remain directly visible and keyboard reachable. Financial Connections expresses the existing path as institution → RUMAR destination → review → confirmation, with a semantic current step. Connected accounts still show their actual state and technical help remains available by disclosure.

The preview harness uses invented records and never loads a personal database. The Core Experience capture in ignored `artifacts/ui-core-experience/` covers both themes and checks 900×620 through 2560×1440 for page errors and horizontal overflow. Some harness views are source-informed static compositions; Body Progress uses the real chart component and Home uses the real Home composition with synthetic slots.

### Visual debt for later phases

Thoughts, Timeline, Reviews and Settings still need their dedicated visual migration. The other migrated modules retain their current structure.

## UI migration status

| Area                        | Status  |
| --------------------------- | ------- |
| Foundation                  | DONE    |
| Global Visual Recalibration | DONE    |
| Core Experience Polish      | DONE    |
| Shell                       | DONE    |
| Sidebar                     | DONE    |
| Home                        | DONE    |
| Tasks                       | DONE    |
| Inbox                       | DONE    |
| Projects                    | DONE    |
| Objectives                  | DONE    |
| Habits                      | DONE    |
| Routines                    | DONE    |
| Calendar                    | DONE    |
| Workouts                    | DONE    |
| Body Progress               | DONE    |
| Nutrition                   | DONE    |
| Finance                     | DONE    |
| Financial Connections       | DONE    |
| Thoughts                    | PENDING |
| Timeline                    | PENDING |
| Reviews                     | PENDING |
| Settings                    | PENDING |

The contrast fix in Reviews remains a foundational correction; Reviews is pending full visual migration.
