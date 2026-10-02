import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Share the repo-root .env with the API.
  envDir: "../..",
  server: {
    port: 5173,
    // Same-origin API calls keep the session cookie simple (no cross-site cookies).
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
