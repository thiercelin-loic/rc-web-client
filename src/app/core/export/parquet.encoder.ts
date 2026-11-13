import * as C from "./export.constants";
import { ColumnChunkMetadata, TabularExportData } from "./export.interface";

export function encodeParquet(dataset: TabularExportData): Uint8Array {
  const encoder = new TextEncoder();
  const rowCount = dataset.rows.length;
  const magic = encoder.encode(C.PARQUET_MAGIC_STRING);

  const chunks: Uint8Array[] = [];
  const metaList: ColumnChunkMetadata[] = [];
  let offset = magic.length;

  for (let colIdx = 0; colIdx < dataset.columns.length; colIdx++) {
    const colName = dataset.columns[colIdx];
    const chunkBytes = buildChunk(dataset.rows, colIdx, encoder);
    chunks.push(chunkBytes);
    metaList.push({
      columnName: colName,
      fileOffset: offset,
      totalByteSize: chunkBytes.length,
    });
    offset += chunkBytes.length;
  }

  const footer = encodeMetadata(dataset.columns, rowCount, metaList);
  const footerLen = encodeLength(footer.length);

  return assembleParquet(magic, chunks, footer, footerLen);
}

function buildChunk(
  rows: readonly (readonly string[])[],
  colIdx: number,
  encoder: TextEncoder,
): Uint8Array {
  const values: Uint8Array[] = [];
  let valuesLen = 0;

  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const raw = rows[rowIdx][colIdx] ?? "";
    const utf8 = encoder.encode(raw);
    const buf = new Uint8Array(4 + utf8.length);
    new DataView(buf.buffer).setUint32(0, utf8.length, true);
    buf.set(utf8, 4);
    values.push(buf);
    valuesLen += buf.length;
  }

  const header = encodeHeader(rows.length, valuesLen);
  const chunk = new Uint8Array(header.length + valuesLen);
  chunk.set(header, 0);

  let pos = header.length;
  for (const buf of values) {
    chunk.set(buf, pos);
    pos += buf.length;
  }
  return chunk;
}

function encodeLength(length: number): Uint8Array {
  const buf = new Uint8Array(C.PARQUET_FOOTER_LENGTH_BYTES);
  new DataView(buf.buffer).setUint32(0, length, true);
  return buf;
}

function assembleParquet(
  magic: Uint8Array,
  chunks: readonly Uint8Array[],
  footer: Uint8Array,
  footerLen: Uint8Array,
): Uint8Array {
  const chunksLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const total =
    magic.length + chunksLen + footer.length + footerLen.length + magic.length;

  const out = new Uint8Array(total);
  let pos = 0;

  out.set(magic, pos);
  pos += magic.length;

  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }

  out.set(footer, pos);
  pos += footer.length;

  out.set(footerLen, pos);
  pos += footerLen.length;

  out.set(magic, pos);
  return out;
}

function encodeHeader(numValues: number, byteSize: number): Uint8Array {
  return new Uint8Array([
    C.THRIFT_I32_DELTA_1,
    0x00,
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(byteSize),
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(byteSize),
    C.THRIFT_STRUCT_DELTA_2,
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(numValues),
    C.THRIFT_I32_DELTA_1,
    0x00,
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(C.PARQUET_RLE_ENCODING),
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(C.PARQUET_RLE_ENCODING),
    C.THRIFT_STOP,
    C.THRIFT_STOP,
  ]);
}

function encodeMetadata(
  columns: readonly string[],
  rowCount: number,
  chunks: readonly ColumnChunkMetadata[],
): Uint8Array {
  const encoder = new TextEncoder();
  const createdBy = encoder.encode("RollerCoaster Columnar Engine v1.2");
  const totalSize = chunks.reduce(
    (sum, chunk) => sum + chunk.totalByteSize,
    0,
  );

  const bytes: number[] = [
    C.THRIFT_I32_DELTA_1,
    0x02,
    ...encodeSchema(columns, encoder),
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(rowCount),
    ...encodeGroup(chunks, rowCount, totalSize, encoder),
    C.THRIFT_BINARY_DELTA_2,
    ...encodeVarint(createdBy.length),
    ...createdBy,
    C.THRIFT_STOP,
  ];

  return new Uint8Array(bytes);
}

