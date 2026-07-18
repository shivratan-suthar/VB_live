import socketio
from fastapi import FastAPI
import uvicorn
import asyncio
from datetime import datetime

# =====================================================================
# 1. SERVER INITIALIZATION
# =====================================================================
# Initialize FastAPI for REST endpoints
api_app = FastAPI()

# Initialize Socket.IO for real-time WebSockets
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')

# Wrap the FastAPI app with the Socket.IO ASGI app
app = socketio.ASGIApp(sio, other_asgi_app=api_app)

# State management to track active classes and users
active_rooms = {}
disconnect_timers = {}

# =====================================================================
# 2. REST API ENDPOINTS (FastAPI)
# =====================================================================
@api_app.get("/api/live-classes")
async def get_live_classes():
    """Returns a list of all currently active live classes."""
    classes_list = [{"room_id": k, "users": len(v)} for k, v in active_rooms.items()]
    return {"classes": classes_list}

# =====================================================================
# 3. SOCKET.IO EVENTS (VectorBoard & State)
# =====================================================================
@sio.on('join-room')
async def handle_join_room(sid, data):
    room_id = data.get('room_id')
    user_type = data.get('role', 'learner') # 'educator' or 'learner'
    
    await sio.enter_room(sid, room_id)
    
    # Track users in the room
    if room_id not in active_rooms:
        active_rooms[room_id] = {}
    active_rooms[room_id][sid] = {'role': user_type}

    # If an educator reconnected, cancel their termination timer
    if user_type == 'educator' and room_id in disconnect_timers:
        disconnect_timers[room_id].cancel()
        del disconnect_timers[room_id]
        print(f"🔄 Educator reconnected. Canceled shutdown timer for {room_id}")

    print(f"✅ User {sid} ({user_type}) joined control room: {room_id}")
    await sio.emit('user-joined', {'sid': sid, 'role': user_type}, room=room_id, skip_sid=sid)

@sio.on('board-action')
async def handle_board_action(sid, room_id, action_data):
    """Synchronizes whiteboard drawings and shapes."""
    await sio.emit('board-action', action_data, room=room_id, skip_sid=sid)

@sio.on('sync-deck-state')
async def handle_deck_sync(sid, room_id, deck_data):
    """Synchronizes presentation slides."""
    await sio.emit('sync-deck-state', deck_data, room=room_id, skip_sid=sid)

@sio.on('chat-message')
async def handle_chat(sid, room_id, message_data):
    """Routes text messages and injects a server-side timestamp."""
    # Ensure every message has a reliable timestamp
    if 'timestamp' not in message_data:
        message_data['timestamp'] = datetime.utcnow().isoformat()
        
    await sio.emit('chat-message', message_data, room=room_id)

@sio.on('camera-status')
async def handle_camera_status(sid, room_id, status_data):
    """Routes lightweight metadata like camera ON/OFF toggles."""
    await sio.emit('camera-status', status_data, room=room_id, skip_sid=sid)

# =====================================================================
# 4. DISCONNECTION & RESILIENCE
# =====================================================================
async def terminate_room(room_id):
    """Closes the room if the educator does not return in time."""
    print(f"🛑 15-second grace period expired. Terminating class {room_id}.")
    await sio.emit('class-terminated', {'message': 'Educator disconnected.'}, room=room_id)
    if room_id in active_rooms:
        del active_rooms[room_id]

@sio.event
async def disconnect(sid):
    # Find which room this user was in
    for room_id, users in list(active_rooms.items()):
        if sid in users:
            user_type = users[sid]['role']
            del users[sid]
            
            print(f"❌ User {sid} ({user_type}) disconnected from {room_id}")
            
            # If the room is empty, clean it up immediately
            if len(users) == 0:
                del active_rooms[room_id]
                break
                
            # If the educator drops, start the 15-second grace period
            if user_type == 'educator':
                print(f"⚠️ Educator dropped! Starting 15s grace period for {room_id}...")
                timer = asyncio.get_event_loop().call_later(15, asyncio.create_task, terminate_room(room_id))
                disconnect_timers[room_id] = timer
            else:
                # Let others know a learner left
                await sio.emit('user-left', {'sid': sid}, room=room_id)
            break


if __name__ == "__main__":
    print("🚀 Starting VectorBoard Control Server on port 3000...")
    # Note: We run 'server1:app' because 'app' is the combined ASGI app variable above
    uvicorn.run("server1:app", host="0.0.0.0", port=3000, ws="websockets", log_level="info")
