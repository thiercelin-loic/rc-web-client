export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