function encodeSchema(
  columns: readonly string[],
  encoder: TextEncoder,
): number[] {
  const rootName = encoder.encode("schema");
  const bytes: number[] = [
    ...encodeList(1 + columns.length),
    C.THRIFT_BINARY_DELTA_4,
    ...encodeVarint(rootName.length),
    ...rootName,
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(columns.length),
    C.THRIFT_STOP,
  ];

  for (const colName of columns) {
    const colBytes = encoder.encode(colName);
    bytes.push(
      C.THRIFT_I32_DELTA_1,
      ...encodeZigzag(C.PARQUET_BYTE_ARRAY_TYPE),
      C.THRIFT_I32_DELTA_2,
      C.PARQUET_REQUIRED_REPETITION,
      C.THRIFT_BINARY_DELTA_1,
      ...encodeVarint(colBytes.length),
      ...colBytes,
      C.THRIFT_I32_DELTA_2,
      C.PARQUET_UTF8_CONVERTED_TYPE,
      C.THRIFT_STOP,
    );
  }
  return bytes;
}

function encodeGroup(
  chunks: readonly ColumnChunkMetadata[],
  rowCount: number,
  totalSize: number,
  encoder: TextEncoder,
): number[] {
  const bytes: number[] = [
    C.THRIFT_LIST_DELTA_1,
    0x1c,
    ...encodeList(chunks.length),
  ];

  for (const chunk of chunks) {
    bytes.push(...encodeColumn(chunk, rowCount, encoder));
  }

  bytes.push(
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(totalSize),
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(rowCount),
    C.THRIFT_STOP,
  );
  return bytes;
}

function encodeColumn(
  chunk: ColumnChunkMetadata,
  rowCount: number,
  encoder: TextEncoder,
): number[] {
  const nameBytes = encoder.encode(chunk.columnName);
  return [
    C.THRIFT_I64_DELTA_2,
    ...encodeZigzag(chunk.fileOffset),
    C.THRIFT_STRUCT_DELTA_1,
    C.THRIFT_I32_DELTA_1,
    ...encodeZigzag(C.PARQUET_BYTE_ARRAY_TYPE),
    C.THRIFT_LIST_DELTA_1,
    C.THRIFT_I32_DELTA_2,
    C.PARQUET_PLAIN_ENCODING,
    0x06,
    C.THRIFT_LIST_DELTA_1,
    C.THRIFT_BINARY_DELTA_1,
    ...encodeVarint(nameBytes.length),
    ...nameBytes,
    C.THRIFT_I32_DELTA_1,
    C.PARQUET_UNCOMPRESSED_CODEC,
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(rowCount),
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(chunk.totalByteSize),
    C.THRIFT_I64_DELTA_1,
    ...encodeZigzag(chunk.totalByteSize),
    C.THRIFT_I64_DELTA_2,
    ...encodeZigzag(chunk.fileOffset),
    C.THRIFT_STOP,
    C.THRIFT_STOP,
  ];
}

function encodeList(count: number): number[] {
  if (count < 15) {
    return [C.THRIFT_LIST_DELTA_1, (count << 4) | 0x0c];
  }
  return [C.THRIFT_LIST_DELTA_1, 0xfc, ...encodeVarint(count)];
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = Math.max(0, Math.floor(value));
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining & 0x7f);
  return bytes;
}

function encodeZigzag(value: number): number[] {
  const num = Math.floor(value);
  const zigzag = num >= 0 ? num * 2 : -num * 2 - 1;
  return encodeVarint(zigzag);
}

