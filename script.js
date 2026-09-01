// --- APP STATE & CONSTANTS ---
const DEFAULT_GRAY = "#b0b0b0"; 

let rowCounter = 0;
let selectedRowIds = new Set(); // Tracks multiple selected rows
let lastClickedRowId =    null;    // For Shift-click range selections

// Multi-cell selection tracking
let selectedCellElements = new Set(); 
let lastClickedCellElement = null;

let isColorDeleteMode = false;
let isShapeDeleteMode = false;

const SIZE_LABELS = ["XS", "S", "M", "L", "XL"];
const SIZE_SCALES = [0.65, 0.8, 1.0, 1.2, 1.4];

const rowSettings = {};

// --- UNDO / REDO STATE ---
let undoStack = [];
let redoStack = [];
const MAX_HISTORY = 50;
let isApplyingHistory = false;

// DOM Elements
const fileNameInput = document.getElementById("fileNameInput");
const previewBtn = document.getElementById("previewBtn");
const exportSvgBtn = document.getElementById("exportSvgBtn");
const exportPngBtn = document.getElementById("exportPngBtn");

// --- CORE UNDO / REDO FUNCTIONS ---
function captureState() {
  if (isApplyingHistory) return;

  const stateSnapshot = {
    fileName: fileNameInput ? fileNameInput.value : "",
    rowCounter,
    selectedRowIds: Array.from(selectedRowIds),
    rowSettings: JSON.parse(JSON.stringify(rowSettings)),
    rowsContainerHTML: rowsContainer.innerHTML,
    layersBoxHTML: layersBox.innerHTML,
    availableColors: JSON.parse(JSON.stringify(availableColors)),
    selectedColor,
    availableShapes: [...availableShapes],
    selectedShape
  };

  undoStack.push(stateSnapshot);
  if (undoStack.length > MAX_HISTORY) {
    undoStack.shift();
  }
  redoStack = [];
}

function restoreState(state) {
  isApplyingHistory = true;

  if (fileNameInput && state.fileName !== undefined) {
    fileNameInput.value = state.fileName;
  }
  
  rowCounter = state.rowCounter;
  selectedRowIds = new Set(state.selectedRowIds);
  
  Object.keys(rowSettings).forEach(k => delete rowSettings[k]);
  Object.assign(rowSettings, JSON.parse(JSON.stringify(state.rowSettings)));

  rowsContainer.innerHTML = state.rowsContainerHTML;
  layersBox.innerHTML = state.layersBoxHTML;

  availableColors = JSON.parse(JSON.stringify(state.availableColors));
  selectedColor = state.selectedColor;
  availableShapes = [...state.availableShapes];
  selectedShape = state.selectedShape;

  rebindRestoredElements();

  renderColorsGrid();
  renderShapesGrid();
  syncPanelControls();

  isApplyingHistory = false;
}

function rebindRestoredElements() {
  selectedCellElements.clear();
  lastClickedCellElement = null;

  document.querySelectorAll(".row-box").forEach(canvasRow => {
    const rowId = canvasRow.dataset.rowId;
    canvasRow.draggable = true;
    canvasRow.addEventListener("dragstart", handleDragStart);
    canvasRow.addEventListener("dragover", handleDragOver);
    canvasRow.addEventListener("dragleave", handleDragLeave);
    canvasRow.addEventListener("drop", handleDrop);
    canvasRow.addEventListener("dragend", handleDragEnd);

    canvasRow.addEventListener("click", (e) => {
      if (e.target === canvasRow) {
        clearSelectedCells();
      }
      selectRow(rowId, e);
    });

    canvasRow.querySelectorAll(".placed-shape").forEach(shapeWrapper => {
      shapeWrapper.draggable = true;
      shapeWrapper.addEventListener("dragstart", handleCellDragStart);
      shapeWrapper.addEventListener("dragover", handleCellDragOver);
      shapeWrapper.addEventListener("dragleave", handleCellDragLeave);
      shapeWrapper.addEventListener("drop", handleCellDrop);
      shapeWrapper.addEventListener("dragend", handleCellDragEnd);

      const deleteBadge = shapeWrapper.querySelector(".cell-delete-btn");
      if (deleteBadge) {
        deleteBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          captureState();
          removeCell(shapeWrapper, rowId);
        });
      }
      shapeWrapper.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!selectedRowIds.has(rowId)) {
          selectRow(rowId, e);
        }
        selectCell(shapeWrapper, e);
      });
    });
  });

  document.querySelectorAll(".layer-item").forEach(layerItem => {
    const rowId = layerItem.dataset.rowId;
    layerItem.draggable = true;
    layerItem.addEventListener("dragstart", handleLayerDragStart);
    layerItem.addEventListener("dragover", handleLayerDragOver);
    layerItem.addEventListener("dragleave", handleLayerDragLeave);
    layerItem.addEventListener("drop", handleLayerDrop);
    layerItem.addEventListener("dragend", handleLayerDragEnd);

    layerItem.addEventListener("click", (e) => {
      clearSelectedCells();
      selectRow(rowId, e);
    });
  });
}

function undo() {
  if (undoStack.length === 0) return;
  
  const currentState = {
    fileName: fileNameInput ? fileNameInput.value : "",
    rowCounter,
    selectedRowIds: Array.from(selectedRowIds),
    rowSettings: JSON.parse(JSON.stringify(rowSettings)),
    rowsContainerHTML: rowsContainer.innerHTML,
    layersBoxHTML: layersBox.innerHTML,
    availableColors: JSON.parse(JSON.stringify(availableColors)),
    selectedColor,
    availableShapes: [...availableShapes],
    selectedShape
  };

  redoStack.push(currentState);
  const previousState = undoStack.pop();
  restoreState(previousState);
}

function redo() {
  if (redoStack.length === 0) return;

  const currentState = {
    fileName: fileNameInput ? fileNameInput.value : "",
    rowCounter,
    selectedRowIds: Array.from(selectedRowIds),
    rowSettings: JSON.parse(JSON.stringify(rowSettings)),
    rowsContainerHTML: rowsContainer.innerHTML,
    layersBoxHTML: layersBox.innerHTML,
    availableColors: JSON.parse(JSON.stringify(availableColors)),
    selectedColor,
    availableShapes: [...availableShapes],
    selectedShape
  };

  undoStack.push(currentState);
  const nextState = redoStack.pop();
  restoreState(nextState);
}

// --- DYNAMIC ROW TYPE TOGGLE CONTROL SETUP ---
const panelSection = document.querySelector(".panel-section") || document.querySelector(".sidebar") || document.body;
const rowTypeControlDiv = document.createElement("div");
rowTypeControlDiv.className = "control-group margin-top-sm";
rowTypeControlDiv.innerHTML = `
  <label class="control-label" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;">
    <span>Row Type (Half Row)</span>
    <input type="checkbox" id="rowHalfRowCheckbox" style="cursor: pointer;" />
  </label>
`;

if (!document.getElementById("rowHalfRowCheckbox")) {
  const cellSpacingGroup = document.getElementById("cellSpacing")?.closest(".control-group") || panelSection;
  cellSpacingGroup.parentNode.insertBefore(rowTypeControlDiv, cellSpacingGroup.nextSibling);
}

const rowHalfRowCheckbox = document.getElementById("rowHalfRowCheckbox");
if (rowHalfRowCheckbox) {
  rowHalfRowCheckbox.addEventListener("change", (e) => {
    if (selectedRowIds.size === 0) return;
    captureState();
    setRowHalfTypeForSelected(e.target.checked);
  });
}

function setRowHalfTypeForSelected(isHalf) {
  selectedRowIds.forEach(rowId => {
    if (!rowSettings[rowId]) return;
    rowSettings[rowId].isHalfRow = isHalf;

    const canvasRow = document.getElementById(`canvas-${rowId}`);
    const layerItem = document.getElementById(`layer-${rowId}`);

    if (canvasRow) {
      if (isHalf) {
        canvasRow.classList.add("half-row");
      } else {
        canvasRow.classList.remove("half-row");
      }
    }

    if (layerItem) {
      const baseNum = rowId.replace('row-', '').replace('scanned-row-', '');
      layerItem.textContent = isHalf ? `Row ${baseNum} (Half)` : `Row ${baseNum}`;
    }

    applyRowStyles(rowId);
  });
}

