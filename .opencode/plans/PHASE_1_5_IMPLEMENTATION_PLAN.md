# Phase 1.5 Background Removal - Implementation Plan

## Problem Statement

### Current State (Phase 0)
- MediaPipe Selfie Segmentation with `modelSelection: 1` (landscape model)
- Raw binary mask applied via `globalCompositeOperation: "source-in"`
- No post-processing: hard edges, jagged hair, halo artifacts, flickering
- No temporal stability — each frame processed independently

### Target (Phase 1.5)
- **Portrait model** (`modelSelection: 0`) — better for upright humans
- **WebGL mask refinement shader** — feathering, erosion/dilation on GPU
- **Temporal smoothing** — blend current mask with previous frame (0.7/0.3)
- **Soft alpha edges** — feathered alpha matte (2-4px feather)
- **Result**: 70-80% Google Meet quality, runs entirely client-side, zero server cost

---

## Current Architecture

```
useSegmentation.js
  ├── MediaPipe SelfieSegmentation (CDN, WASM)
  │   ├── modelSelection: 1 (landscape)
  │   └── locateFile: CDN
  ├── onResults callback
  │   ├── canvas.resize to mask size
  │   ├── ctx.drawImage(segmentationMask)
  │   ├── ctx.globalCompositeOperation = "source-in"
  │   ├── ctx.drawImage(videoFrame)
  │   └── ctx.globalCompositeOperation = "source-over"
  └── requestAnimationFrame loop @ camera FPS
```

---

## Phase 1.5 Implementation Plan

### Step 1: Switch to Portrait Model (5 min)

**File**: `frontend/src/hooks/useSegmentation.js`

```javascript
// Line 36 - Change from:
segmenter.setOptions({ modelSelection: 1 });
// To:
segmenter.setOptions({ modelSelection: 0 }); // 0 = portrait, 1 = landscape
```

**Why**: Portrait model (0) is optimized for upright humans in portrait orientation — exactly our use case. Landscape model (1) is optimized for horizontal video.

---

### Step 2: WebGL Mask Refinement Shader (2 hours)

Create a new WebGL shader module for mask post-processing.

**New File**: `frontend/src/utils/maskRefinement.js`

```javascript
/**
 * WebGL Mask Refinement Shader
 * Performs feathering, erosion/dilation on GPU
 */

// Vertex Shader (passthrough)
const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vTexCoord;
  void main() {
    vTexCoord = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

// Fragment Shader - Mask Refinement
const FRAGMENT_SHADER = `
  precision highp float;
  
  uniform sampler2D uMask;        // Input segmentation mask
  uniform float uFeather;         // Feather radius (px)
  uniform float uErode;           // Erosion amount (0-1)
  uniform float uDilate;          // Dilation amount (0-1)
  uniform vec2 uResolution;       // Canvas resolution
  
  varying vec2 vTexCoord;
  
  // Gaussian kernel for feathering
  float gaussian(float x, float sigma) {
    return exp(-0.5 * (x * x) / (sigma * sigma)) / (sigma * sqrt(6.283185));
  }
  
  // Sample mask with offset
  float sampleMask(vec2 offset) {
    vec2 uv = vTexCoord + offset / uResolution;
    return texture2D(uMask, uv).r;
  }
  
  void main() {
    float mask = texture2D(uMask, vTexCoord).r;
    
    // 1. Erosion (shrink mask)
    if (uErode > 0.0) {
      float minVal = 1.0;
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          vec2 offset = vec2(float(x), float(y)) * uErode;
          minVal = min(minVal, sampleMask(offset));
        }
      }
      mask = minVal;
    }
    
    // 2. Dilation (expand mask)
    if (uDilate > 0.0) {
      float maxVal = 0.0;
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          vec2 offset = vec2(float(x), float(y)) * uDilate;
          maxVal = max(maxVal, sampleMask(offset));
        }
      }
      mask = maxVal;
    }
    
    // 3. Gaussian feathering
    if (uFeather > 0.0) {
      float sum = 0.0;
      float weightSum = 0.0;
      for (int x = -3; x <= 3; x++) {
        for (int y = -3; y <= 3; y++) {
          vec2 offset = vec2(float(x), float(y));
          float w = gaussian(length(offset), uFeather / 3.0);
          sum += sampleMask(offset) * w;
          weightSum += w;
        }
      }
      mask = sum / weightSum;
    }
    
    // Output refined mask
    gl_FragColor = vec4(vec3(mask), 1.0);
  }
