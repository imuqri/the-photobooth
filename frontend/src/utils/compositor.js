// Pure canvas compositing. Nothing here ever leaves the browser.

export function drawBackdrop(ctx, w, h, backdrop) {
  if (backdrop?.type === "solid") {
    ctx.fillStyle = backdrop.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // default: soft paper gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, backdrop?.from || "#3A362F");
  g.addColorStop(1, backdrop?.to || "#1B1A17");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Draws one participant's already-background-removed canvas onto the
 * shared stage at their chosen position/scale.
 * position: { x, y, scale } all normalized 0–1 (x,y = center point, scale relative to a base size)
 */
function drawParticipant(ctx, stageW, stageH, sourceCanvas, position) {
  if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return;
  const aspect = sourceCanvas.width / sourceCanvas.height;
  const baseHeight = stageH * 0.92;
  const renderH = baseHeight * (position?.scale ?? 1);
  const renderW = renderH * aspect;
  const cx = (position?.x ?? 0.5) * stageW;
  const cy = (position?.y ?? 0.5) * stageH;

  // Mirror horizontally — webcam content reads naturally as a mirror,
  // same as every native camera app and video call product.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(sourceCanvas, -renderW / 2, -renderH / 2, renderW, renderH);
  ctx.restore();
}

/**
 * Renders the full live composite ("stage") for one frame: backdrop +
 * every participant's segmented video at their current position.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {{backdrop:object, participants: Array<{canvas:HTMLCanvasElement, position:object}>}} scene
 */
export function drawStage(ctx, width, height, scene) {
  ctx.clearRect(0, 0, width, height);
  drawBackdrop(ctx, width, height, scene.backdrop);
  for (const p of scene.participants) {
    drawParticipant(ctx, width, height, p.canvas, p.position);
  }
}

function drawCover(ctx, source, x, y, w, h) {
  const sw = source.width;
  const sh = source.height;
  const sourceAspect = sw / sh;
  const destAspect = w / h;
  let sx, sy, sWidth, sHeight;
  if (sourceAspect > destAspect) {
    sHeight = sh;
    sWidth = sh * destAspect;
    sx = (sw - sWidth) / 2;
    sy = 0;
  } else {
    sWidth = sw;
    sHeight = sw / destAspect;
    sx = 0;
    sy = (sh - sHeight) / 2;
  }
  ctx.drawImage(source, sx, sy, sWidth, sHeight, x, y, w, h);
}

function drawSprocketHoles(ctx, layout) {
  const holeR = 6;
  const spacing = 34;
  const xLeft = layout.sprocketZone / 2;
  const xRight = layout.canvasWidth - layout.sprocketZone / 2;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = spacing; y < layout.canvasHeight - layout.footerHeight; y += spacing) {
    ctx.beginPath();
    ctx.arc(xLeft, y, holeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(xRight, y, holeR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFooter(ctx, layout, label) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.font = "22px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText(
    label || "TOGETHER BOOTH",
    layout.canvasWidth / 2,
    layout.canvasHeight - layout.footerHeight / 2 + 8
  );
}

/**
 * Assembles captured per-shot canvases into the final strip/grid image.
 * @param {object} layout - from utils/layouts.js
 * @param {HTMLCanvasElement[]} shotCanvases - one per slot, in order
 * @param {{paperColor?:string, label?:string}} options
 * @returns {HTMLCanvasElement}
 */
export function assembleFinalImage(layout, shotCanvases, options = {}) {
  const paperColor = options.paperColor || "#F2ECE2";
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = paperColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layout.slots.forEach((slot, i) => {
    const shot = shotCanvases[i];
    if (!shot) return;
    drawCover(ctx, shot, slot.x, slot.y, slot.w, slot.h);
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.lineWidth = 2;
    ctx.strokeRect(slot.x, slot.y, slot.w, slot.h);
  });

  if (layout.style === "strip") drawSprocketHoles(ctx, layout);
  drawFooter(ctx, layout, options.label);

  return canvas;
}

/** Triggers a direct browser download of a canvas — no upload, no server round trip. */
export function downloadCanvas(canvas, filename = "together-booth.png") {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}
