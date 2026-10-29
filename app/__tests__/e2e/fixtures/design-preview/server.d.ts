export interface PreviewServer {
  port: number;
  setSha(sha: string): void;
  close(): Promise<void>;
}
export function startPreviewServer(opts: { portalOrigin: string; sha?: string; port?: number }): Promise<PreviewServer>;