`;

export class MaskRefiner {
  constructor(gl) {
    this.gl = gl;
    this.program = this.createProgram();
    this.initBuffers();
    this.locations = this.getUniformLocations();
  }
  
  createProgram() {
    const vs = this.compileShader(this.gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(this.gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      throw new Error(this.gl.getProgramInfoLog(program));
    }
    return program;
  }
  
  compileShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      throw new Error(this.gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  
  initBuffers() {
    // Full-screen quad
    const positions = new Float32Array([
      -1, -1,  1, -1,  -1, 1,
      -1,  1,  1, -1,   1, 1
    ]);
    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
  }
  
  getUniformLocations() {
    return {
      uMask: this.gl.getUniformLocation(this.program, 'uMask'),
      uFeather: this.gl.getUniformLocation(this.program, 'uFeather'),
      uErode: this.gl.getUniformLocation(this.program, 'uErode'),
      uDilate: this.gl.getUniformLocation(this.program, 'uDilate'),
      uResolution: this.gl.getUniformLocation(this.program, 'uResolution'),
    };
  }
  
  refine(maskTexture, options = {}) {
    const { feather = 4.0, erode = 0.5, dilate = 0.5 } = options;
    
    this.gl.useProgram(this.program);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
    
    // Bind input mask texture
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, maskTexture);
    this.gl.uniform1i(this.locations.uMask, 0);
    
    // Set uniforms
    this.gl.uniform1f(this.locations.uFeather, 4.0); // px
    this.gl.uniform1f(this.locations.uErode, 0.5);
    this.gl.uniform1f(this.locations.uDilate, 0.5);
    this.gl.uniform2f(this.locations.uResolution, this.gl.canvas.width, this.gl.canvas.height);
    
    // Draw full-screen quad
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    const posLoc = this.gl.getAttribLocation(this.program, 'aPosition');
    this.gl.enableVertexAttribArray(posLoc);
    this.gl.vertexAttribPointer(posLoc, 2, this.gl.FLOAT, false, 0, 0);
    
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}
```

---

### Step 3: Integrate MaskRefiner into useSegmentation (1 hour)

**Modified File**: `frontend/src/hooks/useSegmentation.js`

```javascript
import { useEffect, useRef, useState } from "react";
import { MaskRefiner } from "../utils/maskRefinement.js";

export function useSegmentation(videoRef, outputCanvasRef, enabled = true) {
  const segRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const refinerRef = useRef(null);
  const temporalCanvasRef = useRef(null);
  const prevMaskRef = useRef(null);
  
  // Temporal smoothing state
  const [smoothingAlpha] = useState(0.3); // 0.3 = 30% previous, 70% current

  useEffect(() => {
    if (!enabled) return;
    const video = videoRef.current;
    const canvas = outputCanvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });

    // Initialize WebGL refiner
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true });
    if (gl) {
      refinerRef.current = new MaskRefiner(gl);
    }

    const SelfieSegmentation = window.SelfieSegmentation;
    if (!SelfieSegmentation) {
      console.error("MediaPipe SelfieSegmentation not loaded");
      return;
    }

    const segmenter = new SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });
    segmenter.setOptions({ modelSelection: 0 }); // PORTRAIT MODEL
    
    segmenter.onResults((results) => {
      canvas.width = results.image.width;
      canvas.height = results.image.height;

      // Step 1: Draw raw mask to offscreen canvas
      const maskCanvas = document.createElement("canvas");
      maskCanvas.width = results.segmentationMask.width;
      maskCanvas.height = results.segmentationMask.height;
      const maskCtx = maskCanvas.getContext("2d");
      maskCtx.drawImage(results.segmentationMask, 0, 0);

      // Step 2: Refine mask via WebGL
      let refinedMaskCanvas = maskCanvas;
      if (refinerRef.current) {
        const gl = refinerRef.current.gl;
        const maskTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, maskTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maskCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        
        refinerRef.current.refine(maskTexture, {
          feather: 4.0,   // px
          erode: 0.5,     // shrink slightly
          dilate: 0.5,    // expand slightly
        });
        
        // Read back refined mask
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        
        // Create refined mask canvas
        const refinedCanvas = document.createElement("canvas");
        refinedCanvas.width = maskCanvas.width;
        refinedCanvas.height = maskCanvas.height;
        const refinedCtx = refinedCanvas.getContext("2d");
        const imageData = refinedCtx.createImageData(refinedCanvas.width, refinedCanvas.height);
        imageData.data.set(pixels);
        refinedCtx.putImageData(imageData, 0, 0);
        refinedMaskCanvas = refinedCanvas;
        
        // Cleanup
        gl.deleteTexture(maskTexture);
      }

      // Temporal smoothing with previous frame
      if (!temporalCanvasRef.current) {
        temporalCanvasRef.current = document.createElement("canvas");
      }
      temporalCanvasRef.current.width = canvas.width;
      temporalCanvasRef.current.height = canvas.height;
      const temporalCtx = temporalCanvasRef.current.getContext("2d", { alpha: true });

      // Blend current frame with previous frame (0.7 current, 0.3 previous)
      temporalCtx.globalCompositeOperation = "copy";
      temporalCtx.globalAlpha = 0.3; // Previous frame weight
      temporalCtx.drawImage(temporalCanvasRef.current, 0, 0);
      temporalCtx.globalAlpha = 0.7; // Current frame weight
      temporalCtx.drawImage(refinedMaskCanvas, 0, 0);
      temporalCtx.globalAlpha = 1.0;

      // Step 3: Final composite - draw video with refined mask
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(temporalCanvasRef.current, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    });
    
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
```

