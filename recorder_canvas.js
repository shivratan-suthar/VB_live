/**
 * RECORDER_CANVAS.JS — Educator Studio Whiteboard Engine
 * Features: Fabric.js canvas management, custom SVG tool cursors, real-time stroke/cursor broadcasting,
 * multi-slide PDF/image batch loading, undo/redo history stack, and clipboard cut/copy/paste engine.
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
const placeholderChalkboardB64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTEyIiB2aWV3Qm94PSIwIDAgMjAwIDExMiI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIxMTIiIGZpbGw9IiMyMjIiLz48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzU1NSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiIGZvbnQtd2VpZ2h0PSJib2xkIj5DSEFMS0JPQVJEXzwvdGV4dD48L3N2Zz4=';
const placeholderBlankSlideB64 = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMDAiIGhlaWdodD0iMTEyIiB2aWV3Qm94PSIwIDAgMjAwIDExMiI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIxMTIiIGZpbGw9IiMyMjIiLz48dGV4dCB4PSI1MCUiIHk9IjU1JSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI0Q0RDRENCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTEiPkJMQU5LIFNMSURFTDwvdGV4dD48L3N2Zz4=';

const parent = document.getElementById('canvasContainer');
if (parent) parent.addEventListener('contextmenu', e => e.preventDefault());

window.activeColor = '#ffffff'; 
window.activeWidth = 8; 
window.activeFontSize = 42; 
window.activeTool = 'pen'; 
window.activeShapeType = null;
window.canvasClipboard = null;

window.globalSlidesDeck = []; 
window.activeSlideIndex = 0; 
window.isWorkspaceLoading = false;
window.isUserDrawingCurrently = false; 
window.currentDrawingObjectId = null; 

let shapeStartX = 0, shapeStartY = 0; 
let tempDrawingShape = null; 
let blankSlideCounter = 1;
let isRightClickErasing = false; 
let isLeftClickErasing = false;
let undoStack = []; 
let redoStack = []; 
let isHistoryProcessing = false;

window.canvas = new fabric.Canvas('fabricCanvas', { 
    width: 1920, 
    height: 1080, 
    isDrawingMode: true, 
    backgroundColor: '#1c1c1c' 
});

const syncWorkspaceBoardBoundsCalculations = () => {
    if (!parent) return;
    const targetRatio = 16 / 9; 
    const containerRatio = parent.clientWidth / parent.clientHeight;
    let newWidth = (containerRatio > targetRatio) ? parent.clientHeight * targetRatio : parent.clientWidth;
    let newHeight = (containerRatio > targetRatio) ? parent.clientHeight : parent.clientWidth / targetRatio;
    
    // Increased to 0.99 to eliminate excess black margins around the board
    const renderW = newWidth * 0.99;
    const renderH = newHeight * 0.99;
    
    canvas.setWidth(renderW); 
    canvas.setHeight(renderH); 
    canvas.setZoom(renderW / 1920); 
    canvas.calcOffset(); 
    canvas.renderAll();
};
window.addEventListener('resize', syncWorkspaceBoardBoundsCalculations);
syncWorkspaceBoardBoundsCalculations();

// =====================================================================
// CUSTOM SVG CURSORS FOR EDUCATOR STUDIO
// =====================================================================
function updateCursor() {
    let cursorConfig = 'default';
    const eraserSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.4)" stroke="%23ff4444" stroke-width="2" stroke-dasharray="3,3"/></svg>`;
    const highlightSvg = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4" fill="${encodeURIComponent(activeColor)}" fill-opacity="0.5" stroke="%23ffffff" stroke-width="2"/></svg>`;

    switch (activeTool) {
        case 'pen': cursorConfig = 'crosshair'; break;
        case 'highlight': cursorConfig = `url('${highlightSvg}') 12 12, crosshair`; break;
        case 'eraser': cursorConfig = `url('${eraserSvg}') 12 12, crosshair`; break;
        case 'pointer': cursorConfig = 'cell'; break;
        case 'shape': cursorConfig = 'crosshair'; break;
        case 'text': cursorConfig = 'text'; break;
        case 'select': cursorConfig = 'default'; break;
    }
    canvas.defaultCursor = cursorConfig;
    canvas.freeDrawingCursor = cursorConfig; 
    canvas.hoverCursor = (activeTool === 'select' || activeShapeType === 'select') ? 'move' : cursorConfig;
}

window.updateBrush = function() {
    canvas.freeDrawingBrush.shadow = null;
    canvas.freeDrawingBrush.decimate = 2.5; 
    if (activeTool === 'pen') { canvas.freeDrawingBrush.color = activeColor; canvas.freeDrawingBrush.width = activeWidth; }
    else if (activeTool === 'highlight') { canvas.freeDrawingBrush.color = activeColor + '50'; canvas.freeDrawingBrush.width = activeWidth * 4; }
    else if (activeTool === 'pointer') {
        canvas.freeDrawingBrush.color = '#ff0000'; canvas.freeDrawingBrush.width = activeWidth; 
        canvas.freeDrawingBrush.shadow = new fabric.Shadow({ color: '#ffffff', blur: 4, offsetX: 0, offsetY: 0 });
    }
    updateCursor();
};
canvas.freeDrawingBrush.color = activeColor; 
canvas.freeDrawingBrush.width = activeWidth; 
updateBrush();

function logObjectTransform(e) {
    if (e.target && e.target.id && typeof window.logActionDirectlyToTimeline === 'function') {
        window.logActionDirectlyToTimeline('object-transform', {
            targetId: e.target.id, left: Math.round(e.target.left), top: Math.round(e.target.top),
            scaleX: parseFloat(e.target.scaleX.toFixed(3)), scaleY: parseFloat(e.target.scaleY.toFixed(3)), angle: Math.round(e.target.angle)
        });
    }
}
canvas.on('object:moving', logObjectTransform);
canvas.on('object:scaling', logObjectTransform);
canvas.on('object:rotating', logObjectTransform);

window.saveHistoryState = function() {
    if (isHistoryProcessing || isWorkspaceLoading) return;
    
    // 1. Identify and temporarily remove pointer strokes
    const objects = canvas.getObjects();
    const pointerStrokes = objects.filter(o => o.isPointerStroke);
    pointerStrokes.forEach(p => canvas.remove(p));
    
    // 2. Save only the permanent drawings
    redoStack = [];
    undoStack.push(JSON.stringify(canvas.toJSON(['id', 'slideIndex', 'groupId', 'perPixelTargetFind', 'targetFindTolerance', 'strokeUniform'])));
    
    // 3. Add pointer strokes back immediately
    pointerStrokes.forEach(p => canvas.add(p));
    
    if (undoStack.length > 30) undoStack.shift(); 
};

window.performUndo = function() {
    if (undoStack.length === 0) return;
    isHistoryProcessing = true;
    redoStack.push(JSON.stringify(canvas.toJSON(['id', 'slideIndex', 'groupId', 'perPixelTargetFind', 'targetFindTolerance', 'strokeUniform']))); 
    const prevState = undoStack.pop();
    canvas.loadFromJSON(prevState, () => {
        canvas.renderAll(); isHistoryProcessing = false;
        if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('canvas-undo', { state: prevState });
        saveCurrentSlideState();
    });
};

window.performRedo = function() {
    if (redoStack.length === 0) return;
    isHistoryProcessing = true;
    undoStack.push(JSON.stringify(canvas.toJSON(['id', 'slideIndex', 'groupId', 'perPixelTargetFind', 'targetFindTolerance', 'strokeUniform'])));
    const nextState = redoStack.pop();
    canvas.loadFromJSON(nextState, () => {
        canvas.renderAll(); isHistoryProcessing = false;
        if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('canvas-redo', { state: nextState });
        saveCurrentSlideState();
    });
};
canvas.on('object:modified', () => { saveHistoryState(); saveCurrentSlideState(); });

function applyColorToSelection(chosenColor) {
    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects.length) return;
    activeObjects.forEach(obj => {
        if (obj.type === 'i-text' || obj.type === 'textbox') obj.set('fill', chosenColor);
        else obj.set('stroke', chosenColor);
        if (obj.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('object-modified', { targetId: obj.id, fill: obj.fill, stroke: obj.stroke });
    });
    canvas.renderAll(); saveHistoryState(); saveCurrentSlideState();
}

document.querySelectorAll('#colorPalette .color-dot:not(.custom-color-picker)').forEach(dot => {
    dot.addEventListener('click', () => {
        document.querySelectorAll('#colorPalette .color-dot:not(.custom-color-picker)').forEach(d => d.classList.remove('active'));
        dot.classList.add('active'); activeColor = dot.dataset.color; 
        const picker = document.getElementById('nativeColorPicker');
        if (picker) picker.value = activeColor; 
        updateBrush(); applyColorToSelection(activeColor); 
    });
});

document.getElementById('nativeColorPicker')?.addEventListener('input', (e) => {
    const chosenHexColor = e.target.value; const activeDot = document.querySelector('#colorPalette .color-dot.active');
    if (activeDot) { activeDot.dataset.color = chosenHexColor; activeDot.style.background = chosenHexColor; activeColor = chosenHexColor; updateBrush(); applyColorToSelection(activeColor); }
});

document.querySelectorAll('#brushThickness .thickness-btn').forEach(btn => {
    btn.addEventListener('click', () => { document.querySelectorAll('#brushThickness .thickness-btn').forEach(d => d.classList.remove('active')); btn.classList.add('active'); activeWidth = parseInt(btn.dataset.width, 10); updateBrush(); });
});

function evaluatePaletteSwap() {
    const activeObj = canvas.getActiveObject();
    const isTextActive = activeTool === 'text' || (activeObj && (activeObj.type === 'i-text' || activeObj.type === 'textbox'));
    document.getElementById('brushThickness').style.display = isTextActive ? 'none' : 'flex';
    document.getElementById('textSizePalette').style.display = isTextActive ? 'flex' : 'none';
}

canvas.on('selection:created', evaluatePaletteSwap);
canvas.on('selection:updated', evaluatePaletteSwap);
canvas.on('selection:cleared', evaluatePaletteSwap);

document.querySelectorAll('#textSizePalette .text-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#textSizePalette .text-size-btn').forEach(d => d.classList.remove('active'));
        btn.classList.add('active'); window.activeFontSize = parseInt(btn.dataset.size, 10);
        const activeObjects = canvas.getActiveObjects(); let modified = false;
        activeObjects.forEach(obj => {
            if (obj.type === 'i-text' || obj.type === 'textbox') {
                obj.set('fontSize', window.activeFontSize); modified = true;
                if (obj.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('object-modified', { targetId: obj.id, fontSize: window.activeFontSize });
            }
        });
        if (modified) { canvas.renderAll(); saveHistoryState(); saveCurrentSlideState(); }
    });
});

document.querySelectorAll('.tb-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); activeTool = btn.dataset.tool; activeShapeType = null;
        canvas.isDrawingMode = ['pen', 'highlight', 'pointer'].includes(activeTool);
        canvas.selection = ['select'].includes(activeTool);
        canvas.forEachObject(o => o.set('selectable', activeTool === 'select')); updateBrush();
        if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('tool-switch', { tool: activeTool });
        evaluatePaletteSwap();
    });
});

document.getElementById('btnQuickSelect')?.addEventListener('click', (e) => {
    document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active');
    activeTool = 'select'; activeShapeType = 'select'; canvas.isDrawingMode = false; canvas.selection = true;
    canvas.forEachObject(o => o.set('selectable', true)); updateCursor();
    if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('tool-switch', { tool: 'select' });
    evaluatePaletteSwap();
});

document.getElementById('btnQuickLine')?.addEventListener('click', (e) => {
    document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active')); e.currentTarget.classList.add('active');
    activeTool = 'shape'; activeShapeType = 'line'; canvas.isDrawingMode = false; canvas.selection = false;
    canvas.forEachObject(o => o.set('selectable', false)); updateCursor();
    if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('tool-switch', { tool: 'line' });
    evaluatePaletteSwap();
});

document.getElementById('btnMoreTrigger')?.addEventListener('click', e => { e.stopPropagation(); document.getElementById('moreGridPopup').classList.toggle('open'); document.getElementById('shapesMenu').classList.remove('open'); });
document.getElementById('btnShapesTrigger')?.addEventListener('click', e => { e.stopPropagation(); document.getElementById('shapesMenu').classList.toggle('open'); document.getElementById('moreGridPopup').classList.remove('open'); });
window.addEventListener('click', () => { document.getElementById('moreGridPopup')?.classList.remove('open'); document.getElementById('shapesMenu')?.classList.remove('open'); });

document.querySelectorAll('#shapesMenu .shape-opt').forEach(opt => {
    opt.addEventListener('click', (e) => {
        e.stopPropagation(); document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btnShapesTrigger').classList.add('active'); document.getElementById('shapesMenu').classList.remove('open');
        activeTool = 'shape'; activeShapeType = opt.dataset.shape;
        canvas.isDrawingMode = false; canvas.selection = (activeShapeType === 'select');
        canvas.forEachObject(o => o.set('selectable', activeShapeType === 'select')); updateCursor();
        if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('tool-switch', { tool: 'shape' });
    });
});

canvas.on('path:created', (opt) => {
    opt.path.id = currentDrawingObjectId || 'path_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    opt.path.slideIndex = activeSlideIndex; 
    opt.path.set({ perPixelTargetFind: true, targetFindTolerance: 12 });
    
    // FIX: Remove the 'animate' block and replace with a 1-second delay
    if (activeTool === 'pointer') {
        opt.path.isPointerStroke = true; // Tag for saving logic
        opt.path.set({ selectable: false, evented: false }); 
        
        const pathToRemove = opt.path;
        setTimeout(() => {
            if (canvas.getObjects().includes(pathToRemove)) {
                canvas.remove(pathToRemove);
                canvas.renderAll();
            }
        }, 1000); // Wait 1 second exactly, then vanish
        
        return; 
    }
    
    saveHistoryState(); 
    saveCurrentSlideState();
});

function swipeEraseTarget(o) {
    const pointer = canvas.getPointer(o.e); const exactTarget = canvas.findTarget(o.e, false);
    if (exactTarget) {
        if (exactTarget.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('erase-object', { targetId: exactTarget.id });
        canvas.remove(exactTarget); canvas.renderAll(); return;
    }
    const eRadius = 13; const eTL = new fabric.Point(pointer.x - eRadius, pointer.y - eRadius); const eBR = new fabric.Point(pointer.x + eRadius, pointer.y + eRadius);
    const objects = canvas.getObjects(); let erasedAnything = false;
    for (let i = objects.length - 1; i >= 0; i--) {
        if (objects[i].intersectsWithRect(eTL, eBR) || objects[i].containsPoint(pointer)) {
            if (objects[i].id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('erase-object', { targetId: objects[i].id });
            canvas.remove(objects[i]); erasedAnything = true;
        }
    }
    if (erasedAnything) canvas.renderAll(); 
}

canvas.on('mouse:down', (o) => {
    if (o.e.button === 2) { isRightClickErasing = true; swipeEraseTarget(o); return; }
    if (activeTool === 'eraser') { isLeftClickErasing = true; swipeEraseTarget(o); return; }
    if (activeTool === 'text') {
        if (o.target && (o.target.type === 'i-text' || o.target.type === 'textbox')) return; 
        const p = canvas.getPointer(o.e); const textId = 'text_' + Date.now();
        const textObj = new fabric.Textbox('', { left: Math.round(p.x), top: Math.round(p.y), width: 400, fill: activeColor, fontFamily: 'Segoe UI', fontSize: window.activeFontSize, id: textId, slideIndex: activeSlideIndex, selectable: true });
        if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('draw-start', { x: Math.round(p.x), y: Math.round(p.y), tool: 'text', color: activeColor, width: activeWidth, fontSize: window.activeFontSize, objectId: textId, slideIndex: activeSlideIndex });
        canvas.add(textObj); canvas.setActiveObject(textObj); textObj.enterEditing(); 
        document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active')); document.getElementById('btnQuickSelect').classList.add('active');
        activeTool = 'select'; evaluatePaletteSwap(); canvas.renderAll(); saveHistoryState(); saveCurrentSlideState(); return;
    }
    if (activeTool === 'select' || activeShapeType === 'select') return;
    isUserDrawingCurrently = true; const p = canvas.getPointer(o.e);
    currentDrawingObjectId = (activeTool === 'shape') ? ('shape_' + Date.now()) : ('path_' + Date.now());
    const rx = Math.round(p.x); const ry = Math.round(p.y);
    if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('draw-start', { x: rx, y: ry, tool: activeTool, color: activeColor, width: activeWidth, shapeType: activeShapeType, objectId: currentDrawingObjectId, slideIndex: activeSlideIndex });
    if (activeTool !== 'shape') return;
    shapeStartX = rx; shapeStartY = ry;
    const baseProps = { id: currentDrawingObjectId, slideIndex: activeSlideIndex, left: rx, top: ry, fill: 'transparent', stroke: activeColor, strokeWidth: activeWidth, selectable: false, strokeUniform: true };
    if (activeShapeType === 'rect') tempDrawingShape = new fabric.Rect({ ...baseProps, width:0, height:0 });
    if (activeShapeType === 'circle') tempDrawingShape = new fabric.Circle({ ...baseProps, radius:0, originX:'center', originY:'center' });
    if (activeShapeType === 'ellipse') tempDrawingShape = new fabric.Ellipse({ ...baseProps, rx:0, ry:0, originX:'center', originY:'center' });
    if (activeShapeType === 'triangle') tempDrawingShape = new fabric.Triangle({ ...baseProps, width:0, height:0 });
    if (activeShapeType === 'line') tempDrawingShape = new fabric.Line([rx, ry, rx, ry], baseProps);
    if (activeShapeType === 'cube') tempDrawingShape = new fabric.Path("M 50 0 L 100 25 L 100 75 L 50 100 L 0 75 L 0 25 Z M 50 0 L 50 50 L 100 25 M 0 25 L 50 50 L 50 100", { ...baseProps, scaleX: 0, scaleY: 0, originX: 'left', originY: 'top' });
    if (tempDrawingShape) canvas.add(tempDrawingShape);
});

// =====================================================================
// REAL-TIME CURSOR BROADCAST (ALWAYS EMITS FIRST BEFORE ERASING GUARD)
// =====================================================================
canvas.on('mouse:move', (o) => {
    const p = canvas.getPointer(o.e); 
    const now = Date.now(); 
    const rx = Math.round(p.x); 
    const ry = Math.round(p.y);
    
    // Only emit drawing actions if the broadcast session is actively live
    if (window.isRecording && window.liveSocket && window.ROOM_ID) {
        if (now - (window.lastLiveCursorEmit || 0) > 35) { 
            window.liveSocket.emit('board-action', window.ROOM_ID, { type: 'cursor', x: rx, y: ry }); 
            window.lastLiveCursorEmit = now; 
        }
        if (isUserDrawingCurrently && (now - (window.lastLiveDrawEmit || 0) > 20)) { 
            window.liveSocket.emit('board-action', window.ROOM_ID, { type: 'draw-move', x: rx, y: ry, tool: activeTool, color: activeColor }); 
            window.lastLiveDrawEmit = now; 
        }
    }

    // Return early ONLY AFTER emitting cursor coordinates so erasing doesn't freeze the student's cursor!
    if (isRightClickErasing || isLeftClickErasing) { 
        swipeEraseTarget(o); 
        return; 
    }

    if (window.isRecording && (now - (window.lastCursorLogTime || 0) > 25)) { if (window.jsonDrawingTimelineLog) window.jsonDrawingTimelineLog.push([now - (window.recordStartTime || 0), 'c', rx, ry]); window.lastCursorLogTime = now; }
    if (window.isRecording && isUserDrawingCurrently) { if (window.jsonDrawingTimelineLog) window.jsonDrawingTimelineLog.push([now - (window.recordStartTime || 0), 'd', rx, ry]); }

    if (!tempDrawingShape || activeTool !== 'shape' || activeShapeType === 'select') return;
    if (activeShapeType === 'rect' || activeShapeType === 'triangle') tempDrawingShape.set({ width: Math.abs(shapeStartX - p.x), height: Math.abs(shapeStartY - p.y), left: Math.min(p.x, shapeStartX), top: Math.min(p.y, shapeStartY) });
    else if (activeShapeType === 'circle') tempDrawingShape.set({ radius: Math.sqrt(Math.pow(shapeStartX - p.x, 2) + Math.pow(shapeStartY - p.y, 2)) });
    else if (activeShapeType === 'ellipse') tempDrawingShape.set({ rx: Math.abs(shapeStartX - p.x), ry: Math.abs(shapeStartY - p.y) });
    else if (activeShapeType === 'line') tempDrawingShape.set({ x2: p.x, y2: p.y });
    else if (activeShapeType === 'cube') tempDrawingShape.set({ scaleX: Math.max(0.1, Math.abs(p.x - shapeStartX) / 100), scaleY: Math.max(0.1, Math.abs(p.y - shapeStartY) / 100) });
    canvas.renderAll();
});
canvas.on('mouse:up', (o) => { 
    if (o.e.button === 2) { isRightClickErasing = false; canvas.renderAll(); saveHistoryState(); saveCurrentSlideState(); return; }
    if (activeTool === 'eraser') { isLeftClickErasing = false; canvas.renderAll(); saveHistoryState(); saveCurrentSlideState(); return; }
    
    isUserDrawingCurrently = false; 
    if (typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('draw-end'); 
    
    if (tempDrawingShape) { 
        tempDrawingShape.setCoords(); 
        canvas.renderAll(); 
        saveHistoryState(); 
        saveCurrentSlideState(); 
        tempDrawingShape = null; 
    }
    
    // NEW: Push authoritative JSON snapshot to all students whenever a drawing action finishes!
    if (window.isRecording && typeof window.broadcastDeckState === 'function') {
        window.broadcastDeckState();
    }
});
canvas.on('text:editing:exited', (o) => {
    if (!o.target.text || o.target.text.trim() === '') canvas.remove(o.target); 
    canvas.renderAll(); saveHistoryState(); saveCurrentSlideState();
    if (o.target.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('text-edit', { targetId: o.target.id, text: o.target.text });
});

canvas.on('selection:cleared', () => { if (!['shape', 'select', 'eraser', 'text'].includes(activeTool) && activeShapeType !== 'select') canvas.forEachObject(obj => obj.set('selectable', false)); });

// --- IMAGE UPLOADER WITH INSTANT STUDENT BROADCAST ---
document.getElementById('btnInsertImage')?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('canvasImageInsertLoader')?.click(); });
document.getElementById('canvasImageInsertLoader')?.addEventListener('change', function(e) {
    const file = e.target.files[0]; if (!file) return; const reader = new FileReader();
    reader.onload = function(f) {
        const imgDataUrl = f.target.result;
        fabric.Image.fromURL(imgDataUrl, function(img) {
            const maxW = 1920 * 0.7; const maxH = 1080 * 0.7; 
            if (img.width > maxW || img.height > maxH) img.scale(Math.min(maxW / img.width, maxH / img.height));
            const imgId = 'image_' + Date.now();
            img.set({ id: imgId, slideIndex: activeSlideIndex, left: 960, top: 540, originX: 'center', originY: 'center', selectable: true, evented: true, hasControls: true, hasBorders: true });
            canvas.isDrawingMode = false; document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active')); document.getElementById('btnQuickSelect').classList.add('active');
            activeTool = 'select'; activeShapeType = 'select'; updateCursor();
            canvas.add(img); canvas.setActiveObject(img); canvas.renderAll(); saveHistoryState(); saveCurrentSlideState();
            
            if (typeof window.logActionDirectlyToTimeline === 'function') {
                window.logActionDirectlyToTimeline('insert-image', { targetId: imgId, src: imgDataUrl });
            }
            if (typeof window.broadcastDeckState === 'function') window.broadcastDeckState();
        });
    }; reader.readAsDataURL(file); e.target.value = '';
});

// --- BATCH DOCUMENT & SLIDE MANAGER ---
document.getElementById('gridFileLoader')?.addEventListener('change', handleBatchFileUpload);
document.getElementById('sideFileLoader')?.addEventListener('change', handleBatchFileUpload);

window.initDefaultWorkspace = function() {
    globalSlidesDeck = [{ id: 'default_blank', name: 'Blank Chalkboard', type: 'blank', thumbnail: placeholderChalkboardB64, annotation: null }];
    activeSlideIndex = 0; renderFlatSlideSorterUI(); renderActiveSlideToBoard();
};

async function handleBatchFileUpload(e) {
    const files = e.target.files; if (!files.length) return; 
    saveCurrentSlideState();
    let totalSlidesAdded = 0; 
    for (let i = 0; i < files.length; i++) {
        const file = files[i]; const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') {
            const buffer = await file.arrayBuffer(); const pdf = await pdfjsLib.getDocument(new Uint8Array(buffer)).promise;
            for (let pNum = 1; pNum <= pdf.numPages; pNum++) {
                const page = await pdf.getPage(pNum); 
                const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = 200; thumbCanvas.height = 112; 
                const thumbCtx = thumbCanvas.getContext('2d'); thumbCtx.fillStyle = '#000000'; thumbCtx.fillRect(0,0,200,112);
                await page.render({ canvasContext: thumbCtx, viewport: page.getViewport({ scale: Math.min(200 / page.getViewport({scale:1}).width, 112 / page.getViewport({scale:1}).height) }) }).promise;
                const fullCanvas = document.createElement('canvas'); const viewport = page.getViewport({ scale: 1.5 }); fullCanvas.width = viewport.width; fullCanvas.height = viewport.height;
                const fullCtx = fullCanvas.getContext('2d'); fullCtx.fillStyle = '#ffffff'; fullCtx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
                await page.render({ canvasContext: fullCtx, viewport: viewport }).promise;
                const pageDataUrl = fullCanvas.toDataURL('image/jpeg', 0.80);
                globalSlidesDeck.push({ id: `pdf_${Date.now()}_p${pNum}`, name: `${file.name} (p. ${pNum})`, type: 'image', sourceUrl: pageDataUrl, thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.6), annotation: null });
                totalSlidesAdded++;
            }
        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image(); img.onload = () => {
                        const thumbCanvas = document.createElement('canvas'); thumbCanvas.width = 200; thumbCanvas.height = 112; 
                        thumbCanvas.getContext('2d').drawImage(img, 0, 0, 200, 112);
                        globalSlidesDeck.push({ id: `img_${Date.now()}`, name: file.name, type: 'image', sourceUrl: ev.target.result, thumbnail: thumbCanvas.toDataURL('image/jpeg', 0.6), annotation: null }); 
                        totalSlidesAdded++; resolve();
                    }; img.src = ev.target.result;
                }; reader.readAsDataURL(file);
            });
        }
    }
    renderFlatSlideSorterUI(); activeSlideIndex = globalSlidesDeck.length - totalSlidesAdded;
    if(activeSlideIndex < 0) activeSlideIndex = 0; renderActiveSlideToBoard(); e.target.value = '';
    if (typeof window.broadcastDeckState === 'function') window.broadcastDeckState();
}

function renderFlatSlideSorterUI() {
    const container = document.getElementById('fileRegistryContainer'); if (!container) return;
    container.innerHTML = '';
    globalSlidesDeck.forEach((slide, index) => {
        const card = document.createElement('div'); card.className = `file-card ${index === activeSlideIndex ? 'active' : ''}`;
        card.setAttribute('onclick', `window.jumpToSlideIndex(${index})`);
        card.innerHTML = `<button class="del-hook" onclick="window.removeSingleSlide(event, ${index})">✕</button><div class="thumb-box"><img src="${slide.thumbnail}"></div><div class="card-info"><div class="slide-num-badge">${index + 1}</div><span>${slide.name}</span></div>`;
        container.appendChild(card);
    });
    const indicator = document.getElementById('pageIndicator');
    if (indicator) indicator.textContent = `${activeSlideIndex + 1} / ${globalSlidesDeck.length}`;
}

window.jumpToSlideIndex = function(index) { saveCurrentSlideState(); activeSlideIndex = index; renderFlatSlideSorterUI(); renderActiveSlideToBoard(); }
window.removeSingleSlide = function(e, index) { e.stopPropagation(); globalSlidesDeck.splice(index, 1); if (!globalSlidesDeck.length) initDefaultWorkspace(); else { if (activeSlideIndex >= globalSlidesDeck.length) activeSlideIndex = globalSlidesDeck.length - 1; renderFlatSlideSorterUI(); renderActiveSlideToBoard(); } if (typeof window.broadcastDeckState === 'function') window.broadcastDeckState(); }

function renderActiveSlideToBoard() {
    const slide = globalSlidesDeck[activeSlideIndex]; if (!slide) return;
    isWorkspaceLoading = true;
    if (slide.annotation) { canvas.loadFromJSON(slide.annotation, () => { applySlideBackground(slide); isWorkspaceLoading = false; canvas.renderAll(); undoStack = []; redoStack = []; saveHistoryState(); }); } 
    else { canvas.clear(); applySlideBackground(slide); isWorkspaceLoading = false; canvas.renderAll(); undoStack = []; redoStack = []; saveHistoryState(); }
}

function applySlideBackground(slide) {
    if (!slide) return;
    if (slide.sourceUrl) { fabric.Image.fromURL(slide.sourceUrl, img => { img.scaleToWidth(1920); canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas)); }, { crossOrigin: 'anonymous' }); } 
    else { canvas.setBackgroundImage(null, canvas.renderAll.bind(canvas)); }
}

window.saveCurrentSlideState = function() {
    if (isWorkspaceLoading) return; 
    const currentSlide = globalSlidesDeck[activeSlideIndex];
    if (currentSlide) {
        // 1. Identify and temporarily remove pointer strokes
        const objects = canvas.getObjects();
        const pointerStrokes = objects.filter(o => o.isPointerStroke);
        pointerStrokes.forEach(p => canvas.remove(p));
        
        // 2. Save state without the pointer
        canvas.renderAll(); 
        currentSlide.annotation = JSON.stringify(canvas.toJSON(['id', 'slideIndex', 'groupId', 'perPixelTargetFind', 'targetFindTolerance', 'strokeUniform']));
        currentSlide.thumbnail = canvas.toDataURL('image/webp', 0.4);
        
        // 3. Add pointer strokes back
        pointerStrokes.forEach(p => canvas.add(p));
        
        const activeThumbImg = document.querySelector('.file-card.active .thumb-box img'); 
        if (activeThumbImg) activeThumbImg.src = currentSlide.thumbnail;
    }
};

document.getElementById('btnAddPage')?.addEventListener('click', () => { 
    saveCurrentSlideState(); globalSlidesDeck.push({ id: `blank_${Date.now()}`, name: `Blank Slide ${blankSlideCounter++}`, type: 'blank', thumbnail: placeholderBlankSlideB64, annotation: null }); activeSlideIndex = globalSlidesDeck.length - 1; renderFlatSlideSorterUI(); renderActiveSlideToBoard(); 
    if (typeof window.broadcastDeckState === 'function') window.broadcastDeckState();
});
document.getElementById('btnPrevPage')?.addEventListener('click', () => { if (activeSlideIndex > 0) window.jumpToSlideIndex(activeSlideIndex - 1); });
document.getElementById('btnNextPage')?.addEventListener('click', () => { if (activeSlideIndex < globalSlidesDeck.length - 1) window.jumpToSlideIndex(activeSlideIndex + 1); });

initDefaultWorkspace();

// --- CLIPBOARD ENGINE ---
function copyToClipboard() {
    if (activeTool !== 'select' && activeShapeType !== 'select') return;
    const activeObject = canvas.getActiveObject();
    if (activeObject) { activeObject.clone(function(cloned) { window.canvasClipboard = cloned; }, ['slideIndex', 'id']); } 
}

function cutToClipboard() {
    if (activeTool !== 'select' && activeShapeType !== 'select') return;
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
        activeObject.clone(function(cloned) {
            window.canvasClipboard = cloned;
            const activeObjects = canvas.getActiveObjects(); canvas.discardActiveObject();
            activeObjects.forEach(function(object) {
                if (object.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('erase-object', { targetId: object.id });
                canvas.remove(object);
            });
            canvas.renderAll(); saveHistoryState(); saveCurrentSlideState();
        }, ['slideIndex', 'id']);
    }
}

function pasteFromClipboard() {
    if (!window.canvasClipboard) return;
    document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active')); document.getElementById('btnQuickSelect').classList.add('active');
    activeTool = 'select'; activeShapeType = 'select'; canvas.isDrawingMode = false; canvas.selection = true; canvas.forEachObject(o => o.set('selectable', true)); updateCursor(); evaluatePaletteSwap();
    window.canvasClipboard.clone(function(clonedObj) {
        canvas.discardActiveObject();
        clonedObj.set({ left: clonedObj.left + 30, top: clonedObj.top + 30, evented: true });
        if (clonedObj.type === 'activeSelection') {
            clonedObj.canvas = canvas; clonedObj.forEachObject(function(obj) { obj.set('id', 'pasted_' + Date.now() + '_' + Math.floor(Math.random() * 1000)); obj.set('slideIndex', activeSlideIndex); canvas.add(obj); }); clonedObj.setCoords();
        } else { clonedObj.set('id', 'pasted_' + Date.now() + '_' + Math.floor(Math.random() * 1000)); clonedObj.set('slideIndex', activeSlideIndex); canvas.add(clonedObj); }
        window.canvasClipboard.top += 30; window.canvasClipboard.left += 30; canvas.setActiveObject(clonedObj); canvas.requestRenderAll(); saveHistoryState(); saveCurrentSlideState();
    }, ['slideIndex', 'id']);
}

window.addEventListener('keydown', (e) => {
    const activeObjects = canvas.getActiveObjects(); const isEditingText = activeObjects.length === 1 && activeObjects[0].isEditing;
    if (isEditingText) return; 
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeObjects.length > 0) {
            if (e.key === 'Backspace') e.preventDefault(); 
            activeObjects.forEach(obj => {
                if (obj.id && typeof window.logActionDirectlyToTimeline === 'function') window.logActionDirectlyToTimeline('erase-object', { targetId: obj.id });
                canvas.remove(obj);
            });
            canvas.discardActiveObject(); canvas.renderAll(); saveHistoryState(); saveCurrentSlideState();
        }
    }
    if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'c') { e.preventDefault(); copyToClipboard(); }
        else if (key === 'x') { e.preventDefault(); cutToClipboard(); }
        else if (key === 'v') { e.preventDefault(); pasteFromClipboard(); }
    }
});