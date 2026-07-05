/**
 * PLAYER1.JS - Canvas & UI Layout Engine (Live Classroom Edition)
 * Handles scaling, slide background loading, UI toggles, PIP dragging, precision cursor tracking, and PDF export.
 */

window.globalSlidesDeck = [];
window.activeSlideIndex = 0;
window.areAnnotationsVisible = true;
window.isSlideModeActive = false;
window.currentPlaybackRate = 1.0; 

window.parentContainer = document.getElementById('canvasContainer');
window.canvas = new fabric.Canvas('fabricCanvas', { width: 1920, height: 1080, isDrawingMode: false, selection: false, backgroundColor: '#1c1c1c' });
window.camVideoFeed = document.getElementById('webcamVideoFeed');
window.playPauseBtn = document.getElementById('btnModernPlayPause');
window.seekbar = document.getElementById('playerMasterTimelineSliderScrubber');
window.settingsCard = document.getElementById('modernSettingsCardPopup');
const dragBox = document.getElementById('webcamContainerWrapperBox');

// --- 16:9 CANVAS RESPONSIVE LOCK ---
window.syncCanvasDimensionsToWrapper = () => {
    if (!window.parentContainer) return;
    
    // GUARD CLAUSE: Prevent layout collapse when the window is hidden or out of focus
    if (window.parentContainer.clientWidth === 0 || window.parentContainer.clientHeight === 0) return;

    const targetRatio = 16 / 9; 
    const containerRatio = window.parentContainer.clientWidth / window.parentContainer.clientHeight;
    let newWidth = (containerRatio > targetRatio) ? window.parentContainer.clientHeight * targetRatio : window.parentContainer.clientWidth;
    let newHeight = (containerRatio > targetRatio) ? window.parentContainer.clientHeight : window.parentContainer.clientWidth / targetRatio;

    const renderW = newWidth * 0.96;
    const renderH = newHeight * 0.96;

    window.canvas.setWidth(renderW);
    window.canvas.setHeight(renderH);
    window.canvas.setZoom(renderW / 1920); // MASTER 1920 VIRTUAL LOCK
    window.canvas.calcOffset(); 
    
    if (window.globalSlidesDeck[window.activeSlideIndex]) {
        window.applySlideBackground(window.globalSlidesDeck[window.activeSlideIndex]);
    }
    window.canvas.renderAll(); 
};
window.addEventListener('resize', window.syncCanvasDimensionsToWrapper);


// =====================================================================
// PRECISION EDUCATOR CURSOR TRACKING & VISUAL CONTROLLER
// =====================================================================
let cursorAutoHideTimeout = null;
let lastKnownCursorX = 960;
let lastKnownCursorY = 540;

window.updateCursorVisualState = function(virtualX, virtualY, tool = 'pen', color = '#ffffff') {
    const cursorEl = document.getElementById('playbackCursor');
    const parentContainer = document.getElementById('canvasContainer');
    
    if (!cursorEl || !window.canvas || !parentContainer) return;

    // Prevent top-left snapping when tool-switch events pass (0,0)
    if (virtualX === 0 && virtualY === 0 && lastKnownCursorX) {
        virtualX = lastKnownCursorX;
        virtualY = lastKnownCursorY;
    } else {
        lastKnownCursorX = virtualX;
        lastKnownCursorY = virtualY;
    }

    // 1. Get exact zoom scale of the 1920x1080 virtual canvas
    const zoom = window.canvas.getZoom();
    
    // 2. Get DOM bounding boxes to account for flexbox centering margins
    const canvasDOMRect = window.canvas.lowerCanvasEl.getBoundingClientRect();
    const containerDOMRect = parentContainer.getBoundingClientRect();

    // 3. Map virtual coordinates to exact DOM screen pixels relative to #canvasContainer
    const exactScreenX = (canvasDOMRect.left - containerDOMRect.left) + (virtualX * zoom);
    const exactScreenY = (canvasDOMRect.top - containerDOMRect.top) + (virtualY * zoom);

    // 4. Apply precise position
    cursorEl.style.display = 'block';
    cursorEl.style.left = `${exactScreenX}px`;
    cursorEl.style.top = `${exactScreenY}px`;

    // 5. Morph cursor appearance based on active educator tool
    cursorEl.className = ''; // Reset tool classes
    if (tool === 'pointer' || tool === 'laser') {
        cursorEl.classList.add('tool-laser');
    } else if (tool === 'highlight') {
        cursorEl.classList.add('tool-highlight');
        cursorEl.style.backgroundColor = color;
    } else if (tool === 'eraser') {
        cursorEl.classList.add('tool-eraser');
    } else {
        // Standard pen or text tool matches the educator's selected color
        cursorEl.style.backgroundColor = color;
    }

    // 6. Auto-hide cursor after 4 seconds of educator inactivity
    if (cursorAutoHideTimeout) clearTimeout(cursorAutoHideTimeout);
    cursorAutoHideTimeout = setTimeout(() => {
        cursorEl.style.display = 'none';
    }, 4000);
};


