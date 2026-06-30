import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { Markdown } from '@/lib/markdown';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type RegistrationInfo =
  | { state: 'invalid' }
  | { state: 'inactive'; title?: string; project_name?: string }
  | {
      state: 'active';
      title: string;
      description: string;
      ask_email: boolean;
      ask_group: boolean;
      groups: string[];
      project_name: string;
    };

type SubmitResult = { state: 'success' | 'invalid' | 'inactive' | 'invalid_input' };

const TOTAL_STEPS = 4;

const StepDots = ({ step }: { step: number }) => (
  <div className="mb-6 flex items-center justify-center gap-2" aria-hidden="true">
    {Array.from({ length: TOTAL_STEPS }, (_, index) => (
      <span
        key={index}
        className={`h-2 rounded-full transition-all duration-200 ${
          index + 1 === step ? 'w-6 bg-black' : index + 1 < step ? 'w-2 bg-black' : 'w-2 bg-border'
        }`}
      />
    ))}
  </div>
);

export const PublicRegistrationPage = () => {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  const [step, setStep] = useState(1);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [groupName, setGroupName] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_public_registration', { p_token: token }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      setInfo(rpcError ? { state: 'invalid' } : (data as RegistrationInfo));
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const active = info?.state === 'active' ? info : null;

  const dataValid = useMemo(() => {
    if (!active) return false;
    if (!firstName.trim() || !lastName.trim()) return false;
    if (active.ask_email && !email.trim()) return false;
    if (active.ask_group && active.groups.length > 0 && !groupName.trim()) return false;
    return true;
  }, [active, firstName, lastName, email, groupName]);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('submit_public_registration', {
      p_token: token,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email,
      p_group_name: groupName,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(t('registrationSubmitError'));
      return;
    }
    const result = data as SubmitResult;
    if (result.state === 'success') {
      setStep(4);
    } else if (result.state === 'inactive') {
      setInfo({ state: 'inactive', title: active?.title, project_name: active?.project_name });
    } else if (result.state === 'invalid') {
      setInfo({ state: 'invalid' });
    } else {
      setError(t('registrationSubmitError'));
    }
  };

  if (!info) return <PageSpinner />;

  if (info.state !== 'active') {
    return (
      <main className="min-h-full px-4 py-10 sm:px-6 sm:py-16">
        <div className="mx-auto w-full max-w-xl">
          <Card className="p-8 text-center">
            <LockKeyhole size={38} className="mx-auto text-text-secondary" />
            {'title' in info && info.title ? (
              <p className="mt-5 font-semibold">{info.title}</p>
            ) : null}
            <h1 className="mt-2 text-lg font-semibold">
              {info.state === 'inactive' ? t('registrationUnavailable') : t('registrationInvalid')}
            </h1>
          </Card>
        </div>
      </main>
    );
  }
  if (!active) return null;

  return (
    <main className="min-h-full px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-5 h-12 w-12 sm:h-14 sm:w-14" />
          <h1 className="text-2xl font-bold sm:text-3xl">{active.title}</h1>
          <p className="mt-1 text-sm text-text-tertiary">{active.project_name}</p>
        </header>

        <Card className="p-5 sm:p-7">
          {step < 4 ? <StepDots step={step} /> : null}

          {step === 1 ? (
            <div className="space-y-6">
              {active.description.trim() ? (
                <Markdown
                  source={active.description}
                  className="space-y-3 text-text-secondary leading-relaxed"
                />
              ) : (
                <p className="text-text-secondary">{t('startRegistration')}</p>
              )}
              <Button className="w-full" onClick={() => setStep(2)}>
                {t('next')}
              </Button>
            </div>
          ) : null}

          {step === 2 ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (dataValid) setStep(3);
              }}
              className="space-y-4"
            >
              <h2 className="text-base font-semibold">{t('enterYourData')}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label={t('firstName')}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  maxLength={120}
                  required
                  autoFocus
                />
                <Input
                  label={t('lastName')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  maxLength={120}
                  required
                />
              </div>
              {active.ask_email ? (
                <Input
                  type="email"
                  label={t('email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={200}
                  required
                />
              ) : null}
              {active.ask_group ? (
                <Select
                  label={t('group')}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  required
                  disabled={active.groups.length === 0}
                >
                  <option value="">{t('selectGroup')}</option>
                  {active.groups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </Select>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                  {t('back')}
                </Button>
                <Button type="submit" className="flex-1" disabled={!dataValid}>
                  {t('next')}
                </Button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <h2 className="text-base font-semibold">{t('reviewYourData')}</h2>
              <p className="text-sm text-text-secondary">{t('reviewHint')}</p>
              <dl className="divide-y divide-border rounded-md border border-border text-sm">
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-text-secondary">{t('firstName')}</dt>
                  <dd className="font-medium">{firstName}</dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-text-secondary">{t('lastName')}</dt>
                  <dd className="font-medium">{lastName}</dd>
                </div>
                {active.ask_email ? (
                  <div className="flex justify-between gap-3 px-3 py-2">
                    <dt className="text-text-secondary">{t('email')}</dt>
                    <dd className="font-medium">{email || '—'}</dd>
                  </div>
                ) : null}
                {active.ask_group ? (
                  <div className="flex justify-between gap-3 px-3 py-2">
                    <dt className="text-text-secondary">{t('group')}</dt>
                    <dd className="font-medium">{groupName || '—'}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="rounded-md bg-[#fafafa] px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
                {t('privacyNotice')}
              </p>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={acceptPrivacy}
                  onChange={(e) => setAcceptPrivacy(e.target.checked)}
                  className="mt-0.5 accent-black"
                />
                <span>{t('acceptPrivacy')}</span>
              </label>
              {error ? (
                <p className="text-sm text-red-700" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep(2)}>
                  {t('back')}
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={!acceptPrivacy || submitting}
                  onClick={submit}
                >
                  {submitting ? t('loading') : t('submitRegistration')}
                </Button>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="py-7 text-center" role="status">
              <CheckCircle2 size={42} className="mx-auto text-[#16a34a]" />
              <h2 className="mt-4 text-lg font-semibold">{t('registrationSuccess')}</h2>
            </div>
          ) : null}
        </Card>
      </div>
    </main>
  );
};
