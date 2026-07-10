# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Synced photo capture across all participants**: When any participant clicks "Take photos", all browsers in the room now show the same countdown (3→2→1), flash effect, and capture sequence simultaneously.
- **Decentralized capture implementation**: Each browser independently renders the final photo strip/grid using its own local composited scene (positions already synced via WebRTC signaling). No photo bytes ever touch the server — only a tiny "capture-start" signal (~bytes) is broadcast.
- **Shared result modal**: After capture completes, the final photo appears on every participant's screen with a Download button.
- **Initiator-only Retake with confirmation**: Only the participant who initiated the capture sees a Retake button. Clicking it shows a warning: "Retake photo? This photo exists only in your browser and isn't saved anywhere. Retaking will discard it permanently."

### Changed
- Refactored capture logic from `Room.jsx` into a dedicated `useCapture` hook (`frontend/src/hooks/useCapture.js`).
- Added `CaptureResultModal` component (`frontend/src/components/CaptureResultModal.jsx`) for the shared result UI.
- Server now relays `capture-start` event to all room participants (`server/src/index.js`).

### Technical Details
- Capture runs at 2× on-screen resolution (`CAPTURE_SCALE = 2`) for sharp exports.
- Countdown timing: 650ms per number (3→2→1), 500ms between shots.
- Flash animation uses existing `animate-flash` CSS class.
- Positions are synced in real-time via existing `position-update` socket events, so all browsers produce nearly-identical final images.

## [1.0.0] - 2024-01-XX

### Added
- Initial release: Online photobooth with WebRTC mesh, MediaPipe background removal, 3-photo strip / 4-photo grid layouts.
- Signaling server (Node + Express + Socket.IO) with room management, rate limiting, TTL cleanup.
- React + Vite + Tailwind frontend deployed to Vercel; signaling server on Railway/Fly.io.
- CI pipeline with GitHub Actions.