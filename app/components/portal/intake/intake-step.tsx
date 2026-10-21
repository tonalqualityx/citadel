'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { ChoiceList, type ChoiceOption } from './choice-list';
import { PortalButton } from '@/components/portal/ui/button';
import { Field } from '@/components/portal/ui/field';
import { ANSWER_MAX, BUTTONS } from '@/lib/portal/intake/tree';

// One prompt's composer. Either a choice list (with an optional follow-up text for the picked
// choice) or a free-text box. Optional questions offer Skip. Back is the chat's job. The prompt
// itself is shown by the chat as Indelible's message; the text box repeats it as its label.
export interface StepAnswer {
  value: string;
  detail?: string;
}

export interface StepSpec {
  id: string;
  prompt: string;
  required: boolean;
  /** Choice questions. `followUp` is asked after a choice that has one. */
  choices?: Array<ChoiceOption & { followUp?: { prompt: string; required: boolean } }>;
}

export function IntakeStep({
  step,
  initial,
  canGoBack,
  onBack,
  onSubmit,
  nextLabel = BUTTONS.next,
}: {
  step: StepSpec;
  initial?: StepAnswer;
  canGoBack: boolean;
  onBack: () => void;
  onSubmit: (answer: StepAnswer) => void;
  nextLabel?: string;
}) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState(initial?.value ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const [error, setError] = useState<string | null>(null);

  // A new question replaces this form, so put the cursor on its first control.
  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLElement>('textarea, .choices button');
    first?.focus({ preventScroll: true });
  }, []);

  const picked = step.choices?.find((c) => c.key === value) ?? null;
  const followUp = picked?.followUp ?? null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (step.required && v === '') {
      setError('Please answer this to continue.');
      return;
    }
    if (followUp?.required && detail.trim() === '') {
      setError('Please fill in the details to continue.');
      return;
    }
    setError(null);
    onSubmit({ value: v, detail: followUp ? detail.trim() : undefined });
  }

  const errorOnMain = !step.choices && !followUp ? error : null;
  const errorOnDetail = followUp ? error : null;
  const loneError = step.choices && !followUp ? error : null;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="composer">
      {step.choices ? (
        <ChoiceList
          name={`${uid}-choice`}
          label={step.prompt}
          options={step.choices}
          value={value || null}
          onChange={(k) => {
            setValue(k);
            setError(null);
          }}
        />
      ) : (
        <Field id={`${uid}-text`} label={step.prompt} error={errorOnMain}>
          <textarea
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            rows={4}
            maxLength={ANSWER_MAX}
            aria-required={step.required}
          />
        </Field>
      )}
      {followUp && (
        <Field id={`${uid}-detail`} label={followUp.prompt} error={errorOnDetail}>
          <textarea
            value={detail}
            onChange={(e) => {
              setDetail(e.target.value);
              setError(null);
            }}
            rows={3}
            maxLength={ANSWER_MAX}
          />
        </Field>
      )}
      {loneError ? (
        <p role="alert" className="err">
          <TriangleAlert className="i" aria-hidden="true" focusable="false" />
          {loneError}
        </p>
      ) : null}
      <div className="actions">
        <PortalButton type="submit">
          {nextLabel}
        </PortalButton>
        {!step.required && (
          <PortalButton variant="secondary" onClick={() => onSubmit({ value: '' })}>
            {BUTTONS.skip}
          </PortalButton>
        )}
        {canGoBack && (
          <PortalButton variant="quiet" icon={ArrowLeft} onClick={onBack}>
            {BUTTONS.back}
          </PortalButton>
        )}
      </div>
      <p className="hint">You can change any answer before you send.</p>
    </form>
  );
}
