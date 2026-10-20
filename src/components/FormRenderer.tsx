import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, Paperclip, Pencil, Send, Star, Upload, X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { Markdown } from '@/lib/markdown';
import { formatBytes } from '@/lib/concerts';
import { localeOf } from '@shared/languages';
import { problemText, type UploadedFile } from '@/lib/forms';
import {
  DISPLAY_TYPES,
  FILE_KIND_TYPES,
  answerText,
  checkAnswer,
  nextPage,
  pagesOf,
  snapshotOf,
  visitedPageIndexes,
  type AnswerProblem,
  type AnswerValue,
  type Answers,
  type FormItem,
  type FormStructure,
} from '@shared/forms';

// Shows a form page by page (a "section" starts a new page) and checks each
// page before going on; jumps follow the answers, Back retraces the way
// taken. With `review` the answers are shown once more before sending.
// `extras` (guest name, consent, …) sit on the last step above "Send".
// Used by the public form page and the builder's preview (`onUpload`
// unset there: file questions only show what they'd accept).
export const FormRenderer = ({
  structure,
  answers,
  onAnswers,
  startPage = 0,
  onPageChange,
  showProgress,
  review,
  files,
  onUpload,
  onRemoveFile,
  extras,
  extrasValid = true,
  onSubmit,
  submitting = false,
  serverProblems,
  submitLabel,
}: {
  structure: FormStructure;
  answers: Answers;
  onAnswers: (answers: Answers) => void;
  startPage?: number;
  onPageChange?: (page: number) => void;
  showProgress: boolean;
  review: boolean;
  files: Record<string, UploadedFile[]>;
  onUpload?: (itemId: string, file: File, onProgress: (share: number) => void) => Promise<string | null>;
  onRemoveFile?: (itemId: string, fileId: string) => void;
  extras?: ReactNode;
  extrasValid?: boolean;
  onSubmit: () => void;
  submitting?: boolean;
  serverProblems?: Record<string, AnswerProblem> | null;
  submitLabel?: string;
}) => {
  const { t } = useI18n();
  const pages = useMemo(() => pagesOf(structure.items), [structure.items]);
  // The way taken so far (page indexes); restored drafts replay it.
  const [history, setHistory] = useState<number[]>(() => {
    const visited = visitedPageIndexes(structure.items, answers);
    const at = visited.indexOf(startPage);
    return at >= 0 ? visited.slice(0, at + 1) : [0];
  });
  const [reviewing, setReviewing] = useState(false);
  const [shown, setShown] = useState<Record<string, AnswerProblem>>({});
  const topRef = useRef<HTMLDivElement>(null);
  const current = Math.min(history[history.length - 1] ?? 0, pages.length - 1);
  const page = pages[current];

  // Problems the server found: shown on the page they belong to.
  useEffect(() => {
    if (!serverProblems || Object.keys(serverProblems).length === 0) return;
    setShown(serverProblems);
    setReviewing(false);
    const target = pages.findIndex((p) => p.items.some((i) => i.id in serverProblems));
    if (target >= 0) setHistory((h) => (h.includes(target) ? h.slice(0, h.indexOf(target) + 1) : [...h, target]));
  }, [serverProblems, pages]);

  const scrollTop = () => topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const pageProblems = () => {
    const problems: Record<string, AnswerProblem> = {};
    for (const item of page.items) {
      const problem = checkAnswer(item, answers[item.id]);
      if (problem) problems[item.id] = problem;
    }
    return problems;
  };

  const next = nextPage(pages, current, answers);
  const isLast = next === 'end';

  const goNext = () => {
    const problems = pageProblems();
    setShown(problems);
    if (Object.keys(problems).length) {
      // The first field with a problem gets the focus.
      const first = page.items.find((i) => i.id in problems);
      window.setTimeout(() => document.getElementById(`field-${first?.id}`)?.focus(), 0);
      return;
    }
    if (next === 'end') {
      if (review) setReviewing(true);
      else onSubmit();
    } else {
      setHistory((h) => [...h, next]);
      onPageChange?.(next);
    }
    scrollTop();
  };

  const goBack = () => {
    if (reviewing) {
      setReviewing(false);
      return;
    }
    setShown({});
    setHistory((h) => {
      const back = h.length > 1 ? h.slice(0, -1) : h;
      onPageChange?.(back[back.length - 1]);
      return back;
    });
    scrollTop();
  };

  const set = (id: string, value: AnswerValue) => {
    onAnswers({ ...answers, [id]: value });
    if (shown[id]) setShown((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== id)));
  };

  const progress = reviewing ? 1 : (current + 1) / (pages.length + (review ? 1 : 0));
  const finalStep = reviewing || (isLast && !review);

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-5">
      {showProgress && pages.length > 1 && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          aria-label={t('formProgress')}
          className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        >
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {reviewing ? (
        <ReviewList
          structure={structure}
          answers={answers}
          onEdit={(index) => {
            setReviewing(false);
            setHistory((h) => (h.includes(index) ? h.slice(0, h.indexOf(index) + 1) : h));
          }}
        />
      ) : (
        <>
          {current === 0 && structure.settings.intro.trim() && (
            <Markdown source={structure.settings.intro} className="space-y-2 break-words leading-relaxed text-text-secondary" />
          )}
          {page.section && (
            <div className="border-b border-border pb-3">
              <h2 className="text-lg font-semibold">{page.section.title}</h2>
              {page.section.help && <p className="mt-1 whitespace-pre-line text-sm text-text-secondary">{page.section.help}</p>}
            </div>
          )}
          <div className="space-y-6">
            {page.items.map((item) => (
              <FormField
                key={item.id}
                item={item}
                value={answers[item.id]}
                onChange={(value) => set(item.id, value)}
                problem={shown[item.id]}
                files={files[item.id] ?? []}
                onUpload={onUpload}
                onRemoveFile={onRemoveFile}
              />
            ))}
          </div>
        </>
      )}

      {finalStep && extras}

      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        {history.length > 1 || reviewing ? (
          <Button variant="secondary" type="button" onClick={goBack}>
            <ArrowLeft size={16} />
            {t('back')}
          </Button>
        ) : (
          <span />
        )}
        {reviewing ? (
          <Button type="button" onClick={onSubmit} disabled={submitting || !extrasValid}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {submitLabel ?? t('formSend')}
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={submitting || (finalStep && !extrasValid)}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : isLast ? (
              review ? (
                <Check size={16} />
              ) : (
                <Send size={16} />
              )
            ) : (
              <ArrowRight size={16} />
            )}
            {isLast ? (review ? t('formReview') : (submitLabel ?? t('formSend'))) : t('formNext')}
          </Button>
        )}
      </div>
    </div>
  );
};

