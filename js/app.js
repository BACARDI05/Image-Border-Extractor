(() => {
const {
  applyMaskToCanvas,
  buildObjectMask,
  canvasFromImage,
  cloneCanvas,
  createImageWithBorder,
  createOutlineCanvas,
  downloadCanvas,
  drawCanvasInto,
  fileTypeLabel,
  formatBytes,
  hasTransparency,
  keepLargestComponent,
  loadImageFromFile,
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
  alphaReliable: true,
  selectionMode: 'brush',
  selectionPreview: false,
  drawing: false,
  renderTimer: 0,
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
  document.getElementById('downloadImageButton').disabled = !ready;
  document.getElementById('downloadOutlineButton').disabled = !ready;
}

function setEditorProcessing(message) {
  const warning = message || '';
  ui.setEditorWarning(warning);
  state.isRendering = Boolean(message);
  setDownloadsReady(!state.isRendering && Boolean(state.downloadImage && state.downloadOutline));
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
  state.file = null;
  state.original = null;
  state.editable = null;
  state.objectMask = null;
  state.selectionMask = null;
  state.downloadImage = null;
  state.downloadOutline = null;
  state.alphaReliable = true;
  state.selectionPreview = false;
  state.zoom = 1;
  el.fileInput.value = '';
  setUploadStatus('');
  setDownloadsReady(false);
  ui.setSelectionResultVisible(false);
  ui.setEditorWarning('');
  updateLabels();
  ui.showStep('upload');
}

async function handleFile(file) {
  if (!file) return;
  if (!isSupportedImage(file)) {
    setUploadStatus('Please upload PNG, JPG, JPEG, WEBP, or SVG.');
    return;
  }

  try {
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
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const image = await loadImageFromFile(file);
    validateImageSize(image);
    setUploadStatus('Detecting transparency...', true);

    state.original = canvasFromImage(image);
    state.editable = null;
    state.objectMask = null;
    state.selectionMask = null;
    ui.drawDetectionPreview(state.original);
    ui.setImageInfo({
      name: file.name,
      type: fileTypeLabel(file),
      size: formatBytes(file.size),
      width: state.original.width,
      height: state.original.height,
      transparent: false,
      transparentLabel: 'Checking...',
      status: 'Detecting transparency and preparing the next step...'
    });
    setUploadStatus('');
    ui.showStep('detect');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const transparent = hasTransparency(state.original);
    ui.setImageInfo({
      name: file.name,
      type: fileTypeLabel(file),
      size: formatBytes(file.size),
      width: state.original.width,
      height: state.original.height,
      transparent
    });

    window.setTimeout(() => {
      if (transparent) {
        startEditor(cloneCanvas(state.original), true);
      } else {
        ui.showStep('decision');
      }
    }, 650);
  } catch (error) {
    setUploadStatus(error.message || 'This image could not be loaded. Try another file.');
    ui.showStep('upload');
  } finally {
    el.dropZone.classList.remove('loading');
  }
}

function buildInitialSelection() {
  state.selectionMask = buildObjectMask(state.original, { threshold: 42 });
  state.selectionPreview = false;
  ui.drawSelectionCanvas(el.selectionCanvas, state.original, state.selectionMask, false);
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

function confirmSelection() {
  if (!state.selectionMask) return;
  const mask = keepLargestComponent(state.selectionMask, state.original.width, state.original.height);
  const transparentObject = applyMaskToCanvas(state.original, mask);
  state.editable = transparentObject;
  state.objectMask = mask;
  drawCanvasInto(el.selectionPreviewCanvas, transparentObject);
  ui.setSelectionResultVisible(true);
}

function startEditor(canvas, alphaReliable) {
  state.editable = canvas;
  state.alphaReliable = alphaReliable;
  state.downloadImage = null;
  state.downloadOutline = null;
  setDownloadsReady(false);
  ui.setEditorWarning(alphaReliable ? '' : 'Background removal was skipped, so border detection is estimated and may be less accurate.');
  ui.showStep('editor');
  setEditorProcessing('Processing outline...');
  window.setTimeout(() => {
    try {
      state.objectMask = buildObjectMask(canvas, { forceAlpha: alphaReliable });
      scheduleRender();
    } catch (error) {
      ui.setEditorWarning(error.message || 'Outline processing failed. Try another image.');
      setDownloadsReady(false);
    }
  }, 30);
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
  const outline = createOutlineCanvas(state.objectMask, state.editable.width, state.editable.height, settings);
  const imageWithBorder = createImageWithBorder(state.editable, outline, settings);
  state.downloadOutline = outline;
  state.downloadImage = createImageWithBorder(state.editable, outline, { ...settings, showOutline: true });
  drawCanvasInto(el.outlineOnly, outline);
  drawCanvasInto(el.imageWithBorder, imageWithBorder);
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
