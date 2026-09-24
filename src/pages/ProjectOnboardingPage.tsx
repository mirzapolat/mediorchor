import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  CalendarX2,
  Check,
  ClipboardList,
  FileUp,
  GripVertical,
  ImagePlus,
  Music,
  PartyPopper,
  Pencil,
  Plus,
  ShieldCheck,
  Tags,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Input, Textarea } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { GroupPill } from '@/components/GroupPill';
import { GroupForm } from '@/components/GroupForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MemberImportFields, MemberImportSummary, useMemberImport } from '@/components/MemberImport';
import { useDragReorder } from '@/hooks/useDragReorder';
import { useAuth } from '@/hooks/useAuth';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { uploadImage } from '@/lib/uploadImage';
import { paletteColor } from '@/lib/groupColors';
import type { Project, ProjectGroup } from '@/types';

// Wizard steps: project details → member import → groups → next steps.
const STEPS = ['onboardingStepProject', 'onboardingStepMembers', 'onboardingStepGroups', 'onboardingStepDone'] as const;
type Step = 0 | 1 | 2 | 3;

// Soft tint of the branding accent color.
const accentTint = (percent: number) => ({
  backgroundColor: `color-mix(in srgb, var(--color-accent) ${percent}%, transparent)`,
});

const Stepper = ({ step, onSelect }: { step: Step; onSelect: (step: Step) => void }) => {
  const { t } = useI18n();
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className={cn('h-px w-6 lg:w-10', done || current ? 'bg-black' : 'bg-border')} />}
            <button
              type="button"
              // Only finished steps (before the last one) can be revisited.
              disabled={!done || step === 3}
              onClick={() => onSelect(i as Step)}
              className="flex items-center gap-2 text-sm disabled:cursor-default"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-150',
                  done && 'bg-black text-white',
                  current && 'bg-black text-white ring-4 ring-black/10',
                  !done && !current && 'border border-border bg-white text-text-tertiary',
                )}
              >
                {done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('font-medium', current ? 'text-text' : 'text-text-secondary')}>{t(label)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};

const StepHeading = ({ step, title, hint }: { step: Step; title: string; hint: string }) => {
  const { t } = useI18n();
  return (
    <div className="mb-10 text-center">
      <p className="mb-2 text-sm font-medium text-text-tertiary">
        {step + 1} / {STEPS.length} · {t(STEPS[step])}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-text-secondary">{hint}</p>
    </div>
  );
};

const TipCard = ({
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex items-start gap-4 rounded-md border border-border bg-surface p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-black/30 hover:shadow-[0_6px_20px_-8px_rgba(0,0,0,0.15)]"
  >
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-surface-muted text-text">
      <Icon size={19} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block font-medium">{title}</span>
      <span className="mt-1 block text-sm text-text-secondary">{hint}</span>
    </span>
    <ArrowRight
      size={17}
      className="mt-0.5 flex-shrink-0 text-text-tertiary transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-text"
    />
  </button>
);

// Accepts files dropped onto `children` (used for the logo and the CSV).
const useFileDrop = (onFile: (file: File) => void) => {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      },
    },
  };
};

const Footer = ({ width, children }: { width: string; children: ReactNode }) => (
  <footer className="sticky bottom-0 z-10 bg-bg">
    <div className={cn('mx-auto flex w-full flex-wrap items-center gap-3 px-4 pb-8 pt-4 sm:px-6 sm:pb-12', width)}>
      {children}
    </div>
  </footer>
);

// Content width per step (the member import needs room for its columns).
const stepWidth = (step: Step, importing: boolean) =>
  step === 0 ? 'max-w-xl' : step === 1 && importing ? 'max-w-4xl' : step === 3 ? 'max-w-3xl' : 'max-w-2xl';

// A member from the import, kept in memory until the project is created.
interface DraftMember {
  first_name: string;
  last_name: string;
  email: string | null;
  group_name: string | null;
}

// Group of the project being set up; shaped like a saved group so the group
// form and pills can be reused.
const draftGroup = (name: string, color: string): ProjectGroup => ({
  id: crypto.randomUUID(),
  project_id: '',
  name,
  color,
  position: 0,
  created_at: '',
});

const sameName = (a: string | null, b: string) => a?.toLowerCase() === b.toLowerCase();

