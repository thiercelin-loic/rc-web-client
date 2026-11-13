export const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
export const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
export const ZIP_VERSION_20 = 20;
export const ZIP_COMPRESSION_STORE = 0;
export const ZIP_EOCD_BYTE_LENGTH = 22;

export const PARQUET_MAGIC_STRING = "PAR1";
export const PARQUET_FOOTER_LENGTH_BYTES = 4;
export const PARQUET_BYTE_ARRAY_TYPE = 6;
export const PARQUET_REQUIRED_REPETITION = 0;
export const PARQUET_UTF8_CONVERTED_TYPE = 0;
export const PARQUET_UNCOMPRESSED_CODEC = 0;
export const PARQUET_PLAIN_ENCODING = 0;
export const PARQUET_RLE_ENCODING = 3;

export const THRIFT_STOP = 0x00;
export const THRIFT_I32_DELTA_1 = 0x15;
export const THRIFT_I64_DELTA_1 = 0x16;
export const THRIFT_BINARY_DELTA_1 = 0x18;
export const THRIFT_LIST_DELTA_1 = 0x19;
export const THRIFT_STRUCT_DELTA_1 = 0x1c;
export const THRIFT_I32_DELTA_2 = 0x25;
export const THRIFT_I64_DELTA_2 = 0x26;
export const THRIFT_BINARY_DELTA_2 = 0x28;
export const THRIFT_STRUCT_DELTA_2 = 0x2c;
export const THRIFT_BINARY_DELTA_4 = 0x48;

export const CRC32_POLYNOMIAL = 0xedb88320;
export const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let checksum = index;
    for (let bit = 0; bit < 8; bit++) {
      checksum =
        checksum & 1 ? CRC32_POLYNOMIAL ^ (checksum >>> 1) : checksum >>> 1;
    }
    table[index] = checksum >>> 0;
  }
  return table;
})();
