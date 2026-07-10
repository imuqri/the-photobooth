import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      external: ["@mediapipe/selfie_segmentation"],
      output: {
        globals: {
          "@mediapipe/selfie_segmentation": "SelfieSegmentation",
        },
      },
    },
  },
});