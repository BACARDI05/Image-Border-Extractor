(() => {
const {
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
} = window.ImageProcessor;
const { UIController } = window;

const ui = new UIController();

const state = {
  file: null,
  original: null,
  editable: null,
  objectMask: null,
  selectionMask: null,
  downloadImage: null,
  downloadOutline: null,
  isRendering: false,
  isProcessing: false,
  alphaReliable: true,
  selectionMode: 'brush',
  selectionPreview: false,
  drawing: false,
  renderTimer: 0,
  animationFrameId: 0,
  processId: 0,
  cachedMaskKey: '',
  cachedRenderKey: '',
  zoom: 1
};

const el = {
  fileInput: document.getElementById('fileInput'),
  dropZone: document.getElementById('dropZone'),
  uploadStatus: document.getElementById('uploadStatus'),
  selectionCanvas: document.getElementById('selectionCanvas'),
  selectionPreviewCanvas: document.getElementById('selectionPreviewCanvas'),
  brushSize: document.getElementById('brushSize'),
  brushSizeValue: document.getElementById('brushSizeValue'),
  brushMode: document.getElementById('brushMode'),
  eraseMode: document.getElementById('eraseMode'),
  outlineColor: document.getElementById('outlineColor'),
  thickness: document.getElementById('thickness'),
  smoothness: document.getElementById('smoothness'),
  padding: document.getElementById('padding'),
  showOutline: document.getElementById('showOutlineOnOriginal'),
  transparentBackground: document.getElementById('transparentBackground'),
  qualityMode: document.getElementById('qualityMode'),
  imageWithBorder: document.getElementById('imageWithBorderCanvas'),
  outlineOnly: document.getElementById('outlineOnlyCanvas'),
  thicknessValue: document.getElementById('thicknessValue'),
  smoothnessValue: document.getElementById('smoothnessValue'),
  paddingValue: document.getElementById('paddingValue'),
  zoomValue: document.getElementById('zoomValue')
};

const counter = {
  key: 'ibeSuccessfulFilesConverted',
  node: document.getElementById('conversionCounter')
};

function isSupportedImage(file) {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
  const supportedExtensions = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  const extension = file.name.split('.').pop()?.toLowerCase();
  return supportedTypes.includes(file.type) || supportedExtensions.includes(extension);
}

function setUploadStatus(message, loading = false) {
  el.uploadStatus.textContent = message;
  el.dropZone.classList.toggle('loading', loading);
}

function getConversionCount() {
  return Number.parseInt(localStorage.getItem(counter.key) || '0', 10) || 0;
}

function renderConversionCount() {
  counter.node.textContent = getConversionCount().toLocaleString();
}

function incrementConversionCount() {
  localStorage.setItem(counter.key, String(getConversionCount() + 1));
  renderConversionCount();
}

function setDownloadsReady(ready) {
  document.getElementById('downloadImageButton').disabled = !ready || state.isProcessing;
  document.getElementById('downloadOutlineButton').disabled = !ready || state.isProcessing;
}

function setControlsLocked(locked) {
  state.isProcessing = locked;
  [
    el.fileInput,
    document.getElementById('removeBgButton'),
    document.getElementById('skipBgButton'),
    document.getElementById('resetSelectionButton'),
    document.getElementById('previewSelectionButton'),
    document.getElementById('confirmSelectionButton'),
    document.getElementById('continueEditorButton'),
    document.getElementById('downloadImageButton'),
    document.getElementById('downloadOutlineButton')
  ].forEach((node) => {
    if (node) node.disabled = locked || (node.id?.startsWith('download') && !(state.downloadImage && state.downloadOutline));
  });
  el.dropZone.classList.toggle('loading', locked);
}

function setEditorProcessing(message) {
  const warning = message || '';
  ui.setEditorWarning(warning);
  state.isRendering = Boolean(message);
  setDownloadsReady(!state.isRendering && Boolean(state.downloadImage && state.downloadOutline));
}

function nextFrame() {
  cancelAnimation();
  return new Promise((resolve) => {
    state.animationFrameId = requestAnimationFrame(() => {
      state.animationFrameId = 0;
      resolve();
    });
  });
}

function cancelAnimation() {
  if (!state.animationFrameId) return;
  cancelAnimationFrame(state.animationFrameId);
  state.animationFrameId = 0;
}

function cancelWork() {
  state.processId++;
  cancelAnimation();
  window.clearTimeout(state.renderTimer);
  state.renderTimer = 0;
  state.drawing = false;
  setControlsLocked(false);
}

function assertCurrent(processId) {
  if (processId !== state.processId) throw new Error('Processing was cancelled.');
}

function releaseCanvas(name) {
  if (state[name]) {
    clearCanvas(state[name]);
    state[name] = null;
  }
}

function releaseGeneratedCanvases() {
  releaseCanvas('downloadImage');
  releaseCanvas('downloadOutline');
}

function currentSettings() {
  return {
    color: el.outlineColor.value,
    thickness: Number(el.thickness.value),
    smoothness: Number(el.smoothness.value),
    padding: Number(el.padding.value),
    showOutline: el.showOutline.checked,
    transparentBackground: el.transparentBackground.checked
  };
}

function updateLabels() {
  el.brushSizeValue.textContent = `${el.brushSize.value} px`;
  el.thicknessValue.textContent = `${el.thickness.value} px`;
  el.smoothnessValue.textContent = el.smoothness.value;
  el.paddingValue.textContent = `${el.padding.value} px`;
  el.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  document.querySelectorAll('.canvas-frame').forEach((frame) => {
    frame.style.setProperty('--zoom', state.zoom);
  });
}

function resetAll() {
  cancelWork();
  releaseCanvas('original');
  releaseCanvas('editable');
  releaseGeneratedCanvases();
  state.file = null;
  state.objectMask = null;
  state.selectionMask = null;
  state.alphaReliable = true;
  state.selectionPreview = false;
  state.cachedMaskKey = '';
  state.cachedRenderKey = '';
  state.zoom = 1;
  el.fileInput.value = '';
  setUploadStatus('');
  setDownloadsReady(false);
  ui.setSelectionResultVisible(false);
  ui.setEditorWarning('');
  [document.getElementById('detectCanvas'), el.selectionCanvas, el.selectionPreviewCanvas, el.imageWithBorder, el.outlineOnly].forEach(clearCanvas);
  updateLabels();
  ui.showStep('upload');
}

async function handleFile(file) {
  if (!file) return;
  const processId = state.processId + 1;
  cancelWork();
  state.processId = processId;
  releaseCanvas('original');
  releaseCanvas('editable');
  releaseGeneratedCanvases();
  state.objectMask = null;
  state.selectionMask = null;
  state.cachedMaskKey = '';
  state.cachedRenderKey = '';
  if (!isSupportedImage(file)) {
    setUploadStatus('Please upload PNG, JPG, JPEG, WEBP, or SVG.');
    return;
  }

  try {
    validateFileSafety(file);
    setControlsLocked(true);
    state.file = file;
    setUploadStatus(`Loading ${file.name}...`, true);
    ui.setImageInfo({
      name: file.name,
      type: fileTypeLabel(file),
      size: formatBytes(file.size),
      width: '',
      height: '',
      dimensionsLabel: 'Loading...',
      transparent: false,
      transparentLabel: 'Waiting...',
      status: 'Loading image and preparing detection...'
    });
    ui.showStep('detect');
    await nextFrame();
    assertCurrent(processId);

    const image = await loadImageFromFile(file);
    assertCurrent(processId);
    validateImageSize(image);
    const maxSide = qualityMaxSide(el.qualityMode.value);
    const optimizing = imageNeedsOptimization(image) || Math.max(image.naturalWidth, image.naturalHeight) > maxSide;
    setUploadStatus(optimizing
      ? 'Large image detected. Using optimized processing mode to prevent browser crash.'
      : 'Detecting transparency...', true);

    state.original = canvasFromImage(image, maxSide);
    assertCurrent(processId);
    await nextFrame();
    assertCurrent(processId);
    ui.drawDetectionPreview(state.original);
    ui.setImageInfo({
      name: file.name,
      type: fileTypeLabel(file),
      size: formatBytes(file.size),
      width: state.original.width,
      height: state.original.height,
      transparent: false,
      transparentLabel: 'Checking...',
      status: optimizing
        ? 'Large image detected. Using optimized processing mode to prevent browser crash.'
        : 'Detecting transparency and preparing the next step...'
    });
    if (optimizing) setUploadStatus('Large image detected. Using optimized processing mode to prevent browser crash.', true);
    ui.showStep('detect');
    await nextFrame();
    assertCurrent(processId);
    const transparent = hasTransparency(state.original);
    assertCurrent(processId);
    ui.setImageInfo({
      name: file.name,
      type: fileTypeLabel(file),
      size: formatBytes(file.size),
      width: state.original.width,
      height: state.original.height,
      transparent,
      status: optimizing
        ? 'Large image detected. Using optimized processing mode to prevent browser crash.'
        : undefined
    });

    window.setTimeout(() => {
      if (processId !== state.processId) return;
      setControlsLocked(false);
      setUploadStatus('');
      if (transparent) {
        startEditor(cloneCanvas(state.original), true);
      } else {
        ui.showStep('decision');
      }
    }, 650);
  } catch (error) {
    if (error.message !== 'Processing was cancelled.') {
      setUploadStatus(error.message || 'This image could not be loaded. Try another file.');
      ui.showStep('upload');
    }
  } finally {
    if (processId === state.processId) setControlsLocked(false);
  }
}

async function buildInitialSelection() {
  const processId = state.processId + 1;
  cancelWork();
  state.processId = processId;
  setControlsLocked(true);
  setUploadStatus('Building selection mask...', true);
  try {
    await nextFrame();
    assertCurrent(processId);
    state.selectionMask = buildObjectMask(state.original, { threshold: 42 });
    assertCurrent(processId);
    state.selectionPreview = false;
    ui.drawSelectionCanvas(el.selectionCanvas, state.original, state.selectionMask, false);
    setUploadStatus('');
  } catch (error) {
    if (error.message !== 'Processing was cancelled.') {
      setUploadStatus(error.message || 'Selection processing failed.');
    }
  } finally {
    if (processId === state.processId) setControlsLocked(false);
  }
}

function startSelection() {
  buildInitialSelection();
  ui.setSelectionResultVisible(false);
  ui.showStep('selection');
}

function drawBrush(event) {
  if (!state.drawing || !state.selectionMask) return;
  const rect = el.selectionCanvas.getBoundingClientRect();
  const scaleX = el.selectionCanvas.width / rect.width;
  const scaleY = el.selectionCanvas.height / rect.height;
  const x = Math.round((event.clientX - rect.left) * scaleX);
  const y = Math.round((event.clientY - rect.top) * scaleY);
  const radius = Math.round(Number(el.brushSize.value) / 2);
  const value = state.selectionMode === 'brush' ? 1 : 0;

  for (let yy = y - radius; yy <= y + radius; yy++) {
    for (let xx = x - radius; xx <= x + radius; xx++) {
      if (xx < 0 || yy < 0 || xx >= state.original.width || yy >= state.original.height) continue;
      const dx = xx - x;
      const dy = yy - y;
      if (dx * dx + dy * dy <= radius * radius) {
        state.selectionMask[yy * state.original.width + xx] = value;
      }
    }
  }

  ui.drawSelectionCanvas(el.selectionCanvas, state.original, state.selectionMask, state.selectionPreview);
}

async function confirmSelection() {
  if (!state.selectionMask) return;
  const processId = state.processId + 1;
  cancelWork();
  state.processId = processId;
  setControlsLocked(true);
  setUploadStatus('Preparing transparent preview...', true);
  try {
    await nextFrame();
    assertCurrent(processId);
    const mask = keepLargestComponent(state.selectionMask, state.original.width, state.original.height);
    const transparentObject = applyMaskToCanvas(state.original, mask);
    assertCurrent(processId);
    releaseCanvas('editable');
    state.editable = transparentObject;
    state.objectMask = mask;
    state.cachedMaskKey = `${state.original.width}x${state.original.height}:alpha`;
    drawCanvasInto(el.selectionPreviewCanvas, transparentObject);
    ui.setSelectionResultVisible(true);
    setUploadStatus('');
  } catch (error) {
    if (error.message !== 'Processing was cancelled.') {
      setUploadStatus(error.message || 'Selection preview failed.');
    }
  } finally {
    if (processId === state.processId) setControlsLocked(false);
  }
}

async function startEditor(canvas, alphaReliable) {
  const processId = state.processId + 1;
  cancelWork();
  state.processId = processId;
  releaseGeneratedCanvases();
  state.editable = canvas;
  state.alphaReliable = alphaReliable;
  state.cachedRenderKey = '';
  setDownloadsReady(false);
  ui.setEditorWarning(alphaReliable ? '' : 'Background removal was skipped, so border detection is estimated and may be less accurate.');
  ui.showStep('editor');
  setEditorProcessing('Processing outline...');
  setControlsLocked(true);
  try {
    await nextFrame();
    assertCurrent(processId);
    const maskKey = `${canvas.width}x${canvas.height}:${alphaReliable ? 'alpha' : 'estimate'}`;
    if (!state.objectMask || state.cachedMaskKey !== maskKey) {
      state.objectMask = buildObjectMask(canvas, { forceAlpha: alphaReliable });
      state.cachedMaskKey = maskKey;
    }
    assertCurrent(processId);
    setControlsLocked(false);
    scheduleRender();
  } catch (error) {
    if (error.message !== 'Processing was cancelled.') {
      ui.setEditorWarning(error.message || 'Outline processing failed. Try another image.');
      setDownloadsReady(false);
    }
    setControlsLocked(false);
  }
}

function scheduleRender() {
  updateLabels();
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderEditor, 70);
}

function renderEditor() {
  if (!state.editable || !state.objectMask) return;
  setDownloadsReady(false);
  const settings = currentSettings();
  const renderKey = JSON.stringify(settings);
  if (state.cachedRenderKey === renderKey && state.downloadImage && state.downloadOutline) {
    setDownloadsReady(true);
    return;
  }
  releaseGeneratedCanvases();
  const outline = createOutlineCanvas(state.objectMask, state.editable.width, state.editable.height, settings);
  const imageWithBorder = createImageWithBorder(state.editable, outline, settings);
  state.downloadOutline = outline;
  state.downloadImage = createImageWithBorder(state.editable, outline, { ...settings, showOutline: true });
  drawCanvasInto(el.outlineOnly, outline);
  drawCanvasInto(el.imageWithBorder, imageWithBorder);
  clearCanvas(imageWithBorder);
  state.cachedRenderKey = renderKey;
  state.isRendering = false;
  ui.setEditorWarning(state.alphaReliable ? '' : 'Background removal was skipped, so border detection is estimated and may be less accurate.');
  setDownloadsReady(true);
}

function setSelectionMode(mode) {
  state.selectionMode = mode;
  el.brushMode.classList.toggle('active', mode === 'brush');
  el.eraseMode.classList.toggle('active', mode === 'erase');
}

function setColor(color) {
  el.outlineColor.value = color;
  document.querySelectorAll('.color-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.color === color);
  });
  scheduleRender();
}

