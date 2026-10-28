import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
export default defineConfig({
  plugins: [react()],
  build: { target: "es2022" },
  server: { port: 5175 },
  preview: { port: 4175 },
});
