// Surveys and forms: the structure of a form and the rules its answers
// follow, shared by the server (which enforces them) and the app (builder,
// form page, results). Plain data and pure functions only.
//
// A form is a list of items. "section" items split it into pages (the items
// before the first section are page 0). A single choice or dropdown option
// may jump to a later section or straight to the end; a section may set
// where its page continues. Jumps only go forward, so a form can't loop.

export const ITEM_TYPES = [
  'short',
  'long',
  'number',
  'email',
  'date',
  'time',
  'yesno',
  'single',
  'multi',
  'dropdown',
  'ranking',
  'scale',
  'stars',
  'grid',
  'file',
  'text',
  'image',
  'section',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// Items without an answer: a text block, an image, a section start.
export const DISPLAY_TYPES: readonly ItemType[] = ['text', 'image', 'section'];
export const CHOICE_TYPES: readonly ItemType[] = ['single', 'multi', 'dropdown', 'ranking'];
export const BRANCH_TYPES: readonly ItemType[] = ['single', 'dropdown'];

// What a file question may accept.
export const FILE_KINDS = ['pdf', 'image', 'audio', 'video', 'document'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const FILE_KIND_TYPES: Record<FileKind, { mimes: string[]; exts: string[] }> = {
  pdf: { mimes: ['application/pdf'], exts: ['pdf'] },
  image: {
    mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic'],
    exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'],
  },
  audio: {
    mimes: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/aac', 'audio/flac'],
    exts: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'],
  },
  video: { mimes: ['video/mp4', 'video/quicktime', 'video/webm'], exts: ['mp4', 'mov', 'webm', 'm4v'] },
  document: {
    mimes: [
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ],
    exts: ['txt', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'csv'],
  },
};
export const MAX_FILE_MB = 50;

// The kind of an uploaded file by its name (the extension decides; the
// browser's type is only a hint), or null when no kind takes it.
export const fileKindOf = (name: string): FileKind | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return null;
  return FILE_KINDS.find((k) => FILE_KIND_TYPES[k].exts.includes(ext)) ?? null;
};

export interface FormOption {
  id: string;
  label: string;
  // Single choice / dropdown: where answering this continues (a later
  // section's item id, or "submit" for the end); unset = as usual.
  goto?: string;
}

export interface FormItem {
  id: string;
  type: ItemType;
  title: string;
  // Explanation under the title (plain text; a "text" item's body, Markdown).
  help: string;
  required?: boolean;
  // Own error message instead of the standard one.
  error?: string;
  // short / long: length; number: value range.
  min?: number | null;
  max?: number | null;
  integer?: boolean;
  options?: FormOption[];
  // multi: how many may / must be ticked; ranking: how many places may /
  // must be given.
  min_select?: number | null;
  max_select?: number | null;
  // scale: from (0 or 1) to (2–10) with optional end labels; stars: 3–10.
  scale_min?: number;
  scale_max?: number;
  min_label?: string;
  max_label?: string;
  // grid: one choice per row.
  rows?: FormOption[];
  columns?: FormOption[];
  // file: accepted kinds, size per file and how many files.
  accept?: FileKind[];
  max_mb?: number;
  max_files?: number;
  // image: an uploaded picture (public photos bucket).
  image_url?: string | null;
  // section: where its page continues ("next", "submit" or a later section).
  next?: string;
}

export interface FormSettings {
  intro: string; // Markdown, above the first page
  confirmation: string; // shown after sending
  confirmation_url: string; // optional link after sending
  confirmation_url_label: string;
  image_url: string | null; // project or title image (/files/photos/...)
  accent: string | null; // #rrggbb
}

export interface FormStructure {
  settings: FormSettings;
  items: FormItem[];
}

export const emptyStructure = (): FormStructure => ({
  settings: { intro: '', confirmation: '', confirmation_url: '', confirmation_url_label: '', image_url: null, accent: null },
  items: [],
});

export type AnswerValue = string | number | boolean | string[] | Record<string, string> | null;
export type Answers = Record<string, AnswerValue>;

// Limits that keep a public form bounded.
export const LIMITS = {
  items: 200,
  options: 100,
  title: 500,
  help: 5000,
  short: 500,
  long: 10_000,
  answersBytes: 200_000,
};

// --- structure --------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const PHOTO_URL = /^\/files\/photos\/[A-Za-z0-9._/-]+$/;
const photoUrl = (v: unknown) => (typeof v === 'string' && PHOTO_URL.test(v) && !v.includes('..') ? v : null);

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
};

