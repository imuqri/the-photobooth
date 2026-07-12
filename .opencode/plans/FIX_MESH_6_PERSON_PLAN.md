# Fix Mesh for 6 People - Implementation Plan

## Overview
Fix the custom WebRTC mesh to reliably handle 6 participants.

**Branch**: `fix/mesh-6-person` (from `dev`)
**Target**: Merge to `dev` after verified working
**Estimated Effort**: 2.5-3 hours

---

## Root Cause Analysis

| Issue | Current Behavior | Root Cause |
|-------|-----------------|------------|
| 3rd+ user sees only self | Works after refresh | Tiebreaker race: `selfIdRef.current` null when join callback fires |
| "Connected" but no video | Black tiles | No track verification; `ontrack` may never fire |
| Permanent failures | Need refresh | No reconnection logic after ICE failure |
| `InvalidStateError: stable` | Console errors | Glare not fully prevented; lexicographic tiebreaker + timing race |

---

## Phase 1: Core Mesh Fixes (Critical)

### 1.1 Fix Tiebreaker Timing in Room.jsx
**File**: `frontend/src/pages/Room.jsx`
**Lines**: ~84-108 (join-room callback)

**Changes**:
- Call `setWebRTCSelfId(res.selfId)` **BEFORE** `socket.emit("join-room", ...)` 
- Capture `myId = res.selfId` locally
- Pass explicit `selfId` to all `connectToPeer` calls

```jsx
// BEFORE (broken):
socket.emit("join-room", { code }, (res) => {
  setSelfId(res.selfId);
  setWebRTCSelfId(res.selfId);  // Too late!
  // ...
  for (const p of others) connectToPeer(p.socketId);
});

// AFTER (fixed):
setWebRTCSelfId(res.selfId);  // BEFORE join emit
const myId = res.selfId;
socket.emit("join-room", { code }, (res) => {
  setSelfId(res.selfId);
  for (const p of others) {
    connectToPeer(p.socketId, { selfId: myId, isInitiator: true });
  }
});
```

### 1.2 Polite/Impolite Glare Prevention in useWebRTC.js
**File**: `frontend/src/hooks/useWebRTC.js`
**Pattern**: Standard WebRTC glare prevention (replaces manual tiebreaker)

**Changes in `createPeerConnection`**:
```javascript
const createPeerConnection = useCallback((peerId) => {
  const pc = new RTCPeerConnection({ iceServers: iceServers() });
  
  // Determine politeness: lexicographically greater socketId = polite
  const isPolite = peerId > selfIdRef.current;
  pc.polite = isPolite;
  
  // Replace manual offer creation with onnegotiationneeded
  pc.onnegotiationneeded = async () => {
    try {
      await pc.setLocalDescription(await pc.createOffer());
      socketRef.current?.emit("signal", {
        to: peerId,
        data: pc.localDescription,
      });
    } catch (err) {
      // Glare! Polite side rolls back
      if (pc.polite && err.name === "InvalidStateError") {
        console.log(`[WebRTC] Glare detected, rolling back for ${peerId}`);
        await pc.setLocalDescription(pc.currentLocalDescription);
      }
    }
  };
  
  // ... rest unchanged
}, [localStream, socketRef]);
```

**Changes in `connectToPeer`**:
```javascript
const connectToPeer = useCallback(async (peerId, { isInitiator = true, selfId } = {}) => {
  const myId = selfId ?? selfIdRef.current;
  
  // Determine who should initiate (impolite side initiates)
  const shouldInitiate = isInitiator && (!myId || peerId > myId); // impolite initiates
  
  if (!shouldInitiate) {
    console.log(`[WebRTC] ${myId} waiting for ${peerId} to initiate (polite)`);
    return; // Wait for other side's onnegotiationneeded
  }
  
  // ... create connection, but DON'T create offer manually
  // Let onnegotiationneeded fire naturally
}, [createPeerConnection, socketRef]);
```

### 1.3 Track Verification + 10s Timeout -> Reconnect
**File**: `frontend/src/hooks/useWebRTC.js`

**Add state**:
```javascript
const connectionHealthRef = useRef({}); // { [peerId]: { connected, hasTrack, startTime, iceState } }
```

**In `createPeerConnection`**:
```javascript
pc.ontrack = (event) => {
  connectionHealthRef.current[peerId] = {
    ...connectionHealthRef.current[peerId],
    hasTrack: true,
    connected: true,
  };
  setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
};

pc.oniceconnectionstatechange = () => {
  connectionHealthRef.current[peerId] = {
    ...connectionHealthRef.current[peerId],
    iceState: pc.iceConnectionState,
  };
  
  if (pc.iceConnectionState === "failed") {
    console.log(`[WebRTC] ICE failed for ${peerId}, attempting restart`);
    pc.restartIce();
  }
  
  if (pc.iceConnectionState === "disconnected") {
    // Schedule reconnect if no track received
    setTimeout(() => {
      const health = connectionHealthRef.current[peerId];
      if (health && health.connected && !health.hasTrack) {
        reconnectPeer(peerId);
      }
    }, 5000);
  }
};
```

