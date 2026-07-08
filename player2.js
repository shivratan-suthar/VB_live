/**
 * PLAYER2.JS — Real-Time Live Receiver & Lobby Discovery Engine
 * WebSocket Streaming Architecture & Immersive Mobile UI
 */

// --- 1. CONFIGURATION & NETWORK SETUP ---
window.ROOM_ID = null; 
const LEARNER_PEER_ID = 'learner-' + Math.floor(Math.random() * 100000);
const SERVER_URL = 'https://api.sutharx.in';

let lobbyPollingInterval = null;
let hostEvictionTimeout = null;

// WebSocket Media Variables
let playerAudioCtx = null;
let masterGainNode = null;
let nextAudioPlayTime = 0;
let webcamImgFeed = null;
window.isPlaybackPaused = false;
window.currentVolume = 1.0;

// Attach directly to window.liveSocket
window.liveSocket = io(SERVER_URL, {
    extraHeaders: { "ngrok-skip-browser-warning": "true" }
});
window.mediaSocket = io('https://media.sutharx.in', {
    extraHeaders: { "ngrok-skip-browser-warning": "true" }
});

const liveSocket = window.liveSocket;

// Drawing state variables
let playbackActivePoints = [];
let playbackActiveObject = null;
let playbackActivePathProps = null;
let playbackDrawTool = 'pen';
let playbackDrawColor = '#ffffff';
let shapeStartX = 0, shapeStartY = 0;

function setStudentCamPlaceholder(isCamOn) {
    const placeholder = document.getElementById('studentCamPlaceholder');
    if (placeholder) placeholder.style.display = isCamOn ? 'none' : 'flex';
}

function initReceiverMedia() {
    // Initialize Audio Engine with Master Volume Node
    if (!playerAudioCtx) {
        playerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGainNode = playerAudioCtx.createGain();
        masterGainNode.gain.value = window.currentVolume;
        masterGainNode.connect(playerAudioCtx.destination);
    }
    
    // Replace the HTML5 video element with an img element for WebSocket JPEG frames
    const camBox = document.getElementById('webcamContainerWrapperBox');
    const oldVideo = document.getElementById('webcamVideoFeed');
    if (oldVideo) {
        oldVideo.pause();
        oldVideo.remove();
    }
    
    if (!webcamImgFeed && camBox) {
        webcamImgFeed = document.createElement('img');
        webcamImgFeed.id = 'webcamImgFeed';
        webcamImgFeed.style.width = '100%';
        webcamImgFeed.style.height = '100%';
        webcamImgFeed.style.objectFit = 'cover';
        camBox.appendChild(webcamImgFeed);
    }
}

// Global Playback Controls for UI to hook into
window.toggleLivePlayback = function() {
    window.isPlaybackPaused = !window.isPlaybackPaused;
    const btn = document.getElementById('btnModernPlayPause');
    if (btn) btn.textContent = window.isPlaybackPaused ? "▶" : "⏸";
    
    if (playerAudioCtx) {
        if (window.isPlaybackPaused) {
            playerAudioCtx.suspend();
        } else {
            playerAudioCtx.resume();
            nextAudioPlayTime = playerAudioCtx.currentTime; // Reset buffer to prevent burst
        }
    }
};

window.setLiveVolume = function(vol) {
    window.currentVolume = vol;
    if (masterGainNode) {
        masterGainNode.gain.value = vol;
    }
};


// --- 2. NETWORK LIFECYCLE & RECONNECTION MANAGEMENT ---
liveSocket.on('disconnect', (reason) => {
    console.warn('[-] Socket disconnected from server:', reason);
    const overlay = document.getElementById('reconnectingOverlay');
    if (overlay && window.ROOM_ID) {
        overlay.innerText = "⚠️ Network connection lost. Reconnecting to live class...";
        overlay.style.background = "#e02020";
        overlay.classList.remove('hidden');
    }
});

liveSocket.on('connect', () => {
    console.log('[+] Socket connected/reconnected. Verifying room state...');
    const overlay = document.getElementById('reconnectingOverlay');
    if (overlay) overlay.classList.add('hidden');
    
    if (hostEvictionTimeout) {
        clearTimeout(hostEvictionTimeout);
        hostEvictionTimeout = null;
    }

    if (window.ROOM_ID) {
        console.log(`[*] Automatically rejoining room: ${window.ROOM_ID}...`);
        liveSocket.emit('join-room', window.ROOM_ID, LEARNER_PEER_ID, false);
        
        console.log('[*] Requesting authoritative canvas snapshot...');
        liveSocket.emit('request-canvas-resync', window.ROOM_ID);
    } else {
        if (typeof window.fetchActiveClasses === 'function') {
            window.fetchActiveClasses();
        }
    }
});

// Ensure media socket reconnects to the room
window.mediaSocket.on('connect', () => {
    if (window.ROOM_ID) {
        console.log(`[*] Media socket connected. Joining room: ${window.ROOM_ID}...`);
        window.mediaSocket.emit('join-room', window.ROOM_ID);
    }
});


