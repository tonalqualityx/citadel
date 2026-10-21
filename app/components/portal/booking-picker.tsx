'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ExternalLink, MessageSquareText, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/portal/ui/page-header';
import { CALENDLY_SCRIPT_URL, CALENDLY_STYLE_URL, SUPPORT_EMAIL, embedUrl, type MeetingType } from '@/lib/portal/booking';

const TYPE_ICON = { consult: CalendarDays, marketing: Sparkles, questions: MessageSquareText } as const;

type EmbedState = 'idle' | 'loading' | 'ready' | 'blocked';

/**
 * Meeting type picker and Calendly inline embed (portal MVP A5).
 * The script loads only from assets.calendly.com. If it cannot load (blocked by a content
 * security policy, an ad blocker or the network) the page shows a plain link instead.
 */
export function BookingPicker({ types, initialType = null }: { types: MeetingType[]; initialType?: MeetingType['key'] | null }) {
  const [selected, setSelected] = useState<MeetingType['key'] | null>(initialType);
  const [embed, setEmbed] = useState<EmbedState>('idle');
  const container = useRef<HTMLDivElement>(null);

  const current = types.find((t) => t.key === selected) ?? null;
  const url = current?.url ?? null;

  useEffect(() => {
    if (!url) {
      setEmbed('idle');
      return;
    }
    setEmbed('loading');
    let cancelled = false;
    const finish = () => {
      if (!cancelled) setEmbed('ready');
    };
    const fail = () => {
      if (!cancelled) setEmbed('blocked');
    };
    const win = window as unknown as { Calendly?: unknown };
    if (win.Calendly) {
      finish();
      return () => {
        cancelled = true;
      };
    }
    if (!document.querySelector(`link[href="${CALENDLY_STYLE_URL}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = CALENDLY_STYLE_URL;
      document.head.appendChild(link);
    }
    let script = document.querySelector<HTMLScriptElement>(`script[src="${CALENDLY_SCRIPT_URL}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = CALENDLY_SCRIPT_URL;
      script.async = true;
      document.body.appendChild(script);
    }
    script.addEventListener('load', finish);
    script.addEventListener('error', fail);
    // A script blocked silently never fires either event: give it ten seconds.
    const timer = window.setTimeout(() => {
      if (!(window as unknown as { Calendly?: unknown }).Calendly) fail();
    }, 10000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      script?.removeEventListener('load', finish);
      script?.removeEventListener('error', fail);
    };
  }, [url]);

  // Calendly only auto-scans at page load, so start the inline widget by hand once the script is in.
  useEffect(() => {
    if (embed !== 'ready' || !url || !container.current) return;
    const calendly = (window as unknown as {
      Calendly?: { initInlineWidget: (o: { url: string; parentElement: HTMLElement }) => void };
    }).Calendly;
    container.current.innerHTML = '';
    try {
      calendly?.initInlineWidget({ url: embedUrl(url), parentElement: container.current });
    } catch {
      setEmbed('blocked');
    }
  }, [embed, url]);

  return (
    <>
      <PageHeader
        title="Book a meeting"
        size="page"
        lede="Pick the kind of call. Each opens a calendar where you choose the time."
        motif="meadow"
      />

      <div role="radiogroup" aria-label="Meeting type" className="tiles">
        {types.map((t) => {
          const active = t.key === selected;
          const Icon = TYPE_ICON[t.key] ?? CalendarDays;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={active}
              data-selected={active ? 'true' : undefined}
              onClick={() => setSelected(t.key)}
              className="cardlink"
              style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
            >
              <span className="tile-ic" aria-hidden="true" style={{ gridRow: '1 / span 3' }}>
                <Icon className="i" focusable="false" />
              </span>
              <b>{t.label}</b>
              <small>{t.description}</small>
              <small>
                Opens the calendar{' '}
                <ExternalLink className="i" aria-hidden="true" focusable="false" style={{ width: 14, height: 14, verticalAlign: 'text-bottom' }} />
              </small>
            </button>
          );
        })}
      </div>

      {current && !url && (
        <div className="card">
          <p>
            Online booking for this kind of meeting is not ready yet. Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we will find a time.
          </p>
        </div>
      )}

      {current && url && (
        <div className="card">
          {embed === 'blocked' ? (
            <p>
              The scheduler could not load here.{' '}
              <a href={url} target="_blank" rel="noopener noreferrer">
                Open the booking page
              </a>
              .
            </p>
          ) : (
            <>
              {embed === 'loading' && <div className="skel" aria-hidden="true"><span className="skel-block" /></div>}
              {embed === 'ready' && <div ref={container} style={{ minWidth: '320px', height: '700px' }} />}
              <p>
                Prefer a plain page?{' '}
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Open the booking page
                </a>
                .
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
