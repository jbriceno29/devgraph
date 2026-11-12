import { describe, expect, it } from 'vitest';
import { prepareReferences } from '../../src/modules/inception/application/reference-files.js';

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === 'string' ? bytes : Uint8Array.from(bytes)).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ok = (over: Record<string, unknown> = {}) => ({
  name: 'pantalla.png',
  kind: 'VISUAL',
  note: '',
  dataBase64: PNG,
  ...over,
});

describe('prepareReferences', () => {
  it('accepts images, PDFs and text files and assigns ids and file names itself', () => {
    const prepared = prepareReferences([
      ok({ name: 'C:\\fotos\\../Boceto Final.PNG', note: ' me gusta la barra ' }),
      ok({ name: 'doc.pdf', kind: 'FUNCTIONAL', dataBase64: b64('%PDF-1.7\n...') }),
      ok({ name: 'proto.html', kind: 'FUNCTIONAL', dataBase64: b64('<html><body>hola</body></html>') }),
      ok({ name: 'idea.md', kind: 'CONCEPTUAL', dataBase64: b64('# Idea\n') }),
      ok({ name: 'foto.jpg', dataBase64: b64([0xff, 0xd8, 0xff, 0xe0, 0]) }),
    ]);
    expect(prepared.map(item => [item.id, item.file, item.name, item.mimeType])).toEqual([
      ['ref-1', 'ref-1.png', 'Boceto Final.PNG', 'image/png'],
      ['ref-2', 'ref-2.pdf', 'doc.pdf', 'application/pdf'],
      ['ref-3', 'ref-3.html', 'proto.html', 'text/html'],
      ['ref-4', 'ref-4.md', 'idea.md', 'text/markdown'],
      ['ref-5', 'ref-5.jpg', 'foto.jpg', 'image/jpeg'],
    ]);
    expect(prepared[0]).toMatchObject({ note: 'me gusta la barra', kind: 'VISUAL', bytes: 11 });
  });

  it.each([
    ['más de 5', () => Array.from({ length: 6 }, () => ok()), 'como mucho 5'],
    ['no es una lista', () => 'x', 'como una lista'],
    ['sin nombre', () => [ok({ name: '   ' })], 'nombre de su archivo'],
    ['tipo no admitido', () => [ok({ name: 'virus.exe' })], 'tipo de archivo no admitido'],
    ['sin tipo de uso', () => [ok({ kind: 'OTRO' })], 'visual, funcional o conceptual'],
    ['nota larga', () => [ok({ note: 'x'.repeat(501) })], 'la nota admite como mucho 500'],
    ['base64 inválido', () => [ok({ dataBase64: 'no es base64!' })], 'no es válido'],
    ['vacío', () => [ok({ dataBase64: '' })], 'no es válido'],
    ['un .png que no es PNG', () => [ok({ dataBase64: b64('esto es texto') })], 'no es un archivo .png válido'],
    [
      'un .pdf que no es PDF',
      () => [ok({ name: 'a.pdf', dataBase64: b64([0xff, 0xd8, 0xff]) })],
      'no es un archivo .pdf válido',
    ],
    [
      'un .html con bytes binarios',
      () => [ok({ name: 'a.html', dataBase64: b64([0x3c, 0x00, 0x01]) })],
      'no es un archivo .html válido',
    ],
    [
      'un .txt que no es UTF-8',
      () => [ok({ name: 'a.txt', dataBase64: b64([0xc3, 0x28]) })],
      'no es un archivo .txt válido',
    ],
  ])('refuses %s', (_label, make, message) => {
    expect(() => prepareReferences(make())).toThrow(message as string);
  });

  it('refuses a file over 3 MB and a total over 8 MB', () => {
    const big = (megabytes: number) =>
      b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(Math.round(megabytes * 1024 * 1024)).fill(7)]);
    expect(() => prepareReferences([ok({ dataBase64: big(3.2) })])).toThrow('pesa más de 3 MB');
    expect(() =>
      prepareReferences([ok({ dataBase64: big(2.9) }), ok({ dataBase64: big(2.9) }), ok({ dataBase64: big(2.9) })]),
    ).toThrow('suman más de 8 MB');
  });
});