// --- 3. LOBBY DISCOVERY & STREAM SELECTION ENGINE ---
window.fetchActiveClasses = async function() {
    const grid = document.getElementById('liveClassesGrid');
    if (!grid) return;

    if (window.ROOM_ID) return;

    try {
        const response = await fetch(`${SERVER_URL}/api/live-classes`, {
            headers: { "ngrok-skip-browser-warning": "true" }
        });
        const data = await response.json();
        renderLobbyGrid(data.classes || []);
    } catch (err) {
        console.error("[-] Failed to fetch live directory:", err);
        grid.innerHTML = `
            <div class="lobby-empty-state">
                <h3>⚠️ Connection Error</h3>
                <p>Could not connect to classroom server (${SERVER_URL}).</p>
            </div>`;
    }
};

function renderLobbyGrid(classesList) {
    const grid = document.getElementById('liveClassesGrid');
    if (!grid) return;

    const homeView = document.getElementById('homeViewContainer');
    if (homeView && homeView.classList.contains('hidden')) return;

    if (!classesList || classesList.length === 0) {
        grid.innerHTML = `
            <div class="lobby-empty-state">
                <h3>No Live Classes Right Now</h3>
                <p>Waiting for an educator to start a broadcasting session...</p>
            </div>`;
        return;
    }

    grid.innerHTML = '';
    classesList.forEach(cls => {
        const card = document.createElement('div');
        card.className = 'live-class-card';
        card.innerHTML = `
            <div>
                <div class="card-header-badge">
                    <span class="live-pill">🔴 LIVE</span>
                    <span class="learner-count">👥 ${cls.learners || 0} watching</span>
                </div>
                <div class="stream-card-title">${cls.title || 'Untitled Class'}</div>
            </div>
            <div class="stream-card-id">ID: ${cls.roomId}</div>
        `;
        card.onclick = () => window.joinSelectedLiveClass(cls.roomId, cls.title);
        grid.appendChild(card);
    });
}

liveSocket.on('live-classes-updated', (updatedList) => {
    renderLobbyGrid(updatedList);
});

window.joinSelectedLiveClass = async function(roomId, classTitle) {
    window.ROOM_ID = roomId;
    
    // --- Force Fullscreen & Landscape on Mobile ---
    if (window.innerWidth <= 768) {
        try {
            const docEl = document.documentElement;
            if (docEl.requestFullscreen) {
                await docEl.requestFullscreen();
            } else if (docEl.webkitRequestFullscreen) {
                await docEl.webkitRequestFullscreen();
            }
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock('landscape');
            }
        } catch (err) {
            console.warn("[-] Auto-rotation/Fullscreen denied by browser:", err);
        }
    }

    if (lobbyPollingInterval) {
        clearInterval(lobbyPollingInterval);
        lobbyPollingInterval = null;
    }

    // Initialize the Audio Context, Gain Node, and JPEG feed
    initReceiverMedia();

    const homeView = document.getElementById('homeViewContainer');
    const webcamBox = document.getElementById('webcamContainerWrapperBox');
    const headerTitle = document.getElementById('classroomStateHeadingTitle');
    
    if (headerTitle) headerTitle.innerText = `🔴 WATCHING: ${classTitle || roomId}`;
    if (homeView) homeView.classList.add('hidden');
    if (webcamBox) webcamBox.style.display = 'flex';
    
    const chatBox = document.getElementById('playerChatMessages');
    if (chatBox) {
        chatBox.innerHTML = '<div class="sys-msg">Welcome to live chat! Be respectful.</div>';
    }

    // Sync Play/Pause button
    window.isPlaybackPaused = false;
    const playBtn = document.getElementById('btnModernPlayPause');
    if (playBtn) playBtn.textContent = "⏸";

    if (typeof window.syncCanvasDimensionsToWrapper === 'function') {
        setTimeout(window.syncCanvasDimensionsToWrapper, 300);
    }

    console.log(`[*] Connecting to live stream room: ${roomId}...`);
    liveSocket.emit('join-room', roomId, LEARNER_PEER_ID, false);
    
    // Join the room on the media socket as well
    window.mediaSocket.emit('join-room', roomId);
};

liveSocket.on('class-ended', (data) => {
    if (data.roomId === window.ROOM_ID) {
        const overlay = document.getElementById('reconnectingOverlay');

        if (data.intentional) {
            console.log('[*] Live class was intentionally ended by the educator.');
            if (hostEvictionTimeout) clearTimeout(hostEvictionTimeout);
            
            if (overlay) {
                overlay.innerText = "🛑 The educator has ended the live session.";
                overlay.style.background = "#333333";
                overlay.classList.remove('hidden');
            }

            setTimeout(() => {
                if (overlay) {
                    overlay.classList.add('hidden');
                    overlay.style.background = "#e02020";
                }
                if (typeof exitPlayerToHomeHub === 'function') {
                    exitPlayerToHomeHub();
                }
            }, 2500);
            return;
        }

        console.warn('[-] Received class-ended signal. Initiating 8-second recovery buffer...');
        if (overlay) {
            overlay.innerText = "⚠️ Host connection interrupted. Waiting for educator to resume...";
            overlay.style.background = "#e02020";
            overlay.classList.remove('hidden');
        }

        if (hostEvictionTimeout) clearTimeout(hostEvictionTimeout);
        hostEvictionTimeout = setTimeout(() => {
            if (window.ROOM_ID === data.roomId) {
                if (overlay) overlay.classList.add('hidden');
                if (typeof exitPlayerToHomeHub === 'function') {
                    exitPlayerToHomeHub();
                }
            }
        }, 8000);
    }
});


