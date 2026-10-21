'use client';

import { useEffect, useRef, useState } from 'react';
import { CALENDLY_SCRIPT_URL, CALENDLY_STYLE_URL, SUPPORT_EMAIL, embedUrl, type MeetingType } from '@/lib/portal/booking';

type EmbedState = 'idle' | 'loading' | 'ready' | 'blocked';

/**
 * Meeting type picker and Calendly inline embed (portal MVP A5).
 * The script loads only from assets.calendly.com. If it cannot load (blocked by a content
 * security policy, an ad blocker or the network) the page shows a plain link instead.
 */
export function BookingPicker({ types }: { types: MeetingType[] }) {
  const [selected, setSelected] = useState<MeetingType['key'] | null>(null);
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
    <div className="bg-surface rounded-lg border border-border p-6">
      <h2 className="text-2xl font-bold text-text-main mb-1">Book a meeting</h2>
      <p className="text-sm text-text-tertiary mb-4">What would you like to talk about?</p>

      <div role="radiogroup" aria-label="Meeting type" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {types.map((t) => {
          const active = t.key === selected;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setSelected(t.key)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                active ? 'border-brand-primary bg-surface-secondary' : 'border-border hover:border-text-tertiary'
              }`}
            >
              <span className="block font-medium text-text-main">{t.label}</span>
              <span className="mt-1 block text-xs text-text-tertiary">{t.description}</span>
            </button>
          );
        })}
      </div>

      {current && !url && (
        <p className="mt-6 text-sm text-text-secondary">
          Online booking for this kind of meeting is not ready yet. Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-primary hover:underline">
            {SUPPORT_EMAIL}
          </a>{' '}
          and we will find a time.
        </p>
      )}

      {current && url && (
        <div className="mt-6">
          {embed === 'blocked' ? (
            <p className="text-sm text-text-secondary">
              The scheduler could not load here.{' '}
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                Open the booking page
              </a>
              .
            </p>
          ) : (
            <>
              {embed === 'loading' && <p className="text-sm text-text-tertiary">Loading the scheduler…</p>}
              {embed === 'ready' && (
                <div ref={container} style={{ minWidth: '320px', height: '700px' }} />
              )}
              <p className="mt-3 text-xs text-text-tertiary">
                Prefer a plain page?{' '}
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                  Open the booking page
                </a>
                .
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
