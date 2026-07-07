(() => {
const { drawCanvasInto } = window.ImageProcessor;

class UIController {
  constructor() {
    this.steps = {
      upload: document.getElementById('uploadStep'),
      detect: document.getElementById('detectStep'),
      decision: document.getElementById('decisionStep'),
      selection: document.getElementById('selectionStep'),
      editor: document.getElementById('editorStep')
    };
  }

  showStep(name) {
    Object.entries(this.steps).forEach(([key, element]) => {
      element.classList.toggle('active', key === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  setImageInfo(info) {
    const list = document.getElementById('imageInfo');
    list.innerHTML = '';
    [
      ['File name', info.name],
      ['File type', info.type],
      ['File size', info.size],
      ['Dimensions', info.dimensionsLabel || `${info.width} x ${info.height}`],
      ['Transparency', info.transparentLabel || (info.transparent ? 'Transparent alpha found' : 'No transparent pixels')]
    ].forEach(([label, value]) => {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      list.append(term, detail);
    });
    document.getElementById('detectStatus').textContent = info.status || (info.transparent
      ? 'This image is ready for clean alpha-based outline extraction.'
      : 'This image is opaque. Background removal can improve the extracted border.');
  }

  drawDetectionPreview(canvas) {
    drawCanvasInto(document.getElementById('detectCanvas'), canvas);
  }

  drawSelectionCanvas(target, source, mask, previewOnly) {
    target.width = source.width;
    target.height = source.height;
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, 0, 0);

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = target.width;
    overlayCanvas.height = target.height;
    const overlayCtx = overlayCanvas.getContext('2d');
    const overlay = overlayCtx.createImageData(target.width, target.height);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      if (!mask[p]) continue;
      overlay.data[i] = 125;
      overlay.data[i + 1] = 211;
      overlay.data[i + 2] = 252;
      overlay.data[i + 3] = previewOnly ? 115 : 85;
    }
    overlayCtx.putImageData(overlay, 0, 0);
    ctx.drawImage(overlayCanvas, 0, 0);
  }

  setSelectionResultVisible(visible) {
    document.getElementById('selectionResult').hidden = !visible;
  }

  setEditorWarning(message) {
    const warning = document.getElementById('editorWarning');
    warning.hidden = !message;
    warning.textContent = message || '';
  }
}

window.UIController = UIController;
})();