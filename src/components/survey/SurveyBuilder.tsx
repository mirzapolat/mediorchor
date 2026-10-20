import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, ImagePlus, Loader2, Palette, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { Input, Select, Textarea } from '@/components/Input';
import { MarkdownEditor } from '@/components/MarkdownEditor';
import { SortableList } from '@/components/SortableList';
import { Switch } from '@/components/Switch';
import { Toast, useToast } from '@/components/Toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { config } from '@/lib/config';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import { uploadImage } from '@/lib/uploadImage';
import { ITEM_META, STRUCTURE_PROBLEM_KEY, blankItem, type DraftChanges, type FormDetail } from '@/lib/forms';
import {
  BRANCH_TYPES,
  DISPLAY_TYPES,
  FILE_KINDS,
  ITEM_TYPES,
  MAX_FILE_MB,
  newId,
  type FileKind,
  type FormItem,
  type FormOption,
  type FormStructure,
  type ItemType,
  type StructureProblem,
} from '@shared/forms';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

// The questions of a survey: cards in order (drag to sort), each opening
// its own editor; "+" adds a question, text, image or a new page. Saved by
// itself while editing; respondents only see it once published.
export const SurveyBuilder = ({
  detail,
  onSaved,
}: {
  detail: FormDetail;
  onSaved: (saved: { draft: FormStructure; problems: StructureProblem[]; changes: DraftChanges }) => void;
}) => {
  const { t } = useI18n();
  const [structure, setStructure] = useState(detail.draft);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const [problems, setProblems] = useState(detail.problems);
  const dirty = useRef(false);
  const toast = useToast();

  useEffect(() => {
    if (!dirty.current) return;
    setSave('pending');
    const timer = window.setTimeout(async () => {
      setSave('saving');
      const { data, error } = await api.rpc('form_save_draft', { p_form_id: detail.form.id, p_draft: structure });
      if (error) return setSave('error');
      const result = data as { problems: StructureProblem[]; changes: DraftChanges };
      setProblems(result.problems);
      onSaved({ draft: structure, problems: result.problems, changes: result.changes });
      setSave('saved');
    }, 700);
    return () => window.clearTimeout(timer);
    // onSaved is stable enough (a setter wrapper); saving follows the structure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structure, detail.form.id]);

  const update = (next: FormStructure) => {
    dirty.current = true;
    setStructure(next);
  };
  const setItems = (items: FormItem[]) => update({ ...structure, items });
  const patchItem = (id: string, patch: Partial<FormItem>) =>
    setItems(structure.items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const add = (type: ItemType) => {
    const item = blankItem(type, t);
    // After the open item, else at the end.
    const at = openId ? structure.items.findIndex((i) => i.id === openId) + 1 : structure.items.length;
    setItems([...structure.items.slice(0, at), item, ...structure.items.slice(at)]);
    setOpenId(item.id);
    setAdding(false);
  };

  const duplicate = (item: FormItem) => {
    const copy: FormItem = JSON.parse(JSON.stringify(item));
    copy.id = newId();
    for (const list of [copy.options, copy.rows, copy.columns]) list?.forEach((o) => (o.id = newId()));
    const at = structure.items.findIndex((i) => i.id === item.id) + 1;
    setItems([...structure.items.slice(0, at), copy, ...structure.items.slice(at)]);
    setOpenId(copy.id);
  };

  // Undo instead of asking first.
  const remove = (item: FormItem) => {
    const before = structure.items;
    setItems(before.filter((i) => i.id !== item.id));
    toast.show(t('formItemRemoved'), () => setItems(before));
  };

  const problemsOf = (id: string) => problems.filter((p) => p.itemId === id);
  const general = problems.filter((p) => !p.itemId);

  return (
    <div className="space-y-4">
      {detail.version && (detail.changes === 'structural' || detail.changes === 'editorial') && (
        <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">
          {detail.changes === 'structural' ? t('surveyStructuralHint') : t('surveyEditorialHint')}
        </p>
      )}
      {general.length > 0 && (
        <ul className="rounded-xl border border-danger/30 px-3 py-2 text-sm text-danger">
          {general.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <AlertTriangle size={14} />
              {t(STRUCTURE_PROBLEM_KEY[p.code])}
            </li>
          ))}
        </ul>
      )}

      <DesignCard structure={structure} projectImage={detail.project_image} onChange={update} />

      {structure.items.length > 0 && (
        <SortableList
          items={structure.items}
          getId={(i) => i.id}
          onReorder={setItems}
          renderItem={(item, index) => (
            <ItemCard
              item={item}
              index={index}
              items={structure.items}
              open={openId === item.id}
              problems={problemsOf(item.id)}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              onChange={(patch) => patchItem(item.id, patch)}
              onDuplicate={() => duplicate(item)}
              onRemove={() => remove(item)}
            />
          )}
        />
      )}

      {adding ? (
        <div className="rounded-2xl border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{t('formAddItem')}</p>
            <button
              type="button"
              onClick={() => setAdding(false)}
              aria-label={t('close')}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover"
            >
              <X size={15} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {ITEM_TYPES.map((type) => {
              const meta = ITEM_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => add(type)}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <meta.icon size={16} className="flex-shrink-0 text-text-secondary" />
                  {t(meta.label)}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-subtle hover:text-text"
        >
          <Plus size={16} />
          {t('formAddItem')}
        </button>
      )}

      <p className="flex items-center gap-1.5 text-xs text-text-tertiary" aria-live="polite">
        {save === 'saving' || save === 'pending' ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {t('formSaving')}
          </>
        ) : save === 'saved' ? (
          t('formDraftSaved')
        ) : save === 'error' ? (
          <span className="text-danger">{t('saveFailed')}</span>
        ) : (
          ' '
        )}
      </p>
      <Toast toast={toast.toast} onClose={toast.hide} />
    </div>
  );
};

// Intro, confirmation, image and colour of the form.
const DesignCard = ({
  structure,
  projectImage,
  onChange,
}: {
  structure: FormStructure;
  projectImage: string | null;
  onChange: (structure: FormStructure) => void;
}) => {
  const { t } = useI18n();
  const s = structure.settings;
  const set = (patch: Partial<FormStructure['settings']>) => onChange({ ...structure, settings: { ...s, ...patch } });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    const { url, error: uploadError } = await uploadImage('forms', file);
    setUploading(false);
    if (uploadError) setError(uploadError);
    else set({ image_url: url });
  };
  return (
    <details className="group rounded-2xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3">
        <Palette size={16} className="text-text-secondary" />
        <span className="flex-1 text-sm font-medium">{t('formDesign')}</span>
        <ChevronDown size={16} className="text-text-tertiary transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-border px-4 py-4">
        <MarkdownEditor id="form-intro" label={t('formIntro')} value={s.intro} onChange={(intro) => set({ intro })} minHeight={100} />
        <Textarea
          label={t('formConfirmation')}
          placeholder={t('formThanksHint')}
          rows={2}
          maxLength={5000}
          value={s.confirmation}
          onChange={(e) => set({ confirmation: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={`${t('formConfirmationLink')} (${t('optional')})`}
            type="url"
            placeholder="https://"
            value={s.confirmation_url}
            onChange={(e) => set({ confirmation_url: e.target.value })}
          />
          <Input
            label={t('formConfirmationLinkLabel')}
            value={s.confirmation_url_label}
            maxLength={200}
            placeholder={t('formContinueLink')}
            onChange={(e) => set({ confirmation_url_label: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('formImage')}</p>
            <div className="flex flex-wrap items-center gap-2">
              {s.image_url && <img src={s.image_url} alt="" className="h-14 w-24 rounded-lg border border-border object-cover" />}
              {projectImage && s.image_url !== projectImage && (
                <button
                  type="button"
                  onClick={() => set({ image_url: projectImage })}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-muted"
                >
                  {t('formUseProjectImage')}
                </button>
              )}
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-muted">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {t('formUploadImage')}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
              </label>
              {s.image_url && (
                <button
                  type="button"
                  onClick={() => set({ image_url: null })}
                  className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-text-secondary hover:text-text"
                >
                  <X size={14} />
                  {t('remove')}
                </button>
              )}
            </div>
            {error && <p className="mt-1 text-sm text-danger">{error}</p>}
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium">{t('formAccent')}</p>
            <div className="flex items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border py-1.5 pl-1.5 pr-3 hover:bg-surface-muted">
                <input
                  type="color"
                  value={s.accent ?? config.accentColor}
                  onChange={(e) => set({ accent: e.target.value.toLowerCase() })}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <span className="font-mono text-sm uppercase">{s.accent ?? config.accentColor}</span>
              </label>
              {s.accent && (
                <button
                  type="button"
                  onClick={() => set({ accent: null })}
                  className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-text"
                >
                  <RotateCcw size={14} />
                  {t('registrationTintReset')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </details>
  );
};

// One item: its summary line, and its editor when open.
const ItemCard = ({
  item,
  index,
  items,
  open,
  problems,
  onToggle,
  onChange,
  onDuplicate,
  onRemove,
}: {
  item: FormItem;
  index: number;
  items: FormItem[];
  open: boolean;
  problems: StructureProblem[];
  onToggle: () => void;
  onChange: (patch: Partial<FormItem>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) => {
  const { t } = useI18n();
  const meta = ITEM_META[item.type];
  const answerable = !DISPLAY_TYPES.includes(item.type);
  const section = item.type === 'section';
  return (
    <div className={cn('group/item', section && 'bg-surface-subtle')}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
              section ? 'bg-accent/15 text-accent' : 'bg-surface-muted text-text-secondary',
            )}
          >
            <meta.icon size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate', item.title ? 'font-medium' : 'text-text-tertiary')}>
              {item.title || t('formUntitled')}
              {item.required && <span className="ml-0.5 text-danger">*</span>}
            </span>
            <span className="block truncate text-xs text-text-tertiary">
              {t(meta.label)}
              {section && ` · ${t('formNewPage')}`}
            </span>
          </span>
          {problems.length > 0 && (
            <span title={problems.map((p) => t(STRUCTURE_PROBLEM_KEY[p.code])).join(' · ')}>
              <AlertTriangle size={15} className="text-danger" />
            </span>
          )}
        </button>
        <IconButton label={t('duplicate')} onClick={onDuplicate}>
          <Copy size={15} />
        </IconButton>
        <IconButton label={t('delete')} onClick={onRemove}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      {open && (
        <div className="space-y-4 border-t border-border px-3 py-4 sm:px-4">
          {problems.length > 0 && (
            <ul className="space-y-0.5 text-sm text-danger">
              {problems.map((p, i) => (
                <li key={i}>{t(STRUCTURE_PROBLEM_KEY[p.code])}</li>
              ))}
            </ul>
          )}
          <Input
            label={item.type === 'image' ? t('formImageCaption') : item.type === 'text' ? t('formTextTitle') : t('formQuestion')}
            value={item.title}
            maxLength={500}
            autoFocus={!item.title}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          {item.type === 'text' ? (
            <MarkdownEditor id={`help-${item.id}`} label={t('formTextBody')} value={item.help} onChange={(help) => onChange({ help })} minHeight={100} />
          ) : item.type !== 'image' ? (
            <Textarea
              label={`${t('formHelp')} (${t('optional')})`}
              rows={2}
              maxLength={5000}
              value={item.help}
              onChange={(e) => onChange({ help: e.target.value })}
            />
          ) : null}
          <TypeEditor item={item} index={index} items={items} onChange={onChange} />
          {answerable && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <Switch checked={Boolean(item.required)} onChange={(required) => onChange({ required })} label={t('formRequired')} />
              <Input
                aria-label={t('formCustomError')}
                placeholder={t('formCustomError')}
                value={item.error ?? ''}
                maxLength={300}
                onChange={(e) => onChange({ error: e.target.value })}
                className="h-9 text-sm sm:w-72"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const IconButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary transition-opacity hover:bg-surface-hover hover:text-text focus:opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100"
  >
    {children}
  </button>
);

const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

// The settings that belong to an item's type.
const TypeEditor = ({
  item,
  index,
  items,
  onChange,
}: {
  item: FormItem;
  index: number;
  items: FormItem[];
  onChange: (patch: Partial<FormItem>) => void;
}) => {
  const { t } = useI18n();
  // Jumps lead only forward: sections after this item, or the end.
  const targets = useMemo(
    () => items.slice(index + 1).filter((i) => i.type === 'section'),
    [items, index],
  );
  const jumpOptions = (
    <>
      <option value="submit">{t('formJumpEnd')}</option>
      {targets.map((s) => (
        <option key={s.id} value={s.id}>
          {t('formJumpTo').replace('{name}', s.title || t('formUntitled'))}
        </option>
      ))}
    </>
  );

  switch (item.type) {
    case 'short':
    case 'long':
    case 'number':
      return (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Input
            type="number"
            label={item.type === 'number' ? t('formMinValue') : t('formMinLength')}
            value={item.min ?? ''}
            onChange={(e) => onChange({ min: numberOrNull(e.target.value) })}
          />
          <Input
            type="number"
            label={item.type === 'number' ? t('formMaxValue') : t('formMaxLength')}
            value={item.max ?? ''}
            onChange={(e) => onChange({ max: numberOrNull(e.target.value) })}
          />
          {item.type === 'number' && (
            <Switch checked={Boolean(item.integer)} onChange={(integer) => onChange({ integer })} label={t('formWholeNumbers')} />
          )}
        </div>
      );
    case 'single':
    case 'dropdown':
    case 'multi':
      return (
        <div className="space-y-3">
          <OptionsEditor
            label={t('formOptions')}
            options={item.options ?? []}
            onChange={(options) => onChange({ options })}
            jump={
              BRANCH_TYPES.includes(item.type)
                ? (o, set) => (
                    <select
                      value={o.goto ?? ''}
                      aria-label={t('formJump')}
                      onChange={(e) => set({ goto: e.target.value || undefined })}
                      className="h-9 max-w-[45%] rounded-md border border-border bg-white px-2 pr-7 text-xs text-text-secondary"
                    >
                      <option value="">{t('formJumpNone')}</option>
                      {jumpOptions}
                    </select>
                  )
                : undefined
            }
          />
          {BRANCH_TYPES.includes(item.type) && targets.length === 0 && (
            <p className="text-xs text-text-tertiary">{t('formJumpHint')}</p>
          )}
          {item.type === 'multi' && (
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <Input
                type="number"
                min={0}
                label={t('formMinSelect')}
                value={item.min_select ?? ''}
                onChange={(e) => onChange({ min_select: numberOrNull(e.target.value) })}
              />
              <Input
                type="number"
                min={1}
                label={t('formMaxSelect')}
                value={item.max_select ?? ''}
                onChange={(e) => onChange({ max_select: numberOrNull(e.target.value) })}
              />
            </div>
          )}
        </div>
      );
    case 'grid':
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <OptionsEditor label={t('formRows')} options={item.rows ?? []} onChange={(rows) => onChange({ rows })} itemWord={t('formRow')} />
          <OptionsEditor
            label={t('formColumns')}
            options={item.columns ?? []}
            onChange={(columns) => onChange({ columns })}
            itemWord={t('formColumn')}
          />
        </div>
      );
    case 'scale':
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select label={t('formScaleFrom')} value={String(item.scale_min ?? 1)} onChange={(e) => onChange({ scale_min: Number(e.target.value) })}>
            <option value="0">0</option>
            <option value="1">1</option>
          </Select>
          <Select label={t('formScaleTo')} value={String(item.scale_max ?? 5)} onChange={(e) => onChange({ scale_max: Number(e.target.value) })}>
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Input label={t('formScaleMinLabel')} value={item.min_label ?? ''} maxLength={100} onChange={(e) => onChange({ min_label: e.target.value })} />
          <Input label={t('formScaleMaxLabel')} value={item.max_label ?? ''} maxLength={100} onChange={(e) => onChange({ max_label: e.target.value })} />
        </div>
      );
    case 'stars':
      return (
        <Select className="sm:max-w-[10rem]" label={t('formStarsCount')} value={String(item.scale_max ?? 5)} onChange={(e) => onChange({ scale_max: Number(e.target.value) })}>
          {Array.from({ length: 8 }, (_, i) => i + 3).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      );
    case 'file':
      return (
        <div className="space-y-3">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">{t('formFileAccept')}</legend>
            <div className="flex flex-wrap gap-2">
              {FILE_KINDS.map((kind) => {
                const on = item.accept?.includes(kind) ?? false;
                return (
                  <label
                    key={kind}
                    className={cn(
                      'flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm',
                      on ? 'border-accent bg-accent/10' : 'border-border',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const next = on ? (item.accept ?? []).filter((k) => k !== kind) : [...(item.accept ?? []), kind];
                        if (next.length) onChange({ accept: next as FileKind[] });
                      }}
                      className="h-4 w-4 accent-accent"
                    />
                    {t(`formFileKind_${kind}` as TranslationKey)}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Input
              type="number"
              min={1}
              max={MAX_FILE_MB}
              label={t('formFileMaxMb')}
              value={item.max_mb ?? 10}
              onChange={(e) => onChange({ max_mb: Math.min(MAX_FILE_MB, Math.max(1, Number(e.target.value) || 1)) })}
            />
            <Input
              type="number"
              min={1}
              max={10}
              label={t('formFileMaxFiles')}
              value={item.max_files ?? 1}
              onChange={(e) => onChange({ max_files: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </div>
          <p className="text-xs text-text-tertiary">{t('formFileSafetyHint')}</p>
        </div>
      );
    case 'image':
      return <ImageItemEditor item={item} onChange={onChange} />;
    case 'section':
      return (
        <Select
          className="sm:max-w-md"
          label={t('formAfterSection')}
          value={item.next ?? 'next'}
          onChange={(e) => onChange({ next: e.target.value })}
        >
          <option value="next">{t('formJumpNext')}</option>
          {jumpOptions}
        </Select>
      );
    default:
      return null;
  }
};

const ImageItemEditor = ({ item, onChange }: { item: FormItem; onChange: (patch: Partial<FormItem>) => void }) => {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {item.image_url && <img src={item.image_url} alt="" className="max-h-56 rounded-xl border border-border object-contain" />}
      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm text-text-secondary hover:bg-surface-muted">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        {item.image_url ? t('formReplaceImage') : t('formUploadImage')}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError(null);
            const { url, error: uploadError } = await uploadImage('forms', file);
            setBusy(false);
            if (uploadError) setError(uploadError);
            else onChange({ image_url: url });
          }}
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
};

// Options, rows or columns: a list of labels, each removable; a jump select
// for single choice and dropdown.
const OptionsEditor = ({
  label,
  options,
  onChange,
  jump,
  itemWord,
}: {
  label: string;
  options: FormOption[];
  onChange: (options: FormOption[]) => void;
  jump?: (option: FormOption, set: (patch: Partial<FormOption>) => void) => ReactNode;
  itemWord?: string;
}) => {
  const { t } = useI18n();
  const set = (id: string, patch: Partial<FormOption>) => onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const word = itemWord ?? t('formOption');
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <ul className="space-y-1.5">
        {options.map((o, i) => (
          <li key={o.id} className="flex items-center gap-2">
            <input
              value={o.label}
              maxLength={500}
              aria-label={`${word} ${i + 1}`}
              placeholder={`${word} ${i + 1}`}
              onChange={(e) => set(o.id, { label: e.target.value })}
              onKeyDown={(e) => {
                // Enter adds the next option, as in a list.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onChange([...options.slice(0, i + 1), { id: newId(), label: '' }, ...options.slice(i + 1)]);
                  window.setTimeout(() => {
                    const inputs = (e.target as HTMLInputElement).closest('ul')?.querySelectorAll('input');
                    (inputs?.[i + 1] as HTMLInputElement | undefined)?.focus();
                  }, 0);
                }
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-white px-2.5 text-sm focus:border-black focus:outline-none max-md:h-11"
            />
            {jump?.(o, (patch) => set(o.id, patch))}
            <button
              type="button"
              disabled={options.length <= 1}
              onClick={() => onChange(options.filter((x) => x.id !== o.id))}
              aria-label={`${t('remove')}: ${o.label || `${word} ${i + 1}`}`}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-hover hover:text-text disabled:opacity-30"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...options, { id: newId(), label: '' }])}
        className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-sm text-text-secondary hover:bg-surface-muted hover:text-text"
      >
        <Plus size={14} />
        {t('formAddOption').replace('{word}', word)}
      </button>
    </fieldset>
  );
};
