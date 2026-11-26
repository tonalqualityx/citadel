import { cn } from '@/lib/utils/cn';
import { TONE_CLASS, type StateMarkInfo } from './format';

/**
 * The shape of a mark, drawn so every shape has the same size whatever the font (a text glyph such as the half circle
 * falls back to a smaller font on some systems). Shapes: ● on track, ◐ behind, ○ not checked, ✓ done, ■ stopped.
 */
export function MarkShape({ shape, className }: { shape: string; className?: string }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true as const, className: cn('shrink-0', className) };
  if (shape === '●') return <svg {...common}><circle cx="6" cy="6" r="5" fill="currentColor" /></svg>;
  if (shape === '◐')
    return (
      <svg {...common}>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.5 A4.5 4.5 0 0 0 6 10.5 Z" fill="currentColor" />
      </svg>
    );
  if (shape === '✓')
    return (
      <svg {...common}>
        <path d="M2 6.5 L5 9.5 L10 3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (shape === '■') return <svg {...common}><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="currentColor" /></svg>;
  return <svg {...common}><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

/** A state mark: the shape, then the word. The colour only repeats what the shape and word already say. */
export function StateMark({ mark, className }: { mark: StateMarkInfo; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-medium', TONE_CLASS[mark.tone], className)} data-testid="state-mark">
      <MarkShape shape={mark.shape} />
      <span>{mark.word}</span>
    </span>
  );
}
