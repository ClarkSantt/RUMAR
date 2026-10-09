import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { globalSearch, type SearchPage, type SearchResult } from './repository';
import { commandSuggestions, type AppCommand } from './commands';

async function loadSearchResults(query: string) {
  return globalSearch(await getDatabase(), query);
}

export function GlobalSearch({
  onClose,
  onNavigate,
  onCommand,
  loadResults = loadSearchResults,
}: {
  onClose: () => void;
  onNavigate: (page: SearchPage, result: SearchResult) => void;
  onCommand: (command: AppCommand) => void;
  loadResults?: (query: string) => Promise<SearchResult[]>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const commands = commandSuggestions(query);
  const items = [
    ...commands.map((command) => ({ type: 'command' as const, command })),
    ...results.map((result) => ({ type: 'result' as const, result })),
  ];
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void loadResults(query)
        .then((next) => {
          if (current) {
            setResults(next);
            setActive(0);
            setError('');
          }
        })
        .catch(() => {
          if (current) setError('Não foi possível pesquisar. Tente novamente.');
        });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, loadResults]);
  const grouped = new Map<string, SearchResult[]>();
  for (const result of results)
    grouped.set(result.group, [...(grouped.get(result.group) ?? []), result]);
  return (
    <dialog
      ref={dialog}
      className="dialog search-dialog"
      aria-label="Busca global"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.target !== input.current) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive((value) => Math.min(items.length - 1, value + 1));
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((value) => Math.max(0, value - 1));
        }
        if (event.key === 'Enter' && items[active]) {
          event.preventDefault();
          const item = items[active];
          if (item.type === 'command') onCommand(item.command);
          else onNavigate(item.result.page, item.result);
        }
      }}
    >
      <div className="search-head">
        <Search size={20} />
        <input
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="rumar-search-results"
          aria-activedescendant={items[active] ? `rumar-search-option-${active}` : undefined}
          aria-label="Buscar no RUMAR"
          placeholder="Buscar ou executar um comando…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <button className="icon-button" aria-label="Fechar busca" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div
        id="rumar-search-results"
        className="search-results"
        role="listbox"
        aria-label="Resultados da busca"
      >
        {error && <p role="alert">{error}</p>}
        {commands.length > 0 && (
          <section role="group" aria-label="Ações">
            <h3 aria-hidden="true">Ações</h3>
            {commands.map((command, index) => (
              <button
                key={command.id}
                id={`rumar-search-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => onCommand(command)}
              >
                <strong>{command.title}</strong>
                <span>{command.detail}</span>
              </button>
            ))}
          </section>
        )}
        {query.trim().length >= 2 && !results.length && !error && !commands.length ? (
          <p>Nenhum resultado encontrado.</p>
        ) : query.trim().length >= 2 ? (
          Array.from(grouped, ([group, rows]) => (
            <section key={group} role="group" aria-label={group}>
              <h3 aria-hidden="true">{group}</h3>
              {rows.map((row) => {
                const index = commands.length + results.indexOf(row);
                return (
                  <button
                    key={`${group}-${row.id}`}
                    id={`rumar-search-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onNavigate(row.page, row)}
                  >
                    <strong>{row.title}</strong>
                    {row.detail && <span>{row.detail}</span>}
                  </button>
                );
              })}
            </section>
          ))
        ) : null}
      </div>
      <p className="search-help">↑ ↓ selecionar · Enter executar · Esc fechar · Ctrl+K abrir</p>
    </dialog>
  );
}
