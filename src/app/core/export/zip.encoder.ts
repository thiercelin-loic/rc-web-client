import * as C from "./export.constants";
import { ZipEntrySpec } from "./export.interface";

export function packZip(entries: readonly ZipEntrySpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.data;
    const crc = computeCrc32(dataBytes);

    const localHeader = buildLocal(nameBytes, dataBytes.length, crc);
    localParts.push(localHeader, dataBytes);

    const centralHeader = buildCentral(
      nameBytes,
      dataBytes.length,
      crc,
      offset,
    );
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = sumLength(centralParts);
  const eocd = buildEocd(entries.length, centralSize, offset);

  return concatParts(
    [...localParts, ...centralParts, eocd],
    offset + centralSize + eocd.length,
  );
}

function buildLocal(
  nameBytes: Uint8Array,
  size: number,
  crc: number,
): Uint8Array {
  const header = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, C.ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, C.ZIP_VERSION_20, true);
  view.setUint16(8, C.ZIP_COMPRESSION_STORE, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  header.set(nameBytes, 30);
  return header;
}

function buildCentral(
  nameBytes: Uint8Array,
  size: number,
  crc: number,
  offset: number,
): Uint8Array {
  const header = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, C.ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, C.ZIP_VERSION_20, true);
  view.setUint16(6, C.ZIP_VERSION_20, true);
  view.setUint16(10, C.ZIP_COMPRESSION_STORE, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function buildEocd(
  entryCount: number,
  centralSize: number,
  offset: number,
): Uint8Array {
  const eocd = new Uint8Array(C.ZIP_EOCD_BYTE_LENGTH);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, C.ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return eocd;
}

function computeCrc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) {
    const tableIndex = (checksum ^ bytes[index]) & 0xff;
    checksum = (checksum >>> 8) ^ C.CRC32_TABLE[tableIndex];
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function sumLength(parts: readonly Uint8Array[]): number {
  return parts.reduce((sum, part) => sum + part.length, 0);
}

function concatParts(
  parts: readonly Uint8Array[],
  totalSize: number,
): Uint8Array {
  const buffer = new Uint8Array(totalSize);
  let position = 0;
  for (const part of parts) {
    buffer.set(part, position);
    position += part.length;
  }
  return buffer;
}

