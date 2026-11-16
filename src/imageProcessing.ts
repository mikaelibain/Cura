const maxDimension = 720;

export type PolygonPoint = { x: number; y: number };
type StickerResult = { imageUrl: string; productScore: number };

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be opened.'));
    image.src = source;
  });

/**
 * The segmentation model needs the original pixels, not an already
 * background-erased sticker. It is resized only to keep the request quick.
 */
export const makeInferenceImage = async (file: File): Promise<string> => {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable in this browser.');
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

// This is only a temporary, compressed copy for visual search. It never
// changes the image saved on the board and does not remove any background.
export const makeSearchImage = async (source: string): Promise<string> => {
  const image = await loadImage(source);
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.68);
};

export type ImageCrop = { x: number; y: number; width: number; height: number };

export const defaultCropForPiece = (piece: string): ImageCrop => {
  const label = piece.toLowerCase();
  if (/top|shirt|blouse|sweater|cardigan|bra/.test(label)) return { x: 0.12, y: 0.1, width: 0.76, height: 0.43 };
  if (/bottom|skirt|pant|trouser|short|jean/.test(label)) return { x: 0.12, y: 0.32, width: 0.76, height: 0.64 };
  if (/shoe|boot|heel|sandal|sneaker/.test(label)) return { x: 0.14, y: 0.7, width: 0.72, height: 0.3 };
  if (/bag|purse|tote|handbag/.test(label)) return { x: 0.32, y: 0.44, width: 0.46, height: 0.3 };
  if (/outerwear|jacket|coat|blazer/.test(label)) return { x: 0.1, y: 0.06, width: 0.8, height: 0.64 };
  if (/dress|jumpsuit|gown/.test(label)) return { x: 0.08, y: 0.04, width: 0.84, height: 0.92 };
  return { x: 0.1, y: 0.08, width: 0.8, height: 0.72 };
};

// Temporary item-specific zoom for visual search; the saved board image stays intact.
export const makePieceSearchImage = async (source: string, piece: string, selectedCrop?: ImageCrop): Promise<string> => {
  const readableSource = source.startsWith('data:image/') ? source : `/api/image-proxy?url=${encodeURIComponent(source)}`;
  const image = await loadImage(readableSource);
  const crop = selectedCrop ?? defaultCropForPiece(piece);
  const sourceX = Math.round(image.naturalWidth * crop.x);
  const sourceY = Math.round(image.naturalHeight * crop.y);
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth * crop.width));
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight * crop.height));
  const scale = Math.min(1, 720 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser.');
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
};

/**
 * Turns the common clean retailer-photo background transparent. It intentionally
 * only removes near-white/near-neutral pixels, so it never tries to guess at or
 * erase the garment itself. More robust image segmentation belongs in the later
 * server-backed processing service.
 */
const makeStickerImageWithScore = async (file: File): Promise<StickerResult> => {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) throw new Error('Image processing is unavailable in this browser.');

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);

    const data = pixels.data;
    const cornerOffsets = [0, width - 1, (height - 1) * width, height * width - 1];
    const cornerColours = cornerOffsets.map((offset) => {
      const index = offset * 4;
      return { red: data[index], green: data[index + 1], blue: data[index + 2] };
    });
    const visited = new Uint8Array(width * height);
    const pending: number[] = [];

    const isBackgroundLike = (pixel: number): boolean => {
      const index = pixel * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      return cornerColours.some((colour) =>
        Math.hypot(red - colour.red, green - colour.green, blue - colour.blue) < 42,
      );
    };

    const queue = (pixel: number) => {
      if (!visited[pixel] && isBackgroundLike(pixel)) {
        visited[pixel] = 1;
        pending.push(pixel);
      }
    };

    for (let x = 0; x < width; x += 1) {
      queue(x);
      queue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      queue(y * width);
      queue(y * width + width - 1);
    }

    while (pending.length > 0) {
      const pixel = pending.pop();
      if (pixel === undefined) continue;
      data[pixel * 4 + 3] = 0;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x > 0) queue(pixel - 1);
      if (x < width - 1) queue(pixel + 1);
      if (y > 0) queue(pixel - width);
      if (y < height - 1) queue(pixel + width);
    }

    let opaquePixels = 0;
    let skinLikePixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 40) continue;
      opaquePixels += 1;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
      if (red > 85 && green > 35 && blue > 18 && red > green && green > blue && spread > 18) skinLikePixels += 1;
    }
    context.putImageData(pixels, 0, 0);
    // Product-only gallery images rarely include a large skin-coloured area.
    // This is only a tie-breaker between a retailer's own gallery photos.
    const skinRatio = opaquePixels ? skinLikePixels / opaquePixels : 1;
    return { imageUrl: canvas.toDataURL('image/png'), productScore: 1 - skinRatio };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const makeStickerImage = async (file: File): Promise<string> => (await makeStickerImageWithScore(file)).imageUrl;

export const makeStickerFromUrl = async (imageUrl: string): Promise<string> => {
  const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
  if (!response.ok) throw new Error('The product image could not be retrieved.');
  const blob = await response.blob();
  return makeStickerImage(new File([blob], 'product-image', { type: blob.type || 'image/png' }));
};

export const makeBestStickerFromUrls = async (imageUrls: string[]): Promise<string> => {
  const uniqueUrls = [...new Set(imageUrls)].slice(0, 8);
  let best: StickerResult | null = null;
  for (let index = 0; index < uniqueUrls.length; index += 1) {
    try {
      const response = await fetch(`/api/image-proxy?url=${encodeURIComponent(uniqueUrls[index])}`);
      if (!response.ok) continue;
      const blob = await response.blob();
      const candidate = await makeStickerImageWithScore(new File([blob], 'product-image', { type: blob.type || 'image/png' }));
      // Preserve a little preference for the retailer's primary/pack-shot
      // order, but let a strong model-photo signal lose to a clean product shot.
      const score = candidate.productScore - index * 0.015;
      if (!best || score > best.productScore) best = { ...candidate, productScore: score };
    } catch {
      // One protected gallery image should not stop the remaining candidates.
    }
  }
  if (!best) throw new Error('No gallery image could be used.');
  return best.imageUrl;
};

export const makeStickerFromPolygon = async (imageDataUrl: string, points: PolygonPoint[]): Promise<string> => {
  const image = await loadImage(imageDataUrl);
  const hasNormalisedCoordinates = Math.max(...points.map((point) => Math.max(point.x, point.y))) <= 1.01;
  const scaledPoints = hasNormalisedCoordinates
    ? points.map((point) => ({ x: point.x * image.naturalWidth, y: point.y * image.naturalHeight }))
    : points;
  const left = Math.max(0, Math.floor(Math.min(...scaledPoints.map((point) => point.x))));
  const top = Math.max(0, Math.floor(Math.min(...scaledPoints.map((point) => point.y))));
  const right = Math.min(image.naturalWidth, Math.ceil(Math.max(...scaledPoints.map((point) => point.x))));
  const bottom = Math.min(image.naturalHeight, Math.ceil(Math.max(...scaledPoints.map((point) => point.y))));
  if (right - left < 8 || bottom - top < 8) throw new Error('The returned mask is too small to make a sticker.');
  const padding = 12;
  const width = Math.max(1, right - left + padding * 2);
  const height = Math.max(1, bottom - top + padding * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is unavailable in this browser.');

  context.beginPath();
  scaledPoints.forEach((point, index) => {
    const x = point.x - left + padding;
    const y = point.y - top + padding;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();
  context.clip();
  context.drawImage(image, -left + padding, -top + padding);
  return canvas.toDataURL('image/png');
};
