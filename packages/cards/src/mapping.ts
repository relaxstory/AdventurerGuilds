import { parseCsv, stringifyCsv } from "./csv.js";
import type { CardData } from "./types.js";
import type { Issue } from "./validate.js";

export interface Template {
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly text: string;
  readonly params: string;
}

export interface Clause {
  cardId: string;
  cardName: string;
  order: string;
  skillName: string;
  clause: string;
  code: string;
  x: string;
  y: string;
  z: string;
  note: string;
}

const HEADER = ["卡片編號", "卡片名稱", "技能順序", "技能名稱", "子句", "模板代碼", "X", "Y", "Z", "備註"];

export function parseMapping(csv: string): Clause[] {
  const [head, ...rows] = parseCsv(csv);
  if (!head || head.join() !== HEADER.join()) throw new Error("子句對照表的欄位不符");
  return rows
    .filter((r) => r.length > 1)
    .map(([rawId = "", cardName = "", order = "", skillName = "", clause = "", code = "", x = "", y = "", z = "", note = ""]) => ({
      cardId: rawId === "（無編號）" ? "" : rawId, cardName, order, skillName, clause, code, x, y, z, note,
    }));
}

export function stringifyMapping(clauses: readonly Clause[]): string {
  return stringifyCsv([HEADER, ...clauses.map((c) => [c.cardId || "（無編號）", c.cardName, c.order, c.skillName, c.clause, c.code, c.x, c.y, c.z, c.note])]);
}

const active = (status: string) => status === "實裝" || status === "測試";

/** 每張卡要對應到子句對照表的技能名稱；道具用「功能」，任務用「特殊規則」。 */
function expectedSkills(data: CardData): { id: string; name: string; skill: string; kind: Issue["kind"] }[] {
  const out: { id: string; name: string; skill: string; kind: Issue["kind"] }[] = [];
  for (const kind of ["adventurers", "derivatives"] as const) {
    for (const c of data[kind]) {
      if (!active(c.status)) continue;
      for (const s of c.skills) out.push({ id: c.id, name: c.name, skill: s.name || "（無名稱）", kind });
    }
  }
  for (const c of data.items) {
    if (active(c.status) && c.effect && c.effect.toUpperCase() !== "N/A") out.push({ id: c.id, name: c.name, skill: "功能", kind: "items" });
  }
  for (const c of data.tasks) {
    if (active(c.status) && (c.specialRule && c.specialRule.toUpperCase() !== "N/A")) out.push({ id: c.id, name: c.name, skill: "特殊規則", kind: "tasks" });
    // 額外獎勵「獲得【道具】」需要 TASK_REWARD_ITEM 子句（史詩任務的榮譽卡獎勵另外處理）
    if (active(c.status) && /^獲得【.+】$/.test(c.extraReward ?? "")) out.push({ id: c.id, name: c.name, skill: "額外獎勵", kind: "tasks" });
  }
  return out;
}

export function checkMapping(data: CardData, clauses: readonly Clause[], templates: readonly Template[]): Issue[] {
  const issues: Issue[] = [];
  const codes = new Set(templates.map((t) => t.code));
  const key = (id: string, name: string, skill: string) => `${id}｜${name}｜${skill}`;
  const mapped = new Set(clauses.map((c) => key(c.cardId, c.cardName, c.skillName)));
  const expected = expectedSkills(data);
  for (const e of expected) {
    if (!mapped.has(key(e.id, e.name, e.skill))) {
      issues.push({ level: "error", kind: e.kind, card: e.name, message: `${e.skill} 沒有對應的技能模板（需要 Claude 建立子句或開發新模板）` });
    }
  }
  const exp = new Set(expected.map((e) => key(e.id, e.name, e.skill)));
  const inactive = new Set(
    [...data.adventurers, ...data.derivatives, ...data.items, ...data.tasks]
      .filter((c) => !active(c.status))
      .map((c) => `${c.id}｜${c.name}`),
  );
  const reported = new Set<string>();
  for (const c of clauses) {
    if (!codes.has(c.code)) issues.push({ level: "error", kind: "mapping", card: c.cardName, message: `${c.skillName} 使用不存在的模板 ${c.code}` });
    const k = key(c.cardId, c.cardName, c.skillName);
    if (!exp.has(k) && !reported.has(k) && !inactive.has(`${c.cardId}｜${c.cardName}`)) {
      reported.add(k);
      issues.push({ level: "warning", kind: "mapping", card: c.cardName, message: `${c.skillName} 在試算表中找不到，或卡片不是實裝／測試狀態` });
    }
  }
  return issues;
}
