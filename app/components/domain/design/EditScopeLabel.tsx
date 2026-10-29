// "This instance" or "Component: N places": whether a change touched one occurrence or the library component.
export function editScopeText(scope: string | null | undefined, renderCount: number | null | undefined): string | null {
  if (scope === 'instance') return 'This instance';
  if (scope === 'component') {
    return typeof renderCount === 'number' && renderCount > 0 ? `Component: ${renderCount} ${renderCount === 1 ? 'place' : 'places'}` : 'Component';
  }
  return null;
}

export function EditScopeLabel({ scope, renderCount }: { scope?: string | null; renderCount?: number | null }) {
  const text = editScopeText(scope, renderCount);
  if (!text) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-border-warm px-2 py-0.5 text-xs text-text-sub" data-testid="edit-scope">
      {text}
    </span>
  );
}