export interface FormPage {
  section: FormItem | null;
  items: FormItem[];
}

// The pages of a form: page 0 holds the items before the first section.
export const pagesOf = (items: FormItem[]): FormPage[] => {
  const pages: FormPage[] = [{ section: null, items: [] }];
  for (const item of items) {
    if (item.type === 'section') pages.push({ section: item, items: [] });
    else pages[pages.length - 1].items.push(item);
  }
  // A form that starts with a section has an empty page 0: drop it.
  if (pages.length > 1 && pages[0].items.length === 0) pages.shift();
  return pages;
};

export type StructureProblemCode =
  | 'noTitle'
  | 'noOptions'
  | 'emptyOption'
  | 'duplicateOption'
  | 'badRange'
  | 'badJump'
  | 'tooMany'
  | 'noImage'
  | 'noAnswerItems'
  | 'badLink';

export interface StructureProblem {
  itemId: string | null;
  code: StructureProblemCode;
}

// Turns stored or sent JSON into a clean structure (unknown fields dropped,
// texts bounded). Never throws; problems are found by checkStructure.
export const normalizeStructure = (raw: unknown): FormStructure => {
  const base = emptyStructure();
  if (!isObj(raw)) return base;
  const s = isObj(raw.settings) ? raw.settings : {};
  const settings: FormSettings = {
    intro: str(s.intro, 20_000),
    confirmation: str(s.confirmation, 5000),
    confirmation_url: str(s.confirmation_url, 2000).trim(),
    confirmation_url_label: str(s.confirmation_url_label, 200),
    image_url: photoUrl(s.image_url),
    accent: typeof s.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.accent) ? s.accent : null,
  };
  const items: FormItem[] = [];
  const seen = new Set<string>();
  for (const rawItem of Array.isArray(raw.items) ? raw.items.slice(0, LIMITS.items) : []) {
    if (!isObj(rawItem)) continue;
    const type = rawItem.type as ItemType;
    if (!ITEM_TYPES.includes(type)) continue;
    const id = typeof rawItem.id === 'string' && ID.test(rawItem.id) && !seen.has(rawItem.id) ? rawItem.id : null;
    if (!id) continue;
    seen.add(id);
    const options = (list: unknown): FormOption[] => {
      const ids = new Set<string>();
      return (Array.isArray(list) ? list.slice(0, LIMITS.options) : [])
        .filter(isObj)
        .filter((o) => typeof o.id === 'string' && ID.test(o.id) && !ids.has(o.id) && Boolean(ids.add(o.id)))
        .map((o) => ({
          id: String(o.id),
          label: str(o.label, 500),
          ...(typeof o.goto === 'string' && o.goto ? { goto: o.goto.slice(0, 40) } : {}),
        }));
    };
    const item: FormItem = { id, type, title: str(rawItem.title, LIMITS.title), help: str(rawItem.help, LIMITS.help) };
    if (!DISPLAY_TYPES.includes(type)) {
      item.required = rawItem.required === true;
      if (typeof rawItem.error === 'string' && rawItem.error.trim()) item.error = str(rawItem.error, 300);
    }
    if (type === 'short' || type === 'long' || type === 'number') {
      item.min = num(rawItem.min);
      item.max = num(rawItem.max);
      if (type === 'number') item.integer = rawItem.integer === true;
    }
    if (CHOICE_TYPES.includes(type)) item.options = options(rawItem.options);
    // Jumps only from a single choice or a dropdown.
    if (type === 'multi' || type === 'ranking') {
      item.options = item.options?.map(({ id: oid, label }) => ({ id: oid, label }));
      item.min_select = num(rawItem.min_select);
      item.max_select = num(rawItem.max_select);
    }
    if (type === 'scale') {
      item.scale_min = rawItem.scale_min === 0 ? 0 : 1;
      item.scale_max = Math.min(10, Math.max(2, Math.round(num(rawItem.scale_max) ?? 5)));
      item.min_label = str(rawItem.min_label, 100);
      item.max_label = str(rawItem.max_label, 100);
    }
    if (type === 'stars') item.scale_max = Math.min(10, Math.max(3, Math.round(num(rawItem.scale_max) ?? 5)));
    if (type === 'grid') {
      item.rows = options(rawItem.rows).map(({ id: oid, label }) => ({ id: oid, label }));
      item.columns = options(rawItem.columns).map(({ id: oid, label }) => ({ id: oid, label }));
    }
    if (type === 'file') {
      const accept = Array.isArray(rawItem.accept)
        ? rawItem.accept.filter((k): k is FileKind => FILE_KINDS.includes(k as FileKind))
        : [];
      item.accept = accept.length ? [...new Set(accept)] : ['pdf', 'image'];
      item.max_mb = Math.min(MAX_FILE_MB, Math.max(1, Math.round(num(rawItem.max_mb) ?? 10)));
      item.max_files = Math.min(10, Math.max(1, Math.round(num(rawItem.max_files) ?? 1)));
    }
    if (type === 'image') item.image_url = photoUrl(rawItem.image_url);
    if (type === 'section') item.next = typeof rawItem.next === 'string' && rawItem.next ? rawItem.next.slice(0, 40) : 'next';
    items.push(item);
  }
  return { settings, items };
};

