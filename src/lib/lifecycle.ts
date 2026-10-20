import type { TranslationKey } from '@/lib/i18n';

// The one lifecycle every newer area shares (concerts, surveys, rehearsal
// weekends), with the same words everywhere: a draft is published (and can
// be taken back), may be closed, and is archived and restored by hand only —
// a date can mark something as past or close it, never archive it.
// Surveys add "scheduled" (published, opening later) and say "open".
export type LifecycleState = 'draft' | 'scheduled' | 'published' | 'open' | 'closed' | 'archived';

export const LIFECYCLE_LABEL: Record<LifecycleState, TranslationKey> = {
  draft: 'lifecycleDraft',
  scheduled: 'lifecycleScheduled',
  published: 'lifecyclePublished',
  open: 'lifecycleOpen',
  closed: 'lifecycleClosed',
  archived: 'lifecycleArchived',
};

export const LIFECYCLE_TONE: Record<LifecycleState, string> = {
  draft: 'bg-surface-muted text-text-secondary',
  scheduled: 'bg-info-soft-strong text-text',
  published: 'bg-success-soft text-success-strong',
  open: 'bg-success-soft text-success-strong',
  closed: 'bg-surface-muted text-text-tertiary',
  archived: 'bg-surface-muted text-text-tertiary',
};

// A YYYY-MM-DD date (and optional HH:MM) in the past, by the local clock.
export const isPast = (date: string | null, time?: string | null) => {
  if (!date) return false;
  const at = new Date(`${date}T${time || '23:59'}:00`);
  return at.getTime() < Date.now();
};