// --- 4. WEBSOCKET MEDIA RECEIVERS (Anti-Pileup Engine) ---
window.mediaSocket.on('ws-video-frame', (data) => {
    if (window.isPlaybackPaused) return; // FREEZE VIDEO IF PAUSED
    
    if (webcamImgFeed) {
        webcamImgFeed.src = data.frame;
    }
    
    setStudentCamPlaceholder(true);
});

window.mediaSocket.on('ws-audio-chunk', (data) => {
    if (window.isPlaybackPaused || !playerAudioCtx) return; // DROP AUDIO IF PAUSED
    
    const floatData = new Float32Array(data.audio);
    const audioBuffer = playerAudioCtx.createBuffer(1, floatData.length, data.sampleRate);
    audioBuffer.getChannelData(0).set(floatData);
    
    const source = playerAudioCtx.createBufferSource();
    source.buffer = audioBuffer;
    
    // CONNECT TO GAIN NODE INSTEAD OF DESTINATION
    source.connect(masterGainNode);
    
    const currentTime = playerAudioCtx.currentTime;
    
    // ANTI-PILEUP: Only use the AudioContext's local internal clock for timing.
    // If the buffer is stacked more than 300ms ahead of current playback, 
    // drop this chunk entirely to force playback to snap back to live.
    if (nextAudioPlayTime > currentTime + 0.3) {
        return; 
    }
    
    // If the buffer starved and we are behind, reset the clock to current time
    if (nextAudioPlayTime < currentTime) {
        nextAudioPlayTime = currentTime;
    }
    
    source.start(nextAudioPlayTime);
    nextAudioPlayTime += audioBuffer.duration;
});

liveSocket.on('camera-status', (data) => setStudentCamPlaceholder(data.enabled));


// --- 5. IMMEDIATE DOM EXECUTION & LOBBY POLLING ---
function initLobbyDiscoveryEngine() {
    window.fetchActiveClasses();
    
    if (lobbyPollingInterval) clearInterval(lobbyPollingInterval);
    lobbyPollingInterval = setInterval(() => {
        if (!window.ROOM_ID) {
            window.fetchActiveClasses();
        }
    }, 5000);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initLobbyDiscoveryEngine);
} else {
    initLobbyDiscoveryEngine();
}


// --- 6. SLIDE DECK SYNCHRONIZATION ---
liveSocket.on('deck-state-init', (deckPayload) => {
    if (!window.ROOM_ID) return;

    if (hostEvictionTimeout) {
        clearTimeout(hostEvictionTimeout);
        hostEvictionTimeout = null;
        const overlay = document.getElementById('reconnectingOverlay');
        if (overlay) overlay.classList.add('hidden');
    }

    window.globalSlidesDeck = deckPayload.slides || [];
    window.activeSlideIndex = deckPayload.activeSlideIndex || 0;
    if (deckPayload.isCameraOn !== undefined) setStudentCamPlaceholder(deckPayload.isCameraOn);
    if (typeof window.renderFlatSlideSorterUI === 'function') window.renderFlatSlideSorterUI();
    window.jumpToSlideIndex(window.activeSlideIndex);
});


// --- 7. SLIDE NAVIGATION ENGINE ---
window.jumpToSlideIndex = function(index) {
    window.activeSlideIndex = index;
    if (typeof window.renderFlatSlideSorterUI === 'function') window.renderFlatSlideSorterUI();
    const slide = window.globalSlidesDeck[index];
    if (!slide || !window.canvas) return;

    if (typeof window.applySlideBackground === 'function') window.applySlideBackground(slide);
    if (slide.annotation) {
        window.canvas.loadFromJSON(slide.annotation, () => {
            window.canvas.forEachObject(obj => {
                obj.selectable = false;
                obj.visible = (obj.slideIndex === window.activeSlideIndex && window.areAnnotationsVisible);
            });
            window.canvas.renderAll();
        });
    } else {
        window.canvas.clear();
        if (typeof window.applySlideBackground === 'function') window.applySlideBackground(slide);
        window.canvas.renderAll();
    }
};


