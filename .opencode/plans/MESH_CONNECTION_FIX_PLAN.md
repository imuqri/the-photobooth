# Mesh Connection Fix - Detailed Implementation Plan

## 📋 Problem Summary

### Current Behavior (Broken)
The mesh is **directional** — only the *joiner* initiates connections:

```
User A joins → no connections
User B joins → B→A (B connects to A)  
User C joins → C→A, C→B  (but A,B never connect TO C)
```

**Result**: 3rd+ person can see 1&2, but 1&2 can't see 3+. The WebRTC handshake is only initiated by the *newer* user.

---

### Root Cause

**Server** (`server/src/index.js:52-77`):
- On `join-room`, only emits `peer-joined` to **existing** users telling them about the **new** user
- No event tells **existing** users to connect **to** the new user

**Client** (`frontend/src/hooks/useWebRTC.js`):
- `connectToPeer()` only called when *local* user joins and sees existing peers
- No handler for "new peer arrived — you should connect to them"
- No glare prevention → both sides create offers simultaneously → `InvalidStateError: Called in wrong state: stable`

---

## 🛠 Fix Plan (2-4 hours)

### 1. Server: Add New Event on Join

**File**: `server/src/index.js` (around line 52-77)

```javascript
// In join-room handler, after socket.join(code):
socket.to(code).emit("peer-joined", { socketId: socket.id });

// ADD THIS - tell existing users to connect TO the new peer:
const roomSockets = io.sockets.adapter.rooms.get(code);
if (roomSockets) {
  const existingPeers = Array.from(roomSockets).filter((id) => id !== socket.id);
  if (existingPeers.length > 0) {
    socket.to(code).emit("connect-to-new-peer", {
      newPeerId: socket.id,
      existingPeers,
    });
  }
}
```

**Why**: Existing users need to initiate connection TO the new peer, not just know they exist.

---

### 2. Client: Handle New Event + Prevent Glare

**File**: `frontend/src/hooks/useWebRTC.js`

#### A. Add glare prevention (deterministic tiebreaker)
```javascript
// In connectToPeer:
if (isInitiator && selfIdRef.current && peerId < selfIdRef.current) {
  console.log(`[WebRTC] Tiebreaker: ${selfIdRef.current} waits for ${peerId} to initiate`);
  return;
}
```
Only the peer with "greater" socketId creates offer; other side waits for offer.

#### B. Add connection guards
```javascript
const connectingRef = useRef(new Set());

if (peersRef.current[peerId]) return; // already connected
if (connectingRef.current.has(peerId)) return; // already connecting
if (peerId === selfIdRef.current) return; // self
```

#### C. Handle new event
```javascript
function handleConnectToNewPeer({ newPeerId, existingPeers }) {
  if (newPeerId && newPeerId !== selfIdRef.current) {
    connectToPeer(newPeerId, { isInitiator: true });
  }
  if (Array.isArray(existingPeers)) {
    for (const peerId of existingPeers) {
      if (peerId !== selfIdRef.current && !peersRef.current[peerId]) {
        connectToPeer(peerId, { isInitiator: true });
      }
    }
  }
}
socket.on("connect-to-new-peer", handleConnectToNewPeer);
```

#### D. Fix `InvalidStateError` - check signalingState
```javascript
} else if (data.type === "answer") {
  if (pc && pc.signalingState !== "stable") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
}
```

#### E. Add ICE restart on failure
```javascript
pc.oniceconnectionstatechange = () => {
  if (pc.iceConnectionState === "failed") {
    console.log(`[WebRTC] ICE failed for ${peerId}, attempting restart`);
    pc.restartIce();
  }
};
```

---

### 3. Prevent Duplicate Connections (Race Condition Guard)

**File**: `useWebRTC.js` - Modify `connectToPeer`:

```javascript
const connectToPeer = useCallback(
  async (peerId, { isInitiator = true } = {}) => {
    // Prevent duplicate connections
    if (peersRef.current[peerId]) {
      console.log(`[WebRTC] Already connected to ${peerId}, skipping`);
      return;
    }
    if (peerId === selfIdRef.current) {
      console.log(`[WebRTC] Skipping self-connection`);
      return;
    }
    // ... rest of logic
  },
  [createPeerConnection, socketRef]
);
```

---

### 4. Add Connection State Monitoring (Optional but Recommended)

**File**: `useWebRTC.js` - Enhance `createPeerConnection`:

```javascript
pc.onconnectionstatechange = () => {
  console.log(`[WebRTC] ${peerId} state: ${pc.connectionState}`);
  
  if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
    console.log(`[WebRTC] Attempting ICE restart for ${peerId}`);
    try {
      await pc.restartIce();
    } catch (e) {
      console.warn(`[WebRTC] ICE restart failed for ${peerId}:`, e);
      closePeer(peerId);
      setTimeout(() => connectToPeer(peerId), 1000);
    }
  }
  
  if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }
};
```

---

### 5. Client: Ensure Peer IDs Are Tracked Correctly

**File**: `frontend/src/pages/Room.jsx` (around line 94-100)

```javascript
// Current code sets peerIds from room participants on join
const others = res.room.participants.filter((p) => p.socketId !== res.selfId);
setPeerIds(others.map((p) => p.socketId));
for (const p of others) {
  positionsRef.current.set(p.socketId, p.position);
  connectToPeer(p.socketId);  // This works for initial join
}

// When new user joins, peer-joined fires AFTER this effect runs
// The connect-to-new-peer event handles the reverse direction
```

---

## 🧪 Testing Checklist

After implementing, test with **3+ browser tabs** (incognito/private windows):

| Test | Expected |
|------|----------|
| 2 users join | Both see each other (2 connections) |
| 3rd joins | All 3 see each other (6 connections) |
| 4th joins | All 4 see each other (12 connections) |
| User leaves | Others clean up, streams removed |
| User rejoins | Fresh connections established |
| Network disconnect/reconnect | ICE restart works, streams recover |

---

## 🔍 Debugging Tips

Add temporary logging to verify fix:

```javascript
// In useWebRTC.js connectToPeer:
console.log(`[WebRTC] ${selfIdRef.current} connecting to ${peerId} (initiator: ${isInitiator})`);

// In handleSignal:
console.log(`[WebRTC] ${selfIdRef.current} received ${data.type} from ${from}`);

// In socket.on("connect-to-new-peer"):
console.log(`[WebRTC] ${selfIdRef.current} told to connect to new peer ${newPeerId}`);
```

Check browser console in **each tab** — you should see bidirectional connection logs.

---

## ⚠️ Gotchas to Avoid

| Issue | Prevention |
|-------|------------|
| Double connections | Check `peersRef.current[peerId]` before `connectToPeer` |
| Race condition | Server sends `existingPeers` list; client reconciles |
| Memory leaks | Cleanup `peersRef` and socket listeners in `useEffect` cleanup |
| STUN failures | Add TURN server for production (see `iceServers()` in `useWebRTC.js`) |

---

## 📦 Future: If You Want SFU Later

When you need >8 users or recording:
1. **LiveKit** (recommended) — managed, generous free tier, React SDK
2. **mediasoup** — self-hosted, more control, steeper learning curve
3. **LiveKit Cloud** — $0-50/mo, handles TURN, recording, SIP

---

## ✅ Ready to Execute

When ready to fix:
1. Start with server change (5 min)
2. Add client handler (15 min)  
3. Add dedupe/ICE restart (30 min)
4. Test with 3+ browser tabs (15 min)

**Total: ~1-2 hours**

---

*Generated: 2026-07-12*
*Project: photobooth*
*Branch: dev*