// --- DRAGGABLE WEBCAM PIP BOX (WITH TOUCH SUPPORT) ---
let isDragging = false; let startX, startY, initialLeft, initialTop;

const startDragHandler = (e) => {
    if (window.isSlideModeActive) return;
    isDragging = true;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    startX = clientX; startY = clientY;
    initialLeft = dragBox.offsetLeft; initialTop = dragBox.offsetTop;
    if (!e.touches) e.preventDefault();
};

const moveDragHandler = (e) => {
    if (!isDragging || window.isSlideModeActive || !dragBox) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    let targetLeft = initialLeft + (clientX - startX); 
    let targetTop = initialTop + (clientY - startY);
    const containerW = window.parentContainer.clientWidth; const containerH = window.parentContainer.clientHeight;
    const elementW = dragBox.offsetWidth; const elementH = dragBox.offsetHeight;

    if (targetLeft < -(elementW / 2)) targetLeft = -(elementW / 2);
    if (targetLeft > containerW - (elementW / 2)) targetLeft = containerW - (elementW / 2);
    if (targetTop < -(elementH / 2)) targetTop = -(elementH / 2);
    if (targetTop > containerH - (elementH / 2)) targetTop = containerH - (elementH / 2);

    dragBox.style.left = targetLeft + 'px'; dragBox.style.top = targetTop + 'px'; dragBox.style.right = 'auto';
};

const stopDragHandler = () => { isDragging = false; };

if (dragBox) {
    dragBox.addEventListener('mousedown', startDragHandler);
    dragBox.addEventListener('touchstart', startDragHandler, { passive: true });
}
window.addEventListener('mousemove', moveDragHandler);
window.addEventListener('touchmove', moveDragHandler, { passive: false });
window.addEventListener('mouseup', stopDragHandler);
window.addEventListener('touchend', stopDragHandler);


// --- SLIDE DECK SORTER UI ---
window.renderFlatSlideSorterUI = function() {
    const container = document.getElementById('fileRegistryContainer'); 
    if (!container) return;
    container.innerHTML = '';
    
    window.globalSlidesDeck.forEach((slide, index) => {
        const card = document.createElement('div');
        card.className = `file-card ${index === window.activeSlideIndex ? 'playing-active' : ''}`;
        card.setAttribute('onclick', `window.jumpToSlideIndex(${index})`);
        const playCircleOverlayIcon = window.isSlideModeActive ? '<div class="play-overlay">▶</div>' : '';
        
        let previewSrc = slide.thumbnail;
        if (!window.areAnnotationsVisible) { 
            previewSrc = slide.sourceUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"><rect width="100%" height="100%" fill="%231c1c1c"/></svg>'; 
        }

        card.innerHTML = `<div class="thumb-box">${playCircleOverlayIcon}<img src="${previewSrc}"></div>
                          <div class="card-info"><div class="slide-num-badge">${index + 1}</div><span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70%; font-weight:500;">${slide.name}</span></div>`;
        container.appendChild(card);
    });
    
    const indicator = document.getElementById('lblStepperIndexTextIndicator');
    if (indicator) {
        indicator.textContent = `${window.activeSlideIndex + 1} / ${window.globalSlidesDeck.length}`;
    }
};