// The answers once more, page by page, each page with "Edit".
const ReviewList = ({
  structure,
  answers,
  onEdit,
}: {
  structure: FormStructure;
  answers: Answers;
  onEdit: (pageIndex: number) => void;
}) => {
  const { t } = useI18n();
  const pages = pagesOf(structure.items);
  const snapshot = snapshotOf(structure, answers);
  const words = { yes: t('yes'), no: t('no'), files: (n: number) => t('formFilesCount').replace('{n}', String(n)) };
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('formReviewTitle')}</h2>
      {visitedPageIndexes(structure.items, answers).map((index) => {
        const page = pages[index];
        const asked = page.items.filter((i) => !DISPLAY_TYPES.includes(i.type));
        if (asked.length === 0) return null;
        return (
          <section key={index} className="rounded-2xl border border-border bg-surface px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                {page.section?.title || t('formFirstPage')}
              </h3>
              <button
                type="button"
                onClick={() => onEdit(index)}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-muted hover:text-text"
              >
                <Pencil size={13} />
                {t('edit')}
              </button>
            </div>
            <dl className="space-y-2">
              {asked.map((item) => (
                <div key={item.id}>
                  <dt className="text-sm text-text-secondary">{item.title}</dt>
                  <dd className="whitespace-pre-line break-words font-medium">
                    {snapshot[item.id] ? answerText(snapshot[item.id], answers[item.id], words) : <span className="text-text-tertiary">—</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </div>
  );
};

const fieldClass =
  'w-full rounded-md border bg-white px-3 py-2 text-base placeholder:text-text-tertiary focus:border-black focus:outline-none max-md:min-h-11';

// One question (or text, image) with its answer control.
export const FormField = ({
  item,
  value,
  onChange,
  problem,
  files,
  onUpload,
  onRemoveFile,
}: {
  item: FormItem;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  problem?: AnswerProblem;
  files: UploadedFile[];
  onUpload?: (itemId: string, file: File, onProgress: (share: number) => void) => Promise<string | null>;
  onRemoveFile?: (itemId: string, fileId: string) => void;
}) => {
  const { t } = useI18n();
  const id = `field-${item.id}`;
  const errorId = `${id}-error`;
  const border = problem ? 'border-danger' : 'border-border';
  const described = problem ? errorId : undefined;

  if (item.type === 'text') {
    return (
      <div>
        {item.title && <h3 className="font-semibold">{item.title}</h3>}
        {item.help && <Markdown source={item.help} className="mt-1 space-y-2 text-sm text-text-secondary" />}
      </div>
    );
  }
  if (item.type === 'image') {
    return item.image_url ? (
      <figure>
        <img src={item.image_url} alt={item.title} className="w-full rounded-xl border border-border object-cover" />
        {item.title && <figcaption className="mt-1.5 text-sm text-text-secondary">{item.title}</figcaption>}
      </figure>
    ) : null;
  }

  const label = (
    <div className="mb-2">
      <label id={`${id}-label`} htmlFor={id} className="block font-medium">
        {item.title}
        {item.required && (
          <span className="ml-0.5 text-danger" aria-label={t('formRequired')}>
            *
          </span>
        )}
      </label>
      {item.help && <p className="mt-0.5 whitespace-pre-line text-sm text-text-secondary">{item.help}</p>}
    </div>
  );

  let control: ReactNode = null;
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  switch (item.type) {
    case 'short':
    case 'email':
    case 'date':
    case 'time':
    case 'number':
      control = (
        <input
          id={id}
          type={item.type === 'short' ? 'text' : item.type === 'number' ? 'text' : item.type}
          inputMode={item.type === 'number' ? 'decimal' : undefined}
          autoComplete={item.type === 'email' ? 'email' : 'off'}
          value={text}
          maxLength={item.type === 'short' ? (item.max ?? 500) : undefined}
          aria-invalid={Boolean(problem)}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          className={cn(fieldClass, border, item.type === 'date' || item.type === 'time' ? 'sm:max-w-xs' : '')}
        />
      );
      break;
    case 'long':
      control = (
        <textarea
          id={id}
          value={text}
          rows={4}
          maxLength={item.max ?? 10_000}
          aria-invalid={Boolean(problem)}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
          className={cn(fieldClass, border, 'min-h-[110px] resize-y')}
        />
      );
      break;
    case 'yesno':
      control = (
        <ChoiceGroup labelledBy={`${id}-label`} describedBy={described}>
          {[
            { v: true, l: t('yes') },
            { v: false, l: t('no') },
          ].map(({ v, l }, index) => (
            <ChoiceButton key={l} id={index === 0 ? id : undefined} selected={value === v} onClick={() => onChange(v)} round>
              {l}
            </ChoiceButton>
          ))}
        </ChoiceGroup>
      );
      break;
    case 'single':
      control = (
        <ChoiceGroup labelledBy={`${id}-label`} describedBy={described} column>
          {item.options?.map((o, index) => (
            <ChoiceButton key={o.id} id={index === 0 ? id : undefined} selected={value === o.id} onClick={() => onChange(value === o.id && !item.required ? null : o.id)} round>
              {o.label}
            </ChoiceButton>
          ))}
        </ChoiceGroup>
      );
      break;
    case 'multi': {
      const chosen = Array.isArray(value) ? value : [];
      control = (
        <>
          {(item.min_select != null || item.max_select != null) && (
            <p className="mb-2 text-xs text-text-tertiary">
              {item.min_select != null && item.max_select != null
                ? t('formChooseBetween').replace('{min}', String(item.min_select)).replace('{max}', String(item.max_select))
                : item.max_select != null
                  ? t('formChooseAtMost').replace('{max}', String(item.max_select))
                  : t('formChooseAtLeast').replace('{min}', String(item.min_select))}
            </p>
          )}
          <div role="group" aria-labelledby={`${id}-label`} aria-describedby={described} className="flex flex-col gap-2">
            {item.options?.map((o, index) => {
              const on = chosen.includes(o.id);
              return (
                <ChoiceButton
                  key={o.id}
                  id={index === 0 ? id : undefined}
                  selected={on}
                  checkbox
                  onClick={() => onChange(on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])}
                >
                  {o.label}
                </ChoiceButton>
              );
            })}
          </div>
        </>
      );
      break;
    }
    case 'dropdown':
      control = (
        <select
          id={id}
          value={text}
          aria-invalid={Boolean(problem)}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value || null)}
          className={cn(fieldClass, border, 'pr-9 sm:max-w-md')}
        >
          <option value="">{t('formChoose')}</option>
          {item.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'scale': {
      const from = item.scale_min ?? 1;
      const to = item.scale_max ?? 5;
      control = (
        <div>
          <ChoiceGroup labelledBy={`${id}-label`} describedBy={described}>
            {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((n, index) => (
              <ChoiceButton key={n} id={index === 0 ? id : undefined} selected={value === n} onClick={() => onChange(n)} square>
                {n}
              </ChoiceButton>
            ))}
          </ChoiceGroup>
          {(item.min_label || item.max_label) && (
            <div className="mt-1.5 flex justify-between gap-4 text-xs text-text-tertiary">
              <span>{item.min_label}</span>
              <span className="text-right">{item.max_label}</span>
            </div>
          )}
        </div>
      );
      break;
    }
    case 'stars': {
      const max = item.scale_max ?? 5;
      const current = typeof value === 'number' ? value : 0;
      control = (
        <div role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={described} className="flex gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              id={n === 1 ? id : undefined}
              type="button"
              role="radio"
              aria-checked={current === n}
              aria-label={t('formStarsLabel').replace('{n}', String(n)).replace('{max}', String(max))}
              onClick={() => onChange(n)}
              className="flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Star size={26} className={n <= current ? 'fill-accent text-accent' : 'text-border-strong'} />
            </button>
          ))}
        </div>
      );
      break;
    }
    case 'grid': {
      const grid = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};
      control = (
        <div id={id} tabIndex={-1} aria-describedby={described} className="space-y-3">
          {item.rows?.map((row) => (
            <div key={row.id}>
              <p className="mb-1.5 text-sm font-medium text-text-secondary">{row.label}</p>
              <ChoiceGroup label={row.label}>
                {item.columns?.map((column) => (
                  <ChoiceButton
                    key={column.id}
                    selected={grid[row.id] === column.id}
                    onClick={() => onChange({ ...grid, [row.id]: column.id })}
                    round
                  >
                    {column.label}
                  </ChoiceButton>
                ))}
              </ChoiceGroup>
            </div>
          ))}
        </div>
      );
      break;
    }
    case 'file':
      control = (
        <FileQuestion
          id={id}
          item={item}
          files={files}
          describedBy={described}
          onUpload={onUpload}
          onRemove={(fileId) => onRemoveFile?.(item.id, fileId)}
        />
      );
      break;
    default:
      control = null;
  }

  return (
    <div>
      {label}
      {control}
      {problem && (
        <p id={errorId} role="alert" className="mt-1.5 text-sm text-danger">
          {problemText(item, problem, t)}
        </p>
      )}
    </div>
  );
};

const ChoiceGroup = ({
  children,
  labelledBy,
  describedBy,
  label,
  column = false,
}: {
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  column?: boolean;
}) => (
  <div
    role="radiogroup"
    aria-labelledby={labelledBy}
    aria-label={label}
    aria-describedby={describedBy}
    className={cn('flex gap-2', column ? 'flex-col' : 'flex-wrap')}
  >
    {children}
  </div>
);

// One option as a full button (easy to hit on phones).
const ChoiceButton = ({
  id,
  selected,
  onClick,
  children,
  round,
  square,
  checkbox,
}: {
  id?: string;
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  round?: boolean;
  square?: boolean;
  checkbox?: boolean;
}) => (
  <button
    id={id}
    type="button"
    role={checkbox ? 'checkbox' : 'radio'}
    aria-checked={selected}
    onClick={onClick}
    className={cn(
      'flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      square && 'w-11 justify-center px-0 font-semibold tabular-nums',
      selected ? 'border-accent bg-accent/10 font-medium text-text' : 'border-border bg-surface hover:bg-surface-subtle',
    )}
  >
    {!square && (
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-5 flex-shrink-0 items-center justify-center border',
          checkbox ? 'rounded-md' : 'rounded-full',
          selected ? 'border-accent bg-accent text-white' : 'border-border-strong',
        )}
      >
        {selected && (checkbox ? <Check size={13} /> : round ? <span className="h-2 w-2 rounded-full bg-white" /> : null)}
      </span>
    )}
    <span className="min-w-0 break-words">{children}</span>
  </button>
);

