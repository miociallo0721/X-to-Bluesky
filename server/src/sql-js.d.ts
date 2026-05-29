declare module 'sql.js' {
  export interface Statement {
    bind(params: Record<string, string | number | null> | (string | number | null)[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface Database {
    close(): void;
    exec(sql: string): void;
    export(): Uint8Array;
    getRowsModified(): number;
    prepare(sql: string): Statement;
  }

  export interface SqlJsStatic {
    Database: new (data?: Buffer | Uint8Array) => Database;
  }

  export default function initSqlJs(): Promise<SqlJsStatic>;
}
