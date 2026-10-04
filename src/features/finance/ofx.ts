import { normalizeDescription, validDate } from './domain';

export interface OfxRow {
  date: string;
  amount_cents: number;
  transaction_type: 'income' | 'expense';
  description: string;
  normalized_description: string;
  external_id: string | null;
  check_number: string | null;
  external_type: string | null;
  notes: string;
}
export interface OfxDocument {
  rows: OfxRow[];
  account: string | null;
  currency: string | null;
}
export function decodeOfxBytes(bytes: Uint8Array): string {
  if (bytes.length > 10_000_000) throw Error('Arquivo OFX maior que 10 MB.');
  const header = new TextDecoder('windows-1252').decode(bytes.slice(0, 300));
  const decoder = /CHARSET\s*:\s*(?:1252|ISO-8859-1)|ENCODING\s*:\s*USASCII/i.test(header)
    ? new TextDecoder('windows-1252')
    : new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(bytes);
}
function decode(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (code[0] === '#') {
      const point =
        code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(point) || point > 0x10ffff) throw Error('Entidade XML inválida.');
      return String.fromCodePoint(point);
    }
    return named[code.toLowerCase()];
  });
}
function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}\\s*>([^<\\r\\n]*)`, 'i').exec(block);
  return match ? decode(match[1].trim()) : null;
}
function ofxCents(raw: string): number {
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('Valor OFX inválido.');
  const negative = raw.startsWith('-');
  const [whole, decimal = ''] = raw.replace(/^[+-]/, '').split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount === 0) throw Error('Valor OFX inválido.');
  return negative ? -amount : amount;
}
export function parseOfx(content: string): OfxDocument {
  if (content.length > 10_000_000 || /<!\s*(?:DOCTYPE|ENTITY)/i.test(content))
    throw Error('Arquivo OFX inválido ou não permitido.');
  const blocks = [...content.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)];
  if (!blocks.length || blocks.length > 10000)
    throw Error('Não foi possível importar este arquivo.');
  const currency = tag(content, 'CURDEF');
  if (currency && currency.toUpperCase() !== 'BRL')
    throw Error('Somente arquivos BRL são aceitos.');
  const account = tag(content, 'ACCTID');
  const rows = blocks.map((match): OfxRow => {
    const block = match[1],
      rawAmount = tag(block, 'TRNAMT');
    const dateText = tag(block, 'DTPOSTED');
    const description = tag(block, 'NAME') || tag(block, 'MEMO') || '';
    if (!rawAmount || !dateText || !/^\d{8}/.test(dateText) || !description)
      throw Error('Transação OFX incompleta.');
    const signed = ofxCents(rawAmount);
    const date = validDate(
      `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`,
    );
    const memo = tag(block, 'MEMO');
    return {
      date,
      amount_cents: Math.abs(signed),
      transaction_type: signed < 0 ? 'expense' : 'income',
      description,
      normalized_description: normalizeDescription(description),
      external_id: tag(block, 'FITID') || null,
      check_number: tag(block, 'CHECKNUM') || null,
      external_type: tag(block, 'TRNTYPE') || null,
      notes: memo && memo !== description ? memo : '',
    };
  });
  return { rows, account, currency };
}
export async function fileHash(content: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', content.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
