/**
 * PLAYER2.JS — Real-Time Live Receiver & Whiteboard Engine
 * Handles Socket.IO live vector coordination, PeerJS WebRTC video streams,
 * SVG teacher cursor tracking, slide deck catch-up, and complete canvas feature parity.
 */

// --- 1. CONFIGURATION & NETWORK SETUP ---
window.ROOM_ID = 'classroom-room-101';
const EDUCATOR_PEER_ID = 'educator-' + window.ROOM_ID;
const LEARNER_PEER_ID = 'learner-' + Math.floor(Math.random() * 100000);

// Connect securely to your permanent AWS backend
const liveSocket = io('https://api.sutharx.in');

// Configure PeerJS with reliable STUN/TURN servers for network traversal
const peer = new Peer(LEARNER_PEER_ID, {
    config: {
        iceServers: [
            // 1. STUN servers (Discovers public IP addresses)
            { urls: 'stun:stun.relay.metered.ca:80' },
            { urls: 'stun:stun.l.google.com:19302' },

            // 2. Active TURN servers (Relays video across strict firewalls & mobile networks)
            {
                urls: 'turn:a.relay.metered.ca:80',
                username: '2f2a84ff07ed9b7fb5e9cc21',
                credential: 'Uvfc7zqabCwxCkt4'
            },
            {
                urls: 'turn:a.relay.metered.ca:443',
                username: '2f2a84ff07ed9b7fb5e9cc21',
                credential: 'Uvfc7zqabCwxCkt4'
            },
            {
                urls: 'turn:a.relay.metered.ca:443?transport=tcp',
                username: '2f2a84ff07ed9b7fb5e9cc21',
                credential: 'Uvfc7zqabCwxCkt4'
            }
        ]
    }
});

let isPeerReady = false;
peer.on('open', (id) => {
    console.log('[+] Learner PeerJS ready with ID:', id);
    isPeerReady = true;
});

peer.on('error', (err) => {
    console.error('[-] Learner PeerJS Error:', err);
});

// Drawing state variables for incoming live streams
let playbackActivePoints = [];
let playbackActiveObject = null;
let playbackActivePathProps = null;
let playbackDrawTool = 'pen';
let playbackDrawColor = '#ffffff';
let shapeStartX = 0;
let shapeStartY = 0;

// Helper function to update camera placeholder UI overlay
function setStudentCamPlaceholder(isCamOn) {
    const placeholder = document.getElementById('studentCamPlaceholder');
    if (placeholder) {
        placeholder.style.display = isCamOn ? 'none' : 'flex';
    }
}

// Helper function to attach and play video stream with track muting fallbacks
function attachRemoteStream(remoteStream) {
    console.log('[+] Live educator video/audio stream connected!');
    if (window.camVideoFeed) {
        window.camVideoFeed.srcObject = remoteStream;
        window.camVideoFeed.play().catch(err => console.error("Autoplay blocked by browser:", err));
    }

    // Hardware fallback: listen directly to WebRTC track mute/unmute events
    const videoTracks = remoteStream.getVideoTracks();
    if (videoTracks.length > 0) {
        setStudentCamPlaceholder(videoTracks[0].enabled && !videoTracks[0].muted);
        videoTracks[0].onmute = () => setStudentCamPlaceholder(false);
        videoTracks[0].onunmute = () => setStudentCamPlaceholder(true);
    }
}

// --- 2. WEBRTC STREAM HANDSHAKE ---
// Answer incoming WebRTC call if educator initiates connection
peer.on('call', (call) => {
    console.log('[+] Educator is calling learner. Answering...');
    call.answer(); // Answer without local stream
    call.on('stream', (remoteStream) => {
        attachRemoteStream(remoteStream);
    });
});

