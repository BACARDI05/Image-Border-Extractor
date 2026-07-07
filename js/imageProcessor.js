(() => {
const QUALITY_MODES = {
  mobile: { label: 'Mobile Safe', maxSide: 1024 },
  balanced: { label: 'Balanced', maxSide: 1536 },
  high: { label: 'High Quality', maxSide: 2048 }
};
const LARGE_INPUT_PIXELS = 12000000;
const EXTREME_INPUT_PIXELS = 80000000;
const EXTREME_FILE_BYTES = 60 * 1024 * 1024;

function isLowMemoryDevice() {
  const memory = navigator.deviceMemory || 8;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const narrowViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) <= 820;
  return memory <= 4 || Boolean(coarsePointer && narrowViewport);
}

function defaultQualityMode() {
  return isLowMemoryDevice() ? 'mobile' : 'balanced';
}

function qualityMaxSide(mode) {
  return QUALITY_MODES[mode]?.maxSide || QUALITY_MODES.balanced.maxSide;
}

function clearCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

async function loadImageFromFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  const loadPromise = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('Image could not be loaded.'));
  });
  image.src = url;

  try {
    if ('decode' in image) {
      try {
        await image.decode();
        return image;
      } catch {
        if (image.complete && image.naturalWidth) return image;
      }
    }

    await loadPromise;
    return image;
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function validateFileSafety(file) {
  if (file.size > EXTREME_FILE_BYTES) {
    throw new Error('Image file is too large. Use an image under 60 MB.');
  }
}

function validateImageSize(image) {
  const pixels = image.naturalWidth * image.naturalHeight;
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error('Image has invalid dimensions.');
  }
  if (pixels > EXTREME_INPUT_PIXELS) {
    throw new Error('Image is too large. Use an image under 80 megapixels.');
  }
}

function imageNeedsOptimization(image) {
  return image.naturalWidth * image.naturalHeight > LARGE_INPUT_PIXELS;
}

function fileTypeLabel(file) {
  if (file.type === 'image/svg+xml') return 'SVG';
  const ext = file.name.split('.').pop()?.toUpperCase() || 'Image';
  return ext === 'JPG' ? 'JPEG' : ext;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}

function canvasFromImage(image, maxSide = QUALITY_MODES.balanced.maxSide) {
  validateImageSize(image);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function cloneCanvas(source) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d').drawImage(source, 0, 0);
  return canvas;
}

function hasTransparency(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      imageData = null;
      return true;
    }
  }
  imageData = null;
  return false;
}

function estimateBackground(data, width, height) {
  const samples = [];
  const marginX = Math.max(1, Math.floor(width * 0.04));
  const marginY = Math.max(1, Math.floor(height * 0.04));
  const points = [
    [marginX, marginY],
    [width - marginX - 1, marginY],
    [marginX, height - marginY - 1],
    [width - marginX - 1, height - marginY - 1]
  ];

  points.forEach(([cx, cy]) => {
    for (let y = Math.max(0, cy - 4); y <= Math.min(height - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(width - 1, cx + 4); x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] > 8) samples.push([data[i], data[i + 1], data[i + 2]]);
      }
    }
  });

  if (!samples.length) return { r: 255, g: 255, b: 255 };
  const sum = samples.reduce((acc, sample) => {
    acc.r += sample[0];
    acc.g += sample[1];
    acc.b += sample[2];
    return acc;
  }, { r: 0, g: 0, b: 0 });

  return {
    r: sum.r / samples.length,
    g: sum.g / samples.length,
    b: sum.b / samples.length
  };
}

function colorDistance(data, index, color) {
  const dr = data[index] - color.r;
  const dg = data[index + 1] - color.g;
  const db = data[index + 2] - color.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function alphaEdgeMask(data, width, height) {
  const strong = new Uint8Array(width * height);
  let visible = 0;
  let strongVisible = 0;

  for (let p = 0, i = 0; p < strong.length; p++, i += 4) {
    const alpha = data[i + 3];
    if (alpha > 16) visible++;
    if (alpha > 96) {
      strong[p] = 1;
      strongVisible++;
    }
  }

  if (!strongVisible || strongVisible < visible * 0.2) return null;

  let nearStrong = strong;
  const passes = Math.max(2, Math.min(8, Math.round(Math.max(width, height) * 0.006)));
  for (let pass = 0; pass < passes; pass++) {
    nearStrong = dilateMask(nearStrong, width, height);
  }

  const mask = new Uint8Array(width * height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const alpha = data[i + 3];
    mask[p] = alpha > 96 || (alpha > 28 && nearStrong[p]) ? 1 : 0;
  }

  return mask;
}

function buildObjectMask(canvas, options = {}) {
  const threshold = options.threshold ?? 46;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  const background = estimateBackground(data, width, height);
  let semiTransparent = 0;
  let visible = 0;

  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (data[i + 3] > 16) visible++;
    if (data[i + 3] > 16 && data[i + 3] < 250) semiTransparent++;
  }

  const useAlpha = options.forceAlpha || semiTransparent > visible * 0.01;

  if (useAlpha) {
    const alphaMask = alphaEdgeMask(data, width, height);
    if (alphaMask) {
      mask.set(alphaMask);
    } else {
      for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
        mask[p] = data[i + 3] > 28 ? 1 : 0;
      }
    }
  } else {
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (data[i + 3] <= 16) {
        mask[p] = 0;
      } else {
        mask[p] = colorDistance(data, i, background) > threshold ? 1 : 0;
      }
    }
  }

  const result = smoothMask(closeMask(keepLargestComponent(mask, width, height), width, height), width, height, 1);
  imageData = null;
  return result;
}

