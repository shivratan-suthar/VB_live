/**
 * RECORDER_MEDIA.JS — Educator Studio Live Stream & Media Controller
 * WebSocket Streaming Architecture (Replaces WebRTC)
 */

// =====================================================================
// 1. DYNAMIC ROOM & SOCKET INITIALIZATION (WITH RECONNECTION RECOVERY)
// =====================================================================
window.ROOM_ID = 'room-' + Math.random().toString(36).substring(2, 9);
const EDUCATOR_PEER_ID = 'educator-' + window.ROOM_ID;

window.liveSocket = io('https://api.sutharx.in', {
    extraHeaders: { "ngrok-skip-browser-warning": "true" }
});

window.isRecording = false; 
window.recordStartTime = 0; 
window.jsonDrawingTimelineLog = [];
let liveTimerInterval = null;

let localHardwareAVStream = null;
let isCameraHardwareOn = false; 
let isAudioHardwareOn = false; 
let isCameraPermissionGranted = false;
let isMicrophonePermissionGranted = false;
let isRequestingPermissions = false;

// WebSocket Streaming Globals
let videoStreamTimer = null;
let audioCtx = null;
let scriptProcessor = null;
let audioSource = null;

const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = 120;
offscreenCanvas.height = 65;
const offCtx = offscreenCanvas.getContext('2d', { alpha: false });

// DOM Elements
const liveBadge = document.getElementById('btnLiveToggle');
const camVideoFeed = document.getElementById('webcamVideoFeed');
const btnMute = document.getElementById('btnMute');
const btnToggleCam = document.getElementById('btnToggleCam');
const camPlaceholderText = document.getElementById('camPlaceholderText');
const orientOverlay = document.getElementById('orientationOverlay');
const liveSetupModal = document.getElementById('liveSetupModal');
const liveClassTitleInput = document.getElementById('liveClassTitleInput');
const liveAttendanceCounter = document.getElementById('liveAttendanceCounter');

if (camVideoFeed) camVideoFeed.style.opacity = '0';
if (btnMute) btnMute.classList.add('is-muted');

// --- AUTOMATIC RECONNECTION RECOVERY ENGINE ---
window.liveSocket.on('disconnect', (reason) => {
    console.warn('[-] Educator Socket disconnected from server:', reason);
});

window.liveSocket.on('connect', () => {
    console.log('[+] Educator Socket connected/reconnected. Checking broadcast state...');
    if (window.isRecording && window.ROOM_ID) {
        const headingTitle = document.getElementById('classroomStateHeadingTitle');
        const title = headingTitle ? headingTitle.innerText.replace('LIVE: ', '') : 'Restored Class';
        
        console.log(`[*] Network recovered! Re-registering live room: ${window.ROOM_ID} (${title})...`);
        window.liveSocket.emit('join-room', window.ROOM_ID, EDUCATOR_PEER_ID, true, title);
        
        if (typeof window.saveCurrentSlideState === 'function') {
            window.saveCurrentSlideState();
        }
        if (typeof window.broadcastDeckState === 'function') {
            window.broadcastDeckState();
        }
    }
});

// =====================================================================
// 2. LIVE TIMER UTILITIES
// =====================================================================
function startLiveTimer() {
    const timerEl = document.getElementById('topTimer');
    if (!timerEl) return;
    
    clearInterval(liveTimerInterval);
    liveTimerInterval = setInterval(() => {
        if (!window.isRecording || !window.recordStartTime) return;
        
        const elapsedSecs = Math.floor((Date.now() - window.recordStartTime) / 1000);
        const hrs = String(Math.floor(elapsedSecs / 3600)).padStart(2, '0');
        const mins = String(Math.floor((elapsedSecs % 3600) / 60)).padStart(2, '0');
        const secs = String(elapsedSecs % 60).padStart(2, '0');
        
        timerEl.innerText = `${hrs}:${mins}:${secs}`;
    }, 1000);
}

function stopLiveTimer() {
    clearInterval(liveTimerInterval);
    const timerEl = document.getElementById('topTimer');
    if (timerEl) timerEl.innerText = "00:00:00";
}

