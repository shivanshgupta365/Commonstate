export class DeadlineExceededError extends Error {
  readonly code = "DEADLINE_EXCEEDED";
  readonly operation: string;
  readonly deadlineMs: number;

  constructor(operation: string, deadlineMs: number) {
    super(`${operation} exceeded its ${deadlineMs}ms deadline`);
    this.name = "DeadlineExceededError";
    this.operation = operation;
    this.deadlineMs = deadlineMs;
  }
}

/** Provider-neutral deadline wrapper. The underlying storage call is allowed to
 * settle later, but it can no longer hold the HTTP response open. */
export function withDeadline<T>(
  operation: () => Promise<T>,
  deadlineMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new DeadlineExceededError(label, deadlineMs)));
    }, deadlineMs);

    try {
      operation().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