// What is wrong with a structure before it can be published.
export const checkStructure = (structure: FormStructure): StructureProblem[] => {
  const problems: StructureProblem[] = [];
  const { items, settings } = structure;
  if (items.length > LIMITS.items) problems.push({ itemId: null, code: 'tooMany' });
  if (!items.some((i) => !DISPLAY_TYPES.includes(i.type))) problems.push({ itemId: null, code: 'noAnswerItems' });
  if (settings.confirmation_url && !isHttpUrl(settings.confirmation_url)) problems.push({ itemId: null, code: 'badLink' });
  const sectionIndex = new Map(items.filter((i) => i.type === 'section').map((s) => [s.id, items.indexOf(s)]));
  // A jump must lead to a section after the item (or the end): never back.
  const validJump = (from: number, target: string | undefined) =>
    target === undefined || target === 'next' || target === 'submit' || (sectionIndex.get(target) ?? -1) > from;
  items.forEach((item, index) => {
    if (item.type === 'text') {
      if (!item.title.trim() && !item.help.trim()) problems.push({ itemId: item.id, code: 'noTitle' });
    } else if (item.type !== 'image' && !item.title.trim()) {
      problems.push({ itemId: item.id, code: 'noTitle' });
    }
    if (item.type === 'image' && !item.image_url) problems.push({ itemId: item.id, code: 'noImage' });
    const lists = item.type === 'grid' ? [item.rows ?? [], item.columns ?? []] : item.options ? [item.options] : [];
    for (const list of lists) {
      if (list.length === 0) problems.push({ itemId: item.id, code: 'noOptions' });
      if (list.some((o) => !o.label.trim())) problems.push({ itemId: item.id, code: 'emptyOption' });
      const labels = list.map((o) => o.label.trim().toLowerCase());
      if (new Set(labels).size !== labels.length) problems.push({ itemId: item.id, code: 'duplicateOption' });
    }
    if (item.min != null && item.max != null && item.min > item.max) problems.push({ itemId: item.id, code: 'badRange' });
    if (item.min_select != null && item.max_select != null && item.min_select > item.max_select) {
      problems.push({ itemId: item.id, code: 'badRange' });
    }
    if (item.type === 'section' && !validJump(index, item.next)) problems.push({ itemId: item.id, code: 'badJump' });
    if (BRANCH_TYPES.includes(item.type) && item.options?.some((o) => !validJump(index, o.goto))) {
      problems.push({ itemId: item.id, code: 'badJump' });
    }
  });
  return problems;
};

