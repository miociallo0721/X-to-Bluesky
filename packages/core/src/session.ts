export interface SessionStore<T> {
  get(): T | null;
  set(value: T): void;
  clear(): void;
}

export function createMemorySessionStore<T>(): SessionStore<T> {
  let current: T | null = null;

  return {
    get() {
      return current;
    },
    set(value) {
      current = value;
    },
    clear() {
      current = null;
    },
  };
}