// --- 8. LIVE WHITEBOARD ACTION RECEIVER ---
liveSocket.on('board-action', (ev) => {
    if (window.isPlaybackPaused) return; // FREEZE BOARD IF PAUSED
    if (!window.ROOM_ID || !window.canvas) return;

    if (ev.type === 'slide-switch') window.jumpToSlideIndex(ev.index);
    else if (ev.type === 'tool-switch') {
        playbackDrawTool = ev.tool;
        if (typeof window.updateCursorVisualState === 'function') window.updateCursorVisualState(0, 0, ev.tool, playbackDrawColor);
    } 
    else if (ev.type === 'cursor') {
        if (typeof window.updateCursorVisualState === 'function') window.updateCursorVisualState(ev.x, ev.y, playbackDrawTool, playbackDrawColor);
    }
    else if (ev.type === 'draw-start') {
        playbackDrawColor = ev.color; playbackDrawTool = ev.tool;
        if (typeof window.updateCursorVisualState === 'function') window.updateCursorVisualState(ev.x, ev.y, ev.tool, ev.color);

        if (['pen', 'highlight', 'pointer', 'laser'].includes(ev.tool)) {
            playbackActivePoints = [{ x: ev.x, y: ev.y }];
            
            // Support both pointer and laser names
            const sColor = (ev.tool === 'pointer' || ev.tool === 'laser') ? '#ff0000' : ev.color;
            const sOpacity = ev.tool === 'highlight' ? 0.5 : 1.0;
            const sWidth = ev.tool === 'highlight' ? ev.width * 4 : ev.width;
            
            playbackActivePathProps = { 
                stroke: sColor, strokeWidth: sWidth, fill: 'transparent', opacity: sOpacity, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: false, id: ev.objectId, slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex, visible: window.areAnnotationsVisible
            };
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
            
            // Tag the object so we know to delay its removal later
            playbackActiveObject.isPointerStroke = (ev.tool === 'pointer' || ev.tool === 'laser');
            
            window.canvas.add(playbackActiveObject);
        }
        else if (ev.tool === 'text') {
            playbackActiveObject = new fabric.Textbox('', { left: ev.x, top: ev.y, width: 400, fill: ev.color, fontFamily: 'Segoe UI', id: ev.objectId, fontSize: ev.fontSize || 42, selectable: false, slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex, visible: window.areAnnotationsVisible });
            window.canvas.add(playbackActiveObject);
            window.canvas.renderAll();
        }
        else if (ev.tool === 'shape') {
            shapeStartX = ev.x; shapeStartY = ev.y;
            const props = { id: ev.objectId, left: ev.x, top: ev.y, fill: 'transparent', stroke: ev.color, strokeWidth: ev.width, selectable: false, strokeUniform: true, slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex, visible: window.areAnnotationsVisible };
            
            if (ev.shapeType === 'rect') playbackActiveObject = new fabric.Rect({ ...props, width: 1, height: 1 });
            if (ev.shapeType === 'circle') playbackActiveObject = new fabric.Circle({ ...props, radius: 1, originX: 'center', originY: 'center' });
            if (ev.shapeType === 'ellipse') playbackActiveObject = new fabric.Ellipse({ ...props, rx: 1, ry: 1, originX: 'center', originY: 'center' });
            if (ev.shapeType === 'triangle') playbackActiveObject = new fabric.Triangle({ ...props, width: 1, height: 1 });
            if (ev.shapeType === 'line') playbackActiveObject = new fabric.Line([ev.x, ev.y, ev.x + 1, ev.y + 1], props);
            if (ev.shapeType === 'cube') playbackActiveObject = new fabric.Path("M 50 0 L 100 25 L 100 75 L 50 100 L 0 75 L 0 25 Z M 50 0 L 50 50 L 100 25 M 0 25 L 50 50 L 50 100", { ...props, scaleX: 0, scaleY: 0, originX: 'left', originY: 'top' });
            
            if (playbackActiveObject) {
                window.canvas.add(playbackActiveObject);
                window.canvas.renderAll();
            }
        }
    } 
    else if (ev.type === 'draw-move') {
        if (typeof window.updateCursorVisualState === 'function') window.updateCursorVisualState(ev.x, ev.y, playbackDrawTool, playbackDrawColor);
        if (playbackActivePoints && playbackActiveObject && ['pen', 'highlight', 'pointer', 'laser'].includes(playbackDrawTool)) {
            playbackActivePoints.push({ x: ev.x, y: ev.y });
            window.canvas.remove(playbackActiveObject);
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
            
            // Re-apply the tag to the updated path
            playbackActiveObject.isPointerStroke = (playbackDrawTool === 'pointer' || playbackDrawTool === 'laser');
            
            window.canvas.add(playbackActiveObject);
            window.canvas.renderAll();
        }
        else if (playbackActiveObject && playbackDrawTool === 'shape') {
            if (playbackActiveObject.type === 'rect' || playbackActiveObject.type === 'triangle') playbackActiveObject.set({ width: Math.max(1, Math.abs(shapeStartX - ev.x)), height: Math.max(1, Math.abs(shapeStartY - ev.y)), left: Math.min(ev.x, shapeStartX), top: Math.min(ev.y, shapeStartY) });
            else if (playbackActiveObject.type === 'circle') playbackActiveObject.set({ radius: Math.max(1, Math.sqrt(Math.pow(shapeStartX - ev.x, 2) + Math.pow(shapeStartY - ev.y, 2))) });
            else if (playbackActiveObject.type === 'ellipse') playbackActiveObject.set({ rx: Math.max(1, Math.abs(shapeStartX - ev.x)), ry: Math.max(1, Math.abs(shapeStartY - ev.y)) });
            else if (playbackActiveObject.type === 'line') playbackActiveObject.set({ x2: ev.x, y2: ev.y });
            else if (playbackActiveObject.type === 'path') playbackActiveObject.set({ scaleX: Math.max(0.1, Math.abs(ev.x - shapeStartX) / 100), scaleY: Math.max(0.1, Math.abs(ev.y - shapeStartY) / 100) });
            playbackActiveObject.setCoords();
            window.canvas.renderAll();
        }
    } 
    else if (ev.type === 'draw-end') {
        if (playbackActiveObject) {
            playbackActiveObject.setCoords();
            window.canvas.renderAll(); 
            
            // This tag is set in the 'draw-start' block
            if (playbackActiveObject.isPointerStroke) {
                const targetToRemove = playbackActiveObject;
                setTimeout(() => {
                    if (window.canvas && window.canvas.getObjects().includes(targetToRemove)) {
                        window.canvas.remove(targetToRemove);
                        window.canvas.renderAll();
                    }
                }, 1000); // 1 second delay
            }
        }
        playbackActivePoints = []; 
        playbackActiveObject = null;
    }
    else if (ev.type === 'object-transform') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) { target.set({ left: ev.left, top: ev.top, scaleX: ev.scaleX, scaleY: ev.scaleY, angle: ev.angle }); target.setCoords(); window.canvas.renderAll(); }
    }
    else if (ev.type === 'object-modified') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) {
            if (ev.fontSize) target.set({ fontSize: ev.fontSize });
            if (ev.fill) target.set({ fill: ev.fill });
            if (ev.stroke) target.set({ stroke: ev.stroke });
            target.dirty = true; window.canvas.renderAll();
        }
    }
    else if (ev.type === 'text-edit') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) { target.set({ text: ev.text }); if (!ev.text || ev.text.trim() === '') window.canvas.remove(target); window.canvas.renderAll(); }
    }
    else if (ev.type === 'erase-object') {
        const targets = window.canvas.getObjects().filter(o => o.id === ev.targetId || o.groupId === ev.targetId);
        targets.forEach(t => {
            // Enforce the 1-second delay even if the host sends an instant erase command
            if (t.isPointerStroke) {
                setTimeout(() => {
                    if (window.canvas) {
                        window.canvas.remove(t);
                        window.canvas.renderAll();
                    }
                }, 1000);
            } else {
                window.canvas.remove(t);
            }
        }); 
        window.canvas.renderAll();
    }
    else if (ev.type === 'canvas-undo' || ev.type === 'canvas-redo') {
        const targetIdx = window.activeSlideIndex;
        const toRemove = window.canvas.getObjects().filter(o => o.slideIndex === targetIdx);
        toRemove.forEach(t => window.canvas.remove(t));
        try {
            const pState = JSON.parse(ev.state);
            fabric.util.enlivenObjects(pState.objects, (objs) => {
                objs.forEach(obj => {
                    obj.selectable = false;
                    if (obj.slideIndex === undefined) obj.slideIndex = targetIdx;
                    obj.visible = (obj.slideIndex === window.activeSlideIndex && window.areAnnotationsVisible);
                    window.canvas.add(obj);
                });
                window.canvas.renderAll();
            });
        } catch (err) { console.error("Failed to parse undo/redo state:", err); }
    }
    else if (ev.type === 'insert-image' && ev.src) {
        fabric.Image.fromURL(ev.src, (img) => {
            const maxW = 1920 * 0.7; const maxH = 1080 * 0.7; let initialScale = 1;
            if (img.width > maxW || img.height > maxH) initialScale = Math.min(maxW / img.width, maxH / img.height);
            img.set({ id: ev.targetId, slideIndex: window.activeSlideIndex, left: 960, top: 540, originX: 'center', originY: 'center', scaleX: initialScale, scaleY: initialScale, selectable: false, visible: window.areAnnotationsVisible });
            img.setCoords(); window.canvas.add(img); window.canvas.renderAll();
        }, { crossOrigin: 'anonymous' });
    }
});