// The part of a structure that decides what an answer means: types,
// options, rules and jumps — not the wording. Publishing a draft that
// differs here makes a new version; wording-only differences are editorial
// fixes of the current version.
export const structuralSignature = (structure: FormStructure) =>
  JSON.stringify(
    structure.items.map((i) => ({
      id: i.id,
      type: i.type,
      required: i.required ?? false,
      min: i.min ?? null,
      max: i.max ?? null,
      integer: i.integer ?? false,
      options: i.options?.map((o) => [o.id, o.label, o.goto ?? null]) ?? null,
      min_select: i.min_select ?? null,
      max_select: i.max_select ?? null,
      scale: [i.scale_min ?? null, i.scale_max ?? null],
      rows: i.rows?.map((o) => [o.id, o.label]) ?? null,
      columns: i.columns?.map((o) => [o.id, o.label]) ?? null,
      accept: i.accept ?? null,
      max_mb: i.max_mb ?? null,
      max_files: i.max_files ?? null,
      next: i.next ?? null,
    })),
  );

// --- answers ----------------------------------------------------------------

export type AnswerProblem =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'notNumber'
  | 'notInteger'
  | 'tooSmall'
  | 'tooLarge'
  | 'invalidEmail'
  | 'invalidDate'
  | 'invalidTime'
  | 'invalidChoice'
  | 'tooFewChoices'
  | 'tooManyChoices'
  | 'incompleteGrid'
  | 'tooManyFiles';

const EMAIL = /^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/;

export const isEmpty = (value: AnswerValue | undefined) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0) ||
  (isObj(value) && Object.keys(value).length === 0);

// The problem with one answer, or null. `value` is as the form page keeps it.
export const checkAnswer = (item: FormItem, value: AnswerValue | undefined): AnswerProblem | null => {
  if (DISPLAY_TYPES.includes(item.type)) return null;
  if (isEmpty(value)) return item.required ? 'required' : null;
  switch (item.type) {
    case 'short':
    case 'long': {
      if (typeof value !== 'string') return 'invalidChoice';
      const length = value.trim().length;
      if (length > (item.type === 'short' ? LIMITS.short : LIMITS.long)) return 'tooLong';
      if (item.min != null && length < item.min) return 'tooShort';
      if (item.max != null && length > item.max) return 'tooLong';
      return null;
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(n)) return 'notNumber';
      if (item.integer && !Number.isInteger(n)) return 'notInteger';
      if (item.min != null && n < item.min) return 'tooSmall';
      if (item.max != null && n > item.max) return 'tooLarge';
      return null;
    }
    case 'email':
      return typeof value === 'string' && value.length <= 254 && EMAIL.test(value.trim()) ? null : 'invalidEmail';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
        ? null
        : 'invalidDate';
    case 'time':
      return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? null : 'invalidTime';
    case 'yesno':
      return typeof value === 'boolean' ? null : 'invalidChoice';
    case 'single':
    case 'dropdown':
      return typeof value === 'string' && item.options?.some((o) => o.id === value) ? null : 'invalidChoice';
    // ranking: the chosen options, best first.
    case 'multi':
    case 'ranking': {
      if (!Array.isArray(value) || !value.every((v) => item.options?.some((o) => o.id === v))) return 'invalidChoice';
      if (new Set(value).size !== value.length) return 'invalidChoice';
      if (item.min_select != null && value.length < item.min_select) return 'tooFewChoices';
      if (item.max_select != null && value.length > item.max_select) return 'tooManyChoices';
      return null;
    }
    case 'scale':
    case 'stars': {
      const from = item.type === 'stars' ? 1 : (item.scale_min ?? 1);
      const to = item.scale_max ?? 5;
      return typeof value === 'number' && Number.isInteger(value) && value >= from && value <= to ? null : 'invalidChoice';
    }
    case 'grid': {
      if (!isObj(value)) return 'invalidChoice';
      for (const [row, column] of Object.entries(value)) {
        if (!item.rows?.some((r) => r.id === row) || !item.columns?.some((c) => c.id === column)) return 'invalidChoice';
      }
      if (item.required && item.rows?.some((r) => !(r.id in value))) return 'incompleteGrid';
      return null;
    }
    case 'file': {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return 'invalidChoice';
      if (value.length > (item.max_files ?? 1)) return 'tooManyFiles';
      return null;
    }
    default:
      return null;
  }
};

