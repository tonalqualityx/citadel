// Four segments and one sentence: where the person is in the request. The sentence carries the
// meaning; the bar is decoration for people who can see it.
const SEGMENTS = ['What you need', 'Which site', 'Details', 'Check and send'] as const;

export function StepMeter({
  stage,
  question,
  total = 3,
  sent = false,
}: {
  stage: 0 | 1 | 2 | 3;
  question?: number;
  total?: number;
  sent?: boolean;
}) {
  let say: string;
  if (sent) say = 'Sent. All four steps done.';
  else if (stage === 2) say = question ? `Step 3 of 4: details, question ${question} of ${total}.` : 'Step 3 of 4: details.';
  else if (stage === 3) say = 'Step 4 of 4: check your request and send it.';
  else say = `Step ${stage + 1} of 4.`;

  const fill = stage === 2 && question && total > 0 ? Math.round(((question - 1) / total) * 100) : 0;

  return (
    <div className="steps" role="group" aria-label="Progress">
      <ol>
        {SEGMENTS.map((s, i) => {
          const done = sent || i < stage;
          const now = !sent && i === stage;
          return (
            <li
              key={s}
              className={done ? 'done' : now ? 'now' : undefined}
              aria-current={now ? 'step' : undefined}
              style={now && i === 2 ? ({ '--p': `${fill}%` } as React.CSSProperties) : undefined}
            >
              <i aria-hidden="true" />
              <span>{s}</span>
            </li>
          );
        })}
      </ol>
      <p className="say">{say}</p>
    </div>
  );
}
