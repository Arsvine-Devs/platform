'use client';

import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@ui-sdk/react/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@ui-sdk/react/select';
import { ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import type { WebBuild, WebEnvironment } from '@/lib/web-ops';
import styles from './operations.module.css';

export function DeployRelease({
  project,
  environment,
  hostname,
  builds,
  repository,
  liveCommit,
  csrf,
  running,
}: {
  project: string;
  environment: WebEnvironment;
  hostname: string;
  builds: WebBuild[];
  repository: string;
  liveCommit?: string;
  csrf: string;
  running: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const build = builds.find(({ runId }) => String(runId) === selected);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => router.refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [router, running]);

  async function deploy() {
    if (!build) return;
    setNotice('');
    try {
      const response = await fetch('/api/web/deployments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ project, environment, runId: build.runId, commit: build.commit }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNotice(payload.error ?? 'The deployment request failed.');
        return;
      }
      setOpen(false);
      setNotice('Deployment queued. Progress appears in the deployment history.');
      router.refresh();
    } catch {
      setNotice('Connection interrupted. Check the deployment history before retrying.');
    }
  }

  if (!builds.length) {
    return (
      <p className={styles.subtle}>No eligible builds. Run the Web builds workflow in GitHub.</p>
    );
  }

  return (
    <div className={styles.card}>
      <Select
        value={selected}
        onValueChange={(value) => setSelected(typeof value === 'string' ? value : null)}
        placeholder="Choose a successful build"
      >
        <SelectLabel>Build</SelectLabel>
        <SelectTrigger className={styles.selectTrigger}>
          <SelectValue>
            {build ? `${build.branch} · ${build.commit.slice(0, 8)}` : 'Choose a successful build'}
          </SelectValue>
          <ChevronDown aria-hidden="true" size={16} />
        </SelectTrigger>
        <SelectContent className={styles.selectPopup}>
          {builds.map((item) => (
            <SelectItem key={item.runId} value={String(item.runId)} className={styles.selectItem}>
              {item.branch} · {item.commit.slice(0, 8)} · #{item.runId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className={styles.actions}>
        {environment === 'preview' ? (
          <Button className="min-h-11" disabled={!build || running} onClick={deploy}>
            Deploy preview
          </Button>
        ) : (
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger
              className={buttonVariants({ className: 'min-h-11' })}
              disabled={!build || running}
            >
              Deploy to production
            </AlertDialogTrigger>
            <AlertDialogBackdrop className={styles.backdrop} />
            <AlertDialogContent className={styles.dialog}>
              <AlertDialogTitle className="text-lg font-semibold">
                Deploy to production?
              </AlertDialogTitle>
              <AlertDialogDescription className={styles.subtle}>
                Publish commit {build?.commit.slice(0, 8)} to {hostname}.
              </AlertDialogDescription>
              <div className={styles.actions}>
                <AlertDialogClose
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                >
                  Cancel
                </AlertDialogClose>
                <Button className="min-h-11" onClick={deploy}>
                  Deploy
                </Button>
              </div>
              {open && <p role="status">{notice}</p>}
            </AlertDialogContent>
          </AlertDialog>
        )}
        {build && (
          <a className={styles.actionLink} href={build.url}>
            View build
          </a>
        )}
        {build && liveCommit && liveCommit !== build.commit && (
          <a
            className={styles.actionLink}
            href={`https://github.com/${repository}/compare/${liveCommit}...${build.commit}`}
          >
            Compare to live
          </a>
        )}
      </div>
      {!open && <p role="status">{notice}</p>}
    </div>
  );
}
