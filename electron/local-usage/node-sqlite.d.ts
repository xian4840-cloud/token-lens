/** node:sqlite 最小类型声明（@types/node 22 尚未包含此模块）。
 * 仅声明 opencode.ts 用到的 DatabaseSync / StatementSync API。 */
declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown | undefined;
  }
  export class DatabaseSync {
    constructor(location: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
