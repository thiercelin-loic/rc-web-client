/**
 * RollerCoaster Pure-TypeScript ZIP Archive Utilities
 * Implements standard PKZIP 2.0 STORE (uncompressed) packing and unpacking
 * for zero-dependency .rcp project containers and .xlsx/.docx bundles.
 */

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c;
}

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function packZipArchive(entries: readonly ZipEntrySpec[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const dataBytes = entry.data;
    const crc = computeCrc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // PK\x03\x04
    lv.setUint16(4, 20, true); // Version needed (2.0)
    lv.setUint16(6, 0, true); // Flags
    lv.setUint16(8, 0, true); // Compression (0 = STORE)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0, true); // Mod date
    lv.setUint32(14, crc, true); // CRC-32
    lv.setUint32(18, dataBytes.length, true); // Compressed size
    lv.setUint32(22, dataBytes.length, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // Filename length
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // PK\x01\x02
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0, true); // Flags
    cv.setUint16(10, 0, true); // Compression (0 = STORE)
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0, true); // Mod date
    cv.setUint32(16, crc, true); // CRC-32
    cv.setUint32(20, dataBytes.length, true); // Compressed size
    cv.setUint32(24, dataBytes.length, true); // Uncompressed size
    cv.setUint16(28, nameBytes.length, true); // Filename length
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // File comment length
    cv.setUint16(34, 0, true); // Disk number start
    cv.setUint16(36, 0, true); // Internal file attributes
    cv.setUint32(38, 0, true); // External file attributes
    cv.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // PK\x05\x06
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Start disk
  ev.setUint16(8, entries.length, true); // Disk entries
  ev.setUint16(10, entries.length, true); // Total entries
  ev.setUint32(12, centralDirSize, true); // Central directory size
  ev.setUint32(16, offset, true); // Central directory offset
  ev.setUint16(20, 0, true); // Comment length

  const totalLength = offset + centralDirSize + eocd.length;
  const result = new Uint8Array(totalLength);
  let pos = 0;

  for (const part of localParts) {
    result.set(part, pos);
    pos += part.length;
  }
  for (const part of centralParts) {
    result.set(part, pos);
    pos += part.length;
  }
  result.set(eocd, pos);

  return result;
}

interface HuffmanTable {
  readonly counts: Int32Array;
  readonly symbols: Int32Array;
}

const LEN_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LEN_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513,
  769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
  11, 11, 12, 12, 13, 13,
];
const CL_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

function buildHuffman(lengths: ArrayLike<number>): HuffmanTable {
  const counts = new Int32Array(16);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i];
    if (l > 0 && l <= 15) counts[l]++;
  }
  const offsets = new Int32Array(16);
  let total = 0;
  for (let i = 1; i <= 15; i++) {
    offsets[i] = total;
    total += counts[i];
  }
  const symbols = new Int32Array(total);
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i];
    if (l > 0 && l <= 15) {
      symbols[offsets[l]++] = i;
    }
  }
  return { counts, symbols };
}

const FIXED_LIT_LENGTHS = new Uint8Array(288);
for (let i = 0; i <= 143; i++) FIXED_LIT_LENGTHS[i] = 8;
for (let i = 144; i <= 255; i++) FIXED_LIT_LENGTHS[i] = 9;
for (let i = 256; i <= 279; i++) FIXED_LIT_LENGTHS[i] = 7;
for (let i = 280; i <= 287; i++) FIXED_LIT_LENGTHS[i] = 8;
const FIXED_LIT_TABLE = buildHuffman(FIXED_LIT_LENGTHS);

const FIXED_DIST_LENGTHS = new Uint8Array(30);
FIXED_DIST_LENGTHS.fill(5);
const FIXED_DIST_TABLE = buildHuffman(FIXED_DIST_LENGTHS);

/**
 * Pure-TypeScript RFC 1951 raw DEFLATE decompressor for .xlsx / OpenXML entries.
 */
