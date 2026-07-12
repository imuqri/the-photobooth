# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.3] - 2026-07-12

### Fixed
- **Mesh WebRTC connection (3+ users)**: Fixed one-way connection issue where 3rd+ participant could see earlier users but earlier users couldn't see them. Root cause: only the *joiner* initiated WebRTC handshakes.
  - Server now emits `connect-to-new-peer` event so existing users also initiate connections TO new joiners (bidirectional mesh)
  - Client handles `connect-to-new-peer` to connect back to new peer
  - Added glare prevention: deterministic tiebreaker (lexicographically greater socketId initiates) prevents both sides creating offers simultaneously
  - Added connection guards to prevent duplicate connections
  - Added ICE restart on connection failure for automatic recovery
  - Fixed `InvalidStateError: Called in wrong state: stable` by checking `signalingState` before setting remote answer

### Changed
- `server/src/index.js` — emit `connect-to-new-peer` on join with existing peers list
- `frontend/src/hooks/useWebRTC.js` — handle `connect-to-new-peer`, add glare tiebreaker, connection guards, ICE restart, signalingState check

## [1.1.2] - 2026-07-12

### Fixed
- **Close button on capture result modal**: Fixed "Close" button not working after photo capture. The `CaptureResultModal` expected an `onClose` callback but `Room.jsx` wasn't passing it. Added `closeResult` function to `useCapture` hook that clears the captured image state, and wired it through to the modal's `onClose` prop.

### Changed
- `frontend/src/hooks/useCapture.js` — added `closeResult` function to clear capture state
- `frontend/src/pages/Room.jsx` — pass `closeResult` as `onClose` to `CaptureResultModal`

## [1.1.1] - 2026-07-10

### Fixed
- **MediaPipe Selfie Segmentation loading**: Fixed "SelfieSegmentation is not a constructor" error by loading MediaPipe via CDN script tag (importmap) instead of bundling with Vite. MediaPipe is designed to load as a global from CDN.
- **Vite configuration**: Externalized `@mediapipe/selfie_segmentation` from bundle, added proper build config for production deployment.
- **SPA routing on Vercel**: Added `vercel.json` with rewrite rules so `/room/:code` routes work correctly (was returning 404).
- **Environment variable handling**: Properly configured `VITE_SIGNALING_URL` in Vercel production environment.

### Changed
- `frontend/vite.config.js` — simplified config, externalized MediaPipe
- `frontend/index.html` — added importmap + script tag for MediaPipe CDN
- `frontend/src/hooks/useSegmentation.js` — use `window.SelfieSegmentation` global
- `frontend/vercel.json` — added SPA rewrite rules

## [1.1.0] - 2026-07-10

### Added
- **Synced photo capture across all participants**: When any participant clicks "Take photos", all browsers in the room now show the same countdown (3→2→1), flash effect, and capture sequence simultaneously.
- **Decentralized capture implementation**: Each browser independently renders the final photo strip/grid using its own local composited scene (positions already synced via WebRTC signaling). No photo bytes ever touch the server — only a tiny "capture-start" signal (~bytes) is broadcast.
- **Shared result modal**: After capture completes, the final photo appears on every participant's screen with a Download button.
- **Initiator-only Retake with confirmation**: Only the participant who initiated the capture sees a Retake button. Clicking it shows a custom confirmation modal (not browser alert): "Retake photo? This photo exists only in your browser and isn't saved anywhere. Retaking will discard it permanently — everyone's result popup will close and a new capture sequence will begin."
- **Synced retake across all browsers**: When initiator confirms retake, a `capture-retake` signal is broadcast to all participants, closing their result modals immediately.
- **Custom RetakeConfirmModal component** (`frontend/src/components/RetakeConfirmModal.jsx`) with styled UI matching the app's design system.

### Changed
- Refactored capture logic from `Room.jsx` into a dedicated `useCapture` hook (`frontend/src/hooks/useCapture.js`).
- Added `CaptureResultModal` component (`frontend/src/components/CaptureResultModal.jsx`) for the shared result UI.
- Server now relays `capture-start` and `capture-retake` events to all room participants (`server/src/index.js`).
- Increased delay between shots from 500ms to 1500ms for a more natural capture rhythm.

### Technical Details
- Capture runs at 2× on-screen resolution (`CAPTURE_SCALE = 2`) for sharp exports.
- Countdown timing: 650ms per number (3→2→1), 1500ms between shots.
- Flash animation uses existing `animate-flash` CSS class.
- Positions are synced in real-time via existing `position-update` socket events, so all browsers produce nearly-identical final images.
- New socket events: `capture-start` (broadcast to room), `capture-retake` (broadcast to room).

## [1.0.0] - 2024-01-XX

### Added
- Initial release: Online photobooth with WebRTC mesh, MediaPipe background removal, 3-photo strip / 4-photo grid layouts.
- Signaling server (Node + Express + Socket.IO) with room management, rate limiting, TTL cleanup.
- React + Vite + Tailwind frontend deployed to Vercel; signaling server on Railway/Fly.io.
- CI pipeline with GitHub Actions.