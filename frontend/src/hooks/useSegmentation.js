import { useEffect, useRef } from "react";
import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

/**
 * Runs live background segmentation on `videoRef` and draws the
 * person-only result onto `outputCanvasRef`, continuously, at camera
 * framerate. Everything happens locally via WASM/WebGL — no frame is
 * ever sent anywhere for this step.
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {React.RefObject<HTMLCanvasElement>} outputCanvasRef
 * @param {boolean} enabled
 */
export function useSegmentation(videoRef, outputCanvasRef, enabled = true) {
  const segRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    const canvas = outputCanvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");

    const segmenter = new SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    segmenter.setOptions({ modelSelection: 1 }); // 1 = landscape model, faster
    segmenter.onResults((results) => {
      canvas.width = results.image.width;
      canvas.height = results.image.height;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Use the segmentation mask to keep only the person pixels.
      ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    });
    segRef.current = segmenter;

    async function loop() {
      if (!runningRef.current) return;
      if (video.readyState >= 2) {
        await segmenter.send({ image: video });
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    runningRef.current = true;
    loop();

    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      segmenter.close();
    };
  }, [videoRef, outputCanvasRef, enabled]);
}