// --- 9. COLLAPSIBLE RIGHT RAIL & REAL-TIME CHAT CONTROLLER ---
const btnToggleRightSidebar = document.getElementById('btnToggleRightSidebar');
const btnRailChatToggle = document.getElementById('btnRailChatToggle');
const camBox = document.getElementById('webcamContainerWrapperBox');
const camDockSlot = document.getElementById('camDockSlot');
const canvasContainer = document.getElementById('canvasContainer');

let isSidebarCollapsed = false;

function toggleRightSidebarState() {
    isSidebarCollapsed = !isSidebarCollapsed;
    document.body.classList.toggle('chat-collapsed', isSidebarCollapsed);

    if (isSidebarCollapsed) {
        if (btnToggleRightSidebar) btnToggleRightSidebar.innerText = '🡰';
        if (btnRailChatToggle) btnRailChatToggle.classList.remove('active');

        if (camBox && canvasContainer) {
            camBox.classList.remove('docked');
            camBox.classList.add('floating-pip');
            canvasContainer.appendChild(camBox);
        }
    } else {
        if (btnToggleRightSidebar) btnToggleRightSidebar.innerText = '➔';
        if (btnRailChatToggle) btnRailChatToggle.classList.add('active');

        if (camBox && camDockSlot) {
            camBox.classList.remove('floating-pip');
            camBox.classList.add('docked');
            camDockSlot.appendChild(camBox);
            camBox.style.left = ''; camBox.style.top = ''; 
        }
    }

    setTimeout(() => {
        if (typeof window.syncCanvasDimensionsToWrapper === 'function') {
            window.syncCanvasDimensionsToWrapper();
        }
    }, 260);
}

