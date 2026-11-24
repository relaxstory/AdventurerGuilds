/**
 * 把測試模式的打包結果（packages/web/dist/index.html）轉成可以發布為網頁的內容：
 * 去掉 doctype／html／head／body 標籤，保留標題、樣式、程式與根元素。
 * 用法：node scripts/artifact.mjs <輸出檔>
 */
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("packages/web/dist/index.html", "utf-8");
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join("\n");
const scripts = [...html.matchAll(/<script[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]).join("\n");
const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  styles,
  '<div id="root"></div>',
  scripts,
].join("\n");
writeFileSync(process.argv[2], out);
console.log(`已輸出 ${process.argv[2]}（${Math.round(out.length / 1024)} KB）`);
