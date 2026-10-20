import { useEffect, useState, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { Input, Select, Textarea } from '@/components/Input';
import { Switch } from '@/components/Switch';
import { cn } from '@/lib/cn';
import { useI18n, type TranslationKey } from '@/lib/i18n';
import type { FormDetail, FormSettingsRow } from '@/lib/forms';

// ISO time ↔ the value of an <input type="datetime-local"> (local time).
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

// How a survey works: who finds it, who may answer, what is known about
// them, how answers can change, when it runs, what participants see of the
// results and who hears of new responses. Each change is saved at once.
export const SurveySettings = ({
  detail,
  onPatch,
}: {
  detail: FormDetail;
  onPatch: (patch: Partial<FormSettingsRow>) => Promise<boolean>;
}) => {
  const { t } = useI18n();
  const { form } = detail;
  const anonymous = form.identity === 'anonymous';
  const locked = detail.responses > 0;
  const set = (patch: Partial<FormSettingsRow>) => void onPatch(patch);

  return (
    <div className="space-y-4">
      <Card title={t('surveyVisibility')}>
        <Choices
          value={form.listed ? 'listed' : 'link'}
          onChange={(v) => set({ listed: v === 'listed' })}
          options={[
            { value: 'listed', label: 'surveyListed', hint: 'surveyListedHint' },
            { value: 'link', label: 'surveyLinkOnly', hint: 'surveyLinkOnlyHint' },
          ]}
        />
      </Card>

      <Card title={t('surveyAccess')}>
        <Choices
          value={form.access}
          onChange={(access) => set({ access: access as FormSettingsRow['access'] })}
          options={[
            { value: 'members', label: 'accessMembers', hint: 'accessMembersHint' },
            { value: 'accounts', label: 'accessAccounts', hint: 'accessAccountsHint' },
            { value: 'guests', label: 'accessGuests', hint: 'accessGuestsHint' },
          ]}
        />
        {form.access === 'guests' && (
          <div className="mt-3 space-y-3">
            {anonymous ? (
              <p className="text-sm text-text-secondary">{t('surveyGuestFieldsAnonymous')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label={t('surveyGuestName')} value={form.guest_name} onChange={(e) => set({ guest_name: e.target.value as FormSettingsRow['guest_name'] })}>
                  <GuestModeOptions />
                </Select>
                <Select label={t('surveyGuestEmail')} value={form.guest_email} onChange={(e) => set({ guest_email: e.target.value as FormSettingsRow['guest_email'] })}>
                  <GuestModeOptions />
                </Select>
              </div>
            )}
            <p className="rounded-xl bg-info-soft px-3 py-2 text-sm">{t('surveyGuestLimitHonest')}</p>
          </div>
        )}
      </Card>

      <Card title={t('surveyIdentity')}>
        {locked && (
          <p className="mb-2 flex items-center gap-1.5 text-sm text-text-secondary">
            <Lock size={14} />
            {t('surveyIdentityLocked')}
          </p>
        )}
        <Choices
          value={form.identity}
          disabled={locked}
          onChange={(identity) =>
            set({
              identity: identity as FormSettingsRow['identity'],
              // Anonymous answers can't be changed later nor be copied.
              ...(identity === 'anonymous' ? { allow_edit: false, guest_edit_link: false, email_copy: false } : {}),
            })
          }
          options={[
            { value: 'named', label: 'identityNamed', hint: 'identityNamedHint' },
            { value: 'confidential', label: 'identityConfidential', hint: 'identityConfidentialHint' },
            { value: 'anonymous', label: 'identityAnonymous', hint: 'identityAnonymousHint' },
          ]}
        />
      </Card>

      <Card title={t('surveyAnswering')}>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Toggle
            checked={form.one_per_account}
            onChange={(one_per_account) => set({ one_per_account, ...(one_per_account ? {} : { allow_edit: false }) })}
            label={t('surveyOnePerAccount')}
            hint={t('surveyOnePerAccountHint')}
          />
          <Toggle
            checked={form.allow_edit}
            disabled={anonymous || !form.one_per_account}
            onChange={(allow_edit) => set({ allow_edit })}
            label={t('surveyAllowEdit')}
            hint={anonymous ? t('surveyNotForAnonymous') : t('surveyAllowEditHint')}
          />
          <Toggle
            checked={form.guest_edit_link}
            disabled={anonymous}
            onChange={(guest_edit_link) => set({ guest_edit_link })}
            label={t('surveyGuestEditLink')}
            hint={anonymous ? t('surveyNotForAnonymous') : t('surveyGuestEditLinkHint')}
          />
          <Toggle
            checked={form.review_before_submit}
            onChange={(review_before_submit) => set({ review_before_submit })}
            label={t('surveyReview')}
            hint={t('surveyReviewHint')}
          />
          <Toggle checked={form.show_progress} onChange={(show_progress) => set({ show_progress })} label={t('surveyProgress')} />
          <Toggle
            checked={form.email_copy}
            disabled={anonymous || !detail.mail_enabled}
            onChange={(email_copy) => set({ email_copy })}
            label={t('surveyEmailCopy')}
            hint={anonymous ? t('surveyNotForAnonymous') : detail.mail_enabled ? t('surveyEmailCopyHint') : t('surveyMailOff')}
          />
        </div>
      </Card>

      <Card title={t('surveyRuntime')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <DateTimeField label={t('surveyOpensAt')} value={form.opens_at} onSave={(opens_at) => set({ opens_at })} />
          <DateTimeField label={t('surveyClosesAt')} value={form.closes_at} onSave={(closes_at) => set({ closes_at })} />
          <NumberField
            label={t('surveyMaxResponses')}
            value={form.max_responses}
            onSave={(max_responses) => set({ max_responses })}
          />
        </div>
        <p className="mt-2 text-xs text-text-tertiary">{t('surveyRuntimeHint')}</p>
      </Card>

      <Card title={t('surveyResultsForParticipants')}>
        <Choices
          value={form.results_visibility}
          onChange={(v) => set({ results_visibility: v as FormSettingsRow['results_visibility'] })}
          options={[
            { value: 'off', label: 'resultsOff', hint: 'resultsOffHint' },
            { value: 'after_submit', label: 'resultsAfterSubmit', hint: 'resultsSummaryHint' },
            { value: 'after_close', label: 'resultsAfterClose', hint: 'resultsSummaryHint' },
          ]}
        />
      </Card>

      <Card title={t('surveyPrivacy')}>
        <Toggle
          checked={form.consent_required}
          onChange={(consent_required) => set({ consent_required })}
          label={t('surveyConsent')}
          hint={t('surveyConsentHint')}
        />
        {form.consent_required && (
          <TextField
            label={t('surveyConsentText')}
            placeholder={t('formConsentDefault')}
            value={form.consent_text}
            onSave={(consent_text) => set({ consent_text })}
          />
        )}
      </Card>

      <Card title={t('surveyNotifications')}>
        {!detail.mail_enabled && <p className="mb-2 text-sm text-text-secondary">{t('surveyMailOff')}</p>}
        <Choices
          value={form.notify_mode === 'each' && anonymous ? 'daily' : form.notify_mode}
          disabled={!detail.mail_enabled}
          onChange={(v) => set({ notify_mode: v as FormSettingsRow['notify_mode'] })}
          options={[
            { value: 'off', label: 'notifyOff' },
            { value: 'each', label: 'notifyEach', hint: anonymous ? 'notifyEachAnonymous' : 'notifyEachHint', disabled: anonymous },
            { value: 'daily', label: 'notifyDaily', hint: 'notifyDailyHint' },
          ]}
        />
        {form.notify_mode !== 'off' && detail.mail_enabled && (
          <fieldset className="mt-3">
            <legend className="mb-1.5 text-sm font-medium">{t('notifyRecipients')}</legend>
            <ul className="grid gap-1 sm:grid-cols-2">
              {detail.managers.map((m) => {
                const on = form.notify_user_ids.includes(m.id);
                return (
                  <li key={m.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-surface-subtle">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          set({
                            notify_user_ids: on ? form.notify_user_ids.filter((id) => id !== m.id) : [...form.notify_user_ids, m.id],
                          })
                        }
                        className="h-4 w-4 accent-accent"
                      />
                      <Avatar name={m.name || m.email} photoUrl={m.photo_url} size={24} />
                      <span className="min-w-0 truncate text-sm">{m.name || m.email}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-xs text-text-tertiary">{t('notifyPrivacyHint')}</p>
          </fieldset>
        )}
      </Card>
    </div>
  );
};

const GuestModeOptions = () => {
  const { t } = useI18n();
  return (
    <>
      <option value="required">{t('guestFieldRequired')}</option>
      <option value="optional">{t('guestFieldOptional')}</option>
      <option value="off">{t('guestFieldOff')}</option>
    </>
  );
};

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-2xl border border-border bg-surface p-4">
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-tertiary">{title}</h2>
    {children}
  </section>
);

// Mutually exclusive choices as selectable cards, each with a short hint.
const Choices = ({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: TranslationKey; hint?: TranslationKey; disabled?: boolean }[];
  disabled?: boolean;
}) => {
  const { t } = useI18n();
  return (
    <div role="radiogroup" className={cn('grid gap-2', options.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {options.map((o) => {
        const selected = value === o.value;
        const off = disabled || o.disabled;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={off}
            onClick={() => !selected && onChange(o.value)}
            className={cn(
              'flex flex-col rounded-xl border p-3 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              selected ? 'border-accent bg-accent/10' : 'border-border hover:bg-surface-subtle',
              off && !selected && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="font-medium">{t(o.label)}</span>
            {o.hint && <span className="mt-0.5 text-xs text-text-secondary">{t(o.hint)}</span>}
          </button>
        );
      })}
    </div>
  );
};

const Toggle = ({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) => (
  <div className={cn(disabled && 'opacity-50')}>
    <div className={cn(disabled && 'pointer-events-none')}>
      <Switch checked={checked && !disabled} onChange={onChange} label={label} className="text-sm text-text" />
    </div>
    {hint && <p className="ml-1.5 text-xs text-text-tertiary">{hint}</p>}
  </div>
);

// Fields saved when left (not on every keystroke).
const DateTimeField = ({ label, value, onSave }: { label: string; value: string | null; onSave: (iso: string | null) => void }) => {
  const [draft, setDraft] = useState(toLocalInput(value));
  useEffect(() => setDraft(toLocalInput(value)), [value]);
  return (
    <Input
      type="datetime-local"
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => fromLocalInput(draft) !== value && onSave(fromLocalInput(draft))}
    />
  );
};

const NumberField = ({ label, value, onSave }: { label: string; value: number | null; onSave: (n: number | null) => void }) => {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  return (
    <Input
      type="number"
      min={1}
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = draft.trim() ? Math.max(1, Math.round(Number(draft))) : null;
        if (n !== value) onSave(n);
      }}
    />
  );
};

const TextField = ({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (text: string) => void;
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="mt-3">
      <Textarea
        label={label}
        rows={3}
        maxLength={5000}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onSave(draft)}
      />
    </div>
  );
};
