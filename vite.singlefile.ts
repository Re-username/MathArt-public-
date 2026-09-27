import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

// Сборка игры в один самодостаточный HTML-файл (запуск двойным кликом, без сервера)
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: 100000000,
    // 47 МБ треков в base64: минификация такого бандла не влезает в память —
    // для однофайловой сборки она не нужна
    minify: false,
  },
});
