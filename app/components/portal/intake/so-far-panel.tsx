import { MessageSquare, FileText } from 'lucide-react';

export interface SoFarRow {
  label: string;
  value: string;
}

// "Your request so far": the answers as key and value rows, then where the request goes. On
// desktop it is a panel beside the chat; on phones it is a details block above the log.
export function SoFarPanel({
  mode,
  rows,
  destination,
}: {
  mode: 'desk' | 'phone';
  rows: SoFarRow[];
  destination: string | null;
}) {
  const list =
    rows.length > 0 ? (
      rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))
    ) : (
      <div>
        <dd>Nothing yet.</dd>
      </div>
    );

  if (mode === 'phone') {
    return (
      <details className="sofar-phone">
        <summary>
          <FileText className="i" aria-hidden="true" focusable="false" />
          <span>{`Your request so far (${rows.length} ${rows.length === 1 ? 'answer' : 'answers'})`}</span>
        </summary>
        <dl className="kv" style={{ paddingTop: 6 }}>
          {list}
        </dl>
        {destination ? <p className="meta">{destination}</p> : null}
      </details>
    );
  }
  return (
    <aside className="sofar desk" aria-labelledby="sofar-h">
      <h2 id="sofar-h">Your request so far</h2>
      <dl>{list}</dl>
      {destination ? (
        <p className="dest">
          <MessageSquare className="i" aria-hidden="true" focusable="false" />
          <span>{destination}</span>
        </p>
      ) : null}
    </aside>
  );
}