// A file question: what it takes, the files so far and "add file".
const FileQuestion = ({
  id,
  item,
  files,
  describedBy,
  onUpload,
  onRemove,
}: {
  id: string;
  item: FormItem;
  files: UploadedFile[];
  describedBy?: string;
  onUpload?: (itemId: string, file: File, onProgress: (share: number) => void) => Promise<string | null>;
  onRemove: (fileId: string) => void;
}) => {
  const { t, lang } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; share: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accept = (item.accept ?? []).flatMap((k) => FILE_KIND_TYPES[k].exts.map((e) => `.${e}`)).join(',');
  const full = files.length >= (item.max_files ?? 1);
  const pick = async (file: File | undefined) => {
    if (!file || !onUpload) return;
    setError(null);
    if (file.size > (item.max_mb ?? 10) * 1024 * 1024) return setError(t('formFileTooLarge').replace('{max}', String(item.max_mb ?? 10)));
    setBusy({ name: file.name, share: 0 });
    const failure = await onUpload(item.id, file, (share) => setBusy({ name: file.name, share }));
    setBusy(null);
    if (failure) setError(failure);
    if (inputRef.current) inputRef.current.value = '';
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-tertiary">
        {t('formFileHint')
          .replace('{types}', (item.accept ?? []).map((k) => t(`formFileKind_${k}` as Parameters<typeof t>[0])).join(', '))
          .replace('{max}', String(item.max_mb ?? 10))
          .replace('{n}', String(item.max_files ?? 1))}
      </p>
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm">
          <Paperclip size={14} className="flex-shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="text-xs tabular-nums text-text-tertiary">{formatBytes(f.size, localeOf(lang))}</span>
          <button
            type="button"
            onClick={() => onRemove(f.id)}
            aria-label={`${t('remove')}: ${f.name}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      {busy && (
        <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm">
          <Loader2 size={14} className="animate-spin text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate">{busy.name}</span>
          <span className="tabular-nums text-text-tertiary">{Math.round(busy.share * 100)} %</span>
        </div>
      )}
      {!full && !busy && (
        <button
          id={id}
          type="button"
          disabled={!onUpload}
          aria-describedby={describedBy}
          onClick={() => inputRef.current?.click()}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload size={15} />
          {onUpload ? t('formFileAdd') : t('formFilePreviewOnly')}
        </button>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
};