// Join Classroom Event
const joinBtn = document.getElementById('btnJoinLiveClassroom');
if (joinBtn) {
    joinBtn.addEventListener('click', () => {
        const homeView = document.getElementById('homeViewContainer');
        const webcamBox = document.getElementById('webcamContainerWrapperBox');
        
        if (homeView) homeView.classList.add('hidden');
        if (webcamBox) webcamBox.style.display = 'flex';
        if (typeof window.syncCanvasDimensionsToWrapper === 'function') {
            window.syncCanvasDimensionsToWrapper();
        }

        console.log('[*] Joining Live Classroom Room:', window.ROOM_ID);
        liveSocket.emit('join-room', window.ROOM_ID, LEARNER_PEER_ID, false);

        // Explicitly request WebRTC stream connection from the educator
        if (isPeerReady) {
            liveSocket.emit('request-webrtc-stream', window.ROOM_ID, { peerId: LEARNER_PEER_ID });
        } else {
            setTimeout(() => {
                liveSocket.emit('request-webrtc-stream', window.ROOM_ID, { peerId: LEARNER_PEER_ID });
            }, 1000);
        }
    });
}

// If Educator enables camera *after* student joined, initiate stream connection
liveSocket.on('stream-ready', (data) => {
    console.log('[*] Educator stream ready. Requesting WebRTC connection...');
    liveSocket.emit('request-webrtc-stream', window.ROOM_ID, { peerId: LEARNER_PEER_ID });
});

// Listen for live educator camera status changes
liveSocket.on('camera-status', (data) => {
    console.log('[*] Educator camera status changed:', data.enabled ? 'ON' : 'OFF');
    setStudentCamPlaceholder(data.enabled);
});

// --- 3. SLIDE DECK SYNCHRONIZATION (LATE-JOIN & UPLOADS) ---
liveSocket.on('deck-state-init', (deckPayload) => {
    console.log('[+] Synchronizing live slide deck:', deckPayload.slides?.length, 'slides');
    window.globalSlidesDeck = deckPayload.slides || [];
    window.activeSlideIndex = deckPayload.activeSlideIndex || 0;
    
    // Check if initial camera state was passed
    if (deckPayload.isCameraOn !== undefined) {
        setStudentCamPlaceholder(deckPayload.isCameraOn);
    }

    if (typeof window.renderFlatSlideSorterUI === 'function') {
        window.renderFlatSlideSorterUI();
    }
    window.jumpToSlideIndex(window.activeSlideIndex);
});

// --- 4. SLIDE NAVIGATION ENGINE ---
window.jumpToSlideIndex = function(index) {
    window.activeSlideIndex = index;
    if (typeof window.renderFlatSlideSorterUI === 'function') {
        window.renderFlatSlideSorterUI();
    }

    const slide = window.globalSlidesDeck[index];
    if (!slide || !window.canvas) return;

    // Load slide background image
    if (typeof window.applySlideBackground === 'function') {
        window.applySlideBackground(slide);
    }

    // Load saved vector annotations if they exist
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
        if (typeof window.applySlideBackground === 'function') {
            window.applySlideBackground(slide);
        }
        window.canvas.renderAll();
    }
};