// --- MULTI-ROW & MULTI-LAYER REORDERING HANDLERS ---
let draggedRowIds = [];

function handleDragStart(e) {
  const rowId = this.dataset.rowId;
  
  if (!selectedRowIds.has(rowId)) {
    selectRow(rowId, e);
  }

  draggedRowIds = Array.from(rowsContainer.querySelectorAll(".row-box"))
    .filter(row => selectedRowIds.has(row.dataset.rowId))
    .map(row => row.dataset.rowId);

  draggedRowIds.forEach(id => {
    document.getElementById(`canvas-${id}`)?.classList.add("dragging");
    document.getElementById(`layer-${id}`)?.classList.add("dragging");
  });

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", rowId);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  
  const targetRow = e.currentTarget;
  if (draggedRowIds.includes(targetRow.dataset.rowId)) return;

  const rect = targetRow.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  
  targetRow.classList.remove("drag-over-top", "drag-over-bottom");
  if (e.clientY < midpoint) {
    targetRow.classList.add("drag-over-top");
  } else {
    targetRow.classList.add("drag-over-bottom");
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drag-over-top", "drag-over-bottom");
}

function handleDrop(e) {
  e.preventDefault();
  const targetRow = e.currentTarget;
  targetRow.classList.remove("drag-over-top", "drag-over-bottom");
  
  const targetRowId = targetRow.dataset.rowId;
  if (draggedRowIds.length === 0 || draggedRowIds.includes(targetRowId)) return;

  captureState();

  const rect = targetRow.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  const insertBeforeTarget = e.clientY < midpoint;

  const draggedRows = draggedRowIds.map(id => document.getElementById(`canvas-${id}`)).filter(Boolean);
  const draggedLayers = draggedRowIds.map(id => document.getElementById(`layer-${id}`)).filter(Boolean);

  const targetCanvasElement = document.getElementById(`canvas-${targetRowId}`);
  const targetLayerElement = document.getElementById(`layer-${targetRowId}`);

  if (insertBeforeTarget) {
    draggedRows.forEach(row => rowsContainer.insertBefore(row, targetCanvasElement));
    draggedLayers.forEach(layer => layersBox.insertBefore(layer, targetLayerElement));
  } else {
    const nextCanvasSibling = targetCanvasElement.nextSibling;
    const nextLayerSibling = targetLayerElement.nextSibling;

    draggedRows.forEach(row => rowsContainer.insertBefore(row, nextCanvasSibling));
    draggedLayers.forEach(layer => layersBox.insertBefore(layer, nextLayerSibling));
  }
}

function handleDragEnd(e) {
  document.querySelectorAll(".row-box, .layer-item").forEach(row => {
    row.classList.remove("dragging", "drag-over-top", "drag-over-bottom");
  });
  draggedRowIds = [];
}

// Cell Drag and Drop Handlers (Rearranging multiple selected cells)
let draggedCellElement = null;

function handleCellDragStart(e) {
  e.stopPropagation();
  draggedCellElement = this;
  if (!selectedCellElements.has(this)) {
    clearSelectedCells();
    selectCell(this, e);
  }
  selectedCellElements.forEach(cell => cell.classList.add("dragging"));
  e.dataTransfer.effectAllowed = "move";
}

function handleCellDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";

  const targetCell = e.currentTarget;
  if (selectedCellElements.has(targetCell)) return;

  const rect = targetCell.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;

  targetCell.classList.remove("drag-over-left", "drag-over-right");
  if (e.clientX < midpoint) {
    targetCell.classList.add("drag-over-left");
  } else {
    targetCell.classList.add("drag-over-right");
  }
}

function handleCellDragLeave(e) {
  e.currentTarget.classList.remove("drag-over-left", "drag-over-right");
}

function handleCellDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const targetCell = e.currentTarget;
  targetCell.classList.remove("drag-over-left", "drag-over-right");

  if (!draggedCellElement || selectedCellElements.has(targetCell)) return;

  const targetRow = targetCell.closest(".row-box");
  const sourceRow = draggedCellElement.closest(".row-box");

  if (sourceRow !== targetRow) return;

  captureState();

  const rect = targetCell.getBoundingClientRect();
  const midpoint = rect.left + rect.width / 2;

  const cellsToMove = Array.from(sourceRow.querySelectorAll(".placed-shape"))
    .filter(cell => selectedCellElements.has(cell));

  if (e.clientX < midpoint) {
    cellsToMove.forEach(cell => targetRow.insertBefore(cell, targetCell));
  } else {
    cellsToMove.forEach(cell => targetRow.insertBefore(cell, targetCell.nextSibling));
  }
}

function handleCellDragEnd(e) {
  e.stopPropagation();
  document.querySelectorAll(".placed-shape").forEach(cell => {
    cell.classList.remove("dragging", "drag-over-left", "drag-over-right");
  });
  draggedCellElement = null;
}

// Layers Drag and Drop Handlers (Proxying multi-row drag logic)
function handleLayerDragStart(e) {
  handleDragStart.call(this, e);
}

function handleLayerDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  
  const targetLayer = e.currentTarget;
  if (draggedRowIds.includes(targetLayer.dataset.rowId)) return;

  const rect = targetLayer.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;
  
  targetLayer.classList.remove("drag-over-top", "drag-over-bottom");
  if (e.clientY < midpoint) {
    targetLayer.classList.add("drag-over-top");
  } else {
    targetLayer.classList.add("drag-over-bottom");
  }
}

function handleLayerDragLeave(e) {
  e.currentTarget.classList.remove("drag-over-top", "drag-over-bottom");
}

function handleLayerDrop(e) {
  e.preventDefault();
  const targetLayer = e.currentTarget;
  targetLayer.classList.remove("drag-over-top", "drag-over-bottom");

  const targetRowId = targetLayer.dataset.rowId;
  const targetCanvas = document.getElementById(`canvas-${targetRowId}`);
  
  if (targetCanvas) {
    targetCanvas.getBoundingClientRect = () => targetLayer.getBoundingClientRect();
    handleDrop.call(targetCanvas, e);
  }
}

function handleLayerDragEnd(e) {
  handleDragEnd.call(this, e);
}

const previewModal = document.getElementById("previewModal");
const previewContainer = document.getElementById("previewContainer");
const previewModalTitle = document.getElementById("previewModalTitle");
const closePreviewBtn = document.getElementById("closePreviewBtn");

const addRowBtn = document.getElementById("addRowBtn");
const addHalfRowBtn = document.getElementById("addHalfRowBtn");
const deleteRowBtn = document.getElementById("deleteRowBtn");
const canvasAddBtn = document.getElementById("canvasAddBtn");
const rowsContainer = document.getElementById("rowsContainer");
const layersBox = document.getElementById("layersBox");
const canvasArea = document.getElementById("canvasArea");

const cellsVal = document.getElementById("cellsVal");

const sizeDecBtn = document.getElementById("sizeDecBtn");
const sizeIncBtn = document.getElementById("sizeIncBtn");
const sizeVal = document.getElementById("sizeVal");

const scaleXInput = document.getElementById("scaleXInput");
const scaleXVal = document.getElementById("scaleXVal");
const scaleYInput = document.getElementById("scaleYInput");
const scaleYVal = document.getElementById("scaleYVal");

const cellSpacingInput = document.getElementById("cellSpacing");
const cellSpacingVal = document.getElementById("cellSpacingVal");
const fileTitleInput = document.querySelector(".file-input");

if (fileTitleInput) {
  const updateTitleOpacity = () => {
    const val = fileTitleInput.value.trim();
    if (val !== "" && val !== "Untitled Sheet") {
      fileTitleInput.classList.add("has-input");
    } else {
      fileTitleInput.classList.remove("has-input");
    }
  };

  fileTitleInput.addEventListener("input", updateTitleOpacity);
  updateTitleOpacity();
}

