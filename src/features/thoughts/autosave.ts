import type { ThoughtDraft } from './repository';

export type SaveStatus = 'saved' | 'saving' | 'error';
const active = new Set<ThoughtAutosave>();
/** Navigation and native close await this barrier; failures leave the editor open. */
export async function flushThoughts(): Promise<void> {
  for (const writer of [...active]) await writer.flush();
}
export class ThoughtAutosave {
  private pending: ThoughtDraft | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private listener: ((status: SaveStatus) => void) | undefined;
  constructor(
    private persist: (draft: ThoughtDraft) => Promise<void>,
    listener?: (status: SaveStatus) => void,
  ) {
    this.listener = listener;
    active.add(this);
  }
  edit(draft: ThoughtDraft): void {
    this.pending = { ...draft };
    this.listener?.('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 700);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) await this.running;
    if (!this.pending) return;
    this.running = this.drain();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  private async drain(): Promise<void> {
    this.listener?.('saving');
    while (this.pending) {
      const draft = this.pending;
      this.pending = null;
      try {
        await this.persist(draft);
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
    active.delete(this);
  }
}
