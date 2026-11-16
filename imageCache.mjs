import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const safeMetadata = (value) => {
  try {
    const metadata = JSON.parse(value);
    return typeof metadata.contentType === 'string' && metadata.contentType.startsWith('image/') ? metadata : null;
  } catch { return null; }
};

export const createImageCache = ({ directory, fetchImage, maximumBytes = 5_000_000, onEvent = () => {} }) => {
  const read = (url) => {
    const key = createHash('sha256').update(url).digest('hex');
    const bodyPath = resolve(directory, `${key}.bin`);
    const metadataPath = resolve(directory, `${key}.json`);
    if (!existsSync(bodyPath) || !existsSync(metadataPath)) return null;
    const metadata = safeMetadata(readFileSync(metadataPath, 'utf8'));
    if (!metadata) return null;
    const bytes = readFileSync(bodyPath);
    if (bytes.byteLength > maximumBytes) return null;
    return { bytes, contentType: metadata.contentType, cacheHit: true };
  };

  const store = (url, bytes, contentType) => {
    if (!contentType.startsWith('image/') || bytes.byteLength > maximumBytes) throw new Error('INVALID_IMAGE');
    mkdirSync(directory, { recursive: true });
    const key = createHash('sha256').update(url).digest('hex');
    const bodyPath = resolve(directory, `${key}.bin`);
    const metadataPath = resolve(directory, `${key}.json`);
    const temporaryBody = resolve(directory, `${key}.${process.pid}.tmp`);
    const temporaryMetadata = resolve(directory, `${key}.${process.pid}.json.tmp`);
    writeFileSync(temporaryBody, bytes);
    writeFileSync(temporaryMetadata, JSON.stringify({ contentType, sourceHash: key, cachedAt: new Date().toISOString() }));
    renameSync(temporaryBody, bodyPath);
    renameSync(temporaryMetadata, metadataPath);
    return { bytes, contentType, cacheHit: false };
  };

  const resolveImage = async (url) => {
    const cached = read(url);
    if (cached) {
      onEvent('IMAGE_CACHE_HIT', { sourceHash: createHash('sha256').update(url).digest('hex') });
      return cached;
    }
    const fetched = await fetchImage(url, maximumBytes);
    const stored = store(url, fetched.bytes, fetched.contentType);
    onEvent('IMAGE_PROXIED', { sourceHash: createHash('sha256').update(url).digest('hex'), contentType: fetched.contentType });
    return stored;
  };

  return { read, resolve: resolveImage };
};
