/**
 * PLAYER2.JS — Real-Time Live Receiver & Lobby Discovery Engine
 */

// --- 1. CONFIGURATION & NETWORK SETUP ---
window.ROOM_ID = null; // Dynamically set when choosing a stream card
const LEARNER_PEER_ID = 'learner-' + Math.floor(Math.random() * 100000);
const SERVER_URL = 'https://api.sutharx.in';

const liveSocket = io(SERVER_URL, {
    extraHeaders: { "ngrok-skip-browser-warning": "true" }
});

const peer = new Peer(LEARNER_PEER_ID, {
    config: {
        iceServers: [
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'turn:a.relay.metered.ca:80', username: '2f2a84ff07ed9b7fb5e9cc21', credential: 'Uvfc7zqabCwxCkt4' },
            { urls: 'turn:a.relay.metered.ca:443', username: '2f2a84ff07ed9b7fb5e9cc21', credential: 'Uvfc7zqabCwxCkt4' },
            { urls: 'turn:a.relay.metered.ca:443?transport=tcp', username: '2f2a84ff07ed9b7fb5e9cc21', credential: 'Uvfc7zqabCwxCkt4' }
        ]
    }
});

let isPeerReady = false;
peer.on('open', (id) => {
    console.log('[+] Learner PeerJS ready with ID:', id);
    isPeerReady = true;
});

peer.on('error', (err) => console.error('[-] Learner PeerJS Error:', err));

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

function attachRemoteStream(remoteStream) {
    console.log('[+] Live educator video/audio stream connected!');
    if (window.camVideoFeed) {
        window.camVideoFeed.srcObject = remoteStream;
        window.camVideoFeed.play().catch(err => console.error("Autoplay blocked:", err));
    }
    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length > 0) {
        setStudentCamPlaceholder(videoTracks[0].enabled && !videoTracks[0].muted);
        videoTracks[0].onmute = () => setStudentCamPlaceholder(false);
        videoTracks[0].onunmute = () => setStudentCamPlaceholder(true);
    }
}

// Answer incoming WebRTC call from educator
peer.on('call', (call) => {
    console.log('[+] Educator is calling learner. Answering...');
    window.peerCall = call;
    call.answer();
    call.on('stream', attachRemoteStream);
});

