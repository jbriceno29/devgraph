import { basename } from 'node:path';
import { MAX_REFERENCE_BYTES, MAX_REFERENCE_NOTE, MAX_REFERENCES, MAX_REFERENCES_TOTAL_BYTES, REFERENCE_FILE_TYPES, REFERENCE_KINDS, type InceptionReferenceInput, type ReferenceKind } from '../../shared/contracts/inception-view.js';

/** A reference that passed every check, ready to be stored: ids and file names are assigned here, never taken from the user. */
export interface PreparedReference { id: string; file: string; name: string; kind: ReferenceKind; note: string; mimeType: string; bytes: number; content: Buffer }

const startsWith = (content: Buffer, bytes: readonly number[], offset = 0) => bytes.every((byte, index) => content[offset + index] === byte);
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0));
const MAGIC: Record<string, (content: Buffer) => boolean> = {
  png: content => startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: content => startsWith(content, [0xff, 0xd8, 0xff]),
  jpeg: content => startsWith(content, [0xff, 0xd8, 0xff]),
  gif: content => startsWith(content, ascii('GIF87a')) || startsWith(content, ascii('GIF89a')),
  webp: content => startsWith(content, ascii('RIFF')) && startsWith(content, ascii('WEBP'), 8),
  pdf: content => content.subarray(0, 1024).includes(Buffer.from('%PDF-')),
};
const TEXT_TYPES = new Set(['md', 'txt', 'html']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

function isReadableText(content: Buffer): boolean {
  if (content.subarray(0, 8192).includes(0)) return false;
  try { utf8.decode(content); return true; } catch { return false; }
}

/** Display name: no folders, no control characters, capped. */
const cleanName = (value: unknown) => basename(String(value ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);

/**
 * Checks what the user attached before anything is written: count, kinds, notes, accepted types, sizes, valid base64 and that the content
 * really is what its extension says (an `.png` that is not a PNG is refused). Throws a message meant for the user.
 */
export function prepareReferences(inputs: unknown): PreparedReference[] {
  if (!Array.isArray(inputs)) throw new Error('Las referencias deben enviarse como una lista.');
  if (inputs.length > MAX_REFERENCES) throw new Error(`Puedes adjuntar como mucho ${MAX_REFERENCES} referencias.`);
  let total = 0;
  const prepared = inputs.map((raw, index): PreparedReference => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Partial<InceptionReferenceInput>;
    const name = cleanName(item.name);
    if (!name) throw new Error('Cada referencia necesita el nombre de su archivo.');
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const mimeType = REFERENCE_FILE_TYPES[extension];
    if (!mimeType) throw new Error(`«${name}»: tipo de archivo no admitido. Usa ${Object.keys(REFERENCE_FILE_TYPES).join(', ')}.`);
    if (!REFERENCE_KINDS.includes(item.kind as ReferenceKind)) throw new Error(`«${name}»: indica si sirve como referencia visual, funcional o conceptual.`);
    const note = String(item.note ?? '').trim();
    if (note.length > MAX_REFERENCE_NOTE) throw new Error(`«${name}»: la nota admite como mucho ${MAX_REFERENCE_NOTE} caracteres.`);
    const encoded = typeof item.dataBase64 === 'string' ? item.dataBase64.replace(/\s+/g, '') : '';
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error(`«${name}»: el contenido del archivo no es válido.`);
    const content = Buffer.from(encoded, 'base64');
    if (!content.length) throw new Error(`«${name}» está vacío.`);
    if (content.length > MAX_REFERENCE_BYTES) throw new Error(`«${name}» pesa más de ${MAX_REFERENCE_BYTES / 1024 / 1024} MB.`);
    const genuine = TEXT_TYPES.has(extension) ? isReadableText(content) : MAGIC[extension]?.(content) ?? false;
    if (!genuine) throw new Error(`«${name}» no es un archivo .${extension} válido.`);
    total += content.length;
    return { id: `ref-${index + 1}`, file: `ref-${index + 1}.${extension}`, name, kind: item.kind as ReferenceKind, note, mimeType, bytes: content.length, content };
  });
  if (total > MAX_REFERENCES_TOTAL_BYTES) throw new Error(`Las referencias suman más de ${MAX_REFERENCES_TOTAL_BYTES / 1024 / 1024} MB; adjunta menos o más ligeras.`);
  return prepared;
}
