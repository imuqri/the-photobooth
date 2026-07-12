# LiveKit Migration Plan

## Overview
Migrate from custom WebRTC mesh (Socket.io signaling + full mesh P2P) to LiveKit SFU architecture.

**Current State**: Custom signaling server (Railway) + `useWebRTC` hook (full mesh O(N²))
**Target State**: LiveKit Cloud Free Tier + `@livekit/components-react` (SFU O(N))
**Estimated Effort**: 2.5-3 hours
**Cost**: $0/month (LiveKit Cloud Free Tier: 100 participants/mo, 10GB egress)

---

## Architecture Comparison

| Aspect | Current (Mesh) | LiveKit (SFU) |
|--------|---------------|---------------|
| Connections | N×(N-1)/2 (15 at 6 users) | 2N (12 at 6 users) |
| Bandwidth/client | O(N²) | O(N) |
| NAT traversal | Google STUN only | Built-in global TURN |
| Mobile reliability | ~70% (no TURN) | ~99% (TURN + simulcast) |
| Server code | ~300 lines custom | ~50 lines token endpoint |
| Client code | ~200 lines useWebRTC | ~100 lines useLiveKit |
| Scaling | Breaks at ~6 | Scales to 100+ |
| Recording | Not supported | Server-side egress |

---

## Phase 1: LiveKit Cloud Setup (15 min)

### 1.1 Create Account
- [ ] Sign up at https://cloud.livekit.io
- [ ] Create project (name: "photobooth")
- [ ] Note credentials:
  - `Project ID`
  - `API Key` (format: `APIxxxxxx`)
  - `API Secret`
  - `WS URL` (format: `wss://project-name.livekit.cloud`)

### 1.2 Configure Allowed Origins
In LiveKit Cloud Dashboard → Project Settings:
- [ ] Add `https://your-app.vercel.app`
- [ ] Add `http://localhost:5173` (dev)
- [ ] Add any preview deployment URLs

### 1.3 Verify Free Tier
- [ ] Confirm dashboard shows: 100 participants/month, 10GB egress
- [ ] Note: 1 session (6 users × 5 min) = ~30 participant-minutes
- [ ] Free tier supports ~200 sessions/month

---

## Phase 2: Backend Token Service (Railway) (30 min)

### 2.1 Add Dependency
```bash
cd server
npm install livekit-server-sdk
```

### 2.2 Create Token Utility
**File**: `server/src/token.js` (new)

```javascript
import { AccessToken } from 'livekit-server-sdk';

export function createLiveKitToken(roomName, participantIdentity, grants = {}) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set');
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    ttl: '2h',
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true, // For future position sync via data channels
    ...grants,
  });

  return at.toJwt();
}
```

### 2.3 Add Token Endpoint
**File**: `server/src/index.js` (modify)

```javascript
// Add import
import { createLiveKitToken } from './token.js';

// Add after health check endpoint
app.post('/get-token', express.json(), (req, res) => {
  const { room, name } = req.body;
  
  if (!room || !name) {
    return res.status(400).json({ error: 'room and name required' });
  }
  
  const ip = req.ip;
  if (!allow(`token:${ip}`, 30, 60_000)) {
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }
  
  try {
    const token = createLiveKitToken(room.toUpperCase(), name);
    res.json({ 
      token, 
      url: process.env.LIVEKIT_URL 
    });
  } catch (err) {
    console.error('Token generation failed:', err);
    res.status(500).json({ error: 'TOKEN_GENERATION_FAILED' });
  }
});
```

### 2.4 Railway Environment Variables
| Variable | Value | Source |
|----------|-------|--------|
| `LIVEKIT_API_KEY` | `APIxxxxxx` | LiveKit Cloud Dashboard |
| `LIVEKIT_API_SECRET` | `xxxxxxxxxxxx` | LiveKit Cloud Dashboard |
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` | LiveKit Cloud Dashboard |

---

## Phase 3: Frontend Integration (90 min)

### 3.1 Install Dependencies
```bash
cd frontend
npm install livekit-client @livekit/components-react
```

### 3.2 Create Token Hook
**File**: `frontend/src/hooks/useToken.js` (new)

```javascript
import { useState, useEffect, useCallback } from 'react';