function getSanitizedFileName(extension) {
  const name = fileNameInput.value.trim() || "Untitled Sheet";
  const cleanName = name.replace(/[^a-z0-9_\-\s]/gi, "_");
  return `${cleanName}.${extension}`;
}

// --- FILE EXPORT & PREVIEW LOGIC ---
function generateExportableSVG() {
  const canvasRows = document.querySelectorAll(".row-box");

  const defaultRowGap = 20;
  const halfRowGap = 6;
  const padding = 32;

  let currentY = padding;
  let maxRowRight = 0;
  let rowElementsMarkup = "";
  let previousRowWasHalf = false;

  if (canvasRows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200" width="600" height="200" style="width: 100%; height: auto; max-height: 70vh; display: block; margin: 0 auto;">
      <rect width="600" height="200" fill="#ffffff" />
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="sans-serif" font-size="16">Canvas is empty</text>
    </svg>`;
  }

  canvasRows.forEach((row, index) => {
    const rowId = row.dataset.rowId;
    const settings = rowSettings[rowId] || { spacing: 16, isHalfRow: false };
    const spacing = settings.spacing;
    const isHalf = settings.isHalfRow;
    const baseCellDim = isHalf ? 54 : 110;

    const shapes = row.querySelectorAll(".placed-shape");
    
    let maxScaledH = baseCellDim;
    shapes.forEach((shape) => {
      const sizeIdx = parseInt(shape.dataset.sizeIndex ?? (settings.sizeIndex || 2), 10);
      const scaleBase = SIZE_SCALES[sizeIdx] !== undefined ? SIZE_SCALES[sizeIdx] : 1.0;
      const sy = parseFloat(shape.dataset.scaleY ?? (settings.scaleY || 1.0));
      const effectiveH = baseCellDim * scaleBase * sy;
      if (effectiveH > maxScaledH) maxScaledH = effectiveH;
    });

    const rowHeight = Math.max(isHalf ? 72 : 140, maxScaledH + 20);

    if (index > 0) {
      const actualGap = (isHalf && previousRowWasHalf) ? halfRowGap : defaultRowGap;
      currentY += actualGap;
    }

    let currentX = padding;

    shapes.forEach((shape) => {
      const sizeIdx = parseInt(shape.dataset.sizeIndex ?? (settings.sizeIndex || 2), 10);
      const scaleBase = SIZE_SCALES[sizeIdx] !== undefined ? SIZE_SCALES[sizeIdx] : 1.0;
      const sx = parseFloat(shape.dataset.scaleX ?? (settings.scaleX || 1.0));
      const sy = parseFloat(shape.dataset.scaleY ?? (settings.scaleY || 1.0));

      const effectiveW = baseCellDim * scaleBase * sx;
      const effectiveH = baseCellDim * scaleBase * sy;

      const translateX = currentX;
      const translateY = currentY + (rowHeight - effectiveH) / 2;

      const rightEdge = translateX + effectiveW;
      if (rightEdge > maxRowRight) {
        maxRowRight = rightEdge;
      }

      const innerSvg = shape.querySelector("svg");
      let shapeMarkup = "";

      if (innerSvg) {
        shapeMarkup = innerSvg.innerHTML;
      }

      rowElementsMarkup += `  <g transform="translate(${translateX}, ${translateY}) scale(${scaleBase * sx}, ${scaleBase * sy})">\n`;
      rowElementsMarkup += `    <svg viewBox="0 0 100 100" width="${baseCellDim}" height="${baseCellDim}">\n`;
      rowElementsMarkup += `      ${shapeMarkup}\n`;
      rowElementsMarkup += `    </svg>\n`;
      rowElementsMarkup += `  </g>\n`;

      currentX += effectiveW + spacing;
    });

    currentY += rowHeight;
    previousRowWasHalf = isHalf;
  });

  const totalWidth = Math.max(600, maxRowRight + padding);
  const totalHeight = Math.max(200, currentY + padding);

  let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; max-height: 70vh; display: block; margin: 0 auto;">\n`;
  svgContent += `  <rect width="${totalWidth}" height="${totalHeight}" fill="#ffffff" />\n`;
  svgContent += rowElementsMarkup;
  svgContent += `</svg>`;

  return svgContent;
}

// --- PREVIEW MODAL LOGIC ---
function openPreviewModal() {
  const svgData = generateExportableSVG();

  if (previewContainer) {
    previewContainer.innerHTML = svgData;
  }

  if (previewModalTitle) {
    const fileName = fileNameInput.value.trim() || "Untitled Sheet";
    previewModalTitle.textContent = `Preview - ${fileName}`;
  }

  if (previewModal) {
    previewModal.classList.add("active");
  }
}

function closePreviewModal() {
  if (previewModal) {
    previewModal.classList.remove("active");
  }
}

if (previewBtn) previewBtn.addEventListener("click", openPreviewModal);
if (closePreviewBtn) closePreviewBtn.addEventListener("click", closePreviewModal);

if (previewModal) {
  previewModal.addEventListener("click", (e) => {
    if (e.target === previewModal) {
      closePreviewModal();
    }
  });
}

function exportSVG() {
  const svgData = generateExportableSVG();
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = getSanitizedFileName("svg");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportPNG() {
  const svgData = generateExportableSVG();
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgData, "image/svg+xml");
  const rootSvg = svgDoc.querySelector("svg");
  const width = parseFloat(rootSvg.getAttribute("width")) || 800;
  const height = parseFloat(rootSvg.getAttribute("height")) || 600;

  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const pngUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = getSanitizedFileName("png");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  img.src = url;
}

if (exportSvgBtn) exportSvgBtn.addEventListener("click", exportSVG);
if (exportPngBtn) exportPngBtn.addEventListener("click", exportPNG);

// --- ROW & CELL MANAGEMENT ---
function clearAllSelections() {
  selectedRowIds.clear();
  clearSelectedCells();
  document.querySelectorAll(".row-box, .layer-item").forEach((el) => {
    el.classList.remove("selected");
  });
  syncPanelControls();
}

if (canvasArea) {
  canvasArea.addEventListener("click", (e) => {
    if (e.target === canvasArea || e.target === rowsContainer) {
      clearAllSelections();
    }
  });
}

function addRow(isHalfRow = false) {
  captureState();
  rowCounter++;
  const rowId = `row-${rowCounter}`;

  rowSettings[rowId] = {
    cellCount: 0,
    sizeIndex: 2,
    scaleX: 1.0,
    scaleY: 1.0,
    spacing: 16,
    isHalfRow: isHalfRow,
    color: selectedColor
  };

  const canvasRow = document.createElement("div");
  canvasRow.className = isHalfRow ? "row-box half-row" : "row-box";
  canvasRow.id = `canvas-${rowId}`;
  canvasRow.dataset.rowId = rowId;
  
  canvasRow.draggable = true;
  canvasRow.addEventListener("dragstart", handleDragStart);
  canvasRow.addEventListener("dragover", handleDragOver);
  canvasRow.addEventListener("dragleave", handleDragLeave);
  canvasRow.addEventListener("drop", handleDrop);
  canvasRow.addEventListener("dragend", handleDragEnd);

  const layerItem = document.createElement("div");
  layerItem.className = "layer-item";
  layerItem.id = `layer-${rowId}`;
  layerItem.dataset.rowId = rowId;
  layerItem.textContent = isHalfRow ? `Row ${rowCounter} (Half)` : `Row ${rowCounter}`;

  layerItem.draggable = true;
  layerItem.addEventListener("dragstart", handleLayerDragStart);
  layerItem.addEventListener("dragover", handleLayerDragOver);
  layerItem.addEventListener("dragleave", handleLayerDragLeave);
  layerItem.addEventListener("drop", handleLayerDrop);
  layerItem.addEventListener("dragend", handleLayerDragEnd);

  canvasRow.addEventListener("click", (e) => {
    if (e.target === canvasRow) {
      clearSelectedCells();
    }
    selectRow(rowId, e);
  });

  layerItem.addEventListener("click", (e) => {
    clearSelectedCells();
    selectRow(rowId, e);
  });

  rowsContainer.appendChild(canvasRow);
  layersBox.appendChild(layerItem);

  selectRow(rowId, {});
  syncRowCells(rowId);
  applyRowStyles(rowId);
}

function selectRow(rowId, e = {}) {
  const isCtrl = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;

  if (isShift && lastClickedRowId && lastClickedRowId !== rowId) {
    const allRowBoxes = Array.from(rowsContainer.querySelectorAll(".row-box"));
    const ids = allRowBoxes.map(r => r.dataset.rowId);
    const startIdx = ids.indexOf(lastClickedRowId);
    const endIdx = ids.indexOf(rowId);
    if (startIdx !== -1 && endIdx !== -1) {
      const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
      for (let i = min; i <= max; i++) {
        selectedRowIds.add(ids[i]);
      }
    }
  } else if (isCtrl) {
    if (selectedRowIds.has(rowId)) {
      selectedRowIds.delete(rowId);
    } else {
      selectedRowIds.add(rowId);
    }
  } else {
    selectedRowIds.clear();
    selectedRowIds.add(rowId);
  }

  lastClickedRowId = rowId;

  document.querySelectorAll(".row-box, .layer-item").forEach((el) => {
    el.classList.remove("selected");
  });

  selectedRowIds.forEach(id => {
    const activeCanvasRow = document.getElementById(`canvas-${id}`);
    const activeLayerItem = document.getElementById(`layer-${id}`);
    if (activeCanvasRow) activeCanvasRow.classList.add("selected");
    if (activeLayerItem) activeLayerItem.classList.add("selected");
  });

  const firstSelectedId = Array.from(selectedRowIds)[0];
  if (firstSelectedId && rowSettings[firstSelectedId] && rowSettings[firstSelectedId].color) {
    selectedColor = rowSettings[firstSelectedId].color;
    renderColorsGrid();
  }

  syncPanelControls();
}

function clearSelectedCells() {
  selectedCellElements.forEach(cell => cell.classList.remove("selected"));
  selectedCellElements.clear();
  lastClickedCellElement = null;
  syncPanelControls();
}

function selectCell(cellEl, e = {}) {
  const isCtrl = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;

  if (isShift && lastClickedCellElement && lastClickedCellElement !== cellEl) {
    const currentRowBox = cellEl.closest(".row-box");
    const allCellsInRow = Array.from(currentRowBox.querySelectorAll(".placed-shape"));
    const startIdx = allCellsInRow.indexOf(lastClickedCellElement);
    const endIdx = allCellsInRow.indexOf(cellEl);

    if (startIdx !== -1 && endIdx !== -1) {
      const [min, max] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
      for (let i = min; i <= max; i++) {
        selectedCellElements.add(allCellsInRow[i]);
      }
    }
  } else if (isCtrl) {
    if (selectedCellElements.has(cellEl)) {
      selectedCellElements.delete(cellEl);
    } else {
      selectedCellElements.add(cellEl);
    }
  } else {
    selectedCellElements.clear();
    selectedCellElements.add(cellEl);
  }

  lastClickedCellElement = cellEl;

  document.querySelectorAll(".placed-shape").forEach(c => c.classList.remove("selected"));
  selectedCellElements.forEach(c => c.classList.add("selected"));

  syncPanelControls();
}

function syncPanelControls() {
  if (selectedRowIds.size === 0) return;
  const firstId = Array.from(selectedRowIds)[0];
  const r = rowSettings[firstId];
  if (!r) return;

  if (cellsVal) {
    cellsVal.value = r.cellCount;
  }

  if (cellSpacingInput) {
    cellSpacingInput.value = r.spacing;
    if (cellSpacingVal) {
      cellSpacingVal.textContent = `${r.spacing}px`;
    }
  }

  if (rowHalfRowCheckbox) {
    const allHalf = Array.from(selectedRowIds).every(id => rowSettings[id]?.isHalfRow);
    rowHalfRowCheckbox.checked = !!allHalf;
  }

  if (selectedCellElements.size > 0) {
    const firstSelectedCell = Array.from(selectedCellElements)[0];
    const idx = parseInt(firstSelectedCell.dataset.sizeIndex ?? r.sizeIndex, 10);
    const sx = parseFloat(firstSelectedCell.dataset.scaleX ?? r.scaleX);
    const sy = parseFloat(firstSelectedCell.dataset.scaleY ?? r.scaleY);

    sizeVal.textContent = SIZE_LABELS[idx];
    
    scaleXInput.value = sx;
    scaleXVal.textContent = `${sx.toFixed(1)}x`;

    scaleYInput.value = sy;
    scaleYVal.textContent = `${sy.toFixed(1)}x`;
  } else {
    sizeVal.textContent = SIZE_LABELS[r.sizeIndex];

    scaleXInput.value = r.scaleX;
    scaleXVal.textContent = `${r.scaleX.toFixed(1)}x`;

    scaleYInput.value = r.scaleY;
    scaleYVal.textContent = `${r.scaleY.toFixed(1)}x`;
  }
}

function syncRowCells(rowId) {
  const canvasRow = document.getElementById(`canvas-${rowId}`);
  if (!canvasRow || !rowSettings[rowId]) return;

  const targetCount = rowSettings[rowId].cellCount;
  let currentShapes = canvasRow.querySelectorAll(".placed-shape");
  const rowColor = rowSettings[rowId].color || selectedColor;

  while (currentShapes.length < targetCount) {
    addShapeToRow(rowId, selectedShape, false, rowColor);
    currentShapes = canvasRow.querySelectorAll(".placed-shape");
  }

  while (currentShapes.length > targetCount) {
    const lastShape = currentShapes[currentShapes.length - 1];
    if (selectedCellElements.has(lastShape)) {
      selectedCellElements.delete(lastShape);
    }
    lastShape.remove();
    currentShapes = canvasRow.querySelectorAll(".placed-shape");
  }
}

function applyShapeTransform(shapeElement) {
  if (!shapeElement) return;

  const parentRow = shapeElement.closest(".row-box");
  const isHalfRow = parentRow ? parentRow.classList.contains("half-row") : false;
  const rowId = parentRow ? parentRow.dataset.rowId : Array.from(selectedRowIds)[0];
  const settings = rowSettings[rowId] || { sizeIndex: 2, scaleX: 1.0, scaleY: 1.0 };

  const sizeIndex = parseInt(shapeElement.dataset.sizeIndex ?? settings.sizeIndex, 10);
  const scaleX = parseFloat(shapeElement.dataset.scaleX ?? settings.scaleX);
  const scaleY = parseFloat(shapeElement.dataset.scaleY ?? settings.scaleY);

  const baseSize = isHalfRow ? 54 : 110;
  const sizeScale = SIZE_SCALES[sizeIndex] !== undefined ? SIZE_SCALES[sizeIndex] : 1.0;

  const containerDim = baseSize * sizeScale;
  shapeElement.style.width = `${containerDim}px`;
  shapeElement.style.height = `${containerDim}px`;

  const innerSvg = shapeElement.querySelector("svg");
  if (innerSvg) {
    innerSvg.style.width = "100%";
    innerSvg.style.height = "100%";
    innerSvg.style.transform = `scale(${scaleX}, ${scaleY})`;
    innerSvg.style.transformOrigin = "center center";
  }
}

function applyRowStyles(rowId) {
  const canvasRow = document.getElementById(`canvas-${rowId}`);
  if (!canvasRow || !rowSettings[rowId]) return;

  const s = rowSettings[rowId];
  canvasRow.style.setProperty("--cell-spacing", `${s.spacing}px`);

  const placedShapes = canvasRow.querySelectorAll(".placed-shape");
  placedShapes.forEach((cell) => {
    applyShapeTransform(cell);
  });
}

if (cellsVal) {
  cellsVal.addEventListener("change", (e) => {
    if (selectedRowIds.size === 0) return;
    captureState();
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    selectedRowIds.forEach(rowId => {
      if (rowSettings[rowId]) {
        rowSettings[rowId].cellCount = val;
        syncRowCells(rowId);
      }
    });
  });
}

if (sizeDecBtn) {
  sizeDecBtn.addEventListener("click", () => {
    if (selectedCellElements.size > 0) {
      captureState();
      selectedCellElements.forEach(cellWrapper => {
        let curIdx = parseInt(cellWrapper.dataset.sizeIndex, 10);
        if (curIdx > 0) {
          curIdx--;
          cellWrapper.dataset.sizeIndex = curIdx;
          applyShapeTransform(cellWrapper);
        }
      });
      syncPanelControls();
    } else if (selectedRowIds.size > 0) {
      captureState();
      selectedRowIds.forEach(rowId => {
        if (rowSettings[rowId] && rowSettings[rowId].sizeIndex > 0) {
          rowSettings[rowId].sizeIndex--;
          const canvasRow = document.getElementById(`canvas-${rowId}`);
          if (canvasRow) {
            canvasRow.querySelectorAll(".placed-shape").forEach((cell) => {
              delete cell.dataset.sizeIndex;
            });
          }
          applyRowStyles(rowId);
        }
      });
      syncPanelControls();
    }
  });
}

if (sizeIncBtn) {
  sizeIncBtn.addEventListener("click", () => {
    if (selectedCellElements.size > 0) {
      captureState();
      selectedCellElements.forEach(cellWrapper => {
        let curIdx = parseInt(cellWrapper.dataset.sizeIndex, 10);
        if (curIdx < SIZE_LABELS.length - 1) {
          curIdx++;
          cellWrapper.dataset.sizeIndex = curIdx;
          applyShapeTransform(cellWrapper);
        }
      });
      syncPanelControls();
    } else if (selectedRowIds.size > 0) {
      captureState();
      selectedRowIds.forEach(rowId => {
        if (rowSettings[rowId] && rowSettings[rowId].sizeIndex < SIZE_LABELS.length - 1) {
          rowSettings[rowId].sizeIndex++;
          const canvasRow = document.getElementById(`canvas-${rowId}`);
          if (canvasRow) {
            canvasRow.querySelectorAll(".placed-shape").forEach((cell) => {
              delete cell.dataset.sizeIndex;
            });
          }
          applyRowStyles(rowId);
        }
      });
      syncPanelControls();
    }
  });
}

if (scaleXInput) {
  scaleXInput.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    scaleXVal.textContent = `${val.toFixed(1)}x`;

    if (selectedCellElements.size > 0) {
      selectedCellElements.forEach(cellWrapper => {
        cellWrapper.dataset.scaleX = val;
        applyShapeTransform(cellWrapper);
      });
    } else if (selectedRowIds.size > 0) {
      selectedRowIds.forEach(rowId => {
        if (rowSettings[rowId]) {
          rowSettings[rowId].scaleX = val;
          const canvasRow = document.getElementById(`canvas-${rowId}`);
          if (canvasRow) {
            canvasRow.querySelectorAll(".placed-shape").forEach((cell) => {
              delete cell.dataset.scaleX;
            });
          }
          applyRowStyles(rowId);
        }
      });
    }
  });
  scaleXInput.addEventListener("change", () => captureState());
}

