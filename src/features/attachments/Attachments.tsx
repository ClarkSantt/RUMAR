import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { Paperclip, Plus, Trash2, ExternalLink } from 'lucide-react';
import { Dialog } from '../../components/Dialog';
import './attachments.css';

export type AttachmentEntity =
  | 'task'
  | 'project'
  | 'thought'
  | 'objective'
  | 'moment'
  | 'finance_transaction'
  | 'body_progress_photo';

export interface AttachmentRow {
  id: string;
  entity_type: AttachmentEntity;
  entity_id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  created_at: string;
}

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

export function Attachments({
  entityType,
  entityId,
  imagesOnly = false,
  title,
  maxFiles,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  imagesOnly?: boolean;
  title?: string;
  maxFiles?: number;
}) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState<AttachmentRow | null>(null);

  async function refresh() {
    const found = await invoke<AttachmentRow[]>('attachment_list', {
      entityType,
      entityId,
    });
    setRows(found);
  }
  useEffect(() => {
    let active = true;
    void invoke<AttachmentRow[]>('attachment_list', { entityType, entityId })
      .then((found) => {
        if (active) {
          setRows(found);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os anexos.');
      });
    return () => {
      active = false;
    };
  }, [entityType, entityId]);

  async function add() {
    const selected = await open({
      multiple: maxFiles !== 1,
      directory: false,
      filters: [
        {
          name:
            imagesOnly || entityType === 'body_progress_photo' ? 'Imagens' : 'Documentos e imagens',
          extensions:
            imagesOnly || entityType === 'body_progress_photo'
              ? ['png', 'jpg', 'jpeg', 'webp']
              : ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'json', 'docx', 'xlsx'],
        },
      ],
    });
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      const sources = Array.isArray(selected) ? selected : [selected];
      for (const source of sources.slice(0, maxFiles ?? sources.length)) {
        await invoke<AttachmentRow>('attachment_add', { entityType, entityId, source });
      }
      if (maxFiles === 1) {
        for (const row of rows) await invoke('attachment_remove', { id: row.id });
      }
      await refresh();
    } catch (cause) {
      setError(`Não foi possível adicionar todos os arquivos. ${String(cause)}`);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function show(id: string, reveal: boolean) {
    try {
      setError('');
      await invoke('attachment_open', { id, reveal });
    } catch (cause) {
      setError(`Não foi possível abrir o arquivo. ${String(cause)}`);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await invoke('attachment_remove', { id: removing.id });
      await refresh();
      setRemoving(null);
    } catch (cause) {
      setError(`Não foi possível remover o anexo. ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="attachments-section"
      aria-label={title ?? (entityType === 'body_progress_photo' ? 'Foto privada' : 'Anexos')}
    >
      <header className="attachments-header">
        <h2>
          <Paperclip size={17} aria-hidden="true" />
          {title ? ` ${title}` : entityType === 'body_progress_photo' ? ' Foto privada' : ' Anexos'}
        </h2>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void add()}
        >
          <Plus size={16} aria-hidden="true" />
          {maxFiles === 1 && rows.length
            ? ' Trocar foto'
            : imagesOnly || entityType === 'body_progress_photo'
              ? ' Adicionar foto'
              : ' Adicionar arquivo'}
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {rows.length === 0 ? (
        <p className="field-help">Nenhum arquivo anexado.</p>
      ) : (
        <ul className="attachments-list">
          {rows.map((row) => (
            <li key={row.id}>
              <span className="attachments-name" title={row.original_name}>
                {row.original_name}
              </span>
              <span className="attachments-size">{formatSize(row.file_size)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`Abrir ${row.original_name}`}
                onClick={() => void show(row.id, false)}
              >
                <ExternalLink size={16} />
              </button>
              <button type="button" className="text-button" onClick={() => void show(row.id, true)}>
                Mostrar na pasta
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remover ${row.original_name}`}
                disabled={busy}
                onClick={() => setRemoving(row)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing && (
        <Dialog title="Remover anexo?" onClose={() => setRemoving(null)}>
          <div className="dialog-content">
            <p>O arquivo “{removing.original_name}” será removido do armazenamento do RUMAR.</p>
            <div className="dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setRemoving(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void remove()}
              >
                Remover arquivo
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}
