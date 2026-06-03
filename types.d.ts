// Type stubs for Node.js modules used in tests
declare module "fs" {
  export function readFileSync(path: string, encoding?: string): string;
  export function readdirSync(path: string): string[];
}
declare module "path" {
  export function join(...paths: string[]): string;
}
declare var __dirname: string;

// Type stub for node:sqlite
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
  export class StatementSync {
    run(...params: any[]): { changes: number; lastInsertRowId: number | bigint };
    get(...params: any[]): any;
    all(...params: any[]): any[];
    raw(...params: any[]): any[][];
  }
}

// Route handler exports (JS modules without type declarations)
declare module "*/routes/auth.js" {
  export const handleAuthRoutes: Function;
}
declare module "*/routes/admin.js" {
  export const handleAdminRoutes: Function;
}
declare module "*/routes/parent.js" {
  export const handleParentRoutes: Function;
}
declare module "*/routes/child.js" {
  export const handleChildRoutes: Function;
}
declare module "*/routes/shared.js" {
  export const handleSharedRoutes: Function;
}
declare module "*/utils.js" {
  export const json: Function;
  export const ok: Function;
  export const fail: Function;
  export const nowIso: () => string;
  export const id: () => string;
  export const bootstrapPromise: any;
  export const loginAttempts: Map<string, number[]>;
  export const checkLoginRateLimit: (key: string) => void;
  export const validateInput: Function;
  export const hashPassword: (password: string) => Promise<string>;
  export const verifyPassword: Function;
  export const body: Function;
  export const cookie: Function;
  export const actorFromRequest: Function;
  export const requireRole: Function;
  export const ensureAdmin: Function;
  export const timezoneOffsetMinutes: Function;
  export const settingNumber: Function;
  export const recalcAchievements: Function;
  export const notify: Function;
  export const isPrivateUrl: (url: string) => boolean;
  export const batchRefreshGreetings: Function;
  export const generateAiGreeting: Function;
  export const updateSetting: Function;
  export const usernameExists: Function;
  export const clampTimezoneOffset: Function;
  export const timezoneLabel: Function;
  export const sessionCookie: (value: string, env: any) => string;
  export const validateHttpsUrl: (value: string, fieldName: string) => string | null;
  export const truncateAiOutput: (text: string) => string;
  export const validateEnum: (value: any, allowed: any[], fieldName: string) => string | null;
}