// --- 2. LOBBY DISCOVERY & STREAM SELECTION ENGINE ---
window.fetchActiveClasses = async function() {
    const grid = document.getElementById('liveClassesGrid');
    if (!grid) return;

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

    // Only render lobby cards if user is sitting on the home view screen
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

// Listen for global lobby updates when classes open/close
liveSocket.on('live-classes-updated', (updatedList) => {
    renderLobbyGrid(updatedList);
});

// Join a dynamically selected room
window.joinSelectedLiveClass = function(roomId, classTitle) {
    window.ROOM_ID = roomId;
    const homeView = document.getElementById('homeViewContainer');
    const webcamBox = document.getElementById('webcamContainerWrapperBox');
    const headerTitle = document.getElementById('classroomStateHeadingTitle');
    
    if (headerTitle) headerTitle.innerText = `🔴 WATCHING: ${classTitle || roomId}`;
    if (homeView) homeView.classList.add('hidden');
    if (webcamBox) webcamBox.style.display = 'flex';
    if (typeof window.syncCanvasDimensionsToWrapper === 'function') {
        window.syncCanvasDimensionsToWrapper();
    }

    console.log(`[*] Connecting to live stream room: ${roomId}...`);
    liveSocket.emit('join-room', roomId, LEARNER_PEER_ID, false);

    // Request WebRTC feed from educator
    const requestStream = () => liveSocket.emit('request-webrtc-stream', roomId, { peerId: LEARNER_PEER_ID });
    if (isPeerReady) requestStream();
    else setTimeout(requestStream, 1000);
};

// If educator ends the class while watching
liveSocket.on('class-ended', (data) => {
    // Check if the class that ended is the one the student is currently watching
    if (data.roomId === window.ROOM_ID) {
       
        if (typeof exitPlayerToHomeHub === 'function') {
            exitPlayerToHomeHub();
        }
    }
    // Optionally: You could also trigger a re-fetch of the lobby list here
    // window.fetchActiveClasses();
});

liveSocket.on('stream-ready', () => {
    if (window.ROOM_ID) liveSocket.emit('request-webrtc-stream', window.ROOM_ID, { peerId: LEARNER_PEER_ID });
});

liveSocket.on('camera-status', (data) => setStudentCamPlaceholder(data.enabled));

// Auto-fetch list on initial page load
window.addEventListener('DOMContentLoaded', () => {
    window.fetchActiveClasses();
});

// --- 3. SLIDE DECK SYNCHRONIZATION ---
liveSocket.on('deck-state-init', (deckPayload) => {
    window.globalSlidesDeck = deckPayload.slides || [];
    window.activeSlideIndex = deckPayload.activeSlideIndex || 0;
    if (deckPayload.isCameraOn !== undefined) setStudentCamPlaceholder(deckPayload.isCameraOn);
    if (typeof window.renderFlatSlideSorterUI === 'function') window.renderFlatSlideSorterUI();
    window.jumpToSlideIndex(window.activeSlideIndex);
});

// --- 4. SLIDE NAVIGATION ENGINE ---
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

// --- 5. LIVE WHITEBOARD ACTION RECEIVER ---
liveSocket.on('board-action', (ev) => {
    if (!window.canvas) return;

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

        if (['pen', 'highlight', 'pointer'].includes(ev.tool)) {
            playbackActivePoints = [{ x: ev.x, y: ev.y }];
            const sColor = ev.tool === 'pointer' ? '#ff0000' : ev.color;
            const sOpacity = ev.tool === 'highlight' ? 0.5 : 1.0;
            const sWidth = ev.tool === 'highlight' ? ev.width * 4 : ev.width;
            
            playbackActivePathProps = { 
                stroke: sColor, strokeWidth: sWidth, fill: 'transparent', opacity: sOpacity, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: false, id: ev.objectId, slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex, visible: window.areAnnotationsVisible
            };
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
            window.canvas.add(playbackActiveObject);
        }
        else if (ev.tool === 'text') {
            playbackActiveObject = new fabric.Textbox('', { left: ev.x, top: ev.y, width: 400, fill: ev.color, fontFamily: 'Segoe UI', id: ev.objectId, fontSize: ev.fontSize || 42, selectable: false, slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex, visible: window.areAnnotationsVisible });
            window.canvas.add(playbackActiveObject);
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
            if (playbackActiveObject) window.canvas.add(playbackActiveObject);
        }
    } 
    else if (ev.type === 'draw-move') {
        if (typeof window.updateCursorVisualState === 'function') window.updateCursorVisualState(ev.x, ev.y, playbackDrawTool, playbackDrawColor);
        if (playbackActivePoints && playbackActiveObject && ['pen', 'highlight', 'pointer'].includes(playbackDrawTool)) {
            playbackActivePoints.push({ x: ev.x, y: ev.y });
            window.canvas.remove(playbackActiveObject);
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
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
        if (playbackActiveObject && playbackDrawTool === 'pointer') {
            const ptrLine = playbackActiveObject;
            ptrLine.animate('opacity', 0, { duration: 1000, onChange: window.canvas.renderAll.bind(window.canvas), onComplete: () => { window.canvas.remove(ptrLine); } });
        }
        playbackActivePoints = []; playbackActiveObject = null;
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
        targets.forEach(t => window.canvas.remove(t)); window.canvas.renderAll();
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

// =====================================================================
// 7. COLLAPSIBLE RIGHT RAIL & REAL-TIME CHAT CONTROLLER
// =====================================================================
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
        // 1. Change bottom button arrow direction pointing left (🡰)
        if (btnToggleRightSidebar) btnToggleRightSidebar.innerText = '🡰';
        if (btnRailChatToggle) btnRailChatToggle.classList.remove('active');

        // 2. Move webcam out of docked slot into floating PIP over canvas
        if (camBox && canvasContainer) {
            camBox.classList.remove('docked');
            camBox.classList.add('floating-pip');
            canvasContainer.appendChild(camBox);
        }
    } else {
        // 1. Change bottom button arrow pointing right (➔)
        if (btnToggleRightSidebar) btnToggleRightSidebar.innerText = '➔';
        if (btnRailChatToggle) btnRailChatToggle.classList.add('active');

        // 2. Return webcam into the docked right column slot
        if (camBox && camDockSlot) {
            camBox.classList.remove('floating-pip');
            camBox.classList.add('docked');
            camDockSlot.appendChild(camBox);
            camBox.style.left = ''; camBox.style.top = ''; // Reset drag offsets
        }
    }

    // 3. Auto-expand canvas dimensions smoothly after CSS transition completes
    setTimeout(() => {
        if (typeof window.syncCanvasDimensionsToWrapper === 'function') {
            window.syncCanvasDimensionsToWrapper();
        }
    }, 260);
}

// Attach listeners to both the bottom arrow button and top chat bubble icon
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
    if (payload.sender === studentDisplayName) return;
    appendPlayerChatMessage(payload.sender || 'Learner', payload.text, payload.isEducator || false);
});
// --- 6. PATH & CURVE SMOOTHING UTILITY ---
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

// Add this to your Socket.IO setup in player2.js
liveSocket.on('connect', () => {
    console.log('[+] Socket reconnected. Checking room status...');
    if (window.ROOM_ID) {
        // Re-join the room to ensure we are listening to the right broadcast
        liveSocket.emit('join-room', window.ROOM_ID, LEARNER_PEER_ID, false);
    }
});

// Add this to your Socket.IO setup in player2.js
liveSocket.on('connect', () => {
    console.log('[+] Socket reconnected. Checking room status...');
    if (window.ROOM_ID) {
        // Re-join the room to ensure we are listening to the right broadcast
        liveSocket.emit('join-room', window.ROOM_ID, LEARNER_PEER_ID, false);
    }
});