// Where a page continues: the last answered jumping option on it, else the
// section's own setting, else the next page. A page index or "end".
export const nextPage = (pages: FormPage[], index: number, answers: Answers): number | 'end' => {
  const page = pages[index];
  let target: string | undefined;
  for (const item of page.items) {
    if (!BRANCH_TYPES.includes(item.type)) continue;
    const chosen = item.options?.find((o) => o.id === answers[item.id]);
    if (chosen?.goto) target = chosen.goto;
  }
  target ??= page.section?.next;
  if (target === 'submit') return 'end';
  if (target && target !== 'next') {
    const found = pages.findIndex((p) => p.section?.id === target);
    if (found > index) return found;
  }
  return index + 1 < pages.length ? index + 1 : 'end';
};

// The pages a respondent goes through with these answers, in order (their
// indexes in pagesOf).
export const visitedPageIndexes = (items: FormItem[], answers: Answers) => {
  const pages = pagesOf(items);
  const visited: number[] = [];
  let index: number | 'end' = 0;
  // Jumps only go forward, so this ends after at most pages.length steps.
  while (index !== 'end' && !visited.includes(index)) {
    visited.push(index);
    index = nextPage(pages, index, answers);
  }
  return visited;
};

// Checks a whole submission: only the visited pages count; answers to items
// that weren't visited are dropped. The cleaned answers, and the problem
// per item.
export const checkSubmission = (structure: FormStructure, raw: Answers) => {
  const answers: Answers = {};
  const problems: Record<string, AnswerProblem> = {};
  const pages = pagesOf(structure.items);
  for (const index of visitedPageIndexes(structure.items, raw)) {
    for (const item of pages[index].items) {
      if (DISPLAY_TYPES.includes(item.type)) continue;
      let value = raw[item.id];
      if (typeof value === 'string' && item.type !== 'long') value = value.trim();
      if (item.type === 'number' && typeof value === 'string' && value !== '') value = Number(value.replace(',', '.'));
      const problem = checkAnswer(item, value);
      if (problem) problems[item.id] = problem;
      else if (!isEmpty(value)) answers[item.id] = value ?? null;
    }
  }
  return { answers, problems };
};

export interface SnapshotItem {
  title: string;
  type: ItemType;
  options?: Record<string, string>;
  rows?: Record<string, string>;
  columns?: Record<string, string>;
}
export type FormSnapshot = Record<string, SnapshotItem>;

// The wording of the answered items, kept with each response so it stays
// readable when the form changes later.
export const snapshotOf = (structure: FormStructure, answers: Answers): FormSnapshot => {
  const snapshot: FormSnapshot = {};
  const map = (list?: FormOption[]) => (list ? Object.fromEntries(list.map((o) => [o.id, o.label])) : undefined);
  for (const item of structure.items) {
    if (!(item.id in answers)) continue;
    snapshot[item.id] = {
      title: item.title,
      type: item.type,
      ...(item.options ? { options: map(item.options) } : {}),
      ...(item.rows ? { rows: map(item.rows), columns: map(item.columns) } : {}),
    };
  }
  return snapshot;
};

// An answer as text (CSV export, emails): options by their label.
export const answerText = (
  item: SnapshotItem,
  value: AnswerValue | undefined,
  words: { yes: string; no: string; files: (n: number) => string },
): string => {
  if (value === undefined || value === null) return '';
  switch (item.type) {
    case 'yesno':
      return value === true ? words.yes : value === false ? words.no : '';
    case 'single':
    case 'dropdown':
      return item.options?.[String(value)] ?? String(value);
    case 'multi':
      return Array.isArray(value) ? value.map((v) => item.options?.[v] ?? v).join('; ') : '';
    case 'ranking':
      return Array.isArray(value) ? value.map((v, i) => `${i + 1}. ${item.options?.[v] ?? v}`).join('; ') : '';
    case 'grid':
      return isObj(value)
        ? Object.entries(value)
            .map(([row, column]) => `${item.rows?.[row] ?? row}: ${item.columns?.[String(column)] ?? column}`)
            .join('; ')
        : '';
    case 'file':
      return Array.isArray(value) ? words.files(value.length) : '';
    default:
      return String(value);
  }
};

// --- ranked choice ----------------------------------------------------------

export interface RunoffRound {
  // Votes per option still in the race (each ballot counts for its best
  // ranked option that is left).
  counts: Record<string, number>;
  // Ballots still counting (the others ranked no option that is left).
  active: number;
  // Dropped after this round.
  eliminated: string[];
}

