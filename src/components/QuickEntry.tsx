import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Plus } from 'lucide-react';
export function QuickEntry({
  placeholder,
  onSave,
  busy,
  autoFocus = false,
  multiline = false,
}: {
  placeholder: string;
  onSave: (value: string) => Promise<boolean>;
  busy: boolean;
  autoFocus?: boolean;
  multiline?: boolean;
}) {
  const [value, setValue] = useState(''),
    id = useId();
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim() && (await onSave(value))) setValue('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }
  return (
    <form className="quick-entry" onSubmit={(event) => void submit(event)}>
      <Plus size={19} aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>
        {placeholder}
      </label>
      {multiline ? (
        <textarea
          ref={(node) => {
            inputRef.current = node;
          }}
          id={id}
          value={value}
          autoFocus={autoFocus}
          rows={2}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
      ) : (
        <input
          ref={(node) => {
            inputRef.current = node;
          }}
          id={id}
          value={value}
          autoFocus={autoFocus}
          maxLength={500}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
      <button
        type="submit"
        className="icon-button entry-submit"
        disabled={busy || !value.trim()}
        aria-label="Salvar"
        title="Salvar (Enter)"
      >
        <ArrowUp size={18} />
      </button>
    </form>
  );
}
