import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket.js";
import { useWebRTC } from "../hooks/useWebRTC.js";
import ParticipantFeed from "../components/ParticipantFeed.jsx";
import SessionCode from "../components/SessionCode.jsx";
import CaptureButton from "../components/CaptureButton.jsx";
import { LAYOUTS } from "../utils/layouts.js";
import { drawStage, assembleFinalImage, downloadCanvas } from "../utils/compositor.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CAPTURE_SCALE = 2; // render captures at 2x the on-screen stage for a sharp export

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { socketRef, connected } = useSocket();

  const [localStream, setLocalStream] = useState(null);
  const [mediaError, setMediaError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [selfId, setSelfId] = useState(null);
  const [layoutId, setLayoutId] = useState("strip3");
  const [locked, setLocked] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [peerIds, setPeerIds] = useState([]); // remote participant socketIds
  const [countdown, setCountdown] = useState(null);
  const [flashKey, setFlashKey] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [resultCanvas, setResultCanvas] = useState(null);
  const [scale, setScale] = useState(1);

  const stageCanvasRef = useRef(null);
  const canvasMapRef = useRef(new Map()); // socketId -> segmented <canvas>
  const positionsRef = useRef(new Map()); // socketId -> { x, y, scale }
  const draggingRef = useRef(null);
  const lastEmitRef = useRef(0);
  const rafRef = useRef(null);

  const { remoteStreams, connectToPeer } = useWebRTC(socketRef, localStream);

  // ---- 1. Get camera access. Fresh every visit — the browser handles revocation on tab close. ----
  useEffect(() => {
    let activeStream;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((stream) => {
        activeStream = stream;
        setLocalStream(stream);
      })
      .catch(() => {
        setMediaError(
          "We need camera access to put you in the frame. Please allow it and reload."
        );
      });

    return () => {
      activeStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---- 2. Join the room once socket + camera are ready ----
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected || !localStream) return;

    socket.emit("join-room", { code }, (res) => {
      if (res?.error) {
        setJoinError(readableJoinError(res.error));
        return;
      }
      setSelfId(res.selfId);
      setLayoutId(res.room.layout);
      setLocked(res.room.locked);
      setIsHost(res.room.hostSocketId === res.selfId);

      const others = res.room.participants.filter((p) => p.socketId !== res.selfId);
      setPeerIds(others.map((p) => p.socketId));
      for (const p of others) {
        positionsRef.current.set(p.socketId, p.position);
        connectToPeer(p.socketId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, localStream, code]);

  // ---- 3. Track room membership + sync events ----
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    function onPeerJoined({ socketId }) {
      setPeerIds((prev) => (prev.includes(socketId) ? prev : [...prev, socketId]));
    }
    function onPeerLeft({ socketId }) {
      setPeerIds((prev) => prev.filter((id) => id !== socketId));
      canvasMapRef.current.delete(socketId);
      positionsRef.current.delete(socketId);
    }
    function onPeerPosition({ socketId, position }) {
      positionsRef.current.set(socketId, position);
    }
    function onRoomLocked({ locked }) {
      setLocked(locked);
    }
    function onHostChanged({ hostSocketId }) {
      setIsHost(hostSocketId === selfId);
    }

    socket.on("peer-joined", onPeerJoined);
    socket.on("peer-left", onPeerLeft);
    socket.on("peer-position", onPeerPosition);
    socket.on("room-locked", onRoomLocked);
    socket.on("host-changed", onHostChanged);
    return () => {
      socket.off("peer-joined", onPeerJoined);
      socket.off("peer-left", onPeerLeft);
      socket.off("peer-position", onPeerPosition);
      socket.off("room-locked", onRoomLocked);
      socket.off("host-changed", onHostChanged);
    };
  }, [socketRef, selfId]);

  const layout = LAYOUTS[layoutId] || LAYOUTS.strip3;

  // ---- 4. Canvas registry from ParticipantFeed instances ----
  const registerCanvas = useCallback((id, canvasEl) => {
    canvasMapRef.current.set(id, canvasEl);
    if (!positionsRef.current.has(id)) {
      const n = canvasMapRef.current.size;
      positionsRef.current.set(id, { x: 0.3 + 0.4 * ((n - 1) % 3) / 2, y: 0.55, scale: 1 });
    }
  }, []);
  const unregisterCanvas = useCallback((id) => {
    canvasMapRef.current.delete(id);
    positionsRef.current.delete(id);
  }, []);

  // ---- 5. Live stage render loop ----
  useEffect(() => {
    const canvas = stageCanvasRef.current;
    if (!canvas || !selfId) return;
    const ctx = canvas.getContext("2d");
    const width = 720;
    const height = Math.round(width / layout.slotAspect);
    canvas.width = width;
    canvas.height = height;

    function tick() {
      const participants = [];
      for (const [id, c] of canvasMapRef.current) {
        participants.push({ canvas: c, position: positionsRef.current.get(id) });
      }
      drawStage(ctx, width, height, { backdrop: { type: "gradient" }, participants });
      rafRef.current = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [selfId, layout.slotAspect]);

  // ---- 6. Drag-to-position (only your own tile) ----
  function selfBounds() {
    const canvas = stageCanvasRef.current;
    const srcCanvas = canvasMapRef.current.get(selfId);
    const pos = positionsRef.current.get(selfId);
    if (!canvas || !srcCanvas || !pos || !srcCanvas.width) return null;
    const aspect = srcCanvas.width / srcCanvas.height;
    const renderH = canvas.height * 0.92 * pos.scale;
    const renderW = renderH * aspect;
    const cx = pos.x * canvas.width;
    const cy = pos.y * canvas.height;
    return { left: cx - renderW / 2, right: cx + renderW / 2, top: cy - renderH / 2, bottom: cy + renderH / 2 };
  }

  function pointerToNorm(e) {
    const rect = stageCanvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * stageCanvasRef.current.width;
    const y = ((e.clientY - rect.top) / rect.height) * stageCanvasRef.current.height;
    return { x, y };
  }

  function onPointerDown(e) {
    if (!selfId) return;
    const { x, y } = pointerToNorm(e);
    const b = selfBounds();
    if (!b || x < b.left || x > b.right || y < b.top || y > b.bottom) return;
    draggingRef.current = true;
    e.target.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!draggingRef.current || !selfId) return;
    const canvas = stageCanvasRef.current;
    const { x, y } = pointerToNorm(e);
    const nx = Math.min(0.95, Math.max(0.05, x / canvas.width));
    const ny = Math.min(0.95, Math.max(0.05, y / canvas.height));
    const prev = positionsRef.current.get(selfId) || { scale: 1 };
    const next = { ...prev, x: nx, y: ny };
    positionsRef.current.set(selfId, next);

    const now = performance.now();
    if (now - lastEmitRef.current > 50) {
      lastEmitRef.current = now;
      socketRef.current?.emit("position-update", next);
    }
  }

  function onPointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const pos = positionsRef.current.get(selfId);
    if (pos) socketRef.current?.emit("position-update", pos);
  }

  function onScaleChange(e) {
    const value = Number(e.target.value);
    setScale(value);
    const prev = positionsRef.current.get(selfId) || { x: 0.5, y: 0.5 };
    const next = { ...prev, scale: value };
    positionsRef.current.set(selfId, next);
    socketRef.current?.emit("position-update", next);
  }

  // ---- 7. Capture flow ----
  async function handleCapture() {
    if (capturing) return;
    setCapturing(true);
    const shots = [];
    const captureW = Math.round(layout.slots[0].w * CAPTURE_SCALE);
    const captureH = Math.round(captureW / layout.slotAspect);

    for (let i = 0; i < layout.shotCount; i++) {
      for (const n of [3, 2, 1]) {
        setCountdown(n);
        await sleep(650);
      }
      setCountdown(null);
      setFlashKey((k) => k + 1);

      const shotCanvas = document.createElement("canvas");
      shotCanvas.width = captureW;
      shotCanvas.height = captureH;
      const ctx = shotCanvas.getContext("2d");
      const participants = [];
      for (const [id, c] of canvasMapRef.current) {
        participants.push({ canvas: c, position: positionsRef.current.get(id) });
      }
      drawStage(ctx, captureW, captureH, { backdrop: { type: "gradient" }, participants });
      shots.push(shotCanvas);

      await sleep(500);
    }

    const final = assembleFinalImage(layout, shots, { label: code });
    setResultCanvas(final);
    setCapturing(false);
  }

  function toggleLock() {
    const next = !locked;
    setLocked(next);
    socketRef.current?.emit("lock-room", { locked: next });
  }

  function leaveRoom() {
    navigate("/");
  }

  // ---- Render states ----
  if (mediaError) return <CenteredMessage title="Camera blocked" body={mediaError} />;
  if (joinError) return <CenteredMessage title="Can't join" body={joinError} onBack={() => navigate("/")} />;

  const allStreams = { ...(selfId ? { [selfId]: localStream } : {}), ...remoteStreams };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 gap-6">
      {Object.entries(allStreams).map(([id, stream]) => (
        <ParticipantFeed
          key={id}
          socketId={id}
          stream={stream}
          onCanvasReady={registerCanvas}
          onUnmount={unregisterCanvas}
        />
      ))}

      <SessionCode code={code} />

      <div className="flex items-center gap-4 text-sm font-mono text-booth-muted">
        <span>{1 + peerIds.length} in frame</span>
        <span>·</span>
        <span>{layout.label}</span>
        {isHost && (
          <>
            <span>·</span>
            <button onClick={toggleLock} className="underline hover:text-booth-paper">
              {locked ? "Unlock room" : "Lock room"}
            </button>
          </>
        )}
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
        <canvas
          ref={stageCanvasRef}
          className="touch-none max-w-[92vw] block"
          style={{ width: 720, aspectRatio: layout.slotAspect }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        <div
          key={flashKey}
          className={flashKey ? "absolute inset-0 bg-white pointer-events-none animate-flash" : "hidden"}
        />
        {!selfId && (
          <div className="absolute inset-0 flex items-center justify-center bg-booth-bg/70 text-booth-muted font-mono text-sm">
            Connecting…
          </div>
        )}
      </div>

      <p className="text-xs text-booth-muted font-mono">
        Drag yourself to reposition · use the slider to resize
      </p>

      <div className="flex items-center gap-3 w-72">
        <span className="text-xs font-mono text-booth-muted">Size</span>
        <input
          type="range"
          min="0.5"
          max="1.6"
          step="0.02"
          value={scale}
          onChange={onScaleChange}
          className="w-full accent-booth-shutter"
        />
      </div>

      <CaptureButton
        onClick={handleCapture}
        disabled={capturing || !selfId}
        countdown={countdown}
        shotLabel={capturing ? "Hold still…" : `Take ${layout.shotCount} photos`}
      />

      <button onClick={leaveRoom} className="text-xs text-booth-muted hover:text-booth-paper underline">
        Leave session
      </button>

      {resultCanvas && (
        <ResultOverlay
          canvas={resultCanvas}
          onDownload={() => downloadCanvas(resultCanvas, `together-booth-${code}.png`)}
          onRetake={() => setResultCanvas(null)}
        />
      )}
    </div>
  );
}

function ResultOverlay({ canvas, onDownload, onRetake }) {
  const [dataUrl] = useState(() => canvas.toDataURL("image/png"));
  return (
    <div className="fixed inset-0 bg-black/85 flex flex-col items-center justify-center gap-5 p-6 z-50">
      <img src={dataUrl} alt="Your photobooth strip" className="max-h-[70vh] rounded-lg shadow-2xl" />
      <p className="text-xs font-mono text-booth-muted text-center max-w-sm">
        This never touched our server — it exists only in your browser. Download it now; closing this
        won't save a copy anywhere.
      </p>
      <div className="flex gap-3">
        <button
          onClick={onDownload}
          className="px-6 py-3 rounded-xl bg-booth-shutter text-booth-paper font-display text-lg tracking-wide"
        >
          Download
        </button>
        <button
          onClick={onRetake}
          className="px-6 py-3 rounded-xl bg-booth-surface2 border border-white/15 text-booth-paper font-display text-lg tracking-wide"
        >
          Retake
        </button>
      </div>
    </div>
  );
}

function CenteredMessage({ title, body, onBack }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-4">
      <h2 className="font-display text-4xl text-booth-paper">{title}</h2>
      <p className="text-booth-muted max-w-sm">{body}</p>
      {onBack && (
        <button onClick={onBack} className="text-sm underline text-booth-muted hover:text-booth-paper">
          Back to start
        </button>
      )}
    </div>
  );
}

function readableJoinError(code) {
  switch (code) {
    case "NOT_FOUND":
      return "That session code doesn't exist — check with whoever invited you, or it may have expired.";
    case "LOCKED":
      return "This session is locked and isn't accepting new people right now.";
    case "FULL":
      return "This session is full.";
    case "RATE_LIMITED":
      return "Too many attempts — wait a minute and try again.";
    default:
      return "Something went wrong joining this session.";
  }
}