if (scaleYInput) {
  scaleYInput.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    scaleYVal.textContent = `${val.toFixed(1)}x`;

    if (selectedCellElements.size > 0) {
      selectedCellElements.forEach(cellWrapper => {
        cellWrapper.dataset.scaleY = val;
        applyShapeTransform(cellWrapper);
      });
    } else if (selectedRowIds.size > 0) {
      selectedRowIds.forEach(rowId => {
        if (rowSettings[rowId]) {
          rowSettings[rowId].scaleY = val;
          const canvasRow = document.getElementById(`canvas-${rowId}`);
          if (canvasRow) {
            canvasRow.querySelectorAll(".placed-shape").forEach((cell) => {
              delete cell.dataset.scaleY;
            });
          }
          applyRowStyles(rowId);
        }
      });
    }
  });
  scaleYInput.addEventListener("change", () => captureState());
}

if (cellSpacingInput) {
  cellSpacingInput.min = "0";
  cellSpacingInput.max = "100";
  cellSpacingInput.step = "1";

  cellSpacingInput.addEventListener("input", (e) => {
    if (selectedRowIds.size === 0) return;
    const spacingVal = parseInt(e.target.value, 10);
    const safeVal = isNaN(spacingVal) ? 0 : spacingVal;

    if (cellSpacingVal) {
      cellSpacingVal.textContent = `${safeVal}px`;
    }

    selectedRowIds.forEach(rowId => {
      if (rowSettings[rowId]) {
        rowSettings[rowId].spacing = safeVal;
        applyRowStyles(rowId);
      }
    });
  });
  cellSpacingInput.addEventListener("change", () => captureState());
}

