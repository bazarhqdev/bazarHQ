'use client';

/** Super Admin: themes (FR-SA-14/15), announcements (FR-SA-16/17), policies with dual approval (FR-SA-18). */
import { useState } from 'react';
import { CalendarClock, CheckCircle2, FileText, Megaphone, Palette, Pencil, Plus, Send, Trash2, Users } from 'lucide-react';
import { Controller } from 'react-hook-form';
import {
  ANNOUNCEMENT_AUDIENCE_LABEL,
  ANNOUNCEMENT_STATUS_LABEL,
  DEFAULT_STORE_THEMES,
  announcementSchema,
  canApprovePolicy,
  errorMessage,
  formatDate,
  formatDateTime,
  isServiceError,
  POLICY_STATUS_LABEL,
  POLICY_TYPE_LABEL,
  policySchema,
  themeSchema,
  type Announcement,
  type AnnouncementAudience,
  type Policy,
  type PolicyType,
  type ThemeAdmin,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  SelectField,
  SkeletonRows,
  Switch,
  Tabs,
  TextArea,
  TextField,
  useToast,
} from '../../components';
import { useAsync, useServices, useSession } from '../../context';
import { applyServerErrors, useZodForm } from '../../form';
import { BrandColourPicker } from '../store';

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

export function ThemesView() {
  const services = useServices();
  const toast = useToast();
  const list = useAsync(() => services.admin.listThemes(), []);
  const [editing, setEditing] = useState<ThemeAdmin | 'new' | null>(null);
  const [removing, setRemoving] = useState<ThemeAdmin | null>(null);
  const [installingDefaults, setInstallingDefaults] = useState(false);
  const existingThemesByName = new Map((list.data ?? []).map((theme) => [theme.name.trim().toLowerCase(), theme] as const));
  const defaultsToInstall = DEFAULT_STORE_THEMES.filter((theme) => !existingThemesByName.get(theme.name.toLowerCase())?.isActive);

  const installDefaultThemes = async () => {
    if (!list.data || installingDefaults || defaultsToInstall.length === 0) return;
    setInstallingDefaults(true);
    const installed: string[] = [];
    const failed: string[] = [];
    try {
      for (const theme of defaultsToInstall) {
        const existing = existingThemesByName.get(theme.name.toLowerCase());
        try {
          await services.admin.saveTheme(
            existing
              ? { name: existing.name, description: existing.description, accent: existing.accent, isActive: true }
              : { ...theme, isActive: true },
            existing?.id,
          );
          installed.push(theme.name);
        } catch (error) {
          failed.push(`${theme.name}: ${errorMessage(error)}`);
        }
      }
      await list.reload();
      if (failed.length === 0) {
        toast.success('Default themes ready', `${installed.length} theme(s) added or reactivated. Existing active themes were preserved.`);
      } else {
        toast.error('Default theme installation incomplete', `${installed.length} ready; ${failed.length} failed. ${failed[0]}`);
      }
    } finally {
      setInstallingDefaults(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Themes"
        description="Install the five curated defaults; existing active themes are preserved. Themes in use can’t be deleted; breaking changes require 7 days’ notice."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Palette className="size-4" aria-hidden />}
              onClick={() => void installDefaultThemes()}
              loading={installingDefaults}
              disabled={list.loading || Boolean(list.error) || defaultsToInstall.length === 0}
            >
              {defaultsToInstall.length === 0
                ? 'Default themes installed'
                : `Install ${defaultsToInstall.length} default ${defaultsToInstall.length === 1 ? 'theme' : 'themes'}`}
            </Button>
            <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
              New theme
            </Button>
          </>
        }
      />
      {list.loading ? (
        <SkeletonRows rows={4} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : list.data!.length === 0 ? (
        <EmptyState
          icon={<Palette className="size-6" aria-hidden />}
          title="No storefront themes yet"
          description="Install the five curated defaults above to make themes available in Merchant onboarding and store settings."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data!.map((t) => (
            <li key={t.id}>
              <Card className="h-full overflow-hidden">
                <div className="flex h-24 items-end gap-2 p-4" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent}cc)` }} aria-hidden>
                  <span className="h-10 w-16 rounded-md bg-white/85" />
                  <span className="h-14 w-16 rounded-md bg-white/70" />
                  <span className="h-8 w-16 rounded-md bg-white/60" />
                </div>
                <div className="space-y-2 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold">{t.name}</p>
                    {t.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                  </div>
                  <p className="text-[13px] text-ink-muted">{t.description}</p>
                  <p className="flex items-center gap-1.5 text-[12.5px] text-ink-subtle">
                    <Users className="size-3.5" aria-hidden />{' '}
                    {t.usedBy.length ? `Used by ${t.usedBy.map((s) => s.storeName).join(', ')}` : 'Not used by any store'}
                  </p>
                  {t.breakingChangeEffectiveAt && <Alert tone="warning">Breaking update takes effect {formatDate(t.breakingChangeEffectiveAt)}.</Alert>}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-3.5" aria-hidden />}
                      onClick={() => setRemoving(t)}
                      disabled={t.usedBy.length > 0}
                      title={t.usedBy.length ? 'In use — deactivate instead' : undefined}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <ThemeModal theme={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void list.reload()} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={`Delete ${removing?.name}?`}
        description="This can’t be undone."
        tone="danger"
        confirmLabel="Delete theme"
        onConfirm={async () => {
          try {
            await services.admin.deleteTheme(removing!.id);
            toast.success('Theme deleted');
            void list.reload();
          } catch (err) {
            toast.error('Couldn’t delete', errorMessage(err));
          }
          setRemoving(null);
        }}
      />
    </>
  );
}

function ThemeModal({ theme, onClose, onSaved }: { theme: ThemeAdmin | null; onClose: () => void; onSaved: () => void }) {
  const services = useServices();
  const toast = useToast();
  const [breaking, setBreaking] = useState(false);
  const form = useZodForm(themeSchema, {
    name: theme?.name ?? '',
    description: theme?.description ?? '',
    accent: theme?.accent ?? '#059669',
    isActive: theme?.isActive ?? true,
  });
  const submit = form.handleSubmit(async (v) => {
    try {
      await services.admin.saveTheme({ ...v, breaking }, theme?.id);
      toast.success(
        theme ? 'Theme updated' : 'Theme created',
        breaking && theme?.usedBy.length ? `${theme.usedBy.length} merchant(s) notified of the change.` : undefined,
      );
      onSaved();
      onClose();
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t save', errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      busy={form.formState.isSubmitting}
      title={theme ? `Edit ${theme.name}` : 'New theme'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            Save theme
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <TextField label="Name" required {...form.register('name')} error={form.formState.errors.name?.message} />
        <TextArea label="Description" required rows={3} {...form.register('description')} error={form.formState.errors.description?.message} />
        <Controller control={form.control} name="accent" render={({ field }) => <BrandColourPicker value={field.value} onChange={field.onChange} />} />
        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => <Switch checked={field.value} onChange={field.onChange} label="Available to merchants" />}
        />
        {theme && theme.usedBy.length > 0 && (
          <Checkbox
            label="This is a breaking layout change"
            description={`Notifies the ${theme.usedBy.length} store owner(s) using it; the change takes effect in 7 days.`}
            checked={breaking}
            onChange={setBreaking}
          />
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

const announcementTone = { draft: 'neutral', scheduled: 'info', sent: 'success' } as const;

export function AnnouncementsView() {
  const services = useServices();
  const toast = useToast();
  const list = useAsync(() => services.admin.listAnnouncements(), []);
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [removing, setRemoving] = useState<Announcement | null>(null);
  const [unscheduling, setUnscheduling] = useState<Announcement | null>(null);
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Platform-wide messages delivered as in-app notifications. Sent announcements can’t be edited or deleted."
        actions={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
            New announcement
          </Button>
        }
      />
      <Card>
        {list.loading ? (
          <SkeletonRows rows={4} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-6" aria-hidden />} title="No announcements yet" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((an) => (
              <li key={an.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{an.title}</p>
                    <Badge tone={announcementTone[an.status]}>{ANNOUNCEMENT_STATUS_LABEL[an.status]}</Badge>
                    <Badge tone="navy">{ANNOUNCEMENT_AUDIENCE_LABEL[an.audience]}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{an.body}</p>
                  <p className="mt-1 text-[12px] text-ink-subtle">
                    {an.status === 'sent'
                      ? `Sent ${formatDateTime(an.sentAt!)} by ${an.sentByName} · ${an.recipientCount} recipients`
                      : an.status === 'scheduled'
                        ? `Scheduled for ${formatDateTime(an.scheduledAt!)}`
                        : `Draft · created ${formatDate(an.createdAt)}`}
                  </p>
                </div>
                {an.status !== 'sent' && (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(an)}>
                      Edit
                    </Button>
                    {an.status === 'scheduled' && (
                      <Button size="sm" variant="ghost" onClick={() => setUnscheduling(an)}>
                        Unschedule
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" aria-label={`Delete ${an.title}`} onClick={() => setRemoving(an)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <AnnouncementModal announcement={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void list.reload()} />}
      <ConfirmDialog
        open={Boolean(unscheduling)}
        onClose={() => setUnscheduling(null)}
        title="Unschedule this announcement?"
        description={`“${unscheduling?.title}” goes back to drafts and won’t be sent.`}
        confirmLabel="Unschedule"
        onConfirm={async () => {
          try {
            await services.admin.cancelAnnouncement(unscheduling!.id);
            toast.success('Moved back to draft');
            void list.reload();
          } catch (err) {
            toast.error('Couldn’t unschedule', errorMessage(err));
          }
          setUnscheduling(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Delete this announcement?"
        description={removing?.title}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await services.admin.deleteAnnouncement(removing!.id);
            toast.success('Announcement deleted');
            void list.reload();
          } catch (err) {
            toast.error('Couldn’t delete', errorMessage(err));
          }
          setRemoving(null);
        }}
      />
    </>
  );
}

function localDateTime(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AnnouncementModal({ announcement, onClose, onSaved }: { announcement: Announcement | null; onClose: () => void; onSaved: () => void }) {
  const services = useServices();
  const toast = useToast();
  const [confirmSend, setConfirmSend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const form = useZodForm(announcementSchema, {
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    audience: announcement?.audience ?? 'merchants',
    sendMode: announcement?.status === 'scheduled' ? 'schedule' : 'now',
    scheduledAt: localDateTime(announcement?.scheduledAt ?? null),
  });
  const audience = form.watch('audience') as AnnouncementAudience;
  const mode = form.watch('sendMode');
  const count = useAsync(() => services.admin.recipientCount(audience), [audience]);

  const save = async (action: 'draft' | 'schedule' | 'send') => {
    const v = form.getValues();
    const ok = await form.trigger(action === 'schedule' ? undefined : ['title', 'body', 'audience']);
    if (!ok) return;
    setBusy(action);
    try {
      await services.admin.saveAnnouncement(
        { title: v.title, body: v.body, audience: v.audience, scheduledAt: action === 'schedule' ? new Date(v.scheduledAt).toISOString() : null },
        action,
        announcement?.id,
      );
      toast.success(action === 'send' ? `Sent to ${count.data ?? 0} recipients` : action === 'schedule' ? 'Announcement scheduled' : 'Draft saved');
      onSaved();
      onClose();
    } catch (err) {
      if (!(isServiceError(err) && applyServerErrors(form, err))) toast.error('Couldn’t save', errorMessage(err));
    } finally {
      setBusy(null);
      setConfirmSend(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={Boolean(busy)}
      size="lg"
      title={announcement ? 'Edit announcement' : 'New announcement'}
      footer={
        <>
          <Button variant="ghost" onClick={() => save('draft')} loading={busy === 'draft'}>
            Save draft
          </Button>
          {mode === 'schedule' ? (
            <Button icon={<CalendarClock className="size-4" aria-hidden />} onClick={() => save('schedule')} loading={busy === 'schedule'}>
              Schedule
            </Button>
          ) : (
            <Button icon={<Send className="size-4" aria-hidden />} onClick={async () => (await form.trigger()) && setConfirmSend(true)}>
              Send now
            </Button>
          )}
        </>
      }
    >
      <form noValidate className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        <TextField label="Title" required {...form.register('title')} error={form.formState.errors.title?.message} />
        <TextArea label="Message" required rows={5} {...form.register('body')} error={form.formState.errors.body?.message} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Audience"
            options={Object.entries(ANNOUNCEMENT_AUDIENCE_LABEL).map(([value, label]) => ({ value, label }))}
            hint={count.data !== undefined ? `${count.data} active recipients` : 'Counting…'}
            {...form.register('audience')}
          />
          <SelectField
            label="Delivery"
            options={[
              { value: 'now', label: 'Send immediately' },
              { value: 'schedule', label: 'Schedule for later' },
            ]}
            {...form.register('sendMode')}
          />
        </div>
        {mode === 'schedule' && (
          <TextField label="Send at" type="datetime-local" required {...form.register('scheduledAt')} error={form.formState.errors.scheduledAt?.message} />
        )}
      </form>
      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        title={`Send to ${count.data ?? 0} recipients?`}
        description="Sent announcements can’t be edited, recalled or deleted."
        confirmLabel="Send announcement"
        busy={busy === 'send'}
        onConfirm={() => void save('send')}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Policies (dual approval)                                            */
/* ------------------------------------------------------------------ */

const policyTone = { pending_approval: 'warning', approved: 'info', published: 'success', archived: 'neutral' } as const;

export function PoliciesView() {
  const services = useServices();
  const toast = useToast();
  const { session } = useSession();
  const list = useAsync(() => services.admin.listPolicies(), []);
  const [type, setType] = useState<PolicyType>('tos');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ policy: Policy; kind: 'approve' | 'publish' } | null>(null);
  const me = session?.user.id ?? '';
  const items = (list.data ?? []).filter((p) => p.type === type);

  const act = async (p: Policy, kind: 'approve' | 'publish') => {
    setBusy(p.id + kind);
    try {
      if (kind === 'approve') await services.admin.approvePolicy(p.id);
      else await services.admin.publishPolicy(p.id);
      toast.success(
        kind === 'approve' ? 'Version approved' : 'Version published',
        kind === 'publish' ? 'The previous version was archived.' : 'It can now be published.',
      );
      void list.reload();
    } catch (err) {
      toast.error('Action failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Policies"
        description="Terms of Service and Privacy Policy. A new version needs approval by a second Super Admin before it can be published."
        actions={
          <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            New version
          </Button>
        }
      />
      <Card>
        <div className="border-b border-line p-3">
          <Tabs
            label="Policy type"
            value={type}
            onChange={setType}
            items={[
              { value: 'tos', label: POLICY_TYPE_LABEL.tos },
              { value: 'privacy', label: POLICY_TYPE_LABEL.privacy },
            ]}
          />
        </div>
        {list.loading ? (
          <SkeletonRows rows={3} />
        ) : items.length === 0 ? (
          <EmptyState icon={<FileText className="size-6" aria-hidden />} title="No versions yet" />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((p) => {
              const mine = p.submittedBy === me;
              return (
                <li key={p.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 font-semibold">
                        Version {p.version} <Badge tone={policyTone[p.status]}>{POLICY_STATUS_LABEL[p.status]}</Badge>
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-ink-muted">
                        Effective {formatDate(p.effectiveDate)} · submitted by {p.submittedByName}
                        {p.approvedByName && ` · approved by ${p.approvedByName}`}
                        {p.publishedAt && ` · published ${formatDate(p.publishedAt)}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {p.status === 'pending_approval' && (
                        <Button
                          size="sm"
                          variant="brand"
                          icon={<CheckCircle2 className="size-4" aria-hidden />}
                          disabled={!canApprovePolicy(me, p.submittedBy)}
                          title={mine ? 'A different Super Admin must approve your submission' : undefined}
                          loading={busy === p.id + 'approve'}
                          onClick={() => setConfirm({ policy: p, kind: 'approve' })}
                        >
                          Approve
                        </Button>
                      )}
                      {p.status === 'approved' && (
                        <Button size="sm" loading={busy === p.id + 'publish'} onClick={() => setConfirm({ policy: p, kind: 'publish' })}>
                          Publish
                        </Button>
                      )}
                    </div>
                  </div>
                  {p.status === 'pending_approval' && mine && (
                    <p className="mt-2 text-[12.5px] text-amber-800">You submitted this version, so another Super Admin must approve it.</p>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] font-semibold text-brand-700">Read text</summary>
                    <p className={cn('mt-2 max-h-64 overflow-y-auto whitespace-pre-line rounded-lg bg-canvas p-3 text-[13px] text-ink-muted')}>{p.content}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {open && <PolicyModal type={type} onClose={() => setOpen(false)} onSaved={() => void list.reload()} />}
      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        busy={Boolean(busy)}
        title={
          confirm?.kind === 'publish'
            ? `Publish ${POLICY_TYPE_LABEL[confirm.policy.type]} v${confirm.policy.version}?`
            : `Approve ${confirm ? POLICY_TYPE_LABEL[confirm.policy.type] : ''} v${confirm?.policy.version ?? ''}?`
        }
        description={
          confirm?.kind === 'publish'
            ? 'It replaces the current published version for every customer and merchant. The previous version is archived.'
            : `Submitted by ${confirm?.policy.submittedByName}. Your approval is recorded in the audit log.`
        }
        confirmLabel={confirm?.kind === 'publish' ? 'Publish' : 'Approve'}
        tone="brand"
        onConfirm={async () => {
          if (confirm) await act(confirm.policy, confirm.kind);
          setConfirm(null);
        }}
      />
    </>
  );
}

function PolicyModal({ type, onClose, onSaved }: { type: PolicyType; onClose: () => void; onSaved: () => void }) {
  const services = useServices();
  const toast = useToast();
  const form = useZodForm(policySchema, { type, version: '', effectiveDate: '', content: '' });
  const submit = form.handleSubmit(async (v) => {
    try {
      await services.admin.submitPolicy(v);
      toast.success('Submitted for approval', 'Another Super Admin has been notified.');
      onSaved();
      onClose();
    } catch (err) {
      if (!applyServerErrors(form, err)) toast.error('Couldn’t submit', errorMessage(err));
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      busy={form.formState.isSubmitting}
      title="Submit a new policy version"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={form.formState.isSubmitting}>
            Submit for approval
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SelectField
          label="Policy"
          options={[
            { value: 'tos', label: POLICY_TYPE_LABEL.tos },
            { value: 'privacy', label: POLICY_TYPE_LABEL.privacy },
          ]}
          {...form.register('type')}
        />
        <TextField label="Version" placeholder="1.2" required {...form.register('version')} error={form.formState.errors.version?.message} />
        <TextField label="Effective date" type="date" required {...form.register('effectiveDate')} error={form.formState.errors.effectiveDate?.message} />
        <TextArea
          label="Policy text"
          required
          rows={10}
          containerClassName="sm:col-span-3"
          {...form.register('content')}
          error={form.formState.errors.content?.message}
        />
      </form>
    </Modal>
  );
}
