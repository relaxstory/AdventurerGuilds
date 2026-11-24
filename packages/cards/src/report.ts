import { KIND_LABEL, type CardData, type CardKind } from "./types.js";
import type { CardDiff, NumberUpdate } from "./diff.js";
import { kindLabel, type Issue } from "./validate.js";

export interface ReportInput {
  readonly data: CardData;
  readonly baseVersion: number | null;
  readonly diff: CardDiff;
  readonly numberUpdates: readonly NumberUpdate[];
  readonly issues: readonly Issue[];
  readonly builtAt: string;
}

const TARGET: Partial<Record<CardKind, string>> = { adventurers: "每局 80 張", tasks: "每局 50 張", honors: "4 人局 8～12 張" };

export function renderReport(r: ReportInput): string {
  const L: string[] = [];
  const base = r.baseVersion === null ? "（尚未發布過）" : `v${r.baseVersion}`;
  L.push(`# 卡片更新報告`, "");
  L.push(`- 產生時間：${r.builtAt}`);
  L.push(`- 比較基準：已發布的 ${base}`);
  const errors = r.issues.filter((i) => i.level === "error");
  const warnings = r.issues.filter((i) => i.level === "warning");
  const manual = r.numberUpdates.filter((u) => u.result === "manual");
  L.push(`- 結果：${errors.length ? `❌ ${errors.length} 個錯誤，需要修正後才能發布` : "✅ 沒有錯誤，可以發布"}；⚠️ ${warnings.length} 個提醒；需要人工確認的數值變更 ${manual.length} 項`, "");

  L.push("## 卡池", "", "| 類別 | 實裝 | 測試 | 未實裝 | 目標 |", "|---|---|---|---|---|");
  for (const kind of Object.keys(r.data) as CardKind[]) {
    const cards = r.data[kind] as readonly { status: string; backOf?: string }[];
    const count = (s: string) => cards.filter((c) => c.status === s && !c.backOf).length;
    L.push(`| ${KIND_LABEL[kind]} | ${count("實裝")} | ${count("測試")} | ${count("未實裝")} | ${TARGET[kind] ?? "—"} |`);
  }
  L.push("", "冒險者不含雙面卡的背面。", "");

  L.push(`## 與 ${base} 的差異`, "");
  if (!r.diff.added.length && !r.diff.removed.length && !r.diff.changed.length) L.push("沒有變更。", "");
  if (r.diff.added.length) {
    L.push(`### 新增（${r.diff.added.length}）`, "", "| 類別 | 卡片 | 實裝狀態 |", "|---|---|---|");
    r.diff.added.forEach((a) => L.push(`| ${KIND_LABEL[a.kind]} | ${a.key} | ${a.status} |`));
    L.push("");
  }
  if (r.diff.removed.length) {
    L.push(`### 刪除（${r.diff.removed.length}）`, "", "| 類別 | 卡片 |", "|---|---|");
    r.diff.removed.forEach((a) => L.push(`| ${KIND_LABEL[a.kind]} | ${a.key} |`));
    L.push("");
  }
  if (r.diff.changed.length) {
    L.push(`### 修改（${r.diff.changed.length}）`, "", "| 類別 | 卡片 | 欄位 | 修改前 | 修改後 |", "|---|---|---|---|---|");
    const cell = (s: string) => (s.length > 60 ? s.slice(0, 57) + "…" : s).replace(/\|/g, "\\|").replace(/\n/g, "↵");
    for (const c of r.diff.changed) for (const f of c.changes) L.push(`| ${KIND_LABEL[c.kind]} | ${c.name} | ${f.field} | ${cell(f.before)} | ${cell(f.after)} |`);
    L.push("");
  }

  if (r.numberUpdates.length) {
    L.push("## 技能數值變更", "", "| 卡片 | 技能 | 修改前 | 修改後 | 處理 |", "|---|---|---|---|---|");
    const label = { auto: "✅ 已自動更新", already: "✅ 已是新數值", manual: "⚠️ 需要確認" } as const;
    const cell = (s: string) => (s.length > 40 ? s.slice(0, 37) + "…" : s).replace(/\n/g, "↵");
    for (const u of r.numberUpdates) L.push(`| ${u.cardName} | ${u.skill} | ${cell(u.before)} | ${cell(u.after)} | ${label[u.result]}：${u.detail} |`);
    L.push("");
  }

  for (const [title, list] of [["錯誤", errors], ["提醒", warnings]] as const) {
    L.push(`## ${title}（${list.length}）`, "");
    if (!list.length) {
      L.push("沒有。", "");
      continue;
    }
    L.push("| 類別 | 卡片 | 說明 |", "|---|---|---|");
    list.forEach((i) => L.push(`| ${kindLabel(i.kind)} | ${i.card} | ${i.message} |`));
    L.push("");
  }
  return L.join("\n");
}