const Onboarding = () => {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(0);
  // Everything stays in memory until the wizard is finished or skipped; only
  // then is the project created.
  const [project, setProject] = useState<Project | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [members, setMembers] = useState<DraftMember[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ProjectGroup | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<ProjectGroup | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const imp = useMemberImport({ active: true, projectId: null, groups: groups.map((g) => g.name) });

  // Object URLs of picked logos are released when replaced.
  useEffect(
    () => () => {
      if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  const pickLogo = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };
  const logoDrop = useFileDrop(pickLogo);
  const csvDrop = useFileDrop((file) => void imp.handleFile(file));

  const dnd = useDragReorder(groups, (g) => g.id, setGroups);

  // Creates the project with its logo, groups and members. Resolves to the
  // project or null on failure.
  const createProject = async (): Promise<Project | null> => {
    if (project) return project;
    setSaving(true);
    setError(null);
    const fail = (message: string) => {
      setSaving(false);
      setError(message);
      return null;
    };
    const { data, error: createError } = await api
      .from('projects')
      .insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        created_by: user?.id ?? null,
        // New projects ask sign-ups for a group by default (takes effect once
        // the project has groups); can be turned off in the project settings.
        require_signup_group: true,
      })
      .select()
      .single();
    let created = data as Project | null;
    if (createError || !created) return fail(createError?.message ?? '');
    const projectId = created.id;

    if (logoFile) {
      const upload = await uploadImage(`projects/${projectId}`, logoFile);
      if (upload.url) {
        const { data: withImage } = await api
          .from('projects')
          .update({ image_url: upload.url })
          .eq('id', projectId)
          .select()
          .single();
        if (withImage) created = withImage as Project;
      }
    }
    // Groups first, so members land in them with the chosen colors and order.
    if (groups.length) {
      const { error: groupsError } = await api
        .from('project_groups')
        .insert(groups.map((g, position) => ({ project_id: projectId, name: g.name, color: g.color, position })));
      if (groupsError) return fail(groupsError.message);
    }
    if (members.length) {
      const { error: membersError } = await api
        .from('members')
        .insert(members.map((m) => ({ ...m, project_id: projectId, photo_url: null })));
      if (membersError) return fail(membersError.message);
    }
    setProject(created);
    setSaving(false);
    return created;
  };

  const openProject = (id: string) => navigate(`/projects/${id}`);

  const submitDetails = (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim()) setStep(1);
  };

  // Skipping creates the project with what has been set up so far.
  const skip = async () => {
    const created = await createProject();
    if (created) openProject(created.id);
  };

  const finish = async () => {
    if (await createProject()) setStep(3);
  };

  // Closing before the project exists discards the setup (after asking when
  // something was entered).
  const close = () => {
    if (project) openProject(project.id);
    else if (form.name.trim() || members.length || groups.length) setConfirmDiscard(true);
    else navigate('/');
  };

  // Takes the import's members (replacing an earlier import) and adds its new
  // groups with the next palette colors.
  const takeImport = () => {
    const drafts = imp.drafts();
    setMembers(drafts.members);
    setGroups((current) => {
      const next = [...current];
      for (const name of drafts.groups) {
        if (!next.some((g) => sameName(g.name, name))) next.push(draftGroup(name, paletteColor(next.length)));
      }
      return next;
    });
    setStep(2);
  };

  // Group changes carry over to the members, like the database triggers do
  // for saved projects.
  const saveGroup = ({ name, color }: { name: string; color: string }) => {
    if (!editingGroup) {
      setGroups((current) => [...current, draftGroup(name, color)]);
      return;
    }
    const oldName = editingGroup.name;
    setGroups((current) => current.map((g) => (g.id === editingGroup.id ? { ...g, name, color } : g)));
    setMembers((current) => current.map((m) => (sameName(m.group_name, oldName) ? { ...m, group_name: name } : m)));
  };

  const deleteGroup = () => {
    if (!groupToDelete) return;
    const { id, name } = groupToDelete;
    setGroups((current) => current.filter((g) => g.id !== id));
    setMembers((current) => current.map((m) => (sameName(m.group_name, name) ? { ...m, group_name: null } : m)));
    setGroupToDelete(null);
  };

  const countOf = (g: ProjectGroup) => members.filter((m) => sameName(m.group_name, g.name)).length;
  const canSkip = step < 3 && form.name.trim() !== '';
  const width = stepWidth(step, Boolean(imp.rawText));

  const tips: { icon: LucideIcon; title: Parameters<typeof t>[0]; hint: Parameters<typeof t>[0]; path: string }[] = [
    { icon: CalendarPlus, title: 'onboardingTipEvent', hint: 'onboardingTipEventHint', path: 'events' },
    { icon: Music, title: 'onboardingTipPieces', hint: 'onboardingTipPiecesHint', path: 'pieces' },
    {
      icon: ClipboardList,
      title: 'onboardingTipRegistration',
      hint: 'onboardingTipRegistrationHint',
      path: 'registrations',
    },
    { icon: ShieldCheck, title: 'onboardingTipPermissions', hint: 'onboardingTipPermissionsHint', path: 'settings' },
    { icon: CalendarX2, title: 'onboardingTipAbsences', hint: 'onboardingTipAbsencesHint', path: 'absences' },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="sticky top-0 z-20 bg-bg">
        <div className="relative mx-auto flex h-24 w-full max-w-5xl items-center justify-center px-4 sm:px-6">
          <div className="hidden md:block">
            <Stepper step={step} onSelect={setStep} />
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t('close')}
            className="absolute right-4 rounded-md p-2 text-text-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-text sm:right-6"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col justify-center">
        <div
          key={step}
          className={cn('mx-auto w-full px-4 py-12 animate-[fadein_250ms_ease-out] sm:px-6 sm:py-16', width)}
        >
          {step === 0 && (
            <>
              <StepHeading step={0} title={t('onboardingProjectTitle')} hint={t('onboardingProjectHint')} />
              <form id="onboarding-project" onSubmit={submitDetails}>
                <Card className="space-y-6 p-6 sm:p-8">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <label
                      {...logoDrop.props}
                      className={cn(
                        'relative flex h-24 w-24 flex-shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl border-2 border-dashed text-text-tertiary transition-colors duration-150 hover:border-black/40 hover:text-text',
                        logoDrop.over ? 'border-black bg-surface-muted' : 'border-border',
                        logoPreview && 'border-solid',
                      )}
                    >
                      {logoPreview ? (
                        <img src={logoPreview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlus size={26} />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])}
                      />
                    </label>
                    <div>
                      <p className="font-medium">
                        {t('onboardingLogo')} <span className="font-normal text-text-tertiary">({t('optional')})</span>
                      </p>
                      <p className="mt-0.5 text-sm text-text-secondary">{t('onboardingLogoHint')}</p>
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-muted">
                          <ImagePlus size={15} />
                          {t('onboardingLogoUpload')}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && pickLogo(e.target.files[0])}
                          />
                        </label>
                        {logoPreview && (
                          <button
                            type="button"
                            onClick={() => {
                              setLogoFile(null);
                              setLogoPreview(null);
                            }}
                            className="text-sm font-medium text-text-secondary hover:text-text"
                          >
                            {t('remove')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <Input
                    label={t('projectName')}
                    placeholder={t('onboardingNamePlaceholder')}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    autoFocus
                  />
                  <Textarea
                    label={`${t('description')} (${t('optional')})`}
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </Card>

              </form>
            </>
          )}

          {step === 1 && (
            <>
              <StepHeading step={1} title={t('onboardingMembersTitle')} hint={t('onboardingMembersHint')} />
              {members.length > 0 && (
                <p className="mb-4 flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-sm text-success-strong">
                  <Check size={16} />
                  {t('onboardingImported').replace('{n}', String(members.length))}
                </p>
              )}
              {imp.rawText ? (
                <Card className="space-y-4 p-6">
                  <MemberImportFields imp={imp} />
                  <div className="border-t border-border pt-4">
                    <MemberImportSummary imp={imp} />
                  </div>
                </Card>
              ) : (
                <label
                  {...csvDrop.props}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed bg-surface px-6 py-16 text-center transition-colors duration-150 hover:border-black/40',
                    csvDrop.over ? 'border-black bg-surface-muted' : 'border-border',
                  )}
                >
                  <span
                    className="mb-4 flex h-14 w-14 items-center justify-center rounded-full text-accent"
                    style={accentTint(14)}
                  >
                    <FileUp size={24} />
                  </span>
                  <span className="text-lg font-medium">{t('onboardingDropCsv')}</span>
                  <span className="mt-1 text-sm text-text-secondary">{t('onboardingDropCsvHint')}</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && void imp.handleFile(e.target.files[0])}
                  />
                </label>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <StepHeading step={2} title={t('onboardingGroupsTitle')} hint={t('onboardingGroupsHint')} />
              <div className="flex flex-col items-center">
                {groups.length > 0 ? (
                  <ul className="w-full overflow-hidden rounded-md border border-border bg-surface">
                    {groups.map((g, index) => {
                      const dragging = dnd.isDragging(g.id);
                      return (
                        <li
                          key={g.id}
                          ref={(el) => dnd.setItemRef(g.id, el)}
                          className={cn(
                            'flex items-center gap-3 border-b border-border bg-surface px-3 py-3 last:border-b-0',
                            dragging && 'shadow-lg',
                          )}
                          style={
                            dnd.dragActive
                              ? {
                                  transform: `translateY(${dnd.shiftFor(index)}px)`,
                                  transition: dragging ? 'none' : 'transform 150ms ease',
                                  position: 'relative',
                                  zIndex: dragging ? 10 : undefined,
                                }
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            aria-label="Drag"
                            onPointerDown={(e) => dnd.startDrag(e, g.id, index)}
                            onPointerMove={dnd.moveDrag}
                            onPointerUp={dnd.endDrag}
                            onPointerCancel={dnd.endDrag}
                            className="cursor-grab touch-none rounded p-1 text-text-tertiary hover:text-text active:cursor-grabbing"
                          >
                            <GripVertical size={16} />
                          </button>
                          <GroupPill name={g.name} color={g.color} className="text-sm" />
                          <span className="ml-auto text-sm text-text-secondary">
                            {t('onboardingMembersCount').replace('{n}', String(countOf(g)))}
                          </span>
                          <button
                            type="button"
                            aria-label={t('edit')}
                            onClick={() => {
                              setEditingGroup(g);
                              setGroupFormOpen(true);
                            }}
                            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-text"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label={t('delete')}
                            onClick={() => setGroupToDelete(g)}
                            className="rounded-md p-1.5 text-text-secondary hover:bg-surface-muted hover:text-text"
                          >
                            <Trash2 size={15} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="flex w-full flex-col items-center rounded-md border border-dashed border-border bg-surface px-6 py-12 text-center">
                    <Tags size={24} className="mb-3 text-text-tertiary" />
                    <p className="text-sm text-text-secondary">{t('onboardingNoGroups')}</p>
                  </div>
                )}
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupFormOpen(true);
                  }}
                >
                  <Plus size={16} />
                  {t('newGroup')}
                </Button>
              </div>
            </>
          )}

          {step === 3 && project && (
            <>
              <div className="mb-10 flex flex-col items-center text-center">
                <span
                  className="mb-5 flex h-16 w-16 items-center justify-center rounded-full text-accent"
                  style={accentTint(14)}
                >
                  <PartyPopper size={28} />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t('onboardingDoneTitle').replace('{name}', project.name)}
                </h1>
                <p className="mt-2 max-w-xl text-text-secondary">{t('onboardingDoneHint')}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {tips.map((tip) => (
                  <TipCard
                    key={tip.path}
                    icon={tip.icon}
                    title={t(tip.title)}
                    hint={t(tip.hint)}
                    onClick={() => navigate(`/projects/${project.id}/${tip.path}`)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => openProject(project.id)}
                  className="group flex items-center justify-between gap-4 rounded-md bg-black p-5 text-left text-white transition-colors duration-150 hover:bg-black-hover"
                >
                  <span className="flex items-center gap-3">
                    <Avatar name={project.name} photoUrl={project.image_url} size={40} square />
                    <span className="font-medium">{t('onboardingOpenProject')}</span>
                  </span>
                  <ArrowRight size={18} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      {step < 3 && (
        <Footer width={width}>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep((step - 1) as Step)}>
              <ArrowLeft size={16} />
              {t('back')}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            {error && <span className="text-sm text-accent">{error}</span>}
            {canSkip && (
              <button
                type="button"
                onClick={() => void skip()}
                disabled={saving}
                className="whitespace-nowrap px-2 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:text-text"
              >
                {t('onboardingSkip')}
              </button>
            )}
            {step === 0 && (
              <Button type="submit" form="onboarding-project" disabled={saving || !form.name.trim()}>
                {saving ? t('loading') : t('onboardingContinue')}
                <ArrowRight size={16} />
              </Button>
            )}
            {step === 1 && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMembers([]);
                    setStep(2);
                  }}
                >
                  {t('onboardingContinueWithoutImport')}
                </Button>
                {imp.rawText && (
                  <Button onClick={takeImport} disabled={!imp.canImport}>
                    {t('onboardingImportAndContinue')}
                    <ArrowRight size={16} />
                  </Button>
                )}
              </>
            )}
            {step === 2 && (
              <Button onClick={() => void finish()} disabled={saving}>
                {saving ? t('loading') : t('onboardingSetUpProject')}
                <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </Footer>
      )}

      <GroupForm
        open={groupFormOpen}
        projectId=""
        group={editingGroup}
        groups={groups}
        onClose={() => setGroupFormOpen(false)}
        onSaved={() => undefined}
        onSubmit={saveGroup}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title={t('onboardingDiscardTitle')}
        message={t('onboardingDiscardMessage')}
        confirmLabel={t('onboardingDiscard')}
        destructive
        onConfirm={() => navigate('/')}
        onCancel={() => setConfirmDiscard(false)}
      />

      <ConfirmDialog
        open={!!groupToDelete}
        title={t('delete')}
        message={t('confirmDeleteGroup').replace('{n}', String(groupToDelete ? countOf(groupToDelete) : 0))}
        confirmLabel={t('delete')}
        destructive
        onConfirm={deleteGroup}
        onCancel={() => setGroupToDelete(null)}
      />
    </div>
  );
};

// Full-screen wizard for creating a project: details, member import, groups
// and pointers to what to set up next. The project is only created when the
// wizard is finished or skipped (possible once it has a name).
export const ProjectOnboardingPage = () => {
  const { canManageProjects } = useAuth();
  if (!canManageProjects) return <Navigate to="/" replace />;
  return <Onboarding />;
};
