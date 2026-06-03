import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  test: {
    environment: "node"
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react")) return "vendor-react";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          if (id.includes("node_modules/emoji-datasource")) return "vendor-emoji";
          if (id.includes("node_modules")) return "vendor-other";
          if (id.includes("AdminApp")) return "app-admin";
          if (id.includes("ParentApp")) return "app-parent";
          if (id.includes("ChildApp")) return "app-child";
        }
      }
    }
  }
});
