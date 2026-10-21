/** Shared mutable auth for the harness: the engine bearer and the signed-in portal session. */
export const auth: { bearer: string | null; session: Record<string, unknown> | null } = { bearer: null, session: null };
