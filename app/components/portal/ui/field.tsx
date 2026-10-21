import { cloneElement, isValidElement } from 'react';
import { TriangleAlert } from 'lucide-react';

// A label, an optional hint, the control, and an error that is an icon plus text. The control gets
// its id, aria-invalid and aria-describedby from here.
export function Field({
  id, label, hint, error, children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactElement<Record<string, unknown>>;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        <p className="err" id={`${id}-err`} role="alert">
          <TriangleAlert className="i" aria-hidden="true" focusable="false" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