// =====================================================================
// 3. WEBSOCKET LIVE STREAMING (Video @ 24fps & Audio PCM)
// =====================================================================
// =====================================================================
// 3. WEBSOCKET LIVE STREAMING (Video @ 15fps & Audio PCM)
// =====================================================================
function startWebSocketStreaming(stream) {
    // 1. Video Capture Loop (15 FPS = ~66ms)
    if (videoStreamTimer) clearInterval(videoStreamTimer);
    videoStreamTimer = setInterval(() => {
        if (!isCameraHardwareOn || !window.isRecording || !window.ROOM_ID || !camVideoFeed) return;
        
        // Downscale to 120x65
        offCtx.drawImage(camVideoFeed, 0, 0, 120, 65);
        // Reduced quality to 0.5 to ensure fast Socket.io transmission
        const frameData = offscreenCanvas.toDataURL('image/jpeg', 0.5);
        
        window.liveSocket.volatile.emit('ws-video-frame', window.ROOM_ID, {
            frame: frameData
            // Removed cross-device timestamp to prevent clock-drift bugs
        });
    }, 66);

    // 2. Audio Capture (Raw PCM)
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioSource = audioCtx.createMediaStreamSource(stream);
        
        scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1); 
        
        audioSource.connect(scriptProcessor);
        scriptProcessor.connect(audioCtx.destination); 
        
        scriptProcessor.onaudioprocess = (e) => {
            if (!isAudioHardwareOn || !window.isRecording || !window.ROOM_ID) return;
            
            const inputData = e.inputBuffer.getChannelData(0);
            
            window.liveSocket.volatile.emit('ws-audio-chunk', window.ROOM_ID, {
                audio: inputData.buffer,
                sampleRate: audioCtx.sampleRate
                // Removed cross-device timestamp
            });
        };
    } catch (err) {
        console.error("[-] Failed to initialize audio context for streaming:", err);
    }
}
function stopWebSocketStreaming() {
    if (videoStreamTimer) clearInterval(videoStreamTimer);
    if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
    }
    if (scriptProcessor) scriptProcessor.disconnect();
    if (audioSource) audioSource.disconnect();
}

// =====================================================================
// 4. SLIDE DECK SYNCHRONIZATION & EVENT HOOKS
// =====================================================================
window.liveSocket.on('request-canvas-resync', () => {
    console.log('[*] Student requested canvas resync. Broadcasting fresh JSON snapshot...');
    if (typeof window.broadcastDeckState === 'function') {
        window.broadcastDeckState(); 
    }
});

window.broadcastDeckState = function() {
    if (window.liveSocket && window.isRecording && typeof window.saveCurrentSlideState === 'function') {
        window.saveCurrentSlideState();
        console.log('[*] Broadcasting updated slide deck to room...');
        window.liveSocket.emit('sync-deck-state', window.ROOM_ID, {
            slides: window.globalSlidesDeck || [],
            activeSlideIndex: window.activeSlideIndex || 0,
            isCameraOn: isCameraHardwareOn
        });
    }
};

window.liveSocket.on('user-connected', (data) => {
    if (!data.isEducator) {
        console.log('[+] Learner joined the active stream! Syncing state...');
        window.broadcastDeckState();
    }
});

window.liveSocket.on('attendance-update', (count) => {
    console.log('[*] Live student count updated:', count);
    if (liveAttendanceCounter) {
        liveAttendanceCounter.innerText = `👥 ${count} Watching`;
        if (count > 0) {
            liveAttendanceCounter.classList.add('has-viewers');
        } else {
            liveAttendanceCounter.classList.remove('has-viewers');
        }
    }
});

