'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { IntakeChat } from '@/components/portal/intake/intake-chat';
import { PageHeader } from '@/components/portal/ui/page-header';
import { Callout } from '@/components/portal/ui/callout';
import { Skeleton, SkeletonRegion } from '@/components/portal/ui/skeleton';
import { NO_PERMISSION_MESSAGE } from '@/lib/portal/intake/tree';
import { ChatView } from './chat-view';
import { RateLimited, type ChatSource, type StartResult } from './use-chat';

// Request work. The chat when GET /api/portal/intake/context says chat.available (and the first
// message does not come back 409 chat_unavailable), else the phase B stepper, unchanged.
const KEY = 'portal-chat-resume';
interface Resume {
  intakeId: string;
  conversationId: string | null;
}

function readResume(): Resume | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Resume) : null;
  } catch {
    return null;
  }
}
function writeResume(r: Resume | null) {
  try {
    if (r) window.sessionStorage.setItem(KEY, JSON.stringify(r));
    else window.sessionStorage.removeItem(KEY);
  } catch {
    /* sessionStorage can be blocked; the chat works without it */
  }
}

const CHAT_LEDE = 'Tell us what you need. The assistant asks a few quick questions so the team has everything, then you check it and send.';
const STEPPER_LEDE = 'A few short questions, then you check it and send. Nothing reaches the team until you press Send request.';

export function RequestEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<'loading' | 'chat' | 'stepper' | 'error' | 'no_permission'>('loading');
  const [resume, setResume] = useState<Resume | null>(null);
  const [carried, setCarried] = useState<{ text: string; files: number } | null>(null);
  const siteRef = useRef<string | null>(null);
  const filedRef = useRef(false);

  // A fresh request: forget the saved chat and remount the chat under a new intake id.
  const startFresh = useCallback(() => {
    filedRef.current = false;
    writeResume(null);
    setResume({ intakeId: crypto.randomUUID(), conversationId: null });
  }, []);

  // "Request work" while a filed request is still on screen starts a new one (same URL, so no remount).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href="/portal/requests/new"]');
      if (a && filedRef.current) startFresh();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [startFresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/portal/intake/context');
        if (res.status === 401) return router.replace('/portal/login');
        if (!res.ok) return !cancelled && setMode('error');
        const ctx = (await res.json()) as { can_request: boolean; sites: Array<{ id: string }>; chat?: { available: boolean } };
        if (cancelled) return;
        if (ctx.can_request && ctx.chat?.available) {
          const wanted = new URLSearchParams(window.location.search).get('site_id');
          const chosen = wanted && ctx.sites.some((s) => s.id === wanted) ? wanted : ctx.sites.length === 1 ? ctx.sites[0].id : null;
          siteRef.current = chosen;
          // A saved chat is resumed only while it is still being clarified; a filed, closed or missing one starts fresh.
          let r = readResume();
          if (r?.conversationId) {
            try {
              const v = await fetch(`/api/portal/chat/${r.conversationId}`);
              const body = v.ok ? ((await v.json()) as { state?: string }) : null;
              if (!body || !['clarifying', 'confirming'].includes(body.state ?? '')) r = null;
            } catch {
              r = null;
            }
          }
          if (cancelled) return;
          setResume(r && r.intakeId ? r : { intakeId: crypto.randomUUID(), conversationId: null });
          setMode('chat');
        } else setMode(ctx.can_request ? 'stepper' : 'no_permission');
      } catch {
        if (!cancelled) setMode('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (mode === 'chat' && resume) writeResume(resume);
  }, [mode, resume]);

  const header = (lede: string) => (
    <PageHeader eyebrow={['Requests', 'New request']} title="Ask us for something" size="page" lede={lede} motif="contours" />
  );

  if (mode === 'loading') {
    return (
      <>
        {header(STEPPER_LEDE)}
        <SkeletonRegion label="Loading the request chat">
          <div className="chatcard">
            <Skeleton lines={2} block />
          </div>
        </SkeletonRegion>
      </>
    );
  }
  if (mode === 'error') {
    return (
      <>
        {header(STEPPER_LEDE)}
        <Callout tone="urgent" icon={TriangleAlert} title="We could not load this page" id="intake-load">
          <p>We could not load this page. Please try again.</p>
        </Callout>
      </>
    );
  }
  if (mode === 'no_permission') {
    return (
      <>
        {header(STEPPER_LEDE)}
        <div className="card">
          <p>{NO_PERMISSION_MESSAGE}</p>
        </div>
      </>
    );
  }
  if (mode === 'stepper') {
    return (
      <>
        {header(STEPPER_LEDE)}
        <IntakeChat initialText={carried?.text} carriedFiles={carried?.files} />
      </>
    );
  }

  const source: ChatSource = {
    conversationId: resume?.conversationId ?? null,
    onAuthLost: () => router.replace('/portal/login'),
    onFiled: () => {
      filedRef.current = true;
      writeResume(null);
    },
    onUnavailable: ({ text, attachmentIds }) => {
      writeResume(null);
      setCarried({ text, files: attachmentIds.length });
      setMode('stepper');
    },
    onOpened: (id) => setResume((r) => (r ? { ...r, conversationId: id } : r)),
    start: async ({ text, attachmentIds, clientRef }): Promise<StartResult> => {
      const res = await fetch('/api/portal/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intake_id: resume?.intakeId,
          client_ref: clientRef,
          text,
          ...(siteRef.current ? { site_id: siteRef.current } : {}),
          attachment_ids: attachmentIds,
        }),
      });
      if (res.status === 401) {
        router.replace('/portal/login');
        throw new Error('auth');
      }
      if (res.status === 409) {
        const b = (await res.json().catch(() => ({}))) as { code?: string };
        if (b.code === 'chat_unavailable') return { unavailable: true };
      }
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (b.code === 'rate_limited' && b.error) throw new RateLimited(b.error);
        console.error('portal chat start failed', res.status, b.code ?? '', b.error ?? '');
        throw new Error('start failed');
      }
      const b = (await res.json()) as { conversation_id: string; task_id: string; route?: string };
      return { conversation_id: b.conversation_id, task_id: b.task_id, route: b.route };
    },
  };

  return (
    <>
      {header(CHAT_LEDE)}
      <ChatView
        key={resume?.intakeId}
        source={source}
        intakeId={resume?.intakeId}
        composerLabel="What do you need?"
        hint="Your message is saved as soon as you send it."
        emptyLine="Tell us what you would like changed, added or looked into. You can attach a photo or a file."
        viewRequestHref={(id) => `/portal/work/${id}`}
        onStartAnother={startFresh}
      />
    </>
  );
}
