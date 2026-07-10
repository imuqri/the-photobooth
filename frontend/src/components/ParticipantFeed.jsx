import { useEffect, useRef } from "react";
import { useSegmentation } from "../hooks/useSegmentation.js";

/**
 * Invisible worker component: plays a participant's raw stream into a
 * <video>, runs background segmentation on it, and hands the resulting
 * canvas element up to the parent for stage compositing. Nothing here
 * is rendered visibly — the visible result is drawn by Room's stage
 * canvas, which reads these canvases every frame.
 */
export default function ParticipantFeed({ socketId, stream, onCanvasReady, onUnmount }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
  }, [stream]);

  useSegmentation(videoRef, canvasRef, true);

  useEffect(() => {
    if (canvasRef.current) onCanvasReady(socketId, canvasRef.current);
    return () => onUnmount(socketId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketId]);

  return (
    <div style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden>
      <video ref={videoRef} muted playsInline />
      <canvas ref={canvasRef} />
    </div>
  );
}
