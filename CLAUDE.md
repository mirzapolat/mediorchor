# CLAUDE.md

Notes for working on this codebase. The product is described in
[FUNCTIONAL-SPEC.md](FUNCTIONAL-SPEC.md) (its §5.3/§5.4 describe the original
visual language and the classic data table); this file records the newer,
"modern" design language used for new and reworked pages, and conventions
that are easy to get wrong.

## Design language (modern)

Reference implementations — copy from these rather than inventing:

| Pattern | Where |
| --- | --- |
| File browser (grid + list, selection, toolbar, toast) | `src/pages/PieceFilesPage.tsx` |
| Column table of pieces | `src/components/PieceTable.tsx` (+ `SortableList` `header`) |
| Classic table in the modern look | `DataTable` with `variant="modern"` (`src/pages/EventsPage.tsx`) |
| Node cards, section labels, inputs as chips | `src/components/FileWiring.tsx`, `src/components/SetupFileNodes.tsx` |
| Settings page with danger zone | `src/pages/PieceSettingsPage.tsx` |
| Read view + inline edit (Markdown) | `src/pages/PieceDetailsPage.tsx` |

### Principles

- **Calm and dense, not cramped.** One title per page (no repeated section
  title under it). Group content with small caps section labels
  (`text-xs font-semibold uppercase tracking-wide text-text-tertiary`), not
  more headings.
- **Rows never wrap.** Long text is cut with `truncate` (full text in a
  `title` tooltip); give the main column the free space (`min-w-0 flex-1`,
  or the one column without a width in a `table-fixed` table) and the others
  fixed widths shared by header and rows (one `COL` map, see `PieceTable`).
- **Type in tables** matches the app's other tables: rows `text-base`,
  column headers `text-sm`; only secondary lines and meta are smaller
  (`text-xs`/`text-sm`).
- **Actions appear where they act.** Secondary row/node actions (remove ✕,
  grips) are faded until hover (`opacity-0 group-hover/…:opacity-100`,
  always visible below `lg` and on `focus`). Several toolbar options
  collapse into one menu button (e.g. the files page's "Ansicht" menu: view,
  sort, trash).
- **Undo instead of confirm** for reversible actions (move, delete into the
  trash, visibility): do it, then show the black toast with "Rückgängig".
  Confirm dialogs only for what cannot be undone.

### Surfaces and shapes

- Cards, nodes and table frames: `rounded-2xl border border-border bg-surface`.
  Separate cards (`gap-2`) rather than one box with inner dividers when the
  items are independent (file nodes, voices) — inner rows must never paint a
  background over the outer rounded border.
- Table frames: lines between rows only (no vertical cell borders), header
  `bg-surface-subtle text-xs`, last row without a bottom border.
- Inner controls: `rounded-lg`/`rounded-md`; pills `rounded-full`.
- Hover: `hover:bg-surface-subtle` on rows, `hover:shadow-sm` on cards.
  Selected: `border-accent bg-accent/10` (checkbox `bg-accent text-white`).

### Recurring pieces

- **Icon tile:** a tinted square before a title — `h-8 w-8` (nodes) or
  `h-10 w-10` (file cards), `rounded-lg`/`rounded-xl bg-surface-muted` with
  the icon in a tone colour. Accent nodes (the trainer) use
  `bg-accent/15 text-accent` and `border-accent/50`.
- **File type colours:** `fileTone(file)` and `fileIcon(file)` from
  `src/components/PieceFileParts.tsx` (PDF `text-danger`, audio
  `text-chart-4`, notation `text-chart-1`, MIDI `text-chart-3`, images
  `text-chart-5`, links `text-chart-2`). Use them wherever a file appears.
- **Type badge:** `rounded bg-surface-muted px-1.5 py-px text-[10px]
  font-semibold text-text-secondary` (PDF, MP3, "Klick", a voice range).
- **Status pills (yes/no):** yes `bg-success-soft text-success-strong` with
  its icon and the word; no `bg-surface-muted text-text-tertiary` with an
  "off" icon (`MicOff`, `VolumeX`) — never a bare dash for a boolean.
- **Visibility:** "Öffentlich" (`Globe`, success pill) / "Privat" (`Lock`,
  muted pill); private because of a parent folder is shown, not toggleable.
- **Node card:** header row = icon tile + title + one status line
  (`text-xs text-text-tertiary`, e.g. "Verbunden", "2/4 Aufnahmen") +
  actions; inputs below as `h-10` rows with the port on the left edge, the
  connected file as a chip (`rounded-lg bg-surface-muted px-2 py-1 text-xs`
  with the file icon), an empty input as quiet "Datei hierher ziehen".
- **Empty states:** dashed `rounded-2xl` box, round muted icon, one bold
  line, one short hint. "Add" affordances as a full-width dashed button.
- **Long help** (e.g. the MuseScore export commands) goes into a
  `<details>` disclosure with a one-line summary, not inline.
- **Settings pages:** fields side by side (`sm:grid-cols-2`); destructive
  actions in a "Gefahrenzone" card (`border-danger/30`, title
  `text-danger`), each row = what it does + why + button.

### Colours

Only theme tokens (see `tailwind.config.ts`, `src/index.css`):
`surface*`, `border*`, `text*`, `accent`, `success*`, `danger*`,
`info-soft*`, `chart-1…6`, `black`/`white` (an inverse pair that swaps in
dark mode — `bg-black text-white` is the toast/primary look in both modes).
`npm run lint` runs `scripts/check-theme.mjs`, which rejects hex/rgb values
and Tailwind's palette classes.

## Conventions

- **Texts** live in `src/locales/{de,en,fi}.ts`; add every new key to all
  three (TypeScript enforces the key set via `en`). German is the product
  language; keep wording short ("Andere stumm", not sentences).
- **Analytics:** `track(event, data)` from `src/lib/analytics.ts` (Umami).
  Event names `area-action` (`files-move`, `training-play`); data only
  small fixed values — use `sizeBucket(n)` for counts, never names or ids.
  The trainer (`src/tonetrainer`) has no app imports; it reports through the
  `onTrack` prop.
- **API client:** `api.from(…)…` is lazy — a query runs only when awaited
  or `.then`-ed. `void api.from('x').update(…).eq(…)` alone never runs;
  write `.then(() => undefined)` (or await it) and handle the error.
- **Writes that must stay consistent** (moving files/folders, trash,
  restore) go through server RPCs in `server/pieceFiles.ts`, which run in
  one transaction — not through several table updates from the browser.
- **Access rules** are SQL predicates in `server/policies.ts`; stored
  objects of a piece are guarded by `mayReadPieceObject`, and every stored
  key passes `isCanonicalKey`/`pieceObjectPath` before touching the disk.
- **Migrations:** new numbered file in `server/migrations/`, applied on
  start; never edit an applied one.
- Run `npm run lint` before finishing (types + theme check).
