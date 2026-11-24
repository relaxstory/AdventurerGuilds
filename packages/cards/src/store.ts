import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardData } from "./types.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const path = (...p: string[]) => join(ROOT, "data", ...p);

export function read(file: string): string {
  return readFileSync(file, "utf-8");
}

export function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export interface VersionIndex {
  latest: number | null;
  /** version 為內部序號（對局鎖定版本時使用）；name 為顯示名稱，例如 alpha1.0。 */
  history: { version: number; name: string; publishedAt: string; summary: string }[];
}

export function readIndex(): VersionIndex {
  const f = path("versions", "index.json");
  return existsSync(f) ? (JSON.parse(read(f)) as VersionIndex) : { latest: null, history: [] };
}

export function versionName(index: VersionIndex, v: number | null): string | null {
  if (v === null) return null;
  return index.history.find((h) => h.version === v)?.name ?? `v${v}`;
}

export function readVersion(v: number): CardData {
  return JSON.parse(read(path("versions", `v${v}.json`))).cards as CardData;
}