btnToggleRightSidebar?.addEventListener('click', toggleRightSidebarState);
btnRailChatToggle?.addEventListener('click', toggleRightSidebarState);

// --- Student Chat Sending & Receiving ---
const playerChatInput = document.getElementById('playerChatInput');
const btnSendPlayerChat = document.getElementById('btnSendPlayerChat');
const playerChatMessagesBox = document.getElementById('playerChatMessages');
const studentDisplayName = 'Learner-' + Math.floor(1000 + Math.random() * 9000);

function appendPlayerChatMessage(sender, text, isEducator = false) {
    if (!playerChatMessagesBox) return;
    const sysMsg = playerChatMessagesBox.querySelector('.sys-msg');
    if (sysMsg && playerChatMessagesBox.children.length === 1) sysMsg.remove();

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isEducator ? 'educator-msg' : ''}`;
    msgEl.innerHTML = `
        <span class="sender">${sender} ${isEducator ? '👑' : ''}</span>
        <span class="text">${text}</span>
    `;
    playerChatMessagesBox.appendChild(msgEl);
    playerChatMessagesBox.scrollTop = playerChatMessagesBox.scrollHeight;
}

function sendStudentChatMessage() {
    const text = playerChatInput?.value.trim();
    if (!text) return;
    if (!window.ROOM_ID) {
        alert("You must join a live class room before chatting.");
        return;
    }

    appendPlayerChatMessage(studentDisplayName + ' (You)', text, false);
    if (playerChatInput) playerChatInput.value = '';

    if (liveSocket) {
        liveSocket.emit('chat-message', window.ROOM_ID, {
            sender: studentDisplayName,
            text: text,
            isEducator: false
        });
    }
}

btnSendPlayerChat?.addEventListener('click', sendStudentChatMessage);
playerChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendStudentChatMessage(); }
});

liveSocket.on('chat-message', (payload) => {
    if (!window.ROOM_ID) return;
    if (payload.sender === studentDisplayName) return;
    appendPlayerChatMessage(payload.sender || 'Learner', payload.text, payload.isEducator || false);
});


// --- 10. PATH & CURVE SMOOTHING UTILITY ---
window.getSmoothPathFromPoints = function(points) {
    if (!points || points.length === 0) return 'M 0 0';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    let pathStr = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        let xc = (points[i].x + points[i + 1].x) / 2; let yc = (points[i].y + points[i + 1].y) / 2;
        pathStr += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
    }
    pathStr += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return pathStr;
};


// =====================================================================
// 11. BI-DIRECTIONAL LEARNER A/V SHARING (Approval Flow)
// =====================================================================
const avCallContainer = document.getElementById('avCallContainer');
const chatMessages = document.getElementById('playerChatMessages');
const chatInputArea = document.getElementById('playerChatInputArea');
const btnRequestCall = document.getElementById('btnRequestCall');
const callStatusText = document.getElementById('callStatusText');
const learnerSelfVideoWrapper = document.getElementById('learnerSelfVideoWrapper');

let learnerLocalStream = null;
let learnerVideoTimer = null;
let learnerAudioCtx = null;
let learnerScriptProcessor = null;
let isLearnerAVActive = false;

const learnerOffscreenCanvas = document.createElement('canvas');
learnerOffscreenCanvas.width = 120;
learnerOffscreenCanvas.height = 65;
const learnerOffCtx = learnerOffscreenCanvas.getContext('2d', { alpha: false });

// 1. Toggle the Call Menu vs Chat Menu
document.getElementById('btnLearnerShareAV')?.addEventListener('click', () => {
    const isCallView = !avCallContainer.classList.contains('hidden');
    if (isCallView) {
        avCallContainer.classList.add('hidden');
        chatMessages.style.display = 'flex';
        chatInputArea.style.display = 'flex';
        document.getElementById('btnLearnerShareAV').style.color = isLearnerAVActive ? '#5cf272' : '#666';
    } else {
        avCallContainer.classList.remove('hidden');
        chatMessages.style.display = 'none';
        chatInputArea.style.display = 'none';
        document.getElementById('btnLearnerShareAV').style.color = 'var(--brand-accent)';
    }
});

// 2. Send Request to Educator
function bindRequestButton() {
    btnRequestCall.onclick = () => {
        if (!window.ROOM_ID) {
            alert("Please wait until you are connected to a live room to share your camera.");
            return;
        }
        callStatusText.innerText = "⏳ Request sent. Waiting for educator...";
        callStatusText.style.color = "#ffde37";
        btnRequestCall.disabled = true;
        
        window.mediaSocket.emit('request-av-join', window.ROOM_ID, {
            peerId: LEARNER_PEER_ID,
            name: studentDisplayName
        });
    };
}
bindRequestButton();

// 3. Handle Educator's Response
window.mediaSocket.on('av-join-response', async (payload) => {
    if (payload.peerId === LEARNER_PEER_ID) {
        if (payload.accepted) {
            callStatusText.innerText = "✅ Accepted! Connecting camera...";
            callStatusText.style.color = "#5cf272";
            
            try {
                learnerLocalStream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 120 }, height: { ideal: 65 }, frameRate: { ideal: 15 } },
                    audio: { echoCancellation: true, noiseSuppression: true }
                });
                
                isLearnerAVActive = true;
                document.getElementById('btnLearnerShareAV').classList.add('active');
                
                // Show Local Preview
                learnerSelfVideoWrapper.classList.remove('hidden');
                learnerSelfVideoWrapper.innerHTML = '';
                const localVid = document.createElement('video');
                localVid.autoplay = true; localVid.muted = true; localVid.playsInline = true;
                localVid.style.cssText = "width:100%; height:100%; object-fit:cover;";
                localVid.srcObject = learnerLocalStream;
                learnerSelfVideoWrapper.appendChild(localVid);

                // Explicitly tell the browser to play the video (bypasses some mobile autoplay restrictions)
                localVid.play().catch(e => console.warn("Autoplay prevented:", e));

                // Pass the actively rendering DOM video element directly into the streaming loop
                startLearnerStreaming(learnerLocalStream, localVid);
                
                // Switch Button to "End Call"
                btnRequestCall.innerText = "🛑 End Call";
                btnRequestCall.style.background = "#e02020";
                btnRequestCall.disabled = false;
                
                btnRequestCall.onclick = () => {
                    stopLearnerStreaming();
                    learnerSelfVideoWrapper.classList.add('hidden');
                    btnRequestCall.innerText = "➕ Request Call";
                    btnRequestCall.style.background = "var(--brand-accent)";
                    callStatusText.innerText = "";
                    bindRequestButton(); // Reset to request mode
                };
            } catch(err) {
                console.error("[-] Hardware permission denied:", err);
                callStatusText.innerText = "❌ Camera/Mic denied by browser.";
                callStatusText.style.color = "#ff4b4b";
                btnRequestCall.disabled = false;
            }
        } else {
            // If the educator sends 'accepted: false' (Decline or Hang Up)
            if (isLearnerAVActive) {
                // Case A: The call was active, and the educator just hung up
                stopLearnerStreaming();
                learnerSelfVideoWrapper.classList.add('hidden');
                btnRequestCall.innerText = "➕ Request Call";
                btnRequestCall.style.background = "var(--brand-accent)";
                btnRequestCall.disabled = false;
                callStatusText.innerText = "🛑 Call ended by educator.";
                callStatusText.style.color = "#ff4b4b";
                bindRequestButton(); // Reset to request mode
            } else {
                // Case B: The educator declined the initial request
                callStatusText.innerText = "❌ Request declined by educator.";
                callStatusText.style.color = "#ff4b4b";
                btnRequestCall.disabled = false;
            }
        }
    }
});

function startLearnerStreaming(stream, videoEl) {
    // 1. Video Broadcast Loop (15 FPS target)
    learnerVideoTimer = setInterval(() => {
        // Ensure the video element is valid and currently playing
        if (!isLearnerAVActive || !window.ROOM_ID || !videoEl) return;
        
        // Draw the frame directly from the actively playing DOM video element
        learnerOffCtx.drawImage(videoEl, 0, 0, 120, 65);
        const frameData = learnerOffscreenCanvas.toDataURL('image/jpeg', 0.5); 
        
        window.mediaSocket.volatile.emit('learner-video-frame', window.ROOM_ID, {
            peerId: LEARNER_PEER_ID,
            name: studentDisplayName,
            frame: frameData,
            timestamp: Date.now() // Timestamp applied for client-side hard drops
        });
    }, 66);

    // 2. Audio Broadcast Loop
    learnerAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioSource = learnerAudioCtx.createMediaStreamSource(stream);
    learnerScriptProcessor = learnerAudioCtx.createScriptProcessor(4096, 1, 1);
    
    audioSource.connect(learnerScriptProcessor);
    learnerScriptProcessor.connect(learnerAudioCtx.destination);
    
    learnerScriptProcessor.onaudioprocess = (e) => {
        if (!isLearnerAVActive || !window.ROOM_ID) return;
        const inputData = e.inputBuffer.getChannelData(0);
        
        window.mediaSocket.volatile.emit('learner-audio-chunk', window.ROOM_ID, {
            peerId: LEARNER_PEER_ID,
            audio: inputData.buffer,
            sampleRate: learnerAudioCtx.sampleRate,
            timestamp: Date.now()
        });
    };
}
function stopLearnerStreaming() {
    isLearnerAVActive = false;
    if (learnerVideoTimer) clearInterval(learnerVideoTimer);
    if (learnerLocalStream) learnerLocalStream.getTracks().forEach(t => t.stop());
    if (learnerAudioCtx && learnerAudioCtx.state !== 'closed') learnerAudioCtx.close();
    if (learnerScriptProcessor) learnerScriptProcessor.disconnect();
    
    document.getElementById('btnLearnerShareAV').classList.remove('active');
    document.getElementById('btnLearnerShareAV').style.color = '#666';

    if (window.ROOM_ID) {
        window.mediaSocket.emit('learner-stopped-av', window.ROOM_ID, LEARNER_PEER_ID);
    }
}

// 4. Receiving OTHER learners' A/V Streams
const activeLearnerNodes = {};
const learnerAudioEngines = {};
let learnerUIPositionIndex = 0;

window.mediaSocket.on('learner-video-frame', (data) => {
    if (window.isPlaybackPaused || data.peerId === LEARNER_PEER_ID) return;
    
    // HARD LATENCY DROP: Skip frame entirely if it took more than 800ms to arrive.
    if (Date.now() - data.timestamp > 800) return;

    let learnerBox = document.getElementById(`learner-cam-${data.peerId}`);
    
    // Create a new PIP box if this learner hasn't been seen before
    if (!learnerBox) {
        learnerBox = document.createElement('div');
        learnerBox.id = `learner-cam-${data.peerId}`;
        
        // Dynamically stack learner boxes on the left side of the screen
        const bottomOffset = 80 + (learnerUIPositionIndex * 75);
        learnerBox.style.cssText = `position:absolute; bottom:${bottomOffset}px; left:20px; width:120px; height:65px; border:2px solid #5cf272; border-radius:6px; overflow:hidden; z-index:9999; box-shadow:0 4px 10px rgba(0,0,0,0.5);`;
        
        const img = document.createElement('img');
        img.style.width = "100%"; img.style.height = "100%"; img.style.objectFit = "cover";
        learnerBox.appendChild(img);
        
        const nameLabel = document.createElement('div');
        nameLabel.innerText = data.name;
        nameLabel.style.cssText = "position:absolute; bottom:2px; left:4px; font-size:9px; font-weight:bold; color:#fff; text-shadow:0 1px 3px #000; background:rgba(0,0,0,0.4); padding:1px 4px; border-radius:3px;";
        learnerBox.appendChild(nameLabel);
        
        document.body.appendChild(learnerBox);
        learnerUIPositionIndex++;
    }
    
    learnerBox.querySelector('img').src = data.frame;
});

