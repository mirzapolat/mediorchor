import {
  AlignLeft,
  AtSign,
  CalendarDays,
  CheckSquare,
  CircleDot,
  Clock,
  FileUp,
  Grid3x3,
  Hash,
  Heading,
  Image as ImageIcon,
  ListChecks,
  ListOrdered,
  SlidersHorizontal,
  Star,
  TextCursorInput,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { localeOf, type Language } from '@shared/languages';
import {
  emptyStructure,
  newId,
  type AnswerProblem,
  type Answers,
  type FormAccess,
  type FormIdentity,
  type FormItem,
  type FormResultsMode,
  type FormSnapshot,
  type FormState,
  type FormStructure,
  type GuestFieldMode,
  type ItemType,
  type RunoffResult,
  type StructureProblemCode,
  type FormNotifyMode,
} from '@shared/forms';
import type { TranslationKey } from './i18n';

// --- what the server returns (server/forms.ts) ------------------------------

export interface FormSettingsRow {
  id: string;
  project_id: string;
  title: string;
  token: string;
  version_id: string | null;
  status: 'draft' | 'published' | 'closed';
  opens_at: string | null;
  closes_at: string | null;
  max_responses: number | null;
  archived: boolean;
  listed: boolean;
  access: FormAccess;
  identity: FormIdentity;
  guest_name: GuestFieldMode;
  guest_email: GuestFieldMode;
  one_per_account: boolean;
  allow_edit: boolean;
  guest_edit_link: boolean;
  review_before_submit: boolean;
  show_progress: boolean;
  email_copy: boolean;
  results_visibility: FormResultsMode;
  consent_required: boolean;
  consent_text: string;
  notify_user_ids: string[];
  notify_mode: FormNotifyMode;
  draft_saved_at: string | null;
  published_at: string | null;
  updated_at: string;
}

export type DraftChanges = 'unpublished' | 'none' | 'editorial' | 'structural';

export interface FormDetail {
  form: FormSettingsRow;
  draft: FormStructure;
  problems: { itemId: string | null; code: StructureProblemCode }[];
  changes: DraftChanges;
  version: { id: string; number: number; structure: FormStructure } | null;
  versions: { id: string; number: number; created_by_name: string; created_at: string }[];
  state: FormState;
  responses: number;
  receipts: number;
  invites: { total: number; used: number };
  managers: { id: string; name: string; email: string; photo_url: string | null }[];
  mail_enabled: boolean;
  project_image: string | null;
}

export interface FormOverviewRow {
  id: string;
  title: string;
  token: string;
  state: FormState;
  listed: boolean;
  access: FormAccess;
  identity: FormIdentity;
  opens_at: string | null;
  closes_at: string | null;
  max_responses: number | null;
  responses: number;
  version_number: number | null;
  changes: DraftChanges;
  updated_at: string;
}

export interface FormResponse {
  id: string;
  version_id: string;
  answers: Answers;
  snapshot: FormSnapshot;
  reviewed: string[];
  // Named forms only.
  submitted_at?: string | null;
  updated_at?: string | null;
  respondent?: { kind: 'account' | 'invite' | 'guest'; name: string; email: string | null; photo_url: string | null };
}

export interface FormResults {
  identity: FormIdentity;
  title: string;
  responses: FormResponse[];
  versions: { id: string; number: number; structure: FormStructure }[];
  files: { id: string; response_id: string; item_id: string; file_name: string; mime: string | null; size: number }[];
  participation:
    | { count: number }
    | {
        responded: Array<{ at: string; user_id: string | null; name: string | null; email: string | null; photo_url: string | null; invite_label: string | null; invite_email: string | null }>;
        pending: Array<{ member_id: string; first_name: string; last_name: string; group_name: string | null; photo_url: string | null; has_account: boolean }> | null;
      };
}

export interface FormSummaryItem {
  id: string;
  type: ItemType;
  title: string;
  options?: { id: string; label: string }[];
  rows?: { id: string; label: string }[];
  columns?: { id: string; label: string }[];
  scale_min?: number;
  scale_max?: number;
  min_label?: string;
  max_label?: string;
  answered: number;
  counts: Record<string, number>;
  // ranking: the instant runoff over the ballots.
  runoff?: RunoffResult;
}

export interface FormSummary {
  total: number;
  too_few: boolean;
  min: number;
  items: FormSummaryItem[];
}

export interface FormInvite {
  id: string;
  token: string;
  label: string;
  email: string | null;
  used_at: string | null;
  created_at: string;
}

// --- the item catalogue -----------------------------------------------------

export const ITEM_META: Record<ItemType, { icon: LucideIcon; label: TranslationKey; group: 'text' | 'choice' | 'other' | 'layout' }> = {
  short: { icon: TextCursorInput, label: 'formTypeShort', group: 'text' },
  long: { icon: AlignLeft, label: 'formTypeLong', group: 'text' },
  number: { icon: Hash, label: 'formTypeNumber', group: 'text' },
  email: { icon: AtSign, label: 'formTypeEmail', group: 'text' },
  date: { icon: CalendarDays, label: 'formTypeDate', group: 'text' },
  time: { icon: Clock, label: 'formTypeTime', group: 'text' },
  yesno: { icon: ToggleLeft, label: 'formTypeYesNo', group: 'choice' },
  single: { icon: CircleDot, label: 'formTypeSingle', group: 'choice' },
  multi: { icon: CheckSquare, label: 'formTypeMulti', group: 'choice' },
  dropdown: { icon: ListChecks, label: 'formTypeDropdown', group: 'choice' },
  ranking: { icon: ListOrdered, label: 'formTypeRanking', group: 'choice' },
  scale: { icon: SlidersHorizontal, label: 'formTypeScale', group: 'choice' },
  stars: { icon: Star, label: 'formTypeStars', group: 'choice' },
  grid: { icon: Grid3x3, label: 'formTypeGrid', group: 'choice' },
  file: { icon: FileUp, label: 'formTypeFile', group: 'other' },
  text: { icon: Type, label: 'formTypeText', group: 'layout' },
  image: { icon: ImageIcon, label: 'formTypeImage', group: 'layout' },
  section: { icon: Heading, label: 'formTypeSection', group: 'layout' },
};

const option = (label: string) => ({ id: newId(), label });

// A new item of a type, with sensible starting values.
export const blankItem = (type: ItemType, t: (key: TranslationKey) => string): FormItem => {
  const item: FormItem = { id: newId(), type, title: '', help: '' };
  if (['single', 'multi', 'dropdown', 'ranking'].includes(type)) item.options = [option(`${t('formOption')} 1`), option(`${t('formOption')} 2`)];
  if (type === 'scale') Object.assign(item, { scale_min: 1, scale_max: 5, min_label: '', max_label: '' });
  if (type === 'stars') item.scale_max = 5;
  if (type === 'grid') Object.assign(item, { rows: [option(`${t('formRow')} 1`)], columns: [option(`${t('formColumn')} 1`), option(`${t('formColumn')} 2`)] });
  if (type === 'file') Object.assign(item, { accept: ['pdf', 'image'], max_mb: 10, max_files: 1 });
  if (type === 'section') item.next = 'next';
  if (!['text', 'image', 'section'].includes(type)) item.required = false;
  return item;
};

// Small starting points: finding a date, food, feedback.
export type FormTemplate = 'blank' | 'dates' | 'food' | 'feedback';

export const templateStructure = (template: FormTemplate, t: (key: TranslationKey) => string): FormStructure => {
  const structure = emptyStructure();
  const item = (patch: Partial<FormItem> & { type: ItemType }): FormItem => ({ ...blankItem(patch.type, t), ...patch });
  if (template === 'dates') {
    structure.settings.intro = t('templateDatesIntro');
    structure.items = [
      item({
        type: 'grid',
        title: t('templateDatesQuestion'),
        required: true,
        rows: [option(t('templateDatesOption1')), option(t('templateDatesOption2')), option(t('templateDatesOption3'))],
        columns: [option(t('templateYes')), option(t('templateMaybe')), option(t('templateNo'))],
      }),
      item({ type: 'long', title: t('templateComment') }),
    ];
  } else if (template === 'food') {
    structure.settings.intro = t('templateFoodIntro');
    structure.items = [
      item({ type: 'yesno', title: t('templateFoodJoin'), required: true }),
      item({
        type: 'single',
        title: t('templateFoodChoice'),
        required: true,
        options: [option(t('templateFoodMeat')), option(t('templateFoodVeggie')), option(t('templateFoodVegan'))],
      }),
      item({ type: 'short', title: t('templateFoodAllergies'), help: t('templateFoodAllergiesHelp') }),
    ];
  } else if (template === 'feedback') {
    structure.settings.intro = t('templateFeedbackIntro');
    structure.items = [
      item({ type: 'stars', title: t('templateFeedbackOverall'), required: true, scale_max: 5 }),
      item({
        type: 'scale',
        title: t('templateFeedbackPace'),
        scale_min: 1,
        scale_max: 5,
        min_label: t('templateFeedbackPaceSlow'),
        max_label: t('templateFeedbackPaceFast'),
      }),
      item({ type: 'long', title: t('templateFeedbackGood') }),
      item({ type: 'long', title: t('templateFeedbackBetter') }),
    ];
  }
  return structure;
};

// --- words ------------------------------------------------------------------

export const ANSWER_PROBLEM_KEY: Record<AnswerProblem, TranslationKey> = {
  required: 'formErrorRequired',
  tooShort: 'formErrorTooShort',
  tooLong: 'formErrorTooLong',
  notNumber: 'formErrorNotNumber',
  notInteger: 'formErrorNotInteger',
  tooSmall: 'formErrorTooSmall',
  tooLarge: 'formErrorTooLarge',
  invalidEmail: 'formErrorEmail',
  invalidDate: 'formErrorDate',
  invalidTime: 'formErrorTime',
  invalidChoice: 'formErrorChoice',
  tooFewChoices: 'formErrorTooFew',
  tooManyChoices: 'formErrorTooMany',
  incompleteGrid: 'formErrorGrid',
  tooManyFiles: 'formErrorFiles',
};

export const STRUCTURE_PROBLEM_KEY: Record<StructureProblemCode, TranslationKey> = {
  noTitle: 'formProblemNoTitle',
  noOptions: 'formProblemNoOptions',
  emptyOption: 'formProblemEmptyOption',
  duplicateOption: 'formProblemDuplicateOption',
  badRange: 'formProblemBadRange',
  badJump: 'formProblemBadJump',
  tooMany: 'formProblemTooMany',
  noImage: 'formProblemNoImage',
  noAnswerItems: 'formProblemNoAnswerItems',
  badLink: 'formProblemBadLink',
};

// The message for an answer problem, with the item's own limits filled in.
export const problemText = (item: FormItem, problem: AnswerProblem, t: (key: TranslationKey) => string) =>
  item.error ||
  t(ANSWER_PROBLEM_KEY[problem])
    .replace('{min}', String(item.min ?? item.min_select ?? ''))
    .replace('{max}', String(item.max ?? item.max_select ?? item.max_files ?? ''));

export const formDate = (iso: string, lang: Language, withTime = true) =>
  new Date(iso).toLocaleString(localeOf(lang), {
    day: 'numeric',
    month: 'long',
    ...(new Date(iso).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
    ...(withTime && { hour: '2-digit', minute: '2-digit' }),
  });

// The settings in everyday words, e.g. "Nicht gelistet · Gäste erlaubt ·
// namentlich · eine Antwort pro Account · schließt am 12. Juni".
export const settingsSummary = (form: FormSettingsRow, t: (key: TranslationKey) => string, lang: Language) =>
  [
    form.listed ? t('formSumListed') : t('formSumUnlisted'),
    form.access === 'members' ? t('formSumMembers') : form.access === 'accounts' ? t('formSumAccounts') : t('formSumGuests'),
    form.identity === 'named' ? t('formSumNamed') : form.identity === 'confidential' ? t('formSumConfidential') : t('formSumAnonymous'),
    form.one_per_account ? t('formSumOnePerAccount') : t('formSumManyPerAccount'),
    form.opens_at && Date.parse(form.opens_at) > Date.now() ? t('formSumOpens').replace('{date}', formDate(form.opens_at, lang)) : null,
    form.closes_at ? t('formSumCloses').replace('{date}', formDate(form.closes_at, lang)) : t('formSumNoDeadline'),
    form.max_responses ? t('formSumMax').replace('{n}', String(form.max_responses)) : null,
  ]
    .filter(Boolean)
    .join(' · ');

export const formUrl = (token: string, params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString();
  return `${window.location.origin}/f/${token}${query ? `?${query}` : ''}`;
};

// --- respondents' side ------------------------------------------------------

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  // Proof the file was uploaded by this person (absent for files already
  // attached to the response being changed).
  secret?: string;
}

// Uploads one file for a file question; progress 0…1.
export const uploadFormFile = (
  token: string,
  itemId: string,
  file: File,
  access: { invite?: string | null; edit?: string | null },
  onProgress?: (share: number) => void,
): Promise<{ file: UploadedFile | null; error: string | null; code?: string }> =>
  new Promise((resolve) => {
    const params = new URLSearchParams({ item: itemId });
    if (access.invite) params.set('invite', access.invite);
    if (access.edit) params.set('edit', access.edit);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/forms/upload/${encodeURIComponent(token)}?${params.toString()}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let payload: { id?: string; secret?: string; name?: string; size?: number; error?: { message?: string; code?: string } } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.id) {
        return resolve({ file: { id: payload.id, secret: payload.secret, name: payload.name ?? file.name, size: payload.size ?? file.size }, error: null });
      }
      resolve({ file: null, error: payload.error?.message ?? (xhr.statusText || 'Upload failed'), code: payload.error?.code });
    };
    xhr.onerror = () => resolve({ file: null, error: 'Network error' });
    xhr.send(file);
  });

// Guests (and anonymous forms) keep their unsent answers in this browser.
const draftKey = (token: string) => `anwesenheit.form.${token}`;
const doneKey = (token: string) => `anwesenheit.form.done.${token}`;

export const loadLocalDraft = (token: string): { answers: Answers; page: number } | null => {
  try {
    const raw = localStorage.getItem(draftKey(token));
    return raw ? (JSON.parse(raw) as { answers: Answers; page: number }) : null;
  } catch {
    return null;
  }
};

export const saveLocalDraft = (token: string, answers: Answers, page: number) => {
  try {
    localStorage.setItem(draftKey(token), JSON.stringify({ answers, page }));
  } catch {
    /* storage blocked or full */
  }
};

export const clearLocalDraft = (token: string) => {
  try {
    localStorage.removeItem(draftKey(token));
  } catch {
    /* storage blocked */
  }
};

// A hint only (guest links can't be limited reliably): this browser already
// sent the form.
export const markSent = (token: string) => {
  try {
    localStorage.setItem(doneKey(token), new Date().toISOString());
  } catch {
    /* storage blocked */
  }
};

export const sentBefore = (token: string) => {
  try {
    return localStorage.getItem(doneKey(token));
  } catch {
    return null;
  }
};
