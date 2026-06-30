import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { PageSpinner } from '@/components/Spinner';
import { MemberForm } from '@/components/MemberForm';
import { StatusBadge } from '@/components/StatusBadge';
import { DataTable } from '@/components/DataTable';
import { useI18n } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { useProjectContext } from '@/layouts/projectContext';
import type { AttendanceStatus, Event, Member } from '@/types';

interface HistoryRow {
  event: Event;
  status: AttendanceStatus;
  is_guest: boolean;
}

export const MemberDetailPage = () => {
  const { t } = useI18n();
  const { project } = useProjectContext();
  const { memberId } = useParams();
  const navigate = useNavigate();
  const [member, setMember] = useState<Member | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = async () => {
    const { data: m } = await supabase.from('members').select('*').eq('id', memberId).maybeSingle();
    setMember((m as Member) ?? null);

    // Existing group names in this project, for the edit form's suggestions.
    const { data: g } = await supabase
      .from('members')
      .select('group_name')
      .eq('project_id', project.id)
      .not('group_name', 'is', null);
    setGroups(
      [...new Set(((g as { group_name: string | null }[]) ?? [])
        .map((r) => r.group_name)
        .filter((n): n is string => Boolean(n)))].sort((a, b) => a.localeCompare(b)),
    );

    const { data: att } = await supabase
      .from('attendance')
      .select('status, is_guest, events(*)')
      .eq('member_id', memberId);

    const rows: HistoryRow[] = ((att as unknown as Array<{
      status: AttendanceStatus;
      is_guest: boolean;
      events: Event;
    }>) ?? [])
      .filter((r) => r.events)
      .map((r) => ({ event: r.events, status: r.status, is_guest: r.is_guest }))
      .sort((a, b) => (a.event.date ?? '').localeCompare(b.event.date ?? ''));
    setHistory(rows);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  if (loading) return <PageSpinner />;
  if (!member) {
    navigate(`/projects/${project.id}/members`);
    return null;
  }

  const attendedCount = history.filter((h) => h.status === 'attended').length;

  return (
    <>
      <button
        onClick={() => navigate(`/projects/${project.id}/members`)}
        className="flex items-center gap-2 text-sm font-medium text-text-secondary hover:text-text transition-colors duration-150 mb-6"
      >
        <ArrowLeft size={16} />
        {t('members')}
      </button>

      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={`${member.first_name} ${member.last_name}`} photoUrl={member.photo_url} size={64} />
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold break-words">
              {member.first_name} {member.last_name}
            </h1>
            <p className="text-text-secondary text-sm mt-1 break-words">
              {member.group_name ? `${member.group_name} · ` : ''}
              {member.email ?? '—'}
            </p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => setEditOpen(true)} className="sm:flex-shrink-0">
          <Pencil size={15} />
          {t('edit')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="text-sm text-text-secondary">{t('attended')}</p>
          <p className="text-2xl font-bold mt-1">{attendedCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary">{t('excused')}</p>
          <p className="text-2xl font-bold mt-1">
            {history.filter((h) => h.status === 'excused').length}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-text-secondary">{t('events')}</p>
          <p className="text-2xl font-bold mt-1">{history.length}</p>
        </Card>
      </div>

      <h2 className="text-lg font-semibold mb-3">{t('attendance')}</h2>
      <DataTable
        rows={history}
        getRowId={(h) => h.event.id}
        onRowClick={(h) => navigate(`/projects/${project.id}/events/${h.event.id}`)}
        search={(h) => h.event.name}
        emptyMessage={t('noResults')}
        filters={[
          {
            id: 'status',
            label: t('attendance'),
            options: [
              { value: 'attended', label: t('attended') },
              { value: 'excused', label: t('excused') },
              { value: 'not_attended', label: t('notAttended') },
            ],
            predicate: (h, v) => h.status === v,
          },
        ]}
        columns={[
          {
            id: 'event',
            header: t('eventName'),
            accessor: (h) => h.event.name,
            render: (h) => (
              <span className="inline-flex items-center gap-2">
                {h.event.name}
                {h.is_guest && (
                  <span className="text-xs text-text-tertiary border border-border rounded-md px-1.5 py-0.5">
                    {t('guest')}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: 'date',
            header: t('date'),
            accessor: (h) => h.event.date,
            render: (h) => <span className="text-text-secondary">{h.event.date ?? '—'}</span>,
          },
          {
            id: 'status',
            header: t('attendance'),
            accessor: (h) => h.status,
            render: (h) => <StatusBadge status={h.status} />,
          },
        ]}
      />

      <MemberForm
        open={editOpen}
        projectId={project.id}
        member={member}
        groups={groups}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />
    </>
  );
};
