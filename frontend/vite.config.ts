import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/gateway": {
        target: "ws://localhost:8080",
        ws: true,
      },
      "/rtc": {
        target: "ws://localhost:7880",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