export interface RunoffResult {
  rounds: RunoffRound[];
  // More than half of the counting ballots, or the last left; null when no
  // ballots or a tie between all that are left.
  winner: string | null;
  // The options tied at the end (no winner).
  tied: string[];
}

// Instant runoff: count first choices; while no option has more than half
// of the counting ballots, drop the weakest (on a tie, those of them with
// the fewest first choices overall — and all of them if still tied) and
// count those ballots for their next choice.
export const instantRunoff = (ballots: string[][], optionIds: string[]): RunoffResult => {
  const known = new Set(optionIds);
  const clean = ballots.map((b) => b.filter((id) => known.has(id))).filter((b) => b.length > 0);
  const firsts: Record<string, number> = Object.fromEntries(optionIds.map((id) => [id, 0]));
  for (const b of clean) firsts[b[0]]++;
  let left = [...optionIds];
  const rounds: RunoffRound[] = [];
  while (left.length > 0) {
    const counts: Record<string, number> = Object.fromEntries(left.map((id) => [id, 0]));
    let active = 0;
    for (const b of clean) {
      const top = b.find((id) => id in counts);
      if (top === undefined) continue;
      counts[top]++;
      active++;
    }
    const best = Math.max(...left.map((id) => counts[id]));
    const leader = left.find((id) => counts[id] === best)!;
    if (active === 0) {
      rounds.push({ counts, active, eliminated: [] });
      return { rounds, winner: null, tied: [] };
    }
    if (best * 2 > active || left.length === 1) {
      rounds.push({ counts, active, eliminated: [] });
      return { rounds, winner: leader, tied: [] };
    }
    const fewest = Math.min(...left.map((id) => counts[id]));
    let weakest = left.filter((id) => counts[id] === fewest);
    if (weakest.length > 1) {
      const fewestFirsts = Math.min(...weakest.map((id) => firsts[id]));
      weakest = weakest.filter((id) => firsts[id] === fewestFirsts);
    }
    if (weakest.length === left.length) {
      rounds.push({ counts, active, eliminated: [] });
      return { rounds, winner: null, tied: left };
    }
    rounds.push({ counts, active, eliminated: weakest });
    left = left.filter((id) => !weakest.includes(id));
  }
  return { rounds, winner: null, tied: [] };
};

// --- settings ---------------------------------------------------------------

export const ACCESS_MODES = ['members', 'accounts', 'guests'] as const;
export type FormAccess = (typeof ACCESS_MODES)[number];
export const IDENTITY_MODES = ['named', 'confidential', 'anonymous'] as const;
export type FormIdentity = (typeof IDENTITY_MODES)[number];
export const GUEST_FIELD_MODES = ['required', 'optional', 'off'] as const;
export type GuestFieldMode = (typeof GUEST_FIELD_MODES)[number];
export const RESULT_MODES = ['off', 'after_submit', 'after_close'] as const;
export type FormResultsMode = (typeof RESULT_MODES)[number];
export const NOTIFY_MODES = ['off', 'each', 'daily'] as const;
export type FormNotifyMode = (typeof NOTIFY_MODES)[number];

// The participant summary never shows fewer responses than this.
export const MIN_SUMMARY_RESPONSES = 5;

export type FormState = 'draft' | 'scheduled' | 'open' | 'closed' | 'archived';

// Where a form stands: drafts and the archive by hand; once published it
// is scheduled until it opens, and open until it is closed by hand, by its
// deadline or by reaching the maximum number of responses.
export const formState = (
  form: {
    status: string;
    archived: boolean | number;
    opens_at: string | null;
    closes_at: string | null;
    max_responses: number | null;
  },
  responses: number,
  now = Date.now(),
): FormState => {
  if (form.archived) return 'archived';
  if (form.status === 'draft') return 'draft';
  if (form.status === 'closed') return 'closed';
  if (form.closes_at && !(Date.parse(form.closes_at) > now)) return 'closed';
  if (form.max_responses != null && responses >= form.max_responses) return 'closed';
  if (form.opens_at && Date.parse(form.opens_at) > now) return 'scheduled';
  return 'open';
};

// A fresh id for an item or option (client side; the server only checks the
// shape).
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
