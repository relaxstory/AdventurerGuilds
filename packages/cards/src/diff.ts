import { cardKey, type CardData, type CardKind } from "./types.js";
import type { Clause } from "./mapping.js";

export interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface CardChange {
  readonly kind: CardKind;
  readonly key: string;
  readonly name: string;
  readonly changes: readonly FieldChange[];
}

export interface CardDiff {
  readonly added: { kind: CardKind; key: string; name: string; status: string }[];
  readonly removed: { kind: CardKind; key: string; name: string }[];
  readonly changed: CardChange[];
}

const FIELD_LABEL: Record<string, string> = {
  name: "名稱", race: "種族", profession: "職業", traits: "特質", baseDice: "基礎骰數", salary: "薪資",
  flavor: "風味文字", englishName: "英文名稱", story: "故事背景", status: "實裝狀態", categories: "分類",
  effect: "功能", price: "售價", description: "任務敘述", type: "任務時效", conditionText: "任務目標",
  tags: "標籤", specialRule: "特殊規則", gold: "獎勵(金)", reputation: "獎勵(聲望)", extraReward: "額外獎勵",
  client: "委託人", route: "路線", kind: "類型", condition: "條件",
};

const show = (v: unknown): string => (Array.isArray(v) ? v.join("") : v === null || v === undefined ? "" : String(v));

function fieldsOf(card: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(card)) {
    if (k === "id" || k === "backOf" || k === "condition" && typeof v === "object") continue;
    if (k === "skills" && Array.isArray(v)) {
      for (const s of v as { name: string; text: string }[]) out.set(`技能 ${s.name || "（無名稱）"}`, s.text);
      continue;
    }
    out.set(FIELD_LABEL[k] ?? k, show(v));
  }
  return out;
}

export function diffCards(before: CardData | null, after: CardData): CardDiff {
  const diff: CardDiff = { added: [], removed: [], changed: [] };
  for (const kind of Object.keys(after) as CardKind[]) {
    const old = new Map((before?.[kind] ?? []).map((c) => [cardKey(c), c as unknown as Record<string, unknown>]));
    const now = new Map(after[kind].map((c) => [cardKey(c), c as unknown as Record<string, unknown>]));
    for (const [key, c] of now) {
      const o = old.get(key);
      if (!o) {
        diff.added.push({ kind, key, name: String(c.name), status: String(c.status) });
        continue;
      }
      const a = fieldsOf(o);
      const b = fieldsOf(c);
      const changes: FieldChange[] = [];
      for (const f of new Set([...a.keys(), ...b.keys()])) {
        const x = a.get(f) ?? "";
        const y = b.get(f) ?? "";
        if (x !== y) changes.push({ field: f, before: x, after: y });
      }
      if (changes.length) diff.changed.push({ kind, key, name: String(c.name), changes });
    }
    for (const [key, o] of old) if (!now.has(key)) diff.removed.push({ kind, key, name: String(o.name) });
  }
  return diff;
}

export interface NumberUpdate {
  readonly cardName: string;
  readonly skill: string;
  readonly before: string;
  readonly after: string;
  /** auto：已自動更新子句對照表；manual：無法自動判斷，需要 Claude 確認。 */
  readonly result: "auto" | "already" | "manual";
  readonly detail: string;
}

const numbers = (s: string) => s.match(/-?\d+/g) ?? [];
const masked = (s: string) => s.replace(/-?\d+/g, "#");

/**
 * 技能文字只有數字改變時（句型相同），自動更新子句對照表的參數。
 * 例如「任務難度調整1」改成「任務難度調整2」，對應子句的參數 1 會改成 2。
 */
export function applyNumberChanges(diff: CardDiff, data: CardData, clauses: Clause[]): NumberUpdate[] {
  const updates: NumberUpdate[] = [];
  for (const change of diff.changed) {
    const card = (data[change.kind] as readonly { id: string; name: string }[]).find((c) => cardKey(c) === change.key);
    if (!card) continue;
    for (const f of change.changes) {
      let skill: string | null = null;
      if (f.field.startsWith("技能 ")) skill = f.field.slice(3);
      else if (f.field === "功能") skill = "功能";
      else if (f.field === "特殊規則") skill = "特殊規則";
      if (!skill) continue;
      const mine = clauses.filter((c) => c.cardId === card.id && c.cardName === card.name && c.skillName === skill);
      if (masked(f.before) !== masked(f.after)) {
        updates.push({ cardName: card.name, skill, before: f.before, after: f.after, result: "manual", detail: "文字（不只是數字）有改變，需要確認子句是否還正確" });
        continue;
      }
      const a = numbers(f.before);
      const b = numbers(f.after);
      a.forEach((oldValue, i) => {
        const newValue = b[i]!;
        if (oldValue === newValue) return;
        const params = mine.flatMap((c) => (["x", "y", "z"] as const).map((p) => ({ c, p })));
        const hits = params.filter(({ c, p }) => stripSign(c[p]) === stripSign(oldValue));
        const already = params.filter(({ c, p }) => stripSign(c[p]) === stripSign(newValue));
        if (hits.length === 1) {
          const { c, p } = hits[0]!;
          c[p] = keepSign(c[p], newValue);
          updates.push({ cardName: card.name, skill, before: oldValue, after: newValue, result: "auto", detail: `子句 ${c.clause}（${c.code}）的 ${p.toUpperCase()}：${oldValue} → ${newValue}` });
        } else if (hits.length === 0 && already.length > 0) {
          updates.push({ cardName: card.name, skill, before: oldValue, after: newValue, result: "already", detail: "子句對照表已經是新數值" });
        } else {
          updates.push({ cardName: card.name, skill, before: oldValue, after: newValue, result: "manual", detail: hits.length ? "有多個參數等於舊數值，無法判斷要改哪一個" : "子句對照表裡找不到這個數值" });
        }
      });
    }
  }
  return updates;
}

const stripSign = (v: string) => v.replace(/^\+/, "");
const keepSign = (old: string, value: string) => (old.startsWith("+") && !value.startsWith("-") ? `+${value}` : value);