window.applySlideBackground = function(slide, customCanvas = window.canvas) {
    if (!slide) return;
    if (slide.sourceUrl) {
        fabric.Image.fromURL(slide.sourceUrl, img => { 
            img.scaleToWidth(1920); // MASTER 1920 VIRTUAL LOCK
            customCanvas.setBackgroundImage(img, customCanvas.renderAll.bind(customCanvas)); 
        }, { crossOrigin: 'anonymous' });
    } else { 
        customCanvas.setBackgroundImage(null, customCanvas.renderAll.bind(customCanvas)); 
    }
};


// --- SETTINGS POPUP CONTROLLERS ---
if (document.getElementById('btnModernSettingsTrigger')) {
    document.getElementById('btnModernSettingsTrigger').addEventListener('click', e => { 
        e.stopPropagation(); window.settingsCard.classList.toggle('open'); 
        document.getElementById('settingsPopupMainLayer').classList.remove('hidden'); 
        document.getElementById('settingsPopupSpeedLayer').classList.add('hidden');
    });
}
window.addEventListener('click', () => { if (window.settingsCard) window.settingsCard.classList.remove('open'); });
if (document.getElementById('btnTriggerSpeedSubmenu')) {
    document.getElementById('btnTriggerSpeedSubmenu').addEventListener('click', (e) => {
        e.stopPropagation(); document.getElementById('settingsPopupMainLayer').classList.add('hidden'); 
        document.getElementById('settingsPopupSpeedLayer').classList.remove('hidden');
    });
}
if (document.getElementById('btnBackToMainSettingsMenu')) {
    document.getElementById('btnBackToMainSettingsMenu').addEventListener('click', () => {
        document.getElementById('settingsPopupMainLayer').classList.remove('hidden'); 
        document.getElementById('settingsPopupSpeedLayer').classList.add('hidden');
    });
}


// --- SLIDE MODE TOGGLE ---
window.toggleSlideMode = function(forceState) {
    window.isSlideModeActive = (forceState !== undefined) ? forceState : !window.isSlideModeActive;
    const sidebar = document.getElementById('appWorkspaceSidebarColumnPanel');
    const sideBackBtn = document.getElementById('btnExitSlideModeArrow');
    
    if (window.isSlideModeActive) {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => console.error("Could not exit fullscreen:", err));
        }

        if (window.camVideoFeed) window.camVideoFeed.pause(); 
        if (window.playPauseBtn) window.playPauseBtn.textContent = "▶"; 
        
        document.getElementById('pillSlideModeOff')?.classList.remove('active'); 
        document.getElementById('pillSlideModeOn')?.classList.add('active');
        
        sidebar?.classList.remove('slide-mode-hidden'); 
        document.body.classList.add('sidebar-open');
        document.getElementById('studioPlaybackPlayerToolbarUI')?.classList.add('hidden'); 
        window.settingsCard?.classList.remove('open');
        sideBackBtn?.classList.remove('hidden'); 
        if (dragBox) dragBox.style.display = 'none';
        
        if (typeof window.jumpToSlideIndex === 'function') {
            window.jumpToSlideIndex(window.activeSlideIndex);
        }
    } else {
        document.getElementById('pillSlideModeOn')?.classList.remove('active'); 
        document.getElementById('pillSlideModeOff')?.classList.add('active');
        
        sidebar?.classList.add('slide-mode-hidden'); 
        document.body.classList.remove('sidebar-open');
        document.getElementById('studioPlaybackPlayerToolbarUI')?.classList.remove('hidden'); 
        sideBackBtn?.classList.add('hidden'); 
        if (dragBox) dragBox.style.display = 'flex';
        
        if (window.camVideoFeed && window.camVideoFeed.srcObject) {
            window.camVideoFeed.play();
            if (window.playPauseBtn) window.playPauseBtn.textContent = "⏸";
        }
    }
    window.renderFlatSlideSorterUI(); 
    setTimeout(window.syncCanvasDimensionsToWrapper, 320);
};

document.getElementById('rowToggleSlideMode')?.addEventListener('click', () => window.toggleSlideMode());
document.getElementById('btnExitSlideModeArrow')?.addEventListener('click', (e) => { e.stopPropagation(); window.toggleSlideMode(false); });


