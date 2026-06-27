/* Type stubs for the pure JS engine core. The engine is exercised by
 * worker/test/core.test.mjs at runtime; the DO treats it as `any`. */
export const createGame: (opts?: any) => any;
export const getLegalActions: (state: any, seat: number) => any[];
export const pendingDeciders: (state: any) => number[];
export const applyAction: (state: any, seat: number, action: any) => { ok: boolean; events?: any[]; error?: any };
export const botChooseAction: (state: any, seat: number, difficulty?: string) => any;
export const viewFor: (state: any, seat: number, opts?: any) => any;
export const makeConfig: (overrides?: any) => any;
export const DEFAULT_CONFIG: any;