export function inflateRaw(
  data: Uint8Array,
  expectedUncompressedSize = 0,
): Uint8Array {
  let bytePos = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const readBits = (n: number): number => {
    while (bitCount < n) {
      if (bytePos >= data.length) {
        throw new Error('Unexpected EOF in DEFLATE stream');
      }
      bitBuf |= data[bytePos++] << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSymbol = (table: HuffmanTable): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= readBits(1);
      const count = table.counts[len];
      if (code - count < first) {
        return table.symbols[index + (code - first)];
      }
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('Invalid DEFLATE Huffman code');
  };

  let out = new Uint8Array(
    expectedUncompressedSize > 0
      ? expectedUncompressedSize
      : Math.max(256, data.length * 3),
  );
  let outPos = 0;

  const ensureCapacity = (needed: number): void => {
    if (outPos + needed <= out.length) return;
    let nextLen = out.length * 2;
    while (nextLen < outPos + needed) nextLen *= 2;
    const grown = new Uint8Array(nextLen);
    grown.set(out.subarray(0, outPos));
    out = grown;
  };

  let isFinal = 0;
  while (!isFinal) {
    isFinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      bitBuf = 0;
      bitCount = 0;
      if (bytePos + 4 > data.length) {
        throw new Error('Truncated uncompressed DEFLATE block');
      }
      const len = data[bytePos] | (data[bytePos + 1] << 8);
      bytePos += 4;
      ensureCapacity(len);
      out.set(data.subarray(bytePos, bytePos + len), outPos);
      bytePos += len;
      outPos += len;
    } else if (btype === 1 || btype === 2) {
      let litTable = FIXED_LIT_TABLE;
      let distTable = FIXED_DIST_TABLE;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          clLengths[CL_ORDER[i]] = readBits(3);
        }
        const clTable = buildHuffman(clLengths);
        const totalCodes = hlit + hdist;
        const codeLengths = new Uint8Array(totalCodes);
        let idx = 0;
        while (idx < totalCodes) {
          const sym = decodeSymbol(clTable);
          if (sym < 16) {
            codeLengths[idx++] = sym;
          } else if (sym === 16) {
            const prev = idx > 0 ? codeLengths[idx - 1] : 0;
            let rep = readBits(2) + 3;
            while (rep-- > 0 && idx < totalCodes) codeLengths[idx++] = prev;
          } else if (sym === 17) {
            let rep = readBits(3) + 3;
            while (rep-- > 0 && idx < totalCodes) codeLengths[idx++] = 0;
          } else if (sym === 18) {
            let rep = readBits(7) + 11;
            while (rep-- > 0 && idx < totalCodes) codeLengths[idx++] = 0;
          }
        }
        litTable = buildHuffman(codeLengths.subarray(0, hlit));
        distTable = buildHuffman(codeLengths.subarray(hlit, totalCodes));
      }

      while (true) {
        const sym = decodeSymbol(litTable);
        if (sym === 256) break;
        if (sym < 256) {
          ensureCapacity(1);
          out[outPos++] = sym;
        } else {
          const lenIdx = sym - 257;
          const length = LEN_BASE[lenIdx] + readBits(LEN_EXTRA[lenIdx]);
          const distSym = decodeSymbol(distTable);
          const distance = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
          ensureCapacity(length);
          for (let i = 0; i < length; i++) {
            out[outPos] = out[outPos - distance];
            outPos++;
          }
        }
      }
    } else {
      throw new Error('Reserved DEFLATE block type 3');
    }
  }

  return out.subarray(0, outPos);
}

export function unpackZipArchive(
  buffer: ArrayBuffer | Uint8Array,
): Record<string, Uint8Array> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: Record<string, Uint8Array> = {};

  // 1. Locate End of Central Directory (EOCD) record (handles streaming ZIPs with data descriptors)
  let eocdOffset = -1;
  const minEocdOffset = Math.max(0, bytes.length - 65557);
  for (let pos = bytes.length - 22; pos >= minEocdOffset; pos--) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      eocdOffset = pos;
      break;
    }
  }

  if (eocdOffset >= 0) {
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    let cdCursor = view.getUint32(eocdOffset + 16, true);

    for (
      let i = 0;
      i < totalEntries && cdCursor + 46 <= bytes.length;
      i++
    ) {
      if (view.getUint32(cdCursor, true) !== 0x02014b50) break;
      const compressionMethod = view.getUint16(cdCursor + 10, true);
      const compressedSize = view.getUint32(cdCursor + 20, true);
      const uncompressedSize = view.getUint32(cdCursor + 24, true);
      const filenameLen = view.getUint16(cdCursor + 28, true);
      const extraLen = view.getUint16(cdCursor + 30, true);
      const commentLen = view.getUint16(cdCursor + 32, true);
      const localHeaderOffset = view.getUint32(cdCursor + 42, true);

      const filename = decoder.decode(
        bytes.subarray(cdCursor + 46, cdCursor + 46 + filenameLen),
      );
      cdCursor += 46 + filenameLen + extraLen + commentLen;

      if (
        localHeaderOffset + 30 <= bytes.length &&
        view.getUint32(localHeaderOffset, true) === 0x04034b50
      ) {
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataOffset =
          localHeaderOffset + 30 + localNameLen + localExtraLen;
        if (dataOffset + compressedSize <= bytes.length) {
          const rawSlice = bytes.subarray(
            dataOffset,
            dataOffset + compressedSize,
          );
          if (compressionMethod === 0) {
            entries[filename] = bytes.slice(
              dataOffset,
              dataOffset + uncompressedSize,
            );
          } else if (compressionMethod === 8) {
            try {
              entries[filename] = inflateRaw(rawSlice, uncompressedSize);
            } catch {
              // Skip corrupted entry
            }
          }
        }
      }
    }

    if (Object.keys(entries).length > 0) {
      return entries;
    }
  }

  // 2. Fallback: sequential Local File Header scan
  let cursor = 0;
  while (cursor + 30 <= bytes.length) {
    const signature = view.getUint32(cursor, true);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressionMethod = view.getUint16(cursor + 8, true);
    const compressedSize = view.getUint32(cursor + 18, true);
    const uncompressedSize = view.getUint32(cursor + 22, true);
    const filenameLen = view.getUint16(cursor + 26, true);
    const extraFieldLen = view.getUint16(cursor + 28, true);

    const filenameBytes = bytes.subarray(
      cursor + 30,
      cursor + 30 + filenameLen,
    );
    const filename = decoder.decode(filenameBytes);

    const dataOffset = cursor + 30 + filenameLen + extraFieldLen;
    const dataSize = compressedSize > 0 ? compressedSize : uncompressedSize;

    if (dataOffset + dataSize <= bytes.length) {
      const rawSlice = bytes.subarray(dataOffset, dataOffset + dataSize);
      if (compressionMethod === 0) {
        entries[filename] = bytes.slice(dataOffset, dataOffset + dataSize);
      } else if (compressionMethod === 8) {
        try {
          entries[filename] = inflateRaw(rawSlice, uncompressedSize);
        } catch {
          // Skip corrupted entry
        }
      }
    }

    cursor = dataOffset + dataSize;
  }

  return entries;
}
