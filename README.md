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



