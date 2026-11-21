// @vitest-environment node
import { expect, it } from 'vitest';
import { zipTextFiles } from './zip';

it('writes a valid directory with UTF-8 file names, byte offsets and CRCs', async () => {
  const zip = zipTextFiles([
    { name: 'label-円.svg', contents: '123456789' },
    { name: 'asset-details.json', contents: '[]' },
  ]);
  const buffer = Buffer.from(await zip.arrayBuffer());
  const end = buffer.length - 22;
  expect(zip.type).toBe('application/zip');
  expect(buffer.readUInt32LE(end)).toBe(0x06054b50);
  expect(buffer.readUInt16LE(end + 10)).toBe(2);
  const first = buffer.readUInt32LE(end + 16);
  expect(first + buffer.readUInt32LE(end + 12)).toBe(end);
  expect(buffer.readUInt32LE(first)).toBe(0x02014b50);
  expect(buffer.readUInt32LE(first + 16)).toBe(0xcbf43926);
  const nameLength = buffer.readUInt16LE(first + 28);
  expect(buffer.subarray(first + 46, first + 46 + nameLength).toString()).toBe('label-円.svg');
  expect(buffer.readUInt32LE(first + 42)).toBe(0);
  const nextLocalHeader = buffer.readUInt32LE(first + 46 + nameLength + 42);
  expect(nextLocalHeader).toBe(30 + nameLength + 9);
  expect(buffer.readUInt32LE(nextLocalHeader)).toBe(0x04034b50);
});
