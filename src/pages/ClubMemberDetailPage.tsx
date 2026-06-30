import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageSpinner } from '@/components/Spinner';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { ClubMember, ClubMemberStatus } from '@/types';

const SALUTATIONS = ['Herr', 'Frau', 'Divers'];

interface FormState {
  title: string;
  salutation: string;
  first_name: string;
  last_name: string;
  care_of: string;
  street: string;
  address_extra: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  status: ClubMemberStatus;
}

const blank: FormState = {
  title: '',
  salutation: '',
  first_name: '',
  last_name: '',
  care_of: '',
  street: '',
  address_extra: '',
  postal_code: '',
  city: '',
  country: '',
  email: '',
  phone: '',
  status: 'active',
};

const toForm = (m: ClubMember): FormState => ({
  title: m.title ?? '',
  salutation: m.salutation ?? '',
  first_name: m.first_name,
  last_name: m.last_name,
  care_of: m.care_of ?? '',
  street: m.street ?? '',
  address_extra: m.address_extra ?? '',
  postal_code: m.postal_code ?? '',
  city: m.city ?? '',
  country: m.country ?? '',
  email: m.email ?? '',
  phone: m.phone ?? '',
  status: m.status,
});

export const ClubMemberDetailPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { memberId } = useParams();
  const isNew = memberId === 'new';

  const [form, setForm] = useState<FormState>(blank);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('club_members').select('*').eq('id', memberId).maybeSingle();
    const member = (data as ClubMember | null) ?? null;
    if (member) setForm(toForm(member));
    setLoading(false);
  }, [memberId]);

  useEffect(() => {
    if (isNew) {
      setForm(blank);
      setLoading(false);
    } else {
      void load();
    }
  }, [isNew, load]);

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const payload = () => ({
    title: form.title.trim() || null,
    salutation: form.salutation.trim() || null,
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    care_of: form.care_of.trim() || null,
    street: form.street.trim() || null,
    address_extra: form.address_extra.trim() || null,
    postal_code: form.postal_code.trim() || null,
    city: form.city.trim() || null,
    country: form.country.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    status: form.status,
  });

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    if (isNew) {
      const { data } = await supabase.from('club_members').insert(payload()).select().single();
      setSaving(false);
      if (data) navigate(`/club/members/${(data as ClubMember).id}`, { replace: true });
    } else {
      await supabase.from('club_members').update(payload()).eq('id', memberId);
      setSaving(false);
      setSaved(true);
    }
  };

  const remove = async () => {
    await supabase.from('club_members').delete().eq('id', memberId);
    setDeleteOpen(false);
    navigate('/club/members');
  };

  if (loading) return <PageSpinner />;

  const valid = form.first_name.trim() && form.last_name.trim();
  const fullName = [form.title, form.first_name, form.last_name].filter(Boolean).join(' ').trim();

  return (
    <form onSubmit={save}>
      <button
        type="button"
        onClick={() => navigate('/club/members')}
        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={16} />
        {t('members')}
      </button>

      <PageHeader
        title={isNew ? t('newClubMember') : fullName || t('editClubMember')}
        actions={
          <div className="flex items-center gap-2">
            {!isNew ? (
              <Button type="button" variant="secondary" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={15} />
                {t('delete')}
              </Button>
            ) : null}
            <Button type="submit" disabled={saving || !valid}>
              {saved ? <Check size={15} /> : null}
              {saving ? t('loading') : saved ? t('clubMemberSaved') : isNew ? t('create') : t('save')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">
            {t('masterData')}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('salutation')}
              value={form.salutation}
              onChange={(e) => set({ salutation: e.target.value })}
            >
              <option value="">—</option>
              {SALUTATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Input
              label={t('memberTitle')}
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('firstName')}
              value={form.first_name}
              onChange={(e) => set({ first_name: e.target.value })}
              required
              autoFocus={isNew}
            />
            <Input
              label={t('lastName')}
              value={form.last_name}
              onChange={(e) => set({ last_name: e.target.value })}
              required
            />
          </div>
          <Select
            label={t('status')}
            value={form.status}
            onChange={(e) => set({ status: e.target.value as ClubMemberStatus })}
          >
            <option value="active">{t('active')}</option>
            <option value="passive">{t('passive')}</option>
          </Select>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">
            {t('contactDetails')}
          </h2>
          <Input
            type="email"
            label={t('email')}
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
          />
          <Input
            type="tel"
            label={t('phone')}
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />
        </Card>

        <Card className="space-y-4 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-tertiary">
            {t('addressSection')}
          </h2>
          <Input
            label={t('careOf')}
            value={form.care_of}
            onChange={(e) => set({ care_of: e.target.value })}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label={t('street')}
              value={form.street}
              onChange={(e) => set({ street: e.target.value })}
            />
            <div>
              <Input
                label={t('addressExtra')}
                value={form.address_extra}
                onChange={(e) => set({ address_extra: e.target.value })}
              />
              <p className="mt-1.5 text-sm text-text-secondary">{t('addressExtraHint')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label={t('postalCode')}
              value={form.postal_code}
              onChange={(e) => set({ postal_code: e.target.value })}
            />
            <Input
              label={t('city')}
              value={form.city}
              onChange={(e) => set({ city: e.target.value })}
              className="sm:col-span-2"
            />
          </div>
          <Input
            label={t('country')}
            value={form.country}
            onChange={(e) => set({ country: e.target.value })}
          />
        </Card>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={t('delete')}
        message={t('confirmDelete')}
        confirmLabel={t('delete')}
        destructive
        onConfirm={remove}
        onCancel={() => setDeleteOpen(false)}
      />
    </form>
  );
};
