import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 測試模式：打包成單一 HTML 檔，不需要伺服器就能開啟
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  server: { fs: { allow: ["../.."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