### 1.4 Exponential Backoff Reconnection
**File**: `frontend/src/hooks/useWebRTC.js`

**Add reconnect function**:
```javascript
const reconnectPeer = useCallback(async (peerId, attempt = 0) => {
  console.log(`[WebRTC] Reconnecting to ${peerId} (attempt ${attempt + 1})`);
  closePeer(peerId);
  const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
  await new Promise(r => setTimeout(r, delay));
  connectToPeer(peerId, { isInitiator: true, selfId: selfIdRef.current });
}, [closePeer, connectToPeer]);
```

**Call from `oniceconnectionstatechange` when failed/disconnected without track**.

---

## Phase 2: TURN Support (Future Enhancement - Not in Initial Implementation)

### 2.1 TURN Already Supported in Code
**File**: `frontend/src/hooks/useWebRTC.js` (lines 3-14) - **Already implemented**

```javascript
function iceServers() {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}
```

**Decision**: TURN is fully supported in code. No implementation needed now. Add env vars later when mobile issues appear.

### 2.2 Local Testing Setup (Optional - For When Needed)
**Option A**: Run coturn locally (Docker)
```bash
docker run -d \
  -p 3478:3478/udp -p 3478:3478/tcp -p 5349:5349/tcp \
  coturn/coturn:latest \
  -n --lt-cred-mech --realm=local --user=test:pass --external-ip=127.0.0.1
```
Then in `frontend/.env`:
```
VITE_TURN_URL=turn:127.0.0.1:3478?transport=udp
VITE_TURN_USERNAME=test
VITE_TURN_CREDENTIAL=pass
```

**Option B**: Use free TURN for local dev
```
VITE_TURN_URL=turn:openrelay.metered.ca:443?transport=tcp
VITE_TURN_USERNAME=openrelayproject
VITE_TURN_CREDENTIAL=openrelayproject
```

### 2.3 Production TURN (Later)
Deploy coturn on Railway or your VM when mobile issues appear.

---

## Phase 3: Health & Edge Cases

### 3.1 Tab Visibility Handling
**File**: `frontend/src/hooks/useWebRTC.js`
```javascript
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      // Trigger ICE restart on all connections
      for (const [peerId, pc] of Object.entries(peersRef.current)) {
        if (pc.iceConnectionState !== "connected") {
          pc.restartIce();
        }
      }
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
}, []);
```

### 3.2 Simultaneous Join Protection
**File**: `frontend/src/hooks/useWebRTC.js` in `connectToPeer`
```javascript
// Add small random jitter to prevent exact simultaneous initiation
const jitter = Math.random() * 100;
await new Promise(r => setTimeout(r, jitter));
```

### 3.3 Cleanup All Error Paths
Verify `connectingRef.current.delete(peerId)` called in all catch blocks.

---

## Phase 4: Testing & Merge

### 4.1 Local Test Matrix
| Test | Users | Browsers | Expected |
|------|-------|----------|----------|
| Basic mesh | 2 | Chrome + Firefox | Both see each other |
| 3 users | 3 | 3 Chrome tabs | All see each other |
| 4 users | 4 | 2 Chrome + 2 incognito | All see each other |
| 6 users | 6 | Mix of tabs/incognito | All see each other |
| Rejoin | 3 | Leave + rejoin | Clean reconnection |
| Tab sleep | 2 | Sleep/wake tab | Recovers automatically |

**Mobile testing**: Deferred until TURN deployed (if needed)

### 4.2 Verification Checklist
- [ ] No `InvalidStateError: stable` in console
- [ ] All 6 users see each other immediately (no refresh)
- [ ] Reconnection works after network blip
- [ ] Tab sleep/wake recovers
- [ ] Leave/rejoin clean (no ghost connections)

### 4.3 Merge Process
```bash
git checkout dev
git merge fix/mesh-6-person
git push origin dev
```

---

## Files to Modify

| File | Phase | Description |
|------|-------|-------------|
| `frontend/src/pages/Room.jsx` | 1.1 | Fix tiebreaker timing, pass explicit selfId |
| `frontend/src/hooks/useWebRTC.js` | 1.2, 1.3, 1.4, 3.1, 3.2 | Polite/impolite, track verification, reconnection, visibility, jitter |

---

## Rollback Plan
```bash
# If issues:
git checkout dev
git branch -D fix/mesh-6-person
```

---

## Open Questions

1. **Max participants**: Hard code `MAX_PARTICIPANTS = 6` in server/rooms.js?
2. **Connection logging**: Add debug logging for ICE candidate types (host/srflx/relay)?

---

*Plan created: 2026-07-12*
*Branch: fix/mesh-6-person (to be created)*
*Status: Ready for implementation*