---

### Step 4: Configuration & Device Presets (30 min)

**New File**: `frontend/src/config/segmentationConfig.js`

```javascript
export const SEGMENTATION_CONFIG = {
  // Model
  modelSelection: 0,           // 0 = portrait, 1 = landscape
  
  // WebGL refinement
  refinement: {
    feather: 4.0,      // Feather radius in pixels (2-6)
    erode: 0.5,        // Shrink mask slightly (0-1)
    dilate: 0.5,       // Expand mask slightly (0-1)
  },
  
  // Temporal smoothing
  temporal: {
    enabled: true,
    alpha: 0.3,        // Previous frame weight (0.2-0.4)
  },
  
  // Input resolution
  input: {
    width: 1280,
    height: 720,
  },
};

// Device-specific presets
export const DEVICE_PRESETS = {
  mobile: {
    refinement: { feather: 2.0, erode: 0.3, dilate: 0.3 },
    temporal: { alpha: 0.4 },
  },
  desktop: {
    refinement: { feather: 4.0, erode: 0.5, dilate: 0.5 },
    temporal: { alpha: 0.3 },
  },
  lowEnd: {
    refinement: { feather: 2.0, erode: 0.2, dilate: 0.2 },
    temporal: { alpha: 0.5 },
  },
};

function getDevicePreset() {
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency <= 4;
  
  if (isMobile || isLowEnd) return DEVICE_PRESETS.lowEnd;
  return DEVICE_PRESETS.desktop;
}

export function getConfig() {
  const preset = getDevicePreset();
  return {
    modelSelection: SEGMENTATION_CONFIG.modelSelection,
    refinement: { ...SEGMENTATION_CONFIG.refinement, ...preset.refinement },
    temporal: { ...SEGMENTATION_CONFIG.temporal, ...preset.temporal },
  };
}
```

---

### Step 5: Device Detection & Auto-Config (30 min)

**In `useSegmentation.js`**:

```javascript
import { getConfig } from "../config/segmentationConfig.js";

// In useEffect, apply preset:
const config = getConfig();
segmenter.setOptions({ modelSelection: config.modelSelection });

// Use config values in refiner
refinerRef.current.refine(maskTexture, config.refinement);
temporalAlpha = config.temporal.alpha;
```

---

## File Structure After Implementation

```
frontend/
├── src/
│   ├── hooks/
│   │   └── useSegmentation.js          # Modified
│   ├── utils/
│   │   ├── maskRefinement.js           # NEW - WebGL shader module
│   │   └── maskRefinement.glsl         # Optional separate GLSL file
│   └── config/
│       └── segmentationConfig.js       # NEW - Config + presets
```

---

## Testing Checklist

| Test | Device | Expected |
|------|--------|----------|
| 1 person, desktop Chrome | Desktop | Smooth edges, no flicker |
| 1 person, mobile Safari | iPhone | 30 FPS, clean edges |
| 1 person, mobile Chrome | Android | 30 FPS, clean edges |
| 3 people, desktop | Desktop | All 3 clean, 25+ FPS |
| 6 people, desktop | Desktop | All 6 clean, 20+ FPS |
| Hair transparency | All | Soft alpha on hair strands |
| Rapid movement | All | No mask lag/ghosting |
| Lighting changes | All | Stable mask |

---

## Rollback Plan

If issues arise:

1. **Quick rollback**: Change `modelSelection: 1` back to landscape
2. **Disable refinement**: Set `refinement: { feather: 0, erode: 0, dilate: 0 }`
3. **Disable temporal**: Set `temporal: { enabled: false }`

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@mediapipe/selfie_segmentation` | 0.1.1675465747 | Already installed |
| WebGL2 | Native | Browser API |

No new npm packages required.

---

## Estimated Timeline

| Step | Duration |
|------|----------|
| 1. Portrait model switch | 5 min |
| 2. WebGL mask refinement shader | 2 hrs |
| 3. Integration + temporal smoothing | 1 hr |
| 4. Config + device presets | 30 min |
| 5. Testing & tuning | 1 hr |
| **Total** | **~5 hours** |

---

## Success Criteria

- [ ] Hair edges look soft (no hard binary cutout)
- [ ] No halo artifacts around person
- [ ] Mask stable across frames (no flicker)
- [ ] 25+ FPS on desktop, 25+ FPS on mobile
- [ ] 6 people in room: all clean cutouts
- [ ] No regression in capture/photo quality

---

**Ready to implement when you are.** The plan is complete and ready for execution.