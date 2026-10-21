import { describe, it, expect } from 'vitest';
import { actionSchema, resultSchema } from '@/lib/portal/chat/result';
import { GATED_FIELDS, ID_VALIDATED_FIELDS, INTERNAL_ONLY_FIELDS } from '@/lib/portal/chat/apply';

/* eslint-disable @typescript-eslint/no-explicit-any */
function unwrap(t: any): any {
  let cur = t;
  for (let i = 0; i < 6; i++) {
    const def = cur?._zod?.def ?? cur?.def;
    if (def?.type === 'optional' || def?.type === 'nullable' || def?.type === 'default') cur = def.innerType;
    else break;
  }
  return cur;
}
const kind = (t: any) => (unwrap(t)?._zod?.def ?? unwrap(t)?.def)?.type as string;

/** Every free-string field of the contract: "{action type}.{field}", "reply", "sources.{field}". */
function stringFields(): string[] {
  const out: string[] = [];
  const walk = (prefix: string, shape: Record<string, any>) => {
    for (const [name, raw] of Object.entries(shape)) {
      const t = unwrap(raw);
      const k = kind(t);
      const path = prefix ? `${prefix}.${name}` : name;
      if (k === 'string') out.push(path);
      else if (k === 'array') {
        const el = unwrap((t._zod?.def ?? t.def).element);
        if (kind(el) === 'string') out.push(path);
        else if (kind(el) === 'object') walk(path, el.shape);
      }
    }
  };
  for (const opt of (actionSchema as any).options as any[]) {
    const shape = opt.shape as Record<string, any>;
    const type = (shape.type._zod?.def ?? shape.type.def).values?.[0] ?? 'action';
    const { type: _t, ...rest } = shape;
    void _t;
    walk(String(type), rest);
  }
  walk('', (resultSchema as any).def?.innerType?.shape ?? (resultSchema as any)._zod?.def?.shape ?? (resultSchema as any).shape ?? {});
  return out;
}

describe('every model-written string is gated or explicitly exempt', () => {
  const fields = stringFields();
  const covered = new Set([...Object.keys(GATED_FIELDS), ...ID_VALIDATED_FIELDS, ...INTERNAL_ONLY_FIELDS]);

  it('finds the fields (guards against the walker going blind)', () => {
    expect(fields.length).toBeGreaterThan(15);
    for (const must of ['reply', 'ask.question', 'propose_summary.change', 'record.change', 'hand_to_person.draft_reply', 'report_injection.excerpt', 'sources.label']) {
      expect(fields).toContain(must);
    }
  });

  it('puts each string field in the gated list, the id-validated list or the internal-only list', () => {
    const unlisted = fields.filter((f) => !covered.has(f));
    expect(unlisted, `ungated, unlisted string fields: ${unlisted.join(', ')}`).toEqual([]);
  });

  it('lists no field twice and none that the schema does not have', () => {
    const all = [...Object.keys(GATED_FIELDS), ...ID_VALIDATED_FIELDS, ...INTERNAL_ONLY_FIELDS];
    expect(new Set(all).size).toBe(all.length);
    for (const f of all) expect(fields, f).toContain(f);
  });

  it('gates every field a client can see: summary parts, the recorded change and the page and section words', () => {
    for (const f of ['reply', 'ask.question', 'propose_summary.summary', 'propose_summary.change', 'propose_summary.section', 'record.change', 'record.page_text', 'record.section_text']) {
      expect(GATED_FIELDS[f], f).toBeTruthy();
    }
  });
});
