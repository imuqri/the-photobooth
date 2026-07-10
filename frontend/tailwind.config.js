/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        booth: {
          bg: "#1B1A17", // warm charcoal, not pure black — feels like a booth interior
          surface: "#242220",
          surface2: "#2E2B27",
          paper: "#F2ECE2", // photo paper cream
          ink: "#E7E2D6",
          muted: "#A89F92",
          shutter: "#E8462F", // vermillion shutter-button red (distinct from clay/terracotta defaults)
          flash: "#F4B942", // flash amber
          go: "#5FA777",
        },
      },
      fontFamily: {
        display: ["'Bebas Neue'", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      keyframes: {
        flash: {
          "0%": { opacity: 0 },
          "10%": { opacity: 1 },
          "100%": { opacity: 0 },
        },
        countdown: {
          "0%": { transform: "scale(1.4)", opacity: 0 },
          "20%": { transform: "scale(1)", opacity: 1 },
          "80%": { transform: "scale(1)", opacity: 1 },
          "100%": { transform: "scale(0.9)", opacity: 0 },
        },
      },
      animation: {
        flash: "flash 500ms ease-out forwards",
        countdown: "countdown 1s ease-in-out forwards",
      },
    },
  },
  plugins: [],
};