function deleteRow() {
  if (selectedRowIds.size === 0) {
    alert("Please select at least one row to delete.");
    return;
  }

  captureState();

  selectedRowIds.forEach(rowId => {
    const canvasRow = document.getElementById(`canvas-${rowId}`);
    const layerItem = document.getElementById(`layer-${rowId}`);

    if (canvasRow) canvasRow.remove();
    if (layerItem) layerItem.remove();

    delete rowSettings[rowId];
  });

  selectedRowIds.clear();
  clearSelectedCells();

  const remainingRows = document.querySelectorAll(".row-box");
  if (remainingRows.length > 0) {
    const lastRowId = remainingRows[remainingRows.length - 1].dataset.rowId;
    selectRow(lastRowId, {});
  }
}

if (addRowBtn) addRowBtn.addEventListener("click", () => addRow(false));
if (addHalfRowBtn) addHalfRowBtn.addEventListener("click", () => addRow(true));
if (canvasAddBtn) canvasAddBtn.addEventListener("click", () => addRow(false));
if (deleteRowBtn) deleteRowBtn.addEventListener("click", deleteRow);

// --- COLOR PALETTE DEFINITIONS & MODAL LOGIC ---
let availableColors = [
  { hex: "#e60039", name: "R100" },
  { hex: "#fa7400", name: "O200" },
  { hex: "#fde900", name: "Y301" },
  { hex: "#1ecb1d", name: "G400" },
  { hex: "#7dc80a", name: "G401" },
  { hex: "#00b54e", name: "G402" },
  { hex: "#009600", name: "G403" },
  { hex: "#0072ff", name: "B500" },
  { hex: "#0047ff", name: "B503" },
  { hex: "#1f2fd3", name: "B504" },
  { hex: "#009eff", name: "B507" },
  { hex: "#5200f6", name: "V600" },
  { hex: "#7a00c6", name: "V601" },
  { hex: "#fa608b", name: "P700" },
  { hex: "#ea0063", name: "P701" },
  { hex: "#ca004e", name: "P702" }
];

let selectedColor = availableColors[0].hex;

const colorsGrid = document.getElementById("colorsGrid");
const addColorBtn = document.getElementById("addColorBtn");
const deleteColorBtn = document.getElementById("deleteColorBtn");

const colorModal = document.getElementById("colorModal");
const closeColorModalBtn = document.getElementById("closeColorModalBtn");
const cancelColorBtn = document.getElementById("cancelColorBtn");
const doneColorBtn = document.getElementById("doneColorBtn");
const modalColorPicker = document.getElementById("modalColorPicker");
const modalColorNameInput = document.getElementById("modalColorNameInput");

function openColorModal() {
  if (modalColorPicker) modalColorPicker.value = "#3b82f6";
  if (modalColorNameInput) {
    modalColorNameInput.value = `C${availableColors.length + 1}`;
  }
  if (colorModal) {
    colorModal.classList.add("active");
    if (modalColorNameInput) {
      modalColorNameInput.focus();
      modalColorNameInput.select();
    }
  }
}

function closeColorModal() {
  if (colorModal) {
    colorModal.classList.remove("active");
  }
}

if (addColorBtn) {
  addColorBtn.addEventListener("click", openColorModal);
}

if (closeColorModalBtn) closeColorModalBtn.addEventListener("click", closeColorModal);
if (cancelColorBtn) cancelColorBtn.addEventListener("click", closeColorModal);

if (colorModal) {
  colorModal.addEventListener("click", (e) => {
    if (e.target === colorModal) {
      closeColorModal();
    }
  });
}