function closeMask(mask, width, height) {
  return erodeMask(dilateMask(mask, width, height), width, height);
}

function dilateMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = false;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1 && !on; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          on = nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx];
        }
      }
      next[y * width + x] = on ? 1 : 0;
    }
  }
  return next;
}

function erodeMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx]) count++;
        }
      }
      next[y * width + x] = count >= 5 ? 1 : 0;
    }
  }
  return next;
}

function keepLargestComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = [];
  let best = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const component = [];
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      const x = p % width;
      component.push(p);
      const neighbors = [p - width, p + width];
      if (x > 0) neighbors.push(p - 1);
      if (x < width - 1) neighbors.push(p + 1);
      neighbors.forEach((n) => {
        if (n >= 0 && n < mask.length && mask[n] && !visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      });
    }

    if (component.length > best.length) best = component;
  }

  const result = new Uint8Array(mask.length);
  best.forEach((p) => { result[p] = 1; });
  return result;
}

function smoothMask(mask, width, height, passes) {
  let current = mask;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(current.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && current[ny * width + nx]) count++;
          }
        }
        next[y * width + x] = count >= 5 ? 1 : 0;
      }
    }
    current = next;
  }
  return current;
}

function maskToCanvas(mask, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    imageData.data[i] = 255;
    imageData.data[i + 1] = 255;
    imageData.data[i + 2] = 255;
    imageData.data[i + 3] = mask[p] ? 255 : 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function applyMaskToCanvas(source, mask) {
  const output = cloneCanvas(source);
  const ctx = output.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, output.width, output.height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    imageData.data[i + 3] = mask[p] ? imageData.data[i + 3] : 0;
  }
  ctx.putImageData(imageData, 0, 0);
  return output;
}

function createOutlineCanvas(mask, width, height, settings) {
  const padding = settings.padding;
  const outWidth = width + padding * 2;
  const outHeight = height + padding * 2;
  const baseMask = maskToCanvas(mask, width, height);
  const filledMask = document.createElement('canvas');
  filledMask.width = outWidth;
  filledMask.height = outHeight;
  const filledCtx = filledMask.getContext('2d');
  filledCtx.filter = settings.smoothness ? `blur(${settings.smoothness}px)` : 'none';
  filledCtx.drawImage(baseMask, padding, padding);
  filledCtx.filter = 'none';
  filledCtx.globalCompositeOperation = 'source-in';
  filledCtx.fillStyle = '#fff';
  filledCtx.fillRect(0, 0, outWidth, outHeight);
  filledCtx.globalCompositeOperation = 'source-over';

  const outline = document.createElement('canvas');
  outline.width = outWidth;
  outline.height = outHeight;
  const ctx = outline.getContext('2d');
  ctx.save();
  ctx.filter = settings.smoothness ? `blur(${Math.max(0.35, settings.smoothness / 2)}px)` : 'none';
  const radius = Math.max(1, settings.thickness);
  for (let angle = 0; angle < 360; angle += 10) {
    const radians = angle * Math.PI / 180;
    ctx.drawImage(filledMask, Math.cos(radians) * radius, Math.sin(radians) * radius);
  }
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(filledMask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = settings.color;
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.restore();
  clearCanvas(baseMask);
  clearCanvas(filledMask);
  return outline;
}

function createImageWithBorder(source, outline, settings) {
  const output = document.createElement('canvas');
  output.width = outline.width;
  output.height = outline.height;
  const ctx = output.getContext('2d');

  if (!settings.transparentBackground) {
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, output.width, output.height);
  }

  if (settings.showOutline) ctx.drawImage(outline, 0, 0);
  ctx.drawImage(source, settings.padding, settings.padding);
  return output;
}

function drawCanvasInto(target, source) {
  target.width = source.width;
  target.height = source.height;
  target.getContext('2d').clearRect(0, 0, target.width, target.height);
  target.getContext('2d').drawImage(source, 0, 0);
}

function downloadCanvas(canvas, fileName, onSuccess) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    if (typeof onSuccess === 'function') onSuccess();
  }, 'image/png');
}

window.ImageProcessor = {
  QUALITY_MODES,
  applyMaskToCanvas,
  buildObjectMask,
  canvasFromImage,
  clearCanvas,
  cloneCanvas,
  createImageWithBorder,
  createOutlineCanvas,
  defaultQualityMode,
  downloadCanvas,
  drawCanvasInto,
  fileTypeLabel,
  formatBytes,
  hasTransparency,
  imageNeedsOptimization,
  keepLargestComponent,
  loadImageFromFile,
  qualityMaxSide,
  validateFileSafety,
  validateImageSize
};
})();