export function useToken(roomName, participantName) {
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchToken = useCallback(async () => {
    if (!roomName || !participantName) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch(`${import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000'}/get-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomName, name: participantName }),
      });
      
      if (!res.ok) throw new Error(await res.text());
      
      const data = await res.json();
      setToken(data.token);
    } catch (err) {
      setError(err.message);
      console.error('Token fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [roomName, participantName]);

  useEffect(() => { fetchToken(); }, [fetchToken]);

  return { token, loading, error, fetchToken };
}
```

### 3.3 Create LiveKit Hook
**File**: `frontend/src/hooks/useLiveKit.js` (new)

```javascript
import { useMemo, useCallback, useEffect, useState } from 'react';
import { Room, RoomEvent, Track, RemoteVideoTrack, LocalVideoTrack } from 'livekit-client';
import { useToken } from './useToken';

export function useLiveKit({ roomName, participantName }) {
  const [room, setRoom] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  const { token, loading: tokenLoading, fetchToken } = useToken(roomName, participantName);

  useEffect(() => {
    if (!token || tokenLoading) return;
    
    const r = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        videoSimulcast: true,
        videoCodec: 'vp8',
      },
    });

    const updateRemoteStreams = () => {
      const streams = {};
      for (const [, participant] of r.remoteParticipants) {
        for (const [, publication] of participant.trackPublications) {
          if (publication.track instanceof RemoteVideoTrack) {
            const stream = new MediaStream();
            stream.addTrack(publication.track.mediaStreamTrack);
            streams[participant.identity] = stream;
            break;
          }
        }
      }
      setRemoteStreams(streams);
    };

    r.on(RoomEvent.TrackSubscribed, updateRemoteStreams);
    r.on(RoomEvent.TrackUnsubscribed, updateRemoteStreams);
    r.on(RoomEvent.ParticipantDisconnected, updateRemoteStreams);
    r.on(RoomEvent.Connected, () => setIsConnected(true));
    r.on(RoomEvent.Disconnected, () => setIsConnected(false));

    r.connect(process.env.VITE_LIVEKIT_URL || 'wss://your-project.livekit.cloud', token)
      .catch((err) => {
        console.error('LiveKit connection failed:', err);
        setError(err.message);
      });

    setRoom(r);
    return () => {
      r.off(RoomEvent.TrackSubscribed, updateRemoteStreams);
      r.off(RoomEvent.TrackUnsubscribed, updateRemoteStreams);
      r.off(RoomEvent.ParticipantDisconnected, updateRemoteStreams);
      r.disconnect();
    };
  }, [token, tokenLoading]);

  useEffect(() => {
    if (!room || !isConnected) return;
    
    let cancelled = false;
    
    async function publishCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: 'user' },
          audio: false,
        });
        
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        const track = LocalVideoTrack.createVideoTrack('camera', stream.getVideoTracks()[0]);
        setLocalVideoTrack(track);
        
        await room.localParticipant.publishTrack(track, {
          name: 'camera',
          simulcast: true,
        });
      } catch (err) {
        console.error('Failed to publish camera:', err);
        setError('Camera access denied');
      }
    }
    
    publishCamera();
    return () => { cancelled = true; };
  }, [room, isConnected]);

  const connect = useCallback(async () => {
    if (room && !isConnected) {
      await room.connect(process.env.VITE_LIVEKIT_URL, token);
    }
  }, [room, isConnected, token]);

  const disconnect = useCallback(async () => {
    if (room) {
      await room.disconnect();
    }
  }, [room]);

  return {
    room,
    remoteStreams,
    localVideoTrack,
    localStream: localVideoTrack ? new MediaStream([localVideoTrack.mediaStreamTrack]) : null,
    connect,
    disconnect,
    isConnected,
    error,
  };
}
```

### 3.4 Update Room.jsx
**File**: `frontend/src/pages/Room.jsx` (major refactor)

#### Remove:
- [ ] `import { useSocket } from '../hooks/useSocket'`
- [ ] `import { useWebRTC } from '../hooks/useWebRTC'`
- [ ] `useSocket` call and `connected` state
- [ ] `useWebRTC` call and `connectToPeer` logic
- [ ] Entire "2. Join the room" useEffect (lines ~80-107)
- [ ] Entire "3. Track room membership" useEffect (lines ~109-143)
- [ ] `peer-joined`, `peer-left`, `peer-position` socket listeners

#### Add:
```javascript
import { useLiveKit } from '../hooks/useLiveKit';
```

```javascript
// Replace WebRTC logic:
const participantName = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const { 
  remoteStreams, 
  localStream,
  isConnected, 
  error: liveKitError 
} = useLiveKit({ 
  roomName: code, 
  participantName 
});

// Merge local stream into remoteStreams for rendering
const allStreams = useMemo(() => ({
  ...remoteStreams,
  [selfId]: localStream
}), [remoteStreams, localStream, selfId]);
```

#### Update Render:
```javascript
// Old:
{Object.entries(allStreams).map(([id, stream]) => (
  <ParticipantFeed key={id} socketId={id} stream={stream} ... />
))}

// New - same format, works unchanged
```

#### Keep Unchanged:
- [ ] Camera access effect (lines ~60-78) - but move into `useLiveKit` or keep for local preview
- [ ] `ParticipantFeed` component - receives `stream` prop, works with MediaStream
- [ ] `drawStage` / `compositor.js` - unchanged
- [ ] `useCapture` hook - unchanged (operates on local canvas)
- [ ] Layout picker, capture button, result modal - unchanged

### 3.5 Frontend Environment Variables
**Local**: `frontend/.env`
```
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_SIGNALING_URL=http://localhost:4000
```

**Vercel Dashboard** → Project Settings → Environment Variables:
- [ ] `VITE_LIVEKIT_URL` = `wss://your-project.livekit.cloud`
- [ ] `VITE_SIGNALING_URL` = `https://your-api.railway.app`

---

## Phase 4: Cleanup (15 min)

### 4.1 Delete Server Files
- [ ] `server/src/rooms.js`
- [ ] `server/src/rateLimit.js` (or keep if used elsewhere)
- [ ] `server/src/index.js` → reduce to only `/health` and `/get-token`

### 4.2 Delete Frontend Hooks
- [ ] `frontend/src/hooks/useWebRTC.js`
- [ ] `frontend/src/hooks/useSocket.js`

### 4.3 Keep Frontend Utils
- [ ] `frontend/src/utils/compositor.js` - **KEEP** (used by capture)
- [ ] `frontend/src/utils/layouts.js` - **KEEP**

### 4.4 Update Vercel Config
**File**: `frontend/vercel.json`
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite"
}
```

---

## Phase 5: Testing Checklist (30 min)

### Local Development
- [ ] Start server: `cd server && npm run dev`
- [ ] Start frontend: `cd frontend && npm run dev`
- [ ] Open 3+ incognito tabs to same room
- [ ] Verify all see each other immediately (no refresh)
- [ ] Test mobile: Chrome Android + Safari iOS
- [ ] Test position dragging sync
- [ ] Test capture: 3-photo strip + 4-photo grid
- [ ] Test retake flow
- [ ] Test leave/rejoin

### Production
- [ ] Push to Railway (server auto-deploys)
- [ ] Push to Vercel (frontend auto-deploys)
- [ ] Test cross-origin (Vercel → Railway token fetch)
- [ ] Test with 6 users across devices

---

## Future: Self-Hosting on Your VM

When ready to self-host (zero cloud cost):

### Docker Compose Stack
```yaml
# docker-compose.yml
services:
  livekit:
    image: livekit/livekit-server:latest
    ports: ["7880:7880", "7881:7881"]
    env_file: .env
    depends_on: [redis, postgres]
    restart: unless-stopped
  
  redis:
    image: redis:7-alpine
    restart: unless-stopped
  
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: livekit
      POSTGRES_USER: livekit
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
  
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    command: >
      -n --lt-cred-mech
      --realm=yourdomain.com
      --user=user:pass
      --external-ip=YOUR_VPS_IP
    restart: unless-stopped

volumes:
  postgres_data:
```

### Migration Steps
1. [ ] Provision VPS (Hetzner CX22 ~€5/mo or your VirtualBox)
2. [ ] Deploy Docker stack
3. [ ] Configure domain + Let's Encrypt TLS
4. [ ] Update `VITE_LIVEKIT_URL` to `wss://your-domain.com`
5. [ ] Update Railway token endpoint to use self-hosted API keys

---

## Rollback Plan

If issues arise during migration:
1. `git revert` to pre-migration commit
2. Feature flag approach: Keep old `useWebRTC` alongside new `useLiveKit`
3. Toggle via env var: `VITE_USE_LIVEKIT=true/false`

---

## Open Decisions (Confirm Before Implementation)

1. **Participant identity format**: `user-${shortId}` or `name-${socketId}`?
2. **Position sync**: 
   - Keep HTTP POST to Railway (simple)
   - Migrate to LiveKit data channels (`canPublishData: true`)
3. **Room code format**: Current 6-char uppercase (e.g., `ABC123`) → use directly as LiveKit room name?
4. **Room cleanup**: LiveKit auto-deletes empty rooms after 10s. Keep Railway room manager for session codes?
5. **Recording (future)**: Enable `canPublishData: true` now for future egress support?

---

## File Summary

### New Files
- `server/src/token.js`
- `frontend/src/hooks/useToken.js`
- `frontend/src/hooks/useLiveKit.js`

### Modified Files
- `server/src/index.js` (add `/get-token` endpoint)
- `frontend/src/pages/Room.jsx` (replace WebRTC with LiveKit)
- `frontend/vercel.json` (simplify)
- `server/.env` / Railway env vars (add LiveKit credentials)
- `frontend/.env` / Vercel env vars (add LiveKit URL)

### Deleted Files
- `server/src/rooms.js`
- `server/src/rateLimit.js` (optional)
- `frontend/src/hooks/useWebRTC.js`
- `frontend/src/hooks/useSocket.js`

---

## Estimated Timeline

| Phase | Time |
|-------|------|
| LiveKit Cloud Setup | 15 min |
| Backend Token Service | 30 min |
| Frontend Hooks + Room.jsx | 90 min |
| Testing | 30 min |
| Cleanup | 15 min |
| **Total** | **~2.75 hours** |

---

*Generated: 2026-07-12*
*Project: photobooth*
*Status: Planning phase - not yet implemented*