// --- ANNOTATION VISIBILITY TOGGLE ---
document.getElementById('btnToggleAnnotationsVectorVisibility')?.addEventListener('click', () => {
    window.areAnnotationsVisible = !window.areAnnotationsVisible;
    if (window.areAnnotationsVisible) { 
        document.getElementById('pillVectorsOff')?.classList.remove('active'); 
        document.getElementById('pillVectorsOn')?.classList.add('active'); 
    } else { 
        document.getElementById('pillVectorsOn')?.classList.remove('active'); 
        document.getElementById('pillVectorsOff')?.classList.add('active'); 
    }
    
    window.canvas.forEachObject(obj => { 
        const isCurrentSlide = obj.slideIndex === undefined || obj.slideIndex === window.activeSlideIndex;
        obj.visible = (isCurrentSlide && window.areAnnotationsVisible); 
    }); 
    window.canvas.renderAll();
    window.renderFlatSlideSorterUI(); 
});


// --- FULLSCREEN TOGGLE ---
document.getElementById('btnModernFullscreenToggle')?.addEventListener('click', () => {
    const workspace = document.querySelector('.app-body');
    if (!document.fullscreenElement && workspace) { 
        workspace.requestFullscreen().then(() => { setTimeout(window.syncCanvasDimensionsToWrapper, 100); }); 
    } else if (document.fullscreenElement) { 
        document.exitFullscreen(); 
    }
});
document.addEventListener('fullscreenchange', () => { setTimeout(window.syncCanvasDimensionsToWrapper, 150); });

document.getElementById('btnStepperPrevPage')?.addEventListener('click', () => { 
    if (window.activeSlideIndex > 0 && typeof window.jumpToSlideIndex === 'function') window.jumpToSlideIndex(window.activeSlideIndex - 1); 
});
document.getElementById('btnStepperNextPage')?.addEventListener('click', () => { 
    if (window.activeSlideIndex < window.globalSlidesDeck.length - 1 && typeof window.jumpToSlideIndex === 'function') window.jumpToSlideIndex(window.activeSlideIndex + 1); 
});


// --- VOLUME & MUTE CONTROLS ---
const muteBtn = document.getElementById('btnModernMuteToggle');
const volSlider = document.getElementById('playerVolumeSlider');

if (muteBtn && window.camVideoFeed) {
    muteBtn.addEventListener('click', () => {
        window.camVideoFeed.muted = !window.camVideoFeed.muted;
        muteBtn.textContent = window.camVideoFeed.muted || window.camVideoFeed.volume === 0 ? "🔇" : (window.camVideoFeed.volume > 0.5 ? "🔊" : "🔉");
        if(volSlider) volSlider.value = window.camVideoFeed.muted ? 0 : (window.camVideoFeed.volume || 1);
    });
}

if (volSlider && window.camVideoFeed) {
    volSlider.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value);
        window.camVideoFeed.volume = vol;
        if (vol > 0) {
            window.camVideoFeed.muted = false;
            if (muteBtn) muteBtn.textContent = vol > 0.5 ? "🔊" : "🔉";
        } else {
            window.camVideoFeed.muted = true;
            if (muteBtn) muteBtn.textContent = "🔇";
        }
    });
}


// --- PDF EXPORT ENGINE ---
document.getElementById('btnDownloadPdf')?.addEventListener('click', async function() {
    if (!window.globalSlidesDeck || window.globalSlidesDeck.length === 0) return;
    
    const btn = this;
    const originalText = btn.textContent;
    btn.textContent = "⏳"; 
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('landscape', 'px', [1920, 1080]);
        
        const tempCanvasEl = document.createElement('canvas');
        tempCanvasEl.width = 1920;
        tempCanvasEl.height = 1080;
        const exportCanvas = new fabric.Canvas(tempCanvasEl, { width: 1920, height: 1080, backgroundColor: '#1c1c1c' });

        for (let i = 0; i < window.globalSlidesDeck.length; i++) {
            const slide = window.globalSlidesDeck[i];
            exportCanvas.clear();

            if (window.areAnnotationsVisible && slide.annotation) {
                await new Promise((resolve) => {
                    exportCanvas.loadFromJSON(slide.annotation, () => {
                        exportCanvas.forEachObject(obj => { obj.visible = true; }); 
                        resolve();
                    });
                });
            }

            if (slide.sourceUrl) {
                await new Promise((resolve) => {
                    fabric.Image.fromURL(slide.sourceUrl, (img) => {
                        img.scaleToWidth(1920);
                        exportCanvas.setBackgroundImage(img, () => {
                            exportCanvas.renderAll();
                            resolve();
                        });
                    }, { crossOrigin: 'anonymous' }); 
                });
            } else {
                exportCanvas.renderAll();
            }

            const imgData = exportCanvas.toDataURL({ format: 'jpeg', quality: 0.8 });
            if (i > 0) pdf.addPage([1920, 1080], 'landscape');
            pdf.addImage(imgData, 'JPEG', 0, 0, 1920, 1080);
        }

        pdf.save('Live_Session_Slides.pdf');
        exportCanvas.dispose();

    } catch (err) {
        console.error("PDF Generation Failed:", err);
        alert("Failed to generate PDF. Check console for details.");
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
});


