type SaveState = 'saving' | 'saved' | 'error';
const writers = new Set<{ flush(): Promise<void> }>();

/** Navigation and native close wait for every pending workout edit. */
export async function flushWorkouts(): Promise<void> {
  for (const writer of [...writers]) await writer.flush();
}

export class WorkoutWriter<T> {
  private pending: { value: T } | undefined;
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private persist: (value: T) => Promise<void>,
    private listener?: (state: SaveState) => void,
  ) {
    writers.add(this);
  }
  edit(value: T): void {
    this.pending = { value };
    this.listener?.('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), 400);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    if (!this.pending) return;
    this.running = this.drain();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async drain(): Promise<void> {
    while (this.pending) {
      const draft = this.pending;
      this.pending = undefined;
      try {
        await this.persist(draft.value);
      } catch (error) {
        this.pending ??= draft;
        this.listener?.('error');
        throw error;
      }
    }
    this.listener?.('saved');
  }
  async dispose(): Promise<void> {
    this.listener = undefined;
    await this.flush();
    writers.delete(this);
  }
}
