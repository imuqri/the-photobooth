import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import {
  createRoom,
  getRoom,
  joinRoom,
  leaveRoom,
  setLocked,
  updatePosition,
  roomSummary,
  config as roomConfig,
} from "./rooms.js";
import { allow } from "./rateLimit.js";

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = (process.env.CLIENT_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim());

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Simple health check — useful for Railway/Fly.io/Render health probes
app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Root endpoint — show server status
app.get("/", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Photobooth Signaling Server</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .status { padding: 20px; border-radius: 8px; background: #dcfce7; color: #166534; }
    .info { margin-top: 20px; padding: 15px; background: #f3f4f6; border-radius: 8px; }
    h1 { color: #1f2937; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🎭 Photobooth Signaling Server</h1>
  <div class="status">✅ Server is running</div>
  <div class="info">
    <p><strong>WebSocket endpoint:</strong> <code>ws://localhost:${PORT}/socket.io/</code></p>
    <p><strong>Health check:</strong> <code>/health</code></p>
    <p><strong>Allowed origins:</strong> ${ALLOWED_ORIGINS.join(", ")}</p>
    <p><strong>Uptime:</strong> ${Math.floor(process.uptime())}s</p>
  </div>
</body>
</html>
  `);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  const ip = socket.handshake.address;

  // ---- Create a room ----
  socket.on("create-room", (payload, callback) => {
    if (!allow(`create:${ip}`, 10, 60_000)) {
      return callback?.({ error: "RATE_LIMITED" });
    }
    const layout = payload?.layout === "grid4" ? "grid4" : "strip3";
    const room = createRoom(socket.id, layout);
    socket.join(room.code);
    callback?.({ room: roomSummary(room) });
  });

  // ---- Join an existing room ----
  socket.on("join-room", (payload, callback) => {
    if (!allow(`join:${ip}`, 20, 60_000)) {
      return callback?.({ error: "RATE_LIMITED" });
    }
    const code = String(payload?.code || "").toUpperCase();
    const result = joinRoom(code, socket.id);
    if (result.error) return callback?.({ error: result.error });

    socket.join(code);
    socket.data.roomCode = code;

    // Tell existing participants a new peer arrived so they can start
    // a WebRTC handshake with it.
    socket.to(code).emit("peer-joined", { socketId: socket.id });

    // Tell existing participants to ALSO connect TO the new peer
    // (bidirectional mesh: joiner connects to existing, existing connects to joiner)
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

    // Send current positions of all existing participants to the new user
    // so they render at correct positions immediately
    const room = getRoom(code);
    if (room) {
      for (const [pid, participant] of room.participants) {
        if (pid !== socket.id) {
          socket.emit("peer-position", {
            socketId: pid,
            position: participant.position,
          });
        }
      }
    }

    callback?.({ room: roomSummary(result.room), selfId: socket.id });
  });

  // ---- Lock / unlock (host only) ----
  socket.on("lock-room", ({ locked }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return; // only host can lock
    setLocked(code, !!locked);
    io.to(code).emit("room-locked", { locked: !!locked });
  });

  // ---- WebRTC signaling relay (offer / answer / ICE candidates) ----
  // The server never inspects this payload's meaning — it's opaque
  // handshake data, forwarded verbatim to the intended peer only.
  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // ---- Live framing position sync (drag-to-fit) ----
  socket.on("position-update", (position) => {
    const code = socket.data.roomCode;
    if (!code) return;
    updatePosition(code, socket.id, position);
    socket.to(code).emit("peer-position", { socketId: socket.id, position });
  });

  // ---- Capture start broadcast ----
  // Initiator sends layout + shotCount; server broadcasts to all in room
  // including initiator so everyone runs identical local capture sequence.
  socket.on("capture-start", ({ layout, shotCount }) => {
    const code = socket.data.roomCode;
    if (!code) return;
    io.to(code).emit("capture-start", { layout, shotCount, initiatorId: socket.id });
  });

  // ---- Capture retake broadcast ----
  // Initiator confirms retake; server broadcasts to all in room to close result modals.
  socket.on("capture-retake", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    io.to(code).emit("capture-retake", { initiatorId: socket.id });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = leaveRoom(code, socket.id);
    io.to(code).emit("peer-left", { socketId: socket.id });
    if (room) {
      // if host changed, let everyone know
      io.to(code).emit("host-changed", { hostSocketId: room.hostSocketId });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on :${PORT}`);
  console.log(`Allowed client origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`Max participants/room: ${roomConfig.MAX_PARTICIPANTS}`);
});