function resetSettings() {
  el.outlineColor.value = '#05070d';
  el.thickness.value = 12;
  el.smoothness.value = 2;
  el.padding.value = 32;
  el.showOutline.checked = true;
  el.transparentBackground.checked = true;
  setColor('#05070d');
  scheduleRender();
}

el.qualityMode.value = defaultQualityMode();

el.dropZone.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  el.fileInput.value = '';
  el.fileInput.click();
});

el.fileInput.addEventListener('click', () => {
  el.fileInput.value = '';
});

el.fileInput.addEventListener('change', (event) => handleFile(event.target.files[0]));

['dragenter', 'dragover'].forEach((type) => {
  el.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((type) => {
  el.dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropZone.classList.remove('dragging');
  });
});

el.dropZone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));

document.getElementById('removeBgButton').addEventListener('click', startSelection);
document.getElementById('skipBgButton').addEventListener('click', () => startEditor(cloneCanvas(state.original), false));
document.getElementById('restartFromDecisionButton').addEventListener('click', resetAll);
document.getElementById('restartFromSelectionButton').addEventListener('click', resetAll);
document.getElementById('uploadAnotherButton').addEventListener('click', resetAll);

el.brushMode.addEventListener('click', () => setSelectionMode('brush'));
el.eraseMode.addEventListener('click', () => setSelectionMode('erase'));
el.brushSize.addEventListener('input', updateLabels);
document.getElementById('resetSelectionButton').addEventListener('click', buildInitialSelection);
document.getElementById('previewSelectionButton').addEventListener('click', () => {
  state.selectionPreview = !state.selectionPreview;
  ui.drawSelectionCanvas(el.selectionCanvas, state.original, state.selectionMask, state.selectionPreview);
});
document.getElementById('confirmSelectionButton').addEventListener('click', confirmSelection);
document.getElementById('refineSelectionButton').addEventListener('click', () => ui.setSelectionResultVisible(false));
document.getElementById('continueEditorButton').addEventListener('click', () => startEditor(state.editable, true));