if (doneColorBtn) {
  doneColorBtn.addEventListener("click", () => {
    captureState();
    const newHex = modalColorPicker ? modalColorPicker.value : "#3b82f6";
    const defaultLabel = `C${availableColors.length + 1}`;
    const customName = modalColorNameInput ? modalColorNameInput.value.trim().toUpperCase() : defaultLabel;
    const finalName = customName || defaultLabel;

    const existing = availableColors.find(c => c.hex.toLowerCase() === newHex.toLowerCase());
    if (existing) {
      existing.name = finalName;
      selectColor(existing.hex);
    } else {
      availableColors.push({
        hex: newHex,
        name: finalName
      });
      selectColor(newHex);
    }

    closeColorModal();
  });
}

if (modalColorNameInput) {
  modalColorNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      doneColorBtn.click();
    } else if (e.key === "Escape") {
      closeColorModal();
    }
  });
}

function renderColorsGrid() {
  if (!colorsGrid) return;
  colorsGrid.innerHTML = "";

  if (isColorDeleteMode) {
    colorsGrid.classList.add("delete-mode");
  } else {
    colorsGrid.classList.remove("delete-mode");
  }

  availableColors.forEach((colorObj) => {
    const isSelected = colorObj.hex.toLowerCase() === selectedColor.toLowerCase();

    const colorItem = document.createElement("div");
    colorItem.className = "color-item";

    const card = document.createElement("div");
    card.className = `color-card ${isSelected ? "selected" : ""}`;
    card.title = `${colorObj.name} (${colorObj.hex})`;
    card.setAttribute("aria-label", colorObj.name);

    const swatch = document.createElement("span");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = colorObj.hex;

    const deleteBadge = document.createElement("button");
    deleteBadge.className = "card-delete-btn";
    deleteBadge.innerHTML = "&times;";
    deleteBadge.title = `Delete ${colorObj.name}`;
    deleteBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      removeColorFromPanel(colorObj.hex);
    });

    card.appendChild(swatch);
    card.appendChild(deleteBadge);

    const label = document.createElement("span");
    label.className = "color-name";
    label.textContent = colorObj.name;
    label.title = "Double click to rename";

    label.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const currentName = colorObj.name;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "color-name-input";
      input.value = currentName;
      input.maxLength = 6;

      const commitChange = () => {
        const val = input.value.trim().toUpperCase();
        if (val !== currentName) {
          captureState();
          colorObj.name = val || currentName;
        }
        renderColorsGrid();
      };

      input.addEventListener("blur", commitChange);
      input.addEventListener("keydown", (keyEvt) => {
        if (keyEvt.key === "Enter") {
          input.blur();
        } else if (keyEvt.key === "Escape") {
          input.value = currentName;
          input.blur();
        }
      });

      label.replaceWith(input);
      input.focus();
      input.select();
    });

    colorItem.appendChild(card);
    colorItem.appendChild(label);

    colorItem.addEventListener("click", () => {
      if (isColorDeleteMode) {
        removeColorFromPanel(colorObj.hex);
      } else {
        selectColor(colorObj.hex);
      }
    });

    colorsGrid.appendChild(colorItem);
  });

  const addColorItem = document.createElement("div");
  addColorItem.className = "color-item";

  const addCard = document.createElement("div");
  addCard.className = "color-card add-card";
  addCard.textContent = "+";
  addCard.title = "Add custom color";
  addCard.addEventListener("click", () => {
    openColorModal();
  });

  addColorItem.appendChild(addCard);
  colorsGrid.appendChild(addColorItem);
}

function selectColor(colorHex) {
  if (selectedColor.toLowerCase() !== colorHex.toLowerCase()) {
    captureState();
  }
  selectedColor = colorHex;
  renderColorsGrid();

  if (selectedCellElements.size > 0) {
    selectedCellElements.forEach(cellWrapper => applyColorToCell(cellWrapper, colorHex));
  } else if (selectedRowIds.size > 0) {
    applyColorToSelectedRows(colorHex);
  }
}

function removeColorFromPanel(colorHex) {
  if (availableColors.length <= 1) {
    alert("You must keep at least one color in the palette.");
    return;
  }
  
  captureState();
  availableColors = availableColors.filter((c) => c.hex.toLowerCase() !== colorHex.toLowerCase());
  
  if (selectedColor.toLowerCase() === colorHex.toLowerCase()) {
    selectedColor = availableColors[0].hex;
  }
  
  renderColorsGrid();
}

function applyColorToCell(cellWrapper, colorHex) {
  if (!cellWrapper || !colorHex) return;

  const svgs = cellWrapper.querySelectorAll("svg path, svg circle, svg ellipse, svg rect, svg polygon, svg polyline");
  svgs.forEach((el) => el.setAttribute("fill", colorHex));

  const filterMatrix = cellWrapper.querySelector("feColorMatrix");
  if (filterMatrix) {
    const r = (parseInt(colorHex.slice(1, 3), 16) / 255).toFixed(2);
    const g = (parseInt(colorHex.slice(3, 5), 16) / 255).toFixed(2);
    const b = (parseInt(colorHex.slice(5, 7), 16) / 255).toFixed(2);
    filterMatrix.setAttribute("values", `0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 1 0`);
  }
}

function applyColorToSelectedRows(colorHex) {
  selectedRowIds.forEach(rowId => {
    if (rowSettings[rowId]) {
      rowSettings[rowId].color = colorHex;
    }

    const canvasRow = document.getElementById(`canvas-${rowId}`);
    if (!canvasRow) return;

    const placedShapes = canvasRow.querySelectorAll(".placed-shape");
    placedShapes.forEach((shapeWrapper) => applyColorToCell(shapeWrapper, colorHex));
  });
}

if (deleteColorBtn) {
  deleteColorBtn.addEventListener("click", () => {
    isColorDeleteMode = !isColorDeleteMode;
    deleteColorBtn.classList.toggle("btn-active-delete", isColorDeleteMode);
    renderColorsGrid();
  });
}

