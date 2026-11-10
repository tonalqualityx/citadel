import * as React from 'react';

/** One plain line about the machine (offline, paused, signed out). Muted gold, never red, never a spinner. */
export function WorkerNotice({ text }: { text: string }) {
  return (
    <p
      role="status"
      data-testid="worker-notice"
      className="home-small"
      style={{ border: '1px solid var(--warning-line)', background: 'var(--warning-subtle)', color: 'var(--warning)', borderRadius: 8, padding: '8px 10px' }}
    >
      {text}
    </p>
  );
}
