export interface TaskRunner {
  run<T>(taskName: string, task: () => Promise<T>): Promise<T>;
}

export function createInlineTaskRunner(): TaskRunner {
  return {
    run(_taskName, task) {
      return task();
    },
  };
}
