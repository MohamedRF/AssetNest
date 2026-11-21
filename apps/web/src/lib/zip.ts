// Store UTF-8 files in a ZIP archive. Label batches are bounded and need no compression.
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function zipTextFiles(files: readonly { name: string; contents: string }[]): Blob {
  const encoder = new TextEncoder();
  const entries: BlobPart[] = [];
  const directory: BlobPart[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.contents);
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true);
    localHeader.setUint16(6, 0x0800, true); // UTF-8 name
    localHeader.setUint16(12, 0x0021, true); // Earliest DOS date, 1980-01-01
    localHeader.setUint32(14, crc32(data), true);
    localHeader.setUint32(18, data.length, true);
    localHeader.setUint32(22, data.length, true);
    localHeader.setUint16(26, name.length, true);
    entries.push(localHeader.buffer, name, data);

    const centralHeader = new DataView(new ArrayBuffer(46));
    centralHeader.setUint32(0, 0x02014b50, true);
    centralHeader.setUint16(4, 20, true);
    new Uint8Array(centralHeader.buffer, 6, 26).set(new Uint8Array(localHeader.buffer, 4, 26));
    centralHeader.setUint32(42, offset, true);
    directory.push(centralHeader.buffer, name);
    offset += localHeader.byteLength + name.length + data.length;
    directorySize += centralHeader.byteLength + name.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true);
  return new Blob([...entries, ...directory, end.buffer], { type: 'application/zip' });
}
