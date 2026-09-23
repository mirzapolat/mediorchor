import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bookmark, CalendarDays, Clock, LogIn, LogOut } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { PageSpinner } from '@/components/Spinner';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useI18n } from '@/lib/i18n';
import { matchesConditions } from '@/lib/absenceConditions';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useProjectContext } from '@/layouts/projectContext';
import type { AbsenceLabel, Attendance, Event, Member } from '@/types';
import { useProjectGroups } from '@/hooks/useProjectGroups';

// "Meine Teilnahme": every account (participant, manager or admin) manages its
// own participation in the project here — group, attendance so far, upcoming
// Proben, and joining/leaving the project.
export const MyParticipationPage = () => {
  const { t, lang } = useI18n();
  const { project } = useProjectContext();
  const { names: groups } = useProjectGroups();
  const { user } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [labels, setLabels] = useState<AbsenceLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Join form (used when there is no active membership yet).
  const nameParts = (user?.name ?? '').trim();
  const lastSpace = nameParts.lastIndexOf(' ');
  const [joinForm, setJoinForm] = useState({
    first_name: lastSpace > 0 ? nameParts.slice(0, lastSpace) : nameParts,
    last_name: lastSpace > 0 ? nameParts.slice(lastSpace + 1) : '',
    group_name: '',
  });
  const [busy, setBusy] = useState(false);
  const [groupSaved, setGroupSaved] = useState(false);

  const participating = member?.status === 'active';

  const load = useCallback(async () => {
    if (!user) return;
    // Pick up member rows a manager added with this account's email.
    await api.rpc('claim_my_memberships');
    const { data: memberData } = await api
      .from('members')
      .select('*')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .maybeSingle();
    const m = (memberData as Member) ?? null;
    setMember(m);

    if (m && m.status === 'active') {
      const [ev, att, lab] = await Promise.all([
        api.from('events').select('*').eq('project_id', project.id).order('date'),
        api.from('attendance').select('*').eq('member_id', m.id),
        api
          .from('absence_labels')
          .select('*')
          .eq('project_id', project.id)
          .order('position')
          .order('created_at'),
      ]);
      setEvents((ev.data as Event[]) ?? []);
      setAttendance((att.data as Attendance[]) ?? []);
      setLabels((lab.data as AbsenceLabel[]) ?? []);
    } else {
      setEvents([]);
      setAttendance([]);
      setLabels([]);
    }
    setLoading(false);
  }, [project.id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const { upcoming, past } = useMemo(
    () => ({
      upcoming: events.filter((e) => e.date && e.date >= today),
      // Undated Proben count as held, so they belong in the attendance list.
      past: events.filter((e) => !e.date || e.date < today).reverse(),
    }),
    [events, today],
  );
  const statusByEvent = useMemo(
    () => new Map(attendance.map((a) => [a.event_id, a.status])),
    [attendance],
  );

  // Public labels that apply to this person, computed the same way as on the
  // Fehlzeiten page: absent = events without an attended/excused record.
  const matchingLabels = useMemo(() => {
    const attended = attendance.filter((a) => a.status === 'attended').length;
    const excused = attendance.filter((a) => a.status === 'excused').length;
    const counts = {
      attended,
      excused,
      absent: Math.max(0, events.length - attended - excused),
    };
    // RLS already limits participants to public labels; the extra filter keeps
    // managers (who can read all labels) consistent with what participants see.
    return labels.filter((l) => l.is_public && matchesConditions(counts, l.conditions));
  }, [labels, attendance, events]);

  const formatDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await api.rpc('join_project', {
      p_project_id: project.id,
      p_first_name: member?.first_name ?? joinForm.first_name,
      p_last_name: member?.last_name ?? joinForm.last_name,
      p_group_name: member?.group_name ?? (joinForm.group_name || null),
    });
    setBusy(false);
    if (rpcError || (data as { state: string })?.state !== 'success') {
      setError(t('participationError'));
      return;
    }
    await load();
  };

  const leave = async () => {
    setConfirmLeave(false);
    setBusy(true);
    setError(null);
    const { error: rpcError } = await api.rpc('leave_project', {
      p_project_id: project.id,
    });
    setBusy(false);
    if (rpcError) {
      setError(t('participationError'));
      return;
    }
    await load();
  };

  const changeGroup = async (group: string) => {
    // A participant always keeps a group once the project has any.
    if (!member || !group) return;
    setGroupSaved(false);
    setMember({ ...member, group_name: group || null });
    const { data, error: rpcError } = await api.rpc('set_my_group', {
      p_project_id: project.id,
      p_group_name: group,
    });
    if (rpcError || (data as { state: string })?.state !== 'success') {
      setError(t('participationError'));
      await load();
      return;
    }
    setGroupSaved(true);
  };

  if (loading) return <PageSpinner />;

  return (
    <>
      <PageHeader title={t('myParticipation')} />

      {error && <p className="text-sm text-accent mb-4">{error}</p>}

      {!participating ? (
        <Card className="max-w-xl space-y-4">
          <div>
            <h2 className="text-base font-medium">{t('joinProject')}</h2>
            <p className="text-sm text-text-secondary mt-1">
              {member ? t('rejoinProjectHint') : t('joinProjectHint')}
            </p>
          </div>
          <form onSubmit={join} className="space-y-4">
            {!member && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('firstName')}
                    value={joinForm.first_name}
                    onChange={(e) => setJoinForm({ ...joinForm, first_name: e.target.value })}
                    required
                  />
                  <Input
                    label={t('lastName')}
                    value={joinForm.last_name}
                    onChange={(e) => setJoinForm({ ...joinForm, last_name: e.target.value })}
                    required
                  />
                </div>
                {groups.length > 0 && (
                  <Select
                    label={t('group')}
                    value={joinForm.group_name}
                    onChange={(e) => setJoinForm({ ...joinForm, group_name: e.target.value })}
                    required
                  >
                    <option value="" disabled>
                      {t('selectGroup')}
                    </option>
                    {groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                )}
              </>
            )}
            <Button type="submit" disabled={busy}>
              <LogIn size={15} />
              {busy ? t('loading') : t('joinProject')}
            </Button>
          </form>
        </Card>
      ) : (
        <div className="space-y-6 max-w-3xl">
          <Card className="space-y-4">
            <div>
              <h2 className="text-base font-medium">{t('myGroup')}</h2>
              <p className="text-sm text-text-secondary mt-1">{t('myGroupHint')}</p>
            </div>
            {groups.length > 0 ? (
              <div className="flex items-center gap-3 max-w-xs">
                <Select
                  value={member?.group_name ?? ''}
                  onChange={(e) => changeGroup(e.target.value)}
                >
                  {!member?.group_name && (
                    <option value="" disabled>
                      {t('selectGroup')}
                    </option>
                  )}
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
                {groupSaved && <span className="text-sm text-text-secondary">✓</span>}
              </div>
            ) : (
              <p className="text-sm text-text-tertiary">{t('noGroupsAvailable')}</p>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-medium">{t('upcomingEvents')}</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-text-tertiary">{t('noUpcomingEvents')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {upcoming.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="font-medium">{e.name}</span>
                    <span className="flex items-center gap-3 text-sm text-text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={13} />
                        {formatDate(e.date!)}
                      </span>
                      {e.time && (
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={13} />
                          {e.time}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-medium">{t('myAttendance')}</h2>
            {matchingLabels.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {matchingLabels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-accent px-2.5 py-1 text-sm font-medium text-accent"
                  >
                    <Bookmark size={13} />
                    {label.name}
                  </span>
                ))}
              </div>
            )}
            {past.length === 0 ? (
              <p className="text-sm text-text-tertiary">{t('noAttendanceYet')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {past.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{e.name}</p>
                      {e.date && (
                        <p className="text-sm text-text-secondary">{formatDate(e.date)}</p>
                      )}
                    </div>
                    <StatusBadge status={statusByEvent.get(e.id) ?? 'not_attended'} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="space-y-3">
            <h2 className="text-base font-medium">{t('leaveProject')}</h2>
            <p className="text-sm text-text-secondary">{t('leaveProjectHint')}</p>
            <Button variant="accent" onClick={() => setConfirmLeave(true)} disabled={busy}>
              <LogOut size={15} />
              {t('leaveProject')}
            </Button>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={confirmLeave}
        title={t('leaveProject')}
        message={t('confirmLeaveProject')}
        confirmLabel={t('leaveProject')}
        destructive
        onConfirm={leave}
        onCancel={() => setConfirmLeave(false)}
      />
    </>
  );
};
