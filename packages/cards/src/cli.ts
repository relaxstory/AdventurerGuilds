import { existsSync } from "node:fs";
import { applyNumberChanges, diffCards, type CardDiff } from "./diff.js";
import { checkMapping, parseMapping, stringifyMapping, type Template } from "./mapping.js";
import { parseAll } from "./parse.js";
import { renderReport } from "./report.js";
import { SHEETS, fetchSheet } from "./sheets.js";
import { path, read, readIndex, readVersion, write } from "./store.js";
import { KIND_LABEL, type CardData, type CardKind } from "./types.js";
import { validate } from "./validate.js";

const now = () => new Date().toISOString();

/** 從試算表下載所有分頁，存成 data/raw/*.csv 快照。 */
async function update(): Promise<void> {
  for (const [key, sheet] of Object.entries(SHEETS)) {
    const csv = await fetchSheet(sheet);
    write(path("raw", `${key}.csv`), csv);
    console.log(`已下載「${sheet}」`);
  }
  build();
}

/** 由 data/raw 的快照產生 data/cards.json 與檢查報告。 */
function build(): { errors: number } {
  const raw = Object.fromEntries(Object.keys(SHEETS).map((k) => [k, read(path("raw", `${k}.csv`))])) as Record<CardKind, string>;
  const data = parseAll(raw);
  const index = readIndex();
  const base = index.latest === null ? null : readVersion(index.latest);
  const diff = diffCards(base, data);

  const clauses = parseMapping(read(path("skill-mapping.csv")));
  const numberUpdates = applyNumberChanges(diff, data, clauses);
  if (numberUpdates.some((u) => u.result === "auto")) write(path("skill-mapping.csv"), stringifyMapping(clauses));

  const templates = JSON.parse(read(path("skill-templates.json"))) as Template[];
  const issues = [...validate(data), ...checkMapping(data, clauses, templates)];
  const builtAt = now();
  write(path("cards.json"), JSON.stringify({ builtAt, cards: data }, null, 2) + "\n");
  write(path("reports", "card-report.md"), renderReport({ data, baseVersion: index.latest, diff, numberUpdates, issues, builtAt }));

  const errors = issues.filter((i) => i.level === "error").length;
  console.log(`卡片資料已產生：data/cards.json`);
  console.log(`檢查報告：data/reports/card-report.md（錯誤 ${errors}、提醒 ${issues.length - errors}）`);
  console.log(`差異：新增 ${diff.added.length}、刪除 ${diff.removed.length}、修改 ${diff.changed.length}`);
  return { errors };
}

function summarize(diff: CardDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`新增 ${diff.added.length}`);
  if (diff.removed.length) parts.push(`刪除 ${diff.removed.length}`);
  if (diff.changed.length) parts.push(`修改 ${diff.changed.length}`);
  return parts.join("、") || "沒有變更";
}

/** 把目前的 data/cards.json 發布為新版本。 */
function publish(): void {
  const { errors } = build();
  if (errors) {
    console.error(`有 ${errors} 個錯誤，無法發布。請先看 data/reports/card-report.md`);
    process.exitCode = 1;
    return;
  }
  const data = (JSON.parse(read(path("cards.json"))) as { cards: CardData }).cards;
  const index = readIndex();
  const base = index.latest === null ? null : readVersion(index.latest);
  const diff = diffCards(base, data);
  if (base && !diff.added.length && !diff.removed.length && !diff.changed.length) {
    console.log(`和 v${index.latest} 相同，不需要發布`);
    return;
  }
  const version = (index.latest ?? 0) + 1;
  const publishedAt = now();
  write(path("versions", `v${version}.json`), JSON.stringify({ version, publishedAt, cards: data }, null, 2) + "\n");
  const summary = summarize(diff);
  index.latest = version;
  index.history.push({ version, publishedAt, summary });
  write(path("versions", "index.json"), JSON.stringify(index, null, 2) + "\n");

  const log = existsSync(path("CHANGELOG.md")) ? read(path("CHANGELOG.md")) : "# 卡片更新紀錄\n";
  const lines = [`## v${version}（${publishedAt.slice(0, 10)}）`, "", summary, ""];
  if (base) {
    for (const a of diff.added) lines.push(`- 新增 ${KIND_LABEL[a.kind]}：${a.name}`);
    for (const a of diff.removed) lines.push(`- 刪除 ${KIND_LABEL[a.kind]}：${a.name}`);
    for (const c of diff.changed) {
      const short = (s: string) => (s.length > 30 ? s.slice(0, 27) + "…" : s).replace(/\n/g, " ");
      lines.push(`- ${c.name}：${c.changes.map((f) => `${f.field} ${short(f.before)} → ${short(f.after)}`).join("；")}`);
    }
  } else {
    lines.push("第一個版本。");
  }
  const [title, ...rest] = log.split("\n");
  write(path("CHANGELOG.md"), [title, "", ...lines, ...rest].join("\n").replace(/\n{3,}/g, "\n\n"));
  console.log(`已發布 v${version}：${summary}`);
}

const command = process.argv[2];
if (command === "update") await update();
else if (command === "build") build();
else if (command === "publish") publish();
else {
  console.log("用法：cli.ts update | build | publish");
  process.exitCode = 1;
}