// =====================================================================
// 5. HARDWARE CAMERA & MICROPHONE PERMISSIONS
// =====================================================================
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
        
        // START WEBSOCKET STREAM
        startWebSocketStreaming(localHardwareAVStream);
        
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
            errorNotice.innerText = "Camera/Mic access denied. Check browser permissions.";
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
    if (window.liveSocket && window.isRecording) {
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


// =====================================================================
// 6. LIVE ACTION LOGGING & BROADCASTING
// =====================================================================
window.logActionDirectlyToTimeline = function(type, extraData = {}) { 
    const actionPayload = { type: type, ...extraData, timestamp: Date.now() };
    if (window.isRecording && window.jsonDrawingTimelineLog) {
        window.jsonDrawingTimelineLog.push({ tick: Date.now() - window.recordStartTime, ...actionPayload });
    }
    if (window.liveSocket && window.isRecording) {
        window.liveSocket.emit('board-action', window.ROOM_ID, actionPayload);
    }
};

const originalPageShifter = window.jumpToSlideIndex;
window.jumpToSlideIndex = function(index) { 
    if (typeof originalPageShifter === 'function') originalPageShifter(index); 
    window.logActionDirectlyToTimeline('slide-switch', { index: index }); 
    window.broadcastDeckState();
};


// =====================================================================
// 7. DYNAMIC LIVE ROOM LOBBY BROADCAST CONTROLLER
// =====================================================================
liveBadge?.addEventListener('click', async () => {
    if (!isMicrophonePermissionGranted) {
        const granted = await requestHardwarePermissions();
        if (!granted) {
            alert("Microphone/Camera permission is required to broadcast a live classroom.");
            return;
        }
    }
    
    if (window.isRecording) {
        if (typeof window.saveCurrentSlideState === 'function') window.saveCurrentSlideState();
        window.isRecording = false; 
        
        if (window.liveSocket && window.ROOM_ID) {
            window.liveSocket.emit('end-class', window.ROOM_ID);
        }

        liveBadge.textContent = "🔴 Start Live Room";
        liveBadge.classList.remove('recording');
        
        stopLiveTimer();
        stopWebSocketStreaming();
        if (liveAttendanceCounter) {
            liveAttendanceCounter.classList.add('hidden');
        }
        
        setTimeout(() => {
            window.location.reload();
        }, 150);
        return;
    }
    
    if (liveSetupModal) {
        liveSetupModal.style.display = 'flex';
        if (liveClassTitleInput) liveClassTitleInput.focus();
    }
});

document.getElementById('btnCancelLiveModal')?.addEventListener('click', () => {
    if (liveSetupModal) liveSetupModal.style.display = 'none';
});

document.getElementById('btnConfirmLiveStart')?.addEventListener('click', () => {
    const enteredTitle = liveClassTitleInput?.value.trim() || "Untitled Live Class";
    if (liveSetupModal) liveSetupModal.style.display = 'none';

    const headingTitle = document.getElementById('classroomStateHeadingTitle');
    if (headingTitle) headingTitle.innerText = `LIVE: ${enteredTitle}`;

    console.log(`[*] Registering room ${window.ROOM_ID} as "${enteredTitle}"...`);
    window.liveSocket.emit('join-room', window.ROOM_ID, EDUCATOR_PEER_ID, true, enteredTitle);

    window.isRecording = true; 
    window.recordStartTime = Date.now(); 
    liveBadge.textContent = "📡 LIVE BROADCASTING";
    liveBadge.classList.add('recording');
    
    startLiveTimer();
    
    if (liveAttendanceCounter) {
        liveAttendanceCounter.innerText = "👥 0 Watching";
        liveAttendanceCounter.classList.remove('hidden', 'has-viewers');
    }
    
    window.broadcastDeckState();
});

document.getElementById('btnEndClass')?.addEventListener('click', () => { 
    if (window.isRecording && liveBadge) liveBadge.click(); 
});


// =====================================================================
// 8. REAL-TIME CLASSROOM CHAT ENGINE
// =====================================================================
const chatInput = document.getElementById('liveChatInput');
const btnSendChat = document.getElementById('btnSendChat');
const chatMessagesBox = document.getElementById('liveChatMessages');

function appendChatMessage(sender, text, isEducator = false) {
    if (!chatMessagesBox) return;
    
    const sysMsg = chatMessagesBox.querySelector('.sys-msg');
    if (sysMsg && chatMessagesBox.children.length === 1) {
        sysMsg.remove();
    }

    const msgEl = document.createElement('div');
    msgEl.className = `chat-msg ${isEducator ? 'educator-msg' : ''}`;
    msgEl.innerHTML = `
        <span class="sender">${sender} ${isEducator ? '(Educator)' : ''}</span>
        <span class="text">${text}</span>
    `;
    chatMessagesBox.appendChild(msgEl);
    chatMessagesBox.scrollTop = chatMessagesBox.scrollHeight;
}

function sendEducatorMessage() {
    const text = chatInput?.value.trim();
    if (!text) return;

    if (!window.isRecording || !window.ROOM_ID) {
        alert("You must start broadcasting a live class before sending messages.");
        return;
    }

    appendChatMessage('You', text, true);
    if (chatInput) chatInput.value = '';

    if (window.liveSocket) {
        window.liveSocket.emit('chat-message', window.ROOM_ID, {
            sender: 'Educator',
            text: text,
            isEducator: true
        });
    }
}

btnSendChat?.addEventListener('click', sendEducatorMessage);
chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendEducatorMessage();
    }
});

window.liveSocket.on('chat-message', (payload) => {
    if (payload.isEducator) return;
    appendChatMessage(payload.sender || 'Learner', payload.text, false);
});


// =====================================================================
// 9. UI ORIENTATION & KEYBOARD SHORTCUTS
// =====================================================================
document.getElementById('btnDismissOrientation')?.addEventListener('click', () => {
    if (orientOverlay) orientOverlay.classList.add('hidden');
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