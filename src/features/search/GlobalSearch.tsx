import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { getDatabase } from '../../lib/database/connection';
import { globalSearch, type SearchPage, type SearchResult } from './repository';

export function GlobalSearch({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (page: SearchPage, result: SearchResult) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
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
      void getDatabase()
        .then((db) => globalSearch(db, query))
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
  }, [query]);
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
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive((value) => Math.min(results.length - 1, value + 1));
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive((value) => Math.max(0, value - 1));
        }
        if (event.key === 'Enter' && results[active]) {
          event.preventDefault();
          onNavigate(results[active].page, results[active]);
        }
      }}
    >
      <div className="search-head">
        <Search size={20} />
        <input
          ref={input}
          aria-label="Buscar no RUMO"
          placeholder="Buscar no RUMO…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="icon-button" aria-label="Fechar busca" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="search-results" role="listbox" aria-label="Resultados da busca">
        {error && <p role="alert">{error}</p>}
        {query.trim().length < 2 ? (
          <p>Digite pelo menos duas letras.</p>
        ) : !results.length && !error ? (
          <p>Nenhum resultado encontrado.</p>
        ) : (
          Array.from(grouped, ([group, rows]) => (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map((row) => {
                const index = results.indexOf(row);
                return (
                  <button
                    key={`${group}-${row.id}`}
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
        )}
      </div>
      <p className="search-help">↑ ↓ selecionar · Enter abrir · Esc fechar</p>
    </dialog>
  );
}
