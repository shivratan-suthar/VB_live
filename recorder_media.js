/**
 * RECORDER_MEDIA.JS — Educator Studio Live Stream & Media Controller
 * Manages WebRTC PeerJS audio/video streaming, Socket.IO live action broadcasting,
 * hardware permissions (mic/webcam), slide deck sync, and classroom hotkeys.
 */

// --- 1. LIVE SOCKET & ROOM IDENTIFICATION ---
window.ROOM_ID = 'classroom-room-101';
const EDUCATOR_PEER_ID = 'educator-' + window.ROOM_ID;


// With your secure ngrok URL + bypass header:
window.liveSocket = io('https://vector-board.duckdns.org', {
    extraHeaders: {
        "ngrok-skip-browser-warning": "true"
    }
});
window.isRecording = false; 
window.recordStartTime = 0; 
window.jsonDrawingTimelineLog = [];

let localHardwareAVStream = null;
let isCameraHardwareOn = false; 
let isAudioHardwareOn = false; 
let isCameraPermissionGranted = false;
let isMicrophonePermissionGranted = false;
let isRequestingPermissions = false;

// DOM Elements
const liveBadge = document.getElementById('btnLiveToggle');
const camVideoFeed = document.getElementById('webcamVideoFeed');
const btnMute = document.getElementById('btnMute');
const btnToggleCam = document.getElementById('btnToggleCam');
const camPlaceholderText = document.getElementById('camPlaceholderText');
const orientOverlay = document.getElementById('orientationOverlay');

// Initial UI State: Camera "Off" visual
if (camVideoFeed) camVideoFeed.style.opacity = '0';
if (btnMute) btnMute.classList.add('is-muted');

