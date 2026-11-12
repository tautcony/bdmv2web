/** A rendered PNG image asset ready for package embedding. */
export interface PngPayload { id: string; bytes: Uint8Array }
export interface PngBatch { index: number; assets: Array<{ id: string; dataUrl: string; byteLength: number }> }

export function makePngBatches(assets: PngPayload[], options: { maxAssetBytes?: number; maxBatchBytes?: number; maxTotalBytes?: number } = {}): PngBatch[] {
  const maxAssetBytes = options.maxAssetBytes ?? 1024 * 1024;
  const maxBatchBytes = options.maxBatchBytes ?? 4 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 64 * 1024 * 1024;
  for (const [name, value] of Object.entries({ maxAssetBytes, maxBatchBytes, maxTotalBytes })) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  const batches: PngBatch[] = []; let current: PngBatch = { index: 0, assets: [] }; let batchBytes = 0; let totalBytes = 0;
  for (const asset of assets) {
    const length = asset.bytes.byteLength;
    if (!isPng(asset.bytes)) throw new TypeError(`Image asset '${asset.id}' must be encoded as PNG before packaging.`);
    if (length > maxAssetBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxAssetBytes`);
    if (length > maxBatchBytes) throw new RangeError(`PNG asset '${asset.id}' exceeds maxBatchBytes`);
    totalBytes += length; if (totalBytes > maxTotalBytes) throw new RangeError("PNG assets exceed maxTotalBytes");
    if (current.assets.length && batchBytes + length > maxBatchBytes) { batches.push(current); current = { index: batches.length, assets: [] }; batchBytes = 0; }
    current.assets.push({ id: asset.id, dataUrl: `data:image/png;base64,${Buffer.from(asset.bytes).toString("base64")}`, byteLength: length }); batchBytes += length;
  }
  if (current.assets.length) batches.push(current);
  return batches;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}
