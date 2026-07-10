# PhotoBooth

An online photobooth. No sign-up — create a session, share a code, and
whoever joins shows up live in one merged frame via their webcam
(background removed client-side). Capture a 3-photo strip or 4-photo
grid, download it directly from the browser. Nothing is ever uploaded
or stored on the server.

## How it works

```
[Browser A] <--- signaling (Socket.IO) ---> [Server] <--- signaling ---> [Browser B]
[Browser A] <========= WebRTC media, peer-to-peer, encrypted =========> [Browser B]
```

- **Signaling server** (`/server`) only exchanges room membership and
  WebRTC handshake messages (SDP offers/answers, ICE candidates). It
  never sees a single video frame or photo.
- **Video** flows directly between browsers over WebRTC, encrypted
  end-to-end (DTLS-SRTP) by the protocol itself.
- **Background removal** runs per-browser via MediaPipe Selfie
  Segmentation (WASM/WebGL) — nothing is sent anywhere for this step.
- **Compositing** happens on a `<canvas>` in every participant's own
  browser; each browser renders the identical shared scene locally
  from position data synced over the signaling socket.
- **Capture & download** — the final image is assembled with
  `canvas.toBlob()` and downloaded directly. It is never sent to any
  server.
- **Rooms** live in server memory only (`server/src/rooms.js`), expire
  automatically after an hour of inactivity, and disappear the moment
  the last participant leaves.

## Security model

- **No accounts** — a room code is the only credential. Codes are
  random 5-character strings (no ambiguous characters), rate-limited
  against brute forcing (`server/src/rateLimit.js`), and rooms can be
  **locked** by the host once everyone's in.
- **No stored media** — see above; there is nothing on the server to
  breach.
- **Camera permission** is requested fresh every visit and is fully
  governed by the browser (this app doesn't and can't override it) —
  closing the tab stops the tracks and the browser's own camera
  indicator turns off. `Room.jsx` also explicitly stops all tracks on
  unmount as a belt-and-suspenders measure.
- **CORS** is locked to an explicit allow-list of origins
  (`CLIENT_ORIGINS` env var on the server).

## Project structure

```
photobooth/
├── frontend/           React + Vite + Tailwind
│   └── src/
│       ├── pages/       Landing, Room
│       ├── components/  ParticipantFeed, SessionCode, CaptureButton, LayoutPicker
│       ├── hooks/        useSocket, useWebRTC, useSegmentation
│       └── utils/        compositor.js, layouts.js
├── server/              Node + Express + Socket.IO signaling
│   └── src/
│       ├── index.js      socket event handlers
│       ├── rooms.js      in-memory room store + TTL
│       └── rateLimit.js
└── .github/workflows/    CI
```

## Local development

**Server**
```bash
cd server
cp .env.example .env
npm install
npm run dev        # http://localhost:4000
```

**Frontend**
```bash
cd frontend
cp .env.example .env
npm install
npm run dev         # http://localhost:5173
```

Open two browser windows (or one normal + one incognito, since
permissions/state are per-profile) at `localhost:5173` to test a
multi-person session on one machine.

## Deployment: staging + production, done properly

This is set up the way small professional teams run it:

### 1. Branches
- `main` → production, protected, no direct pushes
- `staging` → integration branch, auto-deploys to a staging environment
- `feature/*` → PR into `staging` → review → merge → auto-deploys to
  staging → verify → PR `staging` → `main` → deploys to production
- Tag releases on `main` with semver (`v1.0.0`, `v1.1.0`, …)

### 2. Hosting
| Piece | Where | Why |
|---|---|---|
| Frontend | **Vercel** | Free tier, auto preview deploys per PR, trivial staging/prod split via branch |
| Signaling server | **Railway** (or Fly.io) | Supports long-lived WebSocket connections — serverless platforms like plain Vercel functions don't, they time out |
| TURN server (for prod) | **Fly.io** running `coturn`, or a managed option like Metered.ca | Needed once you have real users behind restrictive NATs/firewalls; STUN alone (used in dev) isn't always enough |

Set up **two environments on each platform** — e.g. on Railway, a
`staging` service and a `production` service, each with its own env
vars (`CLIENT_ORIGINS` pointed at the matching frontend URL). Do the
same on Vercel: a `staging` branch deployment and a `main`
(production) deployment, with `VITE_SIGNALING_URL` pointed at the
matching backend.

### 3. CI
`.github/workflows/ci.yml` runs a build check on every PR and on
pushes to `staging`/`main`. Add a branch protection rule requiring
this check to pass before merge — that one setting is most of what
makes a repo feel "professional."

### 4. Secrets
Never commit `.env` files (already gitignored). Set real values
directly in the Vercel/Railway dashboards, per environment — staging
and production should generally use *different* TURN credentials and
CORS origins.

### 5. Monitoring (optional, still free-tier)
Add [Sentry](https://sentry.io) to both frontend and server for error
tracking — a few lines of setup, genuinely useful once real users hit
edge cases you didn't test locally.

## Known limitations / next steps

- Mesh WebRTC (everyone connects directly to everyone) is fine up to
  ~6 participants; beyond that you'd want an SFU (e.g. LiveKit,
  mediasoup) instead.
- No TURN server is configured by default — on some networks (strict
  corporate NATs) P2P connections will fail without one. Add TURN
  credentials via `VITE_TURN_URL`/`VITE_TURN_USERNAME`/`VITE_TURN_CREDENTIAL`
  before relying on this for real users.
- Position sync is last-write-wins over the socket — fine for this
  use case (occasional drags), not built for high-frequency sync.