// --- 2. PEERJS WEBRTC STREAMING SETUP (WITH STUN SERVERS) ---
window.educatorPeer = new Peer(EDUCATOR_PEER_ID, {
    config: {
        iceServers: [// 1. STUN servers (Discovers public IP addresses)
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'stun:stun.l.google.com:19302' },

    // 2. Your Active TURN servers (Relays video across strict firewalls & mobile networks)
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

window.educatorPeer.on('open', (id) => {
    console.log('[+] Educator Peer ready with ID:', id);
    if (window.liveSocket) {
        window.liveSocket.emit('join-room', window.ROOM_ID, id, true);
    }
});

window.educatorPeer.on('error', (err) => {
    console.error('[-] PeerJS Error:', err);
});

// Automatically answer incoming student video/audio calls with educator's stream
window.educatorPeer.on('call', (call) => {
    if (localHardwareAVStream) {
        console.log('[+] Student called. Answering with live camera stream...');
        call.answer(localHardwareAVStream);
    } else {
        console.warn('[-] Student called, but camera/mic is not active yet.');
    }
});

// --- 3. SLIDE DECK SYNCHRONIZATION ---
window.broadcastDeckState = function() {
    if (window.liveSocket && typeof window.saveCurrentSlideState === 'function') {
        window.saveCurrentSlideState();
        console.log('[*] Broadcasting updated slide deck to room...');
        window.liveSocket.emit('sync-deck-state', window.ROOM_ID, {
            slides: window.globalSlidesDeck || [],
            activeSlideIndex: window.activeSlideIndex || 0,
            isCameraOn: isCameraHardwareOn // <-- NEW: Include camera state
        });
    }
};

// When a new student joins late, immediately sync slides and actively call their WebRTC stream
window.liveSocket.on('user-connected', (data) => {
    if (!data.isEducator) {
        console.log('[+] Learner joined! Syncing slides & calling stream...');
        window.broadcastDeckState();
        
        // Add a small 600ms delay to allow the learner's cloud PeerJS ID to fully initialize
        if (localHardwareAVStream && window.educatorPeer && data.peerId) {
            setTimeout(() => {
                console.log('[+] Dialing learner via WebRTC:', data.peerId);
                window.educatorPeer.call(data.peerId, localHardwareAVStream);
            }, 600);
        }
    }
});

// Listen for explicit stream requests from late-joining students
window.liveSocket.on('request-webrtc-stream', (data) => {
    if (localHardwareAVStream && window.educatorPeer && data.peerId) {
        console.log('[+] Learner requested WebRTC stream explicitly. Calling:', data.peerId);
        window.educatorPeer.call(data.peerId, localHardwareAVStream);
    }
});

// --- 4. HARDWARE CAMERA & MICROPHONE PERMISSIONS ---
async function requestHardwarePermissions() {
    if (isRequestingPermissions) return false;
    isRequestingPermissions = true;
    
    try { 
        localHardwareAVStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: { echoCancellation: true, noiseSuppression: true } 
        }); 
        
        if (camVideoFeed) camVideoFeed.srcObject = localHardwareAVStream;
        
        isCameraPermissionGranted = true; 
        isMicrophonePermissionGranted = true;
        isCameraHardwareOn = true;
        isAudioHardwareOn = true;
        
        if (camVideoFeed) camVideoFeed.style.opacity = '1';
        if (btnMute) btnMute.classList.remove('is-muted');
        document.getElementById('camHardwareErrorNotice')?.classList.add('hidden');
        if (camPlaceholderText) camPlaceholderText.style.display = 'none';
        
        // Notify all students in the room that stream is active so they can connect
        if (window.liveSocket) {
            window.liveSocket.emit('stream-ready', window.ROOM_ID, EDUCATOR_PEER_ID);
        }
        
        isRequestingPermissions = false;
        return true;
    } catch (e) { 
        console.error("Hardware Permission Denied:", e);
        isCameraHardwareOn = false; 
        isAudioHardwareOn = false; 
        isCameraPermissionGranted = false; 
        isMicrophonePermissionGranted = false;
        
        const errorNotice = document.getElementById('camHardwareErrorNotice');
        if (errorNotice) {
            errorNotice.innerText = "Camera/Mic access denied. Please check your browser permissions.";
            errorNotice.classList.remove('hidden');
        }
        
        if (camPlaceholderText) camPlaceholderText.style.display = 'flex';
        isRequestingPermissions = false;
        return false;
    }
}

btnToggleCam?.addEventListener('click', async () => { 
    if (!localHardwareAVStream && !isCameraPermissionGranted) {
        await requestHardwarePermissions();
        return; 
    }
    if (!isCameraPermissionGranted) {
        document.getElementById('camHardwareErrorNotice')?.classList.remove('hidden');
        return;
    }
    isCameraHardwareOn = !isCameraHardwareOn; 
    if (camVideoFeed) camVideoFeed.style.opacity = isCameraHardwareOn ? '1' : '0'; 
    
    if (camPlaceholderText) {
        camPlaceholderText.style.display = isCameraHardwareOn ? 'none' : 'flex';
        camPlaceholderText.innerHTML = '📷 Camera Off';
    }

    if (localHardwareAVStream) {
        localHardwareAVStream.getVideoTracks().forEach(track => track.enabled = isCameraHardwareOn);
    }

    // --- NEW: Broadcast live camera status to all students! ---
    if (window.liveSocket) {
        window.liveSocket.emit('camera-status', window.ROOM_ID, { enabled: isCameraHardwareOn });
    }
});

btnMute?.addEventListener('click', async (e) => { 
    if (!localHardwareAVStream && !isMicrophonePermissionGranted) {
        await requestHardwarePermissions();
        return; 
    }
    if (!isMicrophonePermissionGranted) {
        document.getElementById('camHardwareErrorNotice')?.classList.remove('hidden');
        return;
    }
    isAudioHardwareOn = !isAudioHardwareOn; 
    e.target.classList.toggle('is-muted', !isAudioHardwareOn);
    if (localHardwareAVStream) {
        localHardwareAVStream.getAudioTracks().forEach(track => track.enabled = isAudioHardwareOn);
    }
});

// --- 5. LIVE ACTION LOGGING & SOCKET BROADCASTING ---
window.logActionDirectlyToTimeline = function(type, extraData = {}) { 
    const actionPayload = { type: type, ...extraData, timestamp: Date.now() };
    
    // Log locally
    if (window.isRecording && window.jsonDrawingTimelineLog) {
        window.jsonDrawingTimelineLog.push({ tick: Date.now() - window.recordStartTime, ...actionPayload });
    }
    
    // Broadcast instantly to connected students over Socket.IO
    if (window.liveSocket) {
        window.liveSocket.emit('board-action', window.ROOM_ID, actionPayload);
    }
};

const originalPageShifter = window.jumpToSlideIndex;
window.jumpToSlideIndex = function(index) { 
    if (typeof originalPageShifter === 'function') originalPageShifter(index); 
    window.logActionDirectlyToTimeline('slide-switch', { index: index }); 
    window.broadcastDeckState();
};

// --- 6. LIVE ROOM BROADCAST CONTROLLER ---
liveBadge?.addEventListener('click', async () => {
    if (!isMicrophonePermissionGranted) {
        const granted = await requestHardwarePermissions();
        if (!granted) {
            alert("Microphone/Camera permission is required to broadcast a live classroom.");
            return;
        }
    }
    if (window.isRecording) {
        if (typeof window.saveCurrentSlideState === 'function') {
            window.saveCurrentSlideState();
        }
        window.isRecording = false; 
        liveBadge.textContent = "🔴 Start Live Room";
        liveBadge.classList.remove('recording');
        return;
    }
    window.isRecording = true; 
    window.recordStartTime = Date.now(); 
    liveBadge.textContent = "📡 ROOM LIVE BROADCASTING";
    liveBadge.classList.add('recording');
    window.broadcastDeckState();
});

document.getElementById('btnEndClass')?.addEventListener('click', () => { 
    if (window.isRecording && liveBadge) liveBadge.click(); 
});

// --- 7. UI ORIENTATION & KEYBOARD SHORTCUTS ---
document.getElementById('btnDismissOrientation')?.addEventListener('click', () => {
    if (orientOverlay) {
        orientOverlay.classList.add('hidden');
    }
});

function triggerToolbarToolViaShortcut(toolName) {
    const targetBtn = document.querySelector(`.tb-btn[data-tool="${toolName}"]`);
    if (targetBtn) targetBtn.click();
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') { 
        e.preventDefault(); 
        const hud = document.getElementById('shortcutHudOverlay');
        if (hud) hud.style.display = 'flex'; 
    }
    if (e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') { e.preventDefault(); if (typeof window.performUndo === 'function') window.performUndo(); return; }
        if (key === 'y') { e.preventDefault(); if (typeof window.performRedo === 'function') window.performRedo(); return; }
        if (key >= '1' && key <= '6') {
            e.preventDefault();
            const slotIndex = parseInt(key, 10) - 1;
            const dots = document.querySelectorAll('#colorPalette .color-dot:not(.custom-color-picker)');
            if (dots[slotIndex]) dots[slotIndex].click();
        }
        switch (key) {
            case 'p': e.preventDefault(); triggerToolbarToolViaShortcut('pen'); break;
            case 'h': e.preventDefault(); triggerToolbarToolViaShortcut('highlight'); break;
            case 'e': e.preventDefault(); triggerToolbarToolViaShortcut('eraser'); break;
            case 't': e.preventDefault(); triggerToolbarToolViaShortcut('text'); break;
            case 'l':
                e.preventDefault();
                document.querySelectorAll('.tb-btn').forEach(b => b.classList.remove('active'));
                document.getElementById('btnShapesTrigger')?.classList.add('active');
                window.activeTool = 'shape'; window.activeShapeType = 'line';
                if (window.canvas) {
                    window.canvas.isDrawingMode = false; 
                    window.canvas.selection = false;
                    window.canvas.forEachObject(o => o.set('selectable', false));
                }
                if (typeof window.updateBrush === 'function') window.updateBrush();
                break;
            case 'o': e.preventDefault(); document.getElementById('btnShapesTrigger')?.click(); break;
        }
    }
});

window.addEventListener('keyup', (e) => { 
    if (e.key === 'Alt') { 
        const hud = document.getElementById('shortcutHudOverlay');
        if (hud) hud.style.display = 'none'; 
    } 
});