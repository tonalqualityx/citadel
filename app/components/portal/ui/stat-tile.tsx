import { ArrowDown, ArrowUp, CircleCheck } from 'lucide-react';
import { SiteMark } from './site-mark';
import { Sparkline } from './sparkline';

// A site's month. The change is plain words and an arrow: up in done green, down in neutral ink.
// Never red, so a quiet month is information and not an alarm.
export function StatTile({
  site, value, label, delta, series, uptime,
}: {
  site: string;
  value: number;
  label: string;
  delta?: { pct: number; vs: string } | null;
  series?: number[];
  uptime?: { pct: number; note?: string | null } | null;
}) {
  const up = delta ? delta.pct >= 0 : false;
  return (
    <div className="stat">
      <SiteMark name={site} />
      <span className="val">{value.toLocaleString('en-US')}</span>
      <span className="lbl">{label}</span>
      {delta && delta.pct !== 0 ? (
        <span className={`delta${up ? ' up' : ''}`}>
          {up ? <ArrowUp className="i" aria-hidden="true" focusable="false" /> : <ArrowDown className="i" aria-hidden="true" focusable="false" />}
          {up ? 'Up' : 'Down'} {Math.abs(Math.round(delta.pct))}% on {delta.vs}
        </span>
      ) : null}
      {series && series.length > 1 ? <Sparkline series={series} label={`${label} over the last 30 days, ${value.toLocaleString('en-US')} in total`} /> : null}
      {uptime ? (
        <div className="foot">
          <span>
            <CircleCheck className="i" aria-hidden="true" focusable="false" />
            {uptime.note ?? `Up all month ${uptime.pct}%`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