el.selectionCanvas.addEventListener('pointerdown', (event) => {
  state.drawing = true;
  el.selectionCanvas.setPointerCapture(event.pointerId);
  drawBrush(event);
});
el.selectionCanvas.addEventListener('pointermove', drawBrush);
el.selectionCanvas.addEventListener('pointerup', () => { state.drawing = false; });
el.selectionCanvas.addEventListener('pointercancel', () => { state.drawing = false; });

[el.outlineColor, el.thickness, el.smoothness, el.padding, el.showOutline, el.transparentBackground].forEach((control) => {
  control.addEventListener('input', scheduleRender);
  control.addEventListener('change', scheduleRender);
});

el.qualityMode.addEventListener('change', () => {
  cancelWork();
  setUploadStatus('Performance mode will apply to the next uploaded image.');
});

document.querySelectorAll('.color-chip').forEach((chip) => {
  chip.addEventListener('click', () => setColor(chip.dataset.color));
});

document.getElementById('resetSettingsButton').addEventListener('click', resetSettings);
document.getElementById('zoomInButton').addEventListener('click', () => {
  state.zoom = Math.min(2, state.zoom + 0.1);
  updateLabels();
});
document.getElementById('zoomOutButton').addEventListener('click', () => {
  state.zoom = Math.max(0.4, state.zoom - 0.1);
  updateLabels();
});

document.getElementById('downloadImageButton').addEventListener('click', () => {
  if (!state.downloadImage) return;
  downloadCanvas(state.downloadImage, 'image-with-border.png', incrementConversionCount);
});
document.getElementById('downloadOutlineButton').addEventListener('click', () => {
  if (!state.downloadOutline) return;
  downloadCanvas(state.downloadOutline, 'extracted-outline.png', incrementConversionCount);
});

renderConversionCount();
setDownloadsReady(false);
updateLabels();
ui.showStep('upload');
})();

/*
Version 1.0 Launch Ready smoke checklist:
- Upload PNG through the native file input.
- Upload JPG/JPEG, WEBP, and SVG.
- Drag and drop an image onto the upload card.
- Press Enter/Space on the upload card.
- Skip background removal and open the editor.
- Remove/refine background selection and continue to editor.
- Edit outline color, thickness, smoothness, and padding.
- Download image-with-border.png.
- Download extracted-outline.png.
*/