// --- SHAPE DEFINITIONS & PANELS ---
const SHAPE_DEFINITIONS = {
  petal: `<svg viewBox="0 0 100 100">
    <path d="M 50,10 C 82,30 82,70 50,90 C 18,70 18,30 50,10 Z" fill="${DEFAULT_GRAY}" />
  </svg>`,

  tallOval: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="50" rx="18" ry="38" fill="${DEFAULT_GRAY}" />
  </svg>`,

  oval: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="50" rx="24" ry="32" fill="${DEFAULT_GRAY}" />
  </svg>`,

  circle: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="32" fill="${DEFAULT_GRAY}" />
  </svg>`,

  star: `<svg viewBox="0 0 100 100">
    <path d="M 50,14 C 53,14 59,29 62,34 C 65,39 79,34 85,38 C 91,42 75,54 70,58 C 65,62 75,78 72,82 C 69,86 56,70 50,70 C 44,70 31,86 28,82 C 25,78 35,62 30,58 C 25,54 9,42 15,38 C 21,34 35,39 38,34 C 41,29 47,14 50,14 Z" fill="${DEFAULT_GRAY}" />
  </svg>`,

  line: `<svg viewBox="0 0 100 100">
    <rect x="41" y="12" width="18" height="76" rx="9" fill="${DEFAULT_GRAY}" />
  </svg>`
};

let availableShapes = ["petal", "tallOval", "oval", "circle", "star", "line"];
let selectedShape = "petal";

const shapesGrid = document.getElementById("shapesGrid");
const addShapeBtn = document.getElementById("addShapeBtn");
const deleteShapeBtn = document.getElementById("deleteShapeBtn");
const shapeFileInput = document.getElementById("shapeFileInput");

function renderShapesGrid() {
  if (!shapesGrid) return;
  shapesGrid.innerHTML = "";

  if (isShapeDeleteMode) {
    shapesGrid.classList.add("delete-mode");
  } else {
    shapesGrid.classList.remove("delete-mode");
  }

  availableShapes.forEach((shapeKey) => {
    const card = document.createElement("div");
    card.className = `shape-card ${shapeKey === selectedShape ? "selected" : ""}`;
    card.innerHTML = SHAPE_DEFINITIONS[shapeKey] || SHAPE_DEFINITIONS.circle;

    const elementsToGray = card.querySelectorAll("svg path, svg circle, svg ellipse, svg rect, svg polygon, svg polyline, svg g");
    elementsToGray.forEach((el) => {
      if (el.tagName !== "g") {
        el.removeAttribute("style");
        el.setAttribute("fill", DEFAULT_GRAY);
      }
    });

    const filterMatrix = card.querySelector("feColorMatrix");
    if (filterMatrix) {
      filterMatrix.setAttribute("values", "0 0 0 0 0.69  0 0 0 0 0.69  0 0 0 0 0.69  0 0 0 1 0");
    }

    const deleteBadge = document.createElement("button");
    deleteBadge.className = "card-delete-btn";
    deleteBadge.innerHTML = "&times;";
    deleteBadge.title = "Delete shape";
    deleteBadge.addEventListener("click", (e) => {
      e.stopPropagation();
      removeShapeFromPanel(shapeKey);
    });

    card.appendChild(deleteBadge);

    card.addEventListener("click", () => {
      if (isShapeDeleteMode) {
        removeShapeFromPanel(shapeKey);
      } else {
        selectShape(shapeKey);
      }
    });

    shapesGrid.appendChild(card);
  });
}

function selectShape(shapeKey) {
  if (selectedShape !== shapeKey) {
    captureState();
  }
  selectedShape = shapeKey;
  renderShapesGrid();

  if (selectedCellElements.size > 0) {
    selectedCellElements.forEach(currentWrapper => {
      const parentRow = currentWrapper.closest(".row-box");
      const rowId = parentRow ? parentRow.dataset.rowId : Array.from(selectedRowIds)[0];

      const existingSvgPath = currentWrapper.querySelector("svg path, svg circle, svg ellipse, svg rect, svg polygon, svg polyline");
      const currentColor = existingSvgPath ? existingSvgPath.getAttribute("fill") : (rowSettings[rowId]?.color || selectedColor);

      currentWrapper.innerHTML = `
        <div class="placed-shape-inner">
          ${SHAPE_DEFINITIONS[shapeKey] || SHAPE_DEFINITIONS.circle}
        </div>
      `;

      const deleteBadge = document.createElement("button");
      deleteBadge.className = "cell-delete-btn";
      deleteBadge.innerHTML = "&times;";
      deleteBadge.title = "Delete this cell";
      deleteBadge.addEventListener("click", (e) => {
        e.stopPropagation();
        captureState();
        removeCell(currentWrapper, rowId);
      });

      currentWrapper.appendChild(deleteBadge);
      applyColorToCell(currentWrapper, currentColor);
      applyShapeTransform(currentWrapper);
    });
  } else if (selectedRowIds.size > 0) {
    selectedRowIds.forEach(rowId => {
      const canvasRow = document.getElementById(`canvas-${rowId}`);
      if (canvasRow) {
        const placedShapes = canvasRow.querySelectorAll(".placed-shape");
        
        if (placedShapes.length > 0) {
          placedShapes.forEach((shapeWrapper) => {
            const rowColor = rowSettings[rowId]?.color || selectedColor;
            const existingSvgPath = shapeWrapper.querySelector("svg path, svg circle, svg ellipse, svg rect, svg polygon, svg polyline");
            const currentColor = existingSvgPath ? existingSvgPath.getAttribute("fill") : rowColor;

            shapeWrapper.innerHTML = `
              <div class="placed-shape-inner">
                ${SHAPE_DEFINITIONS[shapeKey] || SHAPE_DEFINITIONS.circle}
              </div>
            `;

            const deleteBadge = document.createElement("button");
            deleteBadge.className = "cell-delete-btn";
            deleteBadge.innerHTML = "&times;";
            deleteBadge.title = "Delete this cell";
            deleteBadge.addEventListener("click", (e) => {
              e.stopPropagation();
              captureState();
              removeCell(shapeWrapper, rowId);
            });

            shapeWrapper.appendChild(deleteBadge);
            applyColorToCell(shapeWrapper, currentColor);
            applyShapeTransform(shapeWrapper);
          });
        } else {
          const rowColor = rowSettings[rowId]?.color || selectedColor;
          addShapeToRow(rowId, shapeKey, true, rowColor);
        }
      }
    });
  }
}

function addShapeToRow(rowId, shapeKey, updateCount = true, targetColor = null) {
  const canvasRow = document.getElementById(`canvas-${rowId}`);
  if (!canvasRow) return;

  const activeColor = targetColor || rowSettings[rowId]?.color || selectedColor;

  const shapeWrapper = document.createElement("div");
  shapeWrapper.className = "placed-shape";
  shapeWrapper.draggable = true;
  shapeWrapper.addEventListener("dragstart", handleCellDragStart);
  shapeWrapper.addEventListener("dragover", handleCellDragOver);
  shapeWrapper.addEventListener("dragleave", handleCellDragLeave);
  shapeWrapper.addEventListener("drop", handleCellDrop);
  shapeWrapper.addEventListener("dragend", handleCellDragEnd);

  const defaultSizeIdx = rowSettings[rowId] ? rowSettings[rowId].sizeIndex : 2;
  const defaultScaleX = rowSettings[rowId] ? rowSettings[rowId].scaleX : 1.0;
  const defaultScaleY = rowSettings[rowId] ? rowSettings[rowId].scaleY : 1.0;

  shapeWrapper.dataset.sizeIndex = defaultSizeIdx;
  shapeWrapper.dataset.scaleX = defaultScaleX;
  shapeWrapper.dataset.scaleY = defaultScaleY;

  shapeWrapper.innerHTML = `
    <div class="placed-shape-inner">
      ${SHAPE_DEFINITIONS[shapeKey] || SHAPE_DEFINITIONS.circle}
    </div>
  `;

  const deleteBadge = document.createElement("button");
  deleteBadge.className = "cell-delete-btn";
  deleteBadge.innerHTML = "&times;";
  deleteBadge.title = "Delete this cell";

  deleteBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    captureState();
    removeCell(shapeWrapper, rowId);
  });

  shapeWrapper.appendChild(deleteBadge);

  shapeWrapper.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!selectedRowIds.has(rowId)) {
      selectRow(rowId, e);
    }
    selectCell(shapeWrapper, e);
  });

  canvasRow.appendChild(shapeWrapper);

  applyColorToCell(shapeWrapper, activeColor);
  applyShapeTransform(shapeWrapper);

  if (updateCount && rowSettings[rowId]) {
    rowSettings[rowId].cellCount = canvasRow.querySelectorAll(".placed-shape").length;
    if (selectedRowIds.has(rowId)) {
      if (cellsVal) {
        cellsVal.value = rowSettings[rowId].cellCount;
      }
    }
  }
}

function removeShapeFromPanel(shapeKey) {
  if (availableShapes.length <= 1) {
    alert("You must keep at least one shape in the panel.");
    return;
  }

  captureState();
  availableShapes = availableShapes.filter((s) => s !== shapeKey);

  if (selectedShape === shapeKey) {
    selectedShape = availableShapes[0];
  }

  renderShapesGrid();
}

function removeCell(cellWrapper, rowId) {
  if (selectedCellElements.has(cellWrapper)) {
    selectedCellElements.delete(cellWrapper);
  }

  cellWrapper.remove();

  if (rowId && rowSettings[rowId] && rowSettings[rowId].cellCount > 0) {
    rowSettings[rowId].cellCount--;
    if (selectedRowIds.has(rowId)) {
      if (cellsVal) {
        cellsVal.value = rowSettings[rowId].cellCount;
      }
    }
  }
}

if (deleteShapeBtn) {
  deleteShapeBtn.addEventListener("click", () => {
    isShapeDeleteMode = !isShapeDeleteMode;
    deleteShapeBtn.classList.toggle("btn-active-delete", isShapeDeleteMode);
    renderShapesGrid();
  });
}

if (addShapeBtn && shapeFileInput) {
  addShapeBtn.addEventListener("click", () => shapeFileInput.click());

  shapeFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileLowerName = file.name.toLowerCase();
    const isPng = file.type === "image/png" || fileLowerName.endsWith(".png");
    const isJpeg = file.type === "image/jpeg" || file.type === "image/jpg" || fileLowerName.endsWith(".jpg") || fileLowerName.endsWith(".jpeg");

    if (!isPng && !isJpeg) {
      alert("Please upload only valid PNG or JPEG image files.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      captureState();
      const customKey = `custom_${Date.now()}`;
      const imgUrl = event.target.result;

      SHAPE_DEFINITIONS[customKey] = `
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <mask id="mask-${customKey}">
            <image href="${imgUrl}" x="0" y="0" width="100" height="100" preserveAspectRatio="xMidYMid meet" />
          </mask>
          <rect x="0" y="0" width="100" height="100" fill="${DEFAULT_GRAY}" mask="url(#mask-${customKey})" />
        </svg>
      `;

      availableShapes.push(customKey);
      selectedShape = customKey;

      renderShapesGrid();

      selectedRowIds.forEach(rowId => {
        const rowColor = rowSettings[rowId]?.color || selectedColor;
        addShapeToRow(rowId, customKey, true, rowColor);
      });
    };
    reader.readAsDataURL(file);

    e.target.value = "";
  });
}

// --- NEW HELPER FUNCTIONS FOR SHORTCUTS & NAVIGATION ---
function duplicateSelectedRows() {
  if (selectedRowIds.size === 0) return;
  captureState();

  const newSelectedRowIds = new Set();
  const allRowBoxes = Array.from(rowsContainer.querySelectorAll(".row-box"));

  allRowBoxes.forEach(rowBox => {
    const rowId = rowBox.dataset.rowId;
    if (selectedRowIds.has(rowId)) {
      rowCounter++;
      const newRowId = `row-${rowCounter}`;
      
      rowSettings[newRowId] = JSON.parse(JSON.stringify(rowSettings[rowId]));
      
      const newCanvasRow = rowBox.cloneNode(true);
      newCanvasRow.id = `canvas-${newRowId}`;
      newCanvasRow.dataset.rowId = newRowId;
      
      const layerItem = document.getElementById(`layer-${rowId}`);
      const newLayerItem = layerItem ? layerItem.cloneNode(true) : document.createElement("div");
      newLayerItem.id = `layer-${newRowId}`;
      newLayerItem.dataset.rowId = newRowId;
      const baseNum = newRowId.replace('row-', '');
      newLayerItem.textContent = rowSettings[newRowId].isHalfRow ? `Row ${baseNum} (Half)` : `Row ${baseNum}`;

      rowBox.after(newCanvasRow);
      if (layerItem) {
        layerItem.after(newLayerItem);
      }

      newSelectedRowIds.add(newRowId);
    }
  });

  selectedRowIds = newSelectedRowIds;
  rebindRestoredElements();
  
  document.querySelectorAll(".row-box, .layer-item").forEach(el => el.classList.remove("selected"));
  selectedRowIds.forEach(id => {
    document.getElementById(`canvas-${id}`)?.classList.add("selected");
    document.getElementById(`layer-${id}`)?.classList.add("selected");
  });

  syncPanelControls();
}

function groupSelectedRows() {
  if (selectedRowIds.size <= 1) return;
  captureState();
  const groupId = `group_${Date.now()}`;
  selectedRowIds.forEach(rowId => {
    if (rowSettings[rowId]) {
      rowSettings[rowId].groupId = groupId;
    }
  });
}

function ungroupSelectedRows() {
  if (selectedRowIds.size === 0) return;
  captureState();
  selectedRowIds.forEach(rowId => {
    if (rowSettings[rowId]) {
      delete rowSettings[rowId].groupId;
    }
  });
}

// --- GLOBAL KEYBOARD SHORTCUTS & NAVIGATION ---
document.addEventListener("keydown", (e) => {
  const isInput = document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA";
  
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isInput) {
    e.preventDefault();
    if (e.shiftKey) {
      redo();
    } else {
      undo();
    }
    return;
  }
  
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !isInput) {
    e.preventDefault();
    redo();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !isInput) {
    e.preventDefault();
    duplicateSelectedRows();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !isInput) {
    e.preventDefault();
    if (e.shiftKey) {
      ungroupSelectedRows();
    } else {
      groupSelectedRows();
    }
    return;
  }

  if (e.key === "Escape" && previewModal && previewModal.classList.contains("active")) {
    closePreviewModal();
    return;
  }

  if (isInput) return;

  const navKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (navKeys.includes(e.key)) {
    e.preventDefault();

    if (selectedCellElements.size > 0) {
      const firstCell = Array.from(selectedCellElements)[0];
      const currentRowBox = firstCell.closest(".row-box");
      if (!currentRowBox) return;
      const cells = Array.from(currentRowBox.querySelectorAll(".placed-shape"));
      const cellIndex = cells.indexOf(firstCell);

      if (e.key === "ArrowLeft" && cellIndex > 0) {
        selectCell(cells[cellIndex - 1], {});
      } else if (e.key === "ArrowRight" && cellIndex < cells.length - 1) {
        selectCell(cells[cellIndex + 1], {});
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const allRows = Array.from(rowsContainer.querySelectorAll(".row-box"));
        const rowIndex = allRows.indexOf(currentRowBox);
        const targetRowIndex = e.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
        if (targetRowIndex >= 0 && targetRowIndex < allRows.length) {
          const targetRow = allRows[targetRowIndex];
          const targetRowId = targetRow.dataset.rowId;
          selectRow(targetRowId, {});
          const targetCells = Array.from(targetRow.querySelectorAll(".placed-shape"));
          if (targetCells.length > 0) {
            const targetCell = targetCells[Math.min(cellIndex, targetCells.length - 1)];
            selectCell(targetCell, {});
          } else {
            clearSelectedCells();
          }
        }
      }
    } else if (selectedRowIds.size > 0) {
      const allRows = Array.from(rowsContainer.querySelectorAll(".row-box"));
      const firstSelectedId = Array.from(selectedRowIds)[0];
      const currentRowBox = document.getElementById(`canvas-${firstSelectedId}`);
      if (!currentRowBox) return;
      const rowIndex = allRows.indexOf(currentRowBox);

      if (e.key === "ArrowUp" && rowIndex > 0) {
        const targetRow = allRows[rowIndex - 1];
        selectRow(targetRow.dataset.rowId, {});
      } else if (e.key === "ArrowDown" && rowIndex < allRows.length - 1) {
        const targetRow = allRows[rowIndex + 1];
        selectRow(targetRow.dataset.rowId, {});
      } else if (e.key === "ArrowRight") {
        const cells = Array.from(currentRowBox.querySelectorAll(".placed-shape"));
        if (cells.length > 0) selectCell(cells[0], {});
      }
    }
    return;
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedCellElements.size > 0) {
      e.preventDefault();
      captureState();
      selectedCellElements.forEach(cell => {
        const parentRow = cell.closest(".row-box");
        const rowId = parentRow ? parentRow.dataset.rowId : Array.from(selectedRowIds)[0];
        removeCell(cell, rowId);
      });
      clearSelectedCells();
    }
  }
});

const cellsDecBtn = document.getElementById("cellsDecBtn");
const cellsIncBtn = document.getElementById("cellsIncBtn");

if (cellsDecBtn) {
  cellsDecBtn.addEventListener("click", () => {
    if (selectedRowIds.size === 0) return;
    captureState();
    let val = parseInt(cellsVal.value, 10);
    if (isNaN(val) || val <= 0) val = 0;
    else val -= 1;
    
    cellsVal.value = val;
    selectedRowIds.forEach(rowId => {
      if (rowSettings[rowId]) {
        rowSettings[rowId].cellCount = val;
        syncRowCells(rowId);
      }
    });
  });
}

if (cellsIncBtn) {
  cellsIncBtn.addEventListener("click", () => {
    if (selectedRowIds.size === 0) return;
    captureState();
    let val = parseInt(cellsVal.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    val += 1;
    
    cellsVal.value = val;
    selectedRowIds.forEach(rowId => {
      if (rowSettings[rowId]) {
        rowSettings[rowId].cellCount = val;
        syncRowCells(rowId);
      }
    });
  });
}

// App Initialization
addRow(false);
renderShapesGrid();
renderColorsGrid();