// --- 5. LIVE WHITEBOARD ACTION RECEIVER ---
liveSocket.on('board-action', (ev) => {
    if (!window.canvas) return;

    // A. Slide Navigation
    if (ev.type === 'slide-switch') {
        window.jumpToSlideIndex(ev.index);
    } 
    // B. Tool Switching
    else if (ev.type === 'tool-switch') {
        playbackDrawTool = ev.tool;
        if (typeof window.updateCursorVisualState === 'function') {
            window.updateCursorVisualState(0, 0, ev.tool, playbackDrawColor);
        }
    } 
    // C. Teacher Cursor Movement
    else if (ev.type === 'cursor') {
        if (typeof window.updateCursorVisualState === 'function') {
            window.updateCursorVisualState(ev.x, ev.y, playbackDrawTool, playbackDrawColor);
        }
    }
    // D. Drawing Start
    else if (ev.type === 'draw-start') {
        playbackDrawColor = ev.color;
        playbackDrawTool = ev.tool;
        if (typeof window.updateCursorVisualState === 'function') {
            window.updateCursorVisualState(ev.x, ev.y, ev.tool, ev.color);
        }

        // 1. Pen, Highlighter, Laser Pointer
        if (['pen', 'highlight', 'pointer'].includes(ev.tool)) {
            playbackActivePoints = [{ x: ev.x, y: ev.y }];
            const sColor = ev.tool === 'pointer' ? '#ff0000' : ev.color;
            const sOpacity = ev.tool === 'highlight' ? 0.5 : 1.0;
            const sWidth = ev.tool === 'highlight' ? ev.width * 4 : ev.width;
            
            playbackActivePathProps = { 
                stroke: sColor, 
                strokeWidth: sWidth, 
                fill: 'transparent', 
                opacity: sOpacity, 
                strokeLineCap: 'round', 
                strokeLineJoin: 'round', 
                selectable: false, 
                id: ev.objectId,
                slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex,
                visible: window.areAnnotationsVisible
            };
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
            window.canvas.add(playbackActiveObject);
        }
        // 2. Text Boxes
        else if (ev.tool === 'text') {
            playbackActiveObject = new fabric.Textbox('', { 
                left: ev.x, 
                top: ev.y, 
                width: 400, 
                fill: ev.color, 
                fontFamily: 'Segoe UI', 
                id: ev.objectId, 
                fontSize: ev.fontSize || 42, 
                selectable: false,
                slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex,
                visible: window.areAnnotationsVisible
            });
            window.canvas.add(playbackActiveObject);
        }
        // 3. Shapes & 3D Objects
        else if (ev.tool === 'shape') {
            shapeStartX = ev.x; 
            shapeStartY = ev.y;
            const props = { 
                id: ev.objectId, 
                left: ev.x, 
                top: ev.y, 
                fill: 'transparent', 
                stroke: ev.color, 
                strokeWidth: ev.width, 
                selectable: false, 
                strokeUniform: true,
                slideIndex: ev.slideIndex !== undefined ? ev.slideIndex : window.activeSlideIndex,
                visible: window.areAnnotationsVisible
            };
            
            if (ev.shapeType === 'rect') playbackActiveObject = new fabric.Rect({ ...props, width: 1, height: 1 });
            if (ev.shapeType === 'circle') playbackActiveObject = new fabric.Circle({ ...props, radius: 1, originX: 'center', originY: 'center' });
            if (ev.shapeType === 'ellipse') playbackActiveObject = new fabric.Ellipse({ ...props, rx: 1, ry: 1, originX: 'center', originY: 'center' });
            if (ev.shapeType === 'triangle') playbackActiveObject = new fabric.Triangle({ ...props, width: 1, height: 1 });
            if (ev.shapeType === 'line') playbackActiveObject = new fabric.Line([ev.x, ev.y, ev.x + 1, ev.y + 1], props);
            if (ev.shapeType === 'cube') playbackActiveObject = new fabric.Path("M 50 0 L 100 25 L 100 75 L 50 100 L 0 75 L 0 25 Z M 50 0 L 50 50 L 100 25 M 0 25 L 50 50 L 50 100", { ...props, scaleX: 0, scaleY: 0, originX: 'left', originY: 'top' });
            
            if (playbackActiveObject) window.canvas.add(playbackActiveObject);
        }
    } 
    // E. Drawing Move
    else if (ev.type === 'draw-move') {
        if (typeof window.updateCursorVisualState === 'function') {
            window.updateCursorVisualState(ev.x, ev.y, playbackDrawTool, playbackDrawColor);
        }

        if (playbackActivePoints && playbackActiveObject && ['pen', 'highlight', 'pointer'].includes(playbackDrawTool)) {
            playbackActivePoints.push({ x: ev.x, y: ev.y });
            window.canvas.remove(playbackActiveObject);
            playbackActiveObject = new fabric.Path(window.getSmoothPathFromPoints(playbackActivePoints), playbackActivePathProps);
            window.canvas.add(playbackActiveObject);
            window.canvas.renderAll();
        }
        else if (playbackActiveObject && playbackDrawTool === 'shape') {
            if (playbackActiveObject.type === 'rect' || playbackActiveObject.type === 'triangle') {
                playbackActiveObject.set({ width: Math.max(1, Math.abs(shapeStartX - ev.x)), height: Math.max(1, Math.abs(shapeStartY - ev.y)), left: Math.min(ev.x, shapeStartX), top: Math.min(ev.y, shapeStartY) });
            } else if (playbackActiveObject.type === 'circle') {
                playbackActiveObject.set({ radius: Math.max(1, Math.sqrt(Math.pow(shapeStartX - ev.x, 2) + Math.pow(shapeStartY - ev.y, 2))) });
            } else if (playbackActiveObject.type === 'ellipse') {
                playbackActiveObject.set({ rx: Math.max(1, Math.abs(shapeStartX - ev.x)), ry: Math.max(1, Math.abs(shapeStartY - ev.y)) });
            } else if (playbackActiveObject.type === 'line') {
                playbackActiveObject.set({ x2: ev.x, y2: ev.y });
            } else if (playbackActiveObject.type === 'path') {
                playbackActiveObject.set({ scaleX: Math.max(0.1, Math.abs(ev.x - shapeStartX) / 100), scaleY: Math.max(0.1, Math.abs(ev.y - shapeStartY) / 100) });
            }
            playbackActiveObject.setCoords();
            window.canvas.renderAll();
        }
    } 
    // F. Drawing End
    else if (ev.type === 'draw-end') {
        if (playbackActiveObject && playbackDrawTool === 'pointer') {
            const ptrLine = playbackActiveObject;
            ptrLine.animate('opacity', 0, { 
                duration: 1000, 
                onChange: window.canvas.renderAll.bind(window.canvas), 
                onComplete: () => { window.canvas.remove(ptrLine); } 
            });
        }
        playbackActivePoints = [];
        playbackActiveObject = null;
    }
    // G. Object Transformations (Move / Scale / Rotate)
    else if (ev.type === 'object-transform') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) {
            target.set({ left: ev.left, top: ev.top, scaleX: ev.scaleX, scaleY: ev.scaleY, angle: ev.angle });
            target.setCoords();
            window.canvas.renderAll();
        }
    }
    // H. Object Style Modifications
    else if (ev.type === 'object-modified') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) {
            if (ev.fontSize) target.set({ fontSize: ev.fontSize });
            if (ev.fill) target.set({ fill: ev.fill });
            if (ev.stroke) target.set({ stroke: ev.stroke });
            target.dirty = true;
            window.canvas.renderAll();
        }
    }
    // I. Text Editing
    else if (ev.type === 'text-edit') {
        const target = window.canvas.getObjects().find(o => o.id === ev.targetId);
        if (target) {
            target.set({ text: ev.text });
            if (!ev.text || ev.text.trim() === '') window.canvas.remove(target);
            window.canvas.renderAll();
        }
    }
    // J. Object Erasure
    else if (ev.type === 'erase-object') {
        const targets = window.canvas.getObjects().filter(o => o.id === ev.targetId || o.groupId === ev.targetId);
        targets.forEach(t => window.canvas.remove(t));
        window.canvas.renderAll();
    }
    // K. Undo / Redo Synchronization
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
        } catch (err) {
            console.error("Failed to parse undo/redo state:", err);
        }
    }
    // L. Image Insertion (Renders instant live data URL)
    else if (ev.type === 'insert-image' && ev.src) {
        fabric.Image.fromURL(ev.src, (img) => {
            const maxW = 1920 * 0.7; const maxH = 1080 * 0.7;
            let initialScale = 1;
            if (img.width > maxW || img.height > maxH) {
                initialScale = Math.min(maxW / img.width, maxH / img.height);
            }
            img.set({
                id: ev.targetId,
                slideIndex: window.activeSlideIndex,
                left: 960, top: 540,
                originX: 'center', originY: 'center',
                scaleX: initialScale, scaleY: initialScale,
                selectable: false,
                visible: window.areAnnotationsVisible
            });
            img.setCoords();
            window.canvas.add(img);
            window.canvas.renderAll();
        }, { crossOrigin: 'anonymous' });
    }
});

// --- 6. PATH & CURVE SMOOTHING UTILITY ---
window.getSmoothPathFromPoints = function(points) {
    if (!points || points.length === 0) return 'M 0 0';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    let pathStr = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        let xc = (points[i].x + points[i + 1].x) / 2;
        let yc = (points[i].y + points[i + 1].y) / 2;
        pathStr += ` Q ${points[i].x} ${points[i].y}, ${xc} ${yc}`;
    }
    pathStr += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return pathStr;
};