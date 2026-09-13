'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Link as LinkIcon, Plus, UserRoundX } from 'lucide-react';
import { toast } from 'sonner';

import { adminRequest, isAdminApiError } from '@/lib/admin-api/client';
import type { Invitation, InviteData, Member, MembersData } from '@/lib/admin-api/contracts';
import { ConfirmAction, EmptyState, PageFrame, PageHeader } from '@/components/admin/blocks';
import { useI18n } from '@/components/i18n/locale-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function memberRole(role: Member['role'], t: Translate) {
  return role === 'owner' ? t('members.owner') : t('members.editor');
}

function memberStatus(status: Member['status'], t: Translate) {
  return status === 'active' ? t('members.active') : status === 'pending' ? t('members.pending') : t('members.disabled');
}

export default function MembersPageClient({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const { t } = useI18n();
  const [data, setData] = useState<MembersData>({ members: [], invitations: [] });
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const [createdLink, setCreatedLink] = useState<InviteData | null>(null);
  const [inviting, setInviting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{ member: Member; status: 'active' | 'disabled' } | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await adminRequest<MembersData>('/api/admin/members'));
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('members.loadError'));
    }
  }, [router, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('members.copied'));
    } catch {
      toast.error(t('members.copyFailed'));
    }
  }

  async function invite() {
    setInviting(true);
    try {
      const result = await adminRequest<InviteData>('/api/admin/members', { method: 'POST', csrfToken, body: { email } });
      setCreatedLink(result);
      setEmail('');
      await load();
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('members.createError'));
    } finally {
      setInviting(false);
    }
  }

  async function revokeInvitation(invitation: Invitation) {
    try {
      await adminRequest<void>(`/api/admin/members/invitations/${invitation.id}`, { method: 'DELETE', csrfToken });
      toast.success(t('members.invitationRevoked'));
      await load();
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('members.revokeError'));
    }
  }

  async function setStatus() {
    if (!pendingStatus) return;
    const { member, status } = pendingStatus;
    setPendingStatus(null);
    setChangingStatus(true);
    try {
      await adminRequest<void>(`/api/admin/members/${member.id}`, { method: 'PATCH', csrfToken, body: { status } });
      toast.success(status === 'disabled' ? t('members.disabledSuccess') : t('members.enabledSuccess'));
      await load();
    } catch (caught) {
      if (isAdminApiError(caught) && (caught.status === 401 || caught.status === 403)) router.push('/login');
      else toast.error(caught instanceof Error ? caught.message : t('members.statusError'));
    } finally {
      setChangingStatus(false);
    }
  }

  const statusDescription = pendingStatus?.status === 'disabled' ? t('members.disableDescription', { email: pendingStatus.member.email }) : pendingStatus ? t('members.enableDescription', { email: pendingStatus.member.email }) : '';

  return (
    <PageFrame size="wide">
      <PageHeader title={t('members.title')} description={t('members.description')} actions={<Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCreatedLink(null); }}><DialogTrigger render={<Button className="min-h-11"><Plus data-icon="inline-start" />{t('members.invite')}</Button>} /><DialogContent><DialogHeader><DialogTitle>{createdLink ? t('members.invitationCreated') : t('members.inviteDialog')}</DialogTitle><DialogDescription>{createdLink ? t('members.invitationCreatedDescription', { date: formatDate(createdLink.expiresAt) }) : t('members.inviteDialogDescription')}</DialogDescription></DialogHeader>{createdLink ? <div className="flex gap-2"><Input value={createdLink.invitationUrl} readOnly aria-label={t('members.invitationLink')} /><Button type="button" variant="outline" className="min-h-11 shrink-0" aria-label={t('members.copy')} onClick={() => void copy(createdLink.invitationUrl)}><Copy /></Button></div> : <FieldGroup><Field><FieldLabel htmlFor="member-email">{t('members.email')}</FieldLabel><Input id="member-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field></FieldGroup>}<DialogFooter>{createdLink ? <Button className="min-h-11" onClick={() => setOpen(false)}>{t('members.invitationDone')}</Button> : <Button className="min-h-11" onClick={() => void invite()} disabled={inviting || !email}>{inviting ? t('members.creating') : <><LinkIcon data-icon="inline-start" />{t('members.createInvitation')}</>}</Button>}</DialogFooter></DialogContent></Dialog>} />

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"><div className="mb-4"><h2 className="font-heading text-base font-semibold">{t('members.pendingTitle')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('members.pendingDescription')}</p></div>{data.invitations.length === 0 ? <EmptyState title={t('members.noInvites')} className="min-h-28" /> : <><div className="hidden overflow-x-auto sm:block"><Table><TableHeader><TableRow><TableHead>{t('members.email')}</TableHead><TableHead>{t('members.expires')}</TableHead><TableHead><span className="sr-only">{t('common.actions')}</span></TableHead></TableRow></TableHeader><TableBody>{data.invitations.map((invitation) => <TableRow key={invitation.id}><TableCell>{invitation.email}</TableCell><TableCell className="font-mono text-xs text-muted-foreground">{formatDate(invitation.expiresAt)}</TableCell><TableCell className="text-right"><Button type="button" variant="outline" className="min-h-10" onClick={() => void revokeInvitation(invitation)}>{t('members.revokeInvitation')}</Button></TableCell></TableRow>)}</TableBody></Table></div><div className="grid gap-2 sm:hidden">{data.invitations.map((invitation) => <div key={invitation.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{invitation.email}</p><p className="mt-1 text-xs text-muted-foreground">{t('members.expires')} {formatDate(invitation.expiresAt)}</p></div><Button type="button" variant="outline" className="min-h-10 shrink-0" onClick={() => void revokeInvitation(invitation)}>{t('members.revokeInvitation')}</Button></div>)}</div></>}</section>

      <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6"><div className="mb-4"><h2 className="font-heading text-base font-semibold">{t('members.accountsTitle')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('members.accountsDescription')}</p></div><div className="hidden overflow-x-auto sm:block"><Table><TableHeader><TableRow><TableHead>{t('members.email')}</TableHead><TableHead>{t('members.role')}</TableHead><TableHead>{t('members.status')}</TableHead><TableHead>{t('members.joined')}</TableHead><TableHead><span className="sr-only">{t('common.actions')}</span></TableHead></TableRow></TableHeader><TableBody>{data.members.map((member) => <MemberRow key={member.id} member={member} onStatusChange={(status) => setPendingStatus({ member, status })} />)}</TableBody></Table></div><div className="grid gap-2 sm:hidden">{data.members.map((member) => <article key={member.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{member.email}</p><p className="mt-1 text-xs text-muted-foreground">{memberRole(member.role, t)} · {t('members.joinedOn', { date: formatDate(member.createdAt) })}</p></div><Badge variant={member.status === 'active' ? 'secondary' : 'outline'}>{memberStatus(member.status, t)}</Badge></div>{member.role === 'editor' ? <Button type="button" variant={member.status === 'disabled' ? 'outline' : 'destructive'} className="mt-4 min-h-10 w-full" onClick={() => setPendingStatus({ member, status: member.status === 'disabled' ? 'active' : 'disabled' })}>{member.status === 'disabled' ? t('members.enable') : <><UserRoundX data-icon="inline-start" />{t('members.disable')}</>}</Button> : <p className="mt-4 text-xs text-muted-foreground">{t('members.ownerProtected')}</p>}</article>)}</div></section>

      <ConfirmAction open={pendingStatus !== null} onOpenChange={(next) => { if (!next) setPendingStatus(null); }} title={pendingStatus?.status === 'disabled' ? t('members.disableTitle') : t('members.enableTitle')} description={statusDescription} confirmLabel={pendingStatus?.status === 'disabled' ? t('members.disable') : t('members.enable')} destructive={pendingStatus?.status === 'disabled'} busy={changingStatus} onConfirm={() => void setStatus()} />
    </PageFrame>
  );
}

function MemberRow({ member, onStatusChange }: { member: Member; onStatusChange: (status: 'active' | 'disabled') => void }) {
  const { t } = useI18n();
  return <TableRow><TableCell className="font-medium">{member.email}</TableCell><TableCell>{memberRole(member.role, t)}</TableCell><TableCell><Badge variant={member.status === 'active' ? 'secondary' : 'outline'}>{memberStatus(member.status, t)}</Badge></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{formatDate(member.createdAt)}</TableCell><TableCell className="text-right">{member.role === 'editor' ? <Button type="button" size="sm" className="min-h-10" variant={member.status === 'disabled' ? 'outline' : 'destructive'} onClick={() => onStatusChange(member.status === 'disabled' ? 'active' : 'disabled')}>{member.status === 'disabled' ? t('members.enable') : <><UserRoundX data-icon="inline-start" />{t('members.disable')}</>}</Button> : <span className="text-xs text-muted-foreground">{t('members.protected')}</span>}</TableCell></TableRow>;
}
