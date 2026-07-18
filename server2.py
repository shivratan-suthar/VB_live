import socketio
import uvicorn

# Initialize a dedicated Socket.IO server for media on port 3001
# Added a 5MB buffer limit to prevent server memory crashes during heavy video lag
sio = socketio.AsyncServer(
    async_mode='asgi', 
    cors_allowed_origins='*',
    max_http_buffer_size=5 * 1024 * 1024 
)
app = socketio.ASGIApp(sio)

# 1. THE ROOM ROUTER
@sio.on('join-room')
async def handle_join_room(sid, room_id):
    await sio.enter_room(sid, room_id)
    print(f"✅ Client {sid} joined media room: {room_id}")

# 2. The Test Event
@sio.on('test')
async def handle_test(sid, data):
    print(f"✅ TEST SUCCESS! Received from {sid}. Data: {data}")
    await sio.emit('test-response', {'message': 'Server confirms test received!'}, to=sid)

# 3. Video & Audio Broadcasters
@sio.on('ws-video-frame')
async def handle_ws_video(sid, room_id, payload):
    await sio.emit('ws-video-frame', payload, room=room_id, skip_sid=sid)

@sio.on('ws-audio-chunk')
async def handle_ws_audio(sid, room_id, payload):
    await sio.emit('ws-audio-chunk', payload, room=room_id, skip_sid=sid)

# 4. Learner Bi-Directional AV Broadcasters
@sio.on('learner-video-frame')
async def handle_learner_video(sid, room_id, payload):
    await sio.emit('learner-video-frame', payload, room=room_id, skip_sid=sid)

@sio.on('learner-audio-chunk')
async def handle_learner_audio(sid, room_id, payload):
    await sio.emit('learner-audio-chunk', payload, room=room_id, skip_sid=sid)

@sio.on('learner-stopped-av')
async def handle_learner_stop(sid, room_id, peer_id):
    await sio.emit('learner-stopped-av', peer_id, room=room_id, skip_sid=sid)

@sio.on('request-av-join')
async def handle_request_av(sid, room_id, payload):
    await sio.emit('request-av-join', payload, room=room_id, skip_sid=sid)

@sio.on('av-join-response')
async def handle_av_response(sid, room_id, payload):
    await sio.emit('av-join-response', payload, room=room_id, skip_sid=sid)

# 5. STANDARD PYTHON RUN COMMAND (For EC2 and systemd)
if __name__ == "__main__":
    print("🚀 Starting Media Server on port 3001...")
    uvicorn.run("server2:app", host="0.0.0.0", port=3001, ws="websockets")