window.mediaSocket.on('learner-audio-chunk', (data) => {
    if (window.isPlaybackPaused || !playerAudioCtx || data.peerId === LEARNER_PEER_ID) return;
    
    // HARD LATENCY DROP: Skip audio chunk if lagging to prevent echo pileups
    if (Date.now() - data.timestamp > 1000) return;

    if (!learnerAudioEngines[data.peerId]) {
        learnerAudioEngines[data.peerId] = { nextPlayTime: playerAudioCtx.currentTime };
    }
    let engine = learnerAudioEngines[data.peerId];

    const floatData = new Float32Array(data.audio);
    const audioBuffer = playerAudioCtx.createBuffer(1, floatData.length, data.sampleRate);
    audioBuffer.getChannelData(0).set(floatData);
    
    const source = playerAudioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(masterGainNode); // Route through the player's master volume slider
    
    const currentTime = playerAudioCtx.currentTime;
    
    // Buffer overflow catch
    if (engine.nextPlayTime > currentTime + 0.3) return; 
    if (engine.nextPlayTime < currentTime) engine.nextPlayTime = currentTime;
    
    source.start(engine.nextPlayTime);
    engine.nextPlayTime += audioBuffer.duration;
});

window.mediaSocket.on('learner-stopped-av', (peerId) => {
    const box = document.getElementById(`learner-cam-${peerId}`);
    if (box) {
        box.remove();
        learnerUIPositionIndex = Math.max(0, learnerUIPositionIndex - 1);
    }
    delete learnerAudioEngines[peerId];
});