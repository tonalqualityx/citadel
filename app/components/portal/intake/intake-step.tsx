'use client';

import { useId, useState } from 'react';
import { ChoiceList, type ChoiceOption } from './choice-list';
import { ANSWER_MAX, BUTTONS } from '@/lib/portal/intake/tree';

// One prompt as a fieldset and legend. Either a choice list (with an optional follow-up text for
// the picked choice) or a free-text box. Optional questions offer Skip. Back is the chat's job.
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
  const [value, setValue] = useState(initial?.value ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form onSubmit={submit} noValidate>
      <fieldset className="space-y-3">
        <legend className="text-lg font-semibold text-text-main">{step.prompt}</legend>
        {step.choices ? (
          <ChoiceList name={`${uid}-choice`} options={step.choices} value={value || null} onChange={(k) => { setValue(k); setError(null); }} />
        ) : (
          <>
            <label htmlFor={`${uid}-text`} className="sr-only">
              {step.prompt}
            </label>
            <textarea
              id={`${uid}-text`}
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              rows={4}
              maxLength={ANSWER_MAX}
              aria-required={step.required}
              aria-describedby={error ? `${uid}-err` : undefined}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </>
        )}
        {followUp && (
          <div className="space-y-1">
            <label htmlFor={`${uid}-detail`} className="block text-sm font-medium text-text-main">
              {followUp.prompt}
            </label>
            <textarea
              id={`${uid}-detail`}
              value={detail}
              onChange={(e) => { setDetail(e.target.value); setError(null); }}
              rows={3}
              maxLength={ANSWER_MAX}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text-main focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        )}
      </fieldset>
      {error && (
        <p id={`${uid}-err`} role="alert" className="mt-2 text-sm text-status-error">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="min-h-[44px] rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {nextLabel}
        </button>
        {!step.required && (
          <button
            type="button"
            onClick={() => onSubmit({ value: '' })}
            className="min-h-[44px] rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {BUTTONS.skip}
          </button>
        )}
        {canGoBack && (
          <button type="button" onClick={onBack} className="min-h-[44px] px-2 text-sm text-text-secondary underline">
            {BUTTONS.back}
          </button>
        )}
      </div>
    </form>
  );
}
