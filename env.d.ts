// Minimal ambient types for the Cloudflare Workers runtime bindings this
// project uses. Neither `wrangler.toml` (bindings are declared inline in
// vite.config.ts) nor `@cloudflare/workers-types` are present, so `env.DB`
// and friends were previously untyped (implicit `any`) wherever imported
// from "cloudflare:workers" — this file gives them real types instead.

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1Result>;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

declare module "cloudflare:workers" {
  interface Env {
    DB: D1Database;
    ASSETS: Fetcher;
    ADMIN_USER_EMAILS?: string;
    VENDOR_USER_EMAILS?: string;
    PARTNER_USER_EMAILS?: string;
  }
  export const env: Env;
}