// --- RETURN TO HOME HUB & CLEAN UP LIVE STREAMS ---
function exitPlayerToHomeHub() {
    // 1. Hide virtual cursor immediately
    const cursorEl = document.getElementById('playbackCursor');
    if (cursorEl) cursorEl.style.display = 'none';

    // 2. Wipe old chat history clean so it won't bleed into the next class
    const chatBox = document.getElementById('playerChatMessages');
    if (chatBox) {
        chatBox.innerHTML = '<div class="sys-msg">Welcome to live chat! Be respectful.</div>';
    }

    // 3. EMIT LEAVE-ROOM TO SERVER (Now works because window.liveSocket is defined!)
    if (window.liveSocket && window.ROOM_ID) {
        console.log(`[*] Emitting leave-room signal for: ${window.ROOM_ID}`);
        window.liveSocket.emit('leave-room', window.ROOM_ID);
    }
    window.ROOM_ID = null;

    // 4. Close WebRTC audio/video peer connection
    if (window.peerCall) {
        window.peerCall.close();
    }

    if (window.camVideoFeed) {
        window.camVideoFeed.pause();
        window.camVideoFeed.srcObject = null;
        window.camVideoFeed.src = "";
    }
    
    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }
    
    if (window.canvas) {
        window.canvas.clear();
        window.canvas.setBackgroundImage(null, window.canvas.renderAll.bind(window.canvas));
    }
    
    if (window.playPauseBtn) window.playPauseBtn.textContent = "▶";
    if (dragBox) dragBox.style.display = 'none';

    document.body.classList.remove('chat-collapsed', 'sidebar-open');
    if (dragBox) {
        dragBox.classList.remove('floating-pip');
        dragBox.classList.add('docked');
        const camDockSlot = document.getElementById('camDockSlot');
        if (camDockSlot) camDockSlot.appendChild(dragBox);
        dragBox.style.left = ''; dragBox.style.top = '';
    }
    
    const homeView = document.getElementById('homeViewContainer');
    if (homeView) homeView.classList.remove('hidden');

    // 5. Fetch updated lobby cards immediately
    if (typeof window.fetchActiveClasses === 'function') {
        window.fetchActiveClasses();
    }
}
const exitToolbarBtn = document.getElementById('btnPlayerExitToMenu');
const exitHeaderBtn = document.getElementById('btnBackToHomeMenu');

if (exitToolbarBtn) exitToolbarBtn.addEventListener('click', exitPlayerToHomeHub);
if (exitHeaderBtn) exitHeaderBtn.addEventListener('click', exitPlayerToHomeHub);

if (window.playPauseBtn && window.camVideoFeed) {
    window.playPauseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.camVideoFeed.paused) {
            window.camVideoFeed.play()
                .then(() => {
                    window.playPauseBtn.textContent = "⏸";
                })
                .catch(err => console.error("Playback resume failed:", err));
        } else {
            window.camVideoFeed.pause();
            window.playPauseBtn.textContent = "▶";
        }
    });
window.camVideoFeed.addEventListener('play', () => {
        window.playPauseBtn.textContent = "⏸";
    });

    window.camVideoFeed.addEventListener('pause', () => {
        window.playPauseBtn.textContent = "▶";
    });
}