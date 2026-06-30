import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, LockKeyhole, QrCode } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';

type PublicCheckinInfo =
  | { state: 'invalid' }
  | { state: 'stopped'; event_name?: string; project_name?: string }
  | { state: 'active'; event_name: string; project_name: string; groups: string[] };

type SubmitResult = {
  state: 'success' | 'invalid' | 'stopped' | 'invalid_input';
  recognized?: boolean;
};

export const PublicCheckinPage = () => {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const [info, setInfo] = useState<PublicCheckinInfo | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('get_public_checkin', { p_token: token }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      setInfo(rpcError ? { state: 'invalid' } : (data as PublicCheckinInfo));
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('submit_public_checkin', {
      p_token: token,
      p_first_name: firstName,
      p_last_name: lastName,
      p_group_name: groupName,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(t('checkInSubmitError'));
      return;
    }

    const result = data as SubmitResult;
    if (result.state === 'success') {
      setSubmitted(true);
    } else if (result.state === 'stopped') {
      setInfo({
        state: 'stopped',
        event_name: info && 'event_name' in info ? info.event_name : undefined,
      });
    } else if (result.state === 'invalid') {
      setInfo({ state: 'invalid' });
    } else {
      setError(t('checkInSubmitError'));
    }
  };

  if (!info) return <PageSpinner />;

  return (
    <main className="min-h-full px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        {info.state === 'active' ? (
          <>
            <header className="mb-8 text-center">
              <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
                <QrCode size={22} />
              </span>
              <h1 className="text-2xl font-bold">{t('checkInFormTitle')}</h1>
              <p className="mt-2 text-text-secondary">{info.event_name}</p>
              <p className="mt-0.5 text-sm text-text-tertiary">{info.project_name}</p>
            </header>

            <Card className="p-5 sm:p-6">
              {submitted ? (
                <div className="py-7 text-center" role="status">
                  <CheckCircle2 size={42} className="mx-auto text-[#16a34a]" />
                  <h2 className="mt-4 text-lg font-semibold">{t('checkInSuccess')}</h2>
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-4">
                  <Input
                    id="first-name"
                    label={t('firstName')}
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="given-name"
                    maxLength={120}
                    required
                    autoFocus
                  />
                  <Input
                    id="last-name"
                    label={t('lastName')}
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    autoComplete="family-name"
                    maxLength={120}
                    required
                  />
                  <Select
                    id="group-name"
                    label={t('group')}
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    required
                    disabled={info.groups.length === 0}
                  >
                    <option value="">{t('selectGroup')}</option>
                    {info.groups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </Select>
                  {info.groups.length === 0 ? (
                    <p className="text-sm text-text-secondary">{t('noGroupsAvailable')}</p>
                  ) : null}
                  {error ? (
                    <p className="text-sm text-red-700" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={submitting || info.groups.length === 0}
                  >
                    {submitting ? t('loading') : t('submitCheckIn')}
                  </Button>
                </form>
              )}
            </Card>
          </>
        ) : (
          <Card className="p-8 text-center">
            <LockKeyhole size={38} className="mx-auto text-text-secondary" />
            {'event_name' in info && info.event_name ? (
              <p className="mt-5 font-semibold">{info.event_name}</p>
            ) : null}
            <h1 className="mt-2 text-lg font-semibold">
              {info.state === 'stopped' ? t('checkInUnavailable') : t('checkInInvalid')}
            </h1>
          </Card>
        )}
      </div>
    </main>
  );
};
