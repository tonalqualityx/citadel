/**
 * API Route Registry (re-export)
 *
 * The registry has been split into domain files under ./registry/.
 * This file re-exports everything for backward compatibility.
 *
 * IMPORTANT: Update the relevant domain file in ./registry/ whenever you
 * add, modify, or remove an API endpoint.
 */

export { apiRegistry, apiEnums, apiInfo } from './registry/index';
export type { ParamDef, MethodDef, ApiEndpoint } from './registry/index';
