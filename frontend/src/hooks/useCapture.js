import { useState, useEffect, useCallback, useRef } from "react";
import { drawStage, assembleFinalImage, downloadCanvas } from "../utils/compositor.js";
import { LAYOUTS } from "../utils/layouts.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CAPTURE_SCALE = 2;
const SHOT_DELAY_MS = 1500; // delay between shots

export function useCapture({
  socketRef,
  selfId,
  code,
  layoutId,
  canvasMapRef,
  positionsRef,
}) {
  const [countdown, setCountdown] = useState(null);
  const [flashKey, setFlashKey] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [resultImage, setResultImage] = useState(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [showRetakeConfirm, setShowRetakeConfirm] = useState(false);
  const activeRef = useRef(false);

  const layout = LAYOUTS[layoutId] || LAYOUTS.strip3;

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    function onCaptureStart({ layout: payloadLayout, shotCount, initiatorId }) {
      if (activeRef.current) return;
      activeRef.current = true;
      const isMe = initiatorId === selfId;
      setIsInitiator(isMe);
      runCaptureSequence(payloadLayout || layoutId, shotCount || layout.shotCount);
    }

    function onCaptureRetake() {
      setResultImage(null);
      setIsInitiator(false);
      activeRef.current = false;
      setShowRetakeConfirm(false);
    }

    socket.on("capture-start", onCaptureStart);
    socket.on("capture-retake", onCaptureRetake);
    return () => {
      socket.off("capture-start", onCaptureStart);
      socket.off("capture-retake", onCaptureRetake);
    };
  }, [socketRef, selfId, layoutId, layout.shotCount]);

  const runCaptureSequence = useCallback(
    async (currentLayoutId, shotCount) => {
      setCapturing(true);
      const shots = [];
      const currentLayout = LAYOUTS[currentLayoutId] || LAYOUTS.strip3;
      const captureW = Math.round(currentLayout.slots[0].w * CAPTURE_SCALE);
      const captureH = Math.round(captureW / currentLayout.slotAspect);

      for (let i = 0; i < shotCount; i++) {
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

        if (i < shotCount - 1) {
          await sleep(SHOT_DELAY_MS);
        }
      }

      const final = assembleFinalImage(currentLayout, shots, { label: code });
      const dataUrl = final.toDataURL("image/png");
      setResultImage(dataUrl);
      setCapturing(false);
      activeRef.current = false;
    },
    [code, canvasMapRef, positionsRef]
  );

  const startCapture = useCallback(() => {
    if (capturing || activeRef.current || !selfId) return;
    const socket = socketRef.current;
    if (!socket) return;
    setIsInitiator(true);
    socket.emit("capture-start", { layout: layoutId, shotCount: layout.shotCount });
  }, [capturing, layoutId, layout.shotCount, selfId, socketRef]);

  const handleDownload = useCallback(() => {
    if (!resultImage) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      downloadCanvas(canvas, `together-booth-${code}.png`);
    };
    img.src = resultImage;
  }, [resultImage, code]);

  const requestRetake = useCallback(() => {
    setShowRetakeConfirm(true);
  }, []);

  const confirmRetake = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      socket.emit("capture-retake");
    }
    setResultImage(null);
    setIsInitiator(false);
    activeRef.current = false;
    setShowRetakeConfirm(false);
  }, [socketRef]);

  const cancelRetake = useCallback(() => {
    setShowRetakeConfirm(false);
  }, []);

  return {
    countdown,
    flashKey,
    capturing,
    imageDataUrl: resultImage,
    isInitiator,
    showRetakeConfirm,
    startCapture,
    handleDownload,
    requestRetake,
    confirmRetake,
    cancelRetake,
  };
}