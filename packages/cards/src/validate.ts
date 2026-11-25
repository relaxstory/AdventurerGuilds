import { STATUSES, cardKey, type CardData, type CardKind, KIND_LABEL } from "./types.js";

export interface Issue {
  readonly level: "error" | "warning";
  readonly kind: CardKind | "mapping";
  readonly card: string;
  readonly message: string;
}

/** 已有卡片引用、但相關任務與冒險者留待未來擴充的標籤（規格書 14.2）。 */
export const RESERVED_TAGS = ["[遺跡]", "[火焰]", "[動物]"];

/** 卡片文字中以【】標示、但不是卡名的關鍵字。 */
export const KEYWORDS = ["【獨特】", "【小嗶】", "【集結】"];

const TASK_TYPES = ["一般", "緊急", "永久", "史詩", "史詩(B)"];
const HONOR_ROUTES = ["財富", "聲望", "任務", "人才"];
const HONOR_KINDS = ["排名型", "門檻型"];

const active = (status: string) => status === "實裝" || status === "測試";
const strip = (s: string) => s.replace(/[\s「」]/g, "");

export function validate(data: CardData): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], kind: Issue["kind"], card: string, message: string) =>
    issues.push({ level, kind, card, message });

  // 實裝狀態、編號、重複
  for (const kind of Object.keys(data) as CardKind[]) {
    const seen = new Map<string, number>();
    for (const c of data[kind]) {
      const label = c.name;
      if (!(STATUSES as readonly string[]).includes(c.status)) {
        add("error", kind, label, `實裝狀態「${c.status || "（空白）"}」不是 實裝／測試／未實裝 之一`);
      }
      if (!active(c.status)) continue;
      if (!c.id) add("error", kind, label, "缺少卡片編號");
      const k = cardKey(c);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    for (const [k, n] of seen) if (n > 1) add("error", kind, k, `重複出現 ${n} 次`);
  }

  // 冒險者與衍生物的數值
  for (const kind of ["adventurers", "derivatives"] as const) {
    for (const c of data[kind]) {
      if (!active(c.status)) continue;
      for (const [field, v] of [["基礎骰數", c.baseDice], ["薪資", c.salary]] as const) {
        if (v === null || Number.isNaN(v) || v < 0) add("error", kind, c.name, `${field}不是 0 以上的整數`);
      }
    }
  }
  for (const c of data.adventurers) {
    if (c.backOf && !data.adventurers.some((f) => f.id === c.backOf)) {
      add("error", "adventurers", c.name, `背面找不到正面 ${c.backOf}`);
    }
  }

  // 道具
  for (const c of data.items) {
    if (!active(c.status)) continue;
    if (c.price === null || Number.isNaN(c.price)) add("error", "items", c.name, "售價不是整數");
  }

  // 任務
  for (const c of data.tasks) {
    if (!active(c.status)) continue;
    if (!TASK_TYPES.includes(c.type)) add("error", "tasks", c.name, `任務時效「${c.type}」不是 ${TASK_TYPES.join("／")} 之一`);
    if (c.type !== "史詩(B)") {
      if (!c.condition) add("error", "tasks", c.name, `任務目標「${c.conditionText}」無法辨識（應為 ≥X、≤X 或 X～Y）`);
      else if (c.condition.op === "between" && c.condition.x > c.condition.y) {
        add("error", "tasks", c.name, `任務目標「${c.conditionText}」的下限大於上限`);
      }
      for (const [field, v] of [["獎勵(金)", c.gold], ["獎勵(聲望)", c.reputation]] as const) {
        if (v === null || Number.isNaN(v)) add("error", "tasks", c.name, `${field}不是整數`);
      }
    }
  }

  // 史詩任務正反面的實裝狀態要一致
  for (const back of data.tasks.filter((t) => t.type.endsWith("(B)"))) {
    const front = data.tasks.find((t) => t.id === back.id && t !== back && !t.type.endsWith("(B)"));
    if (front && front.status !== back.status) {
      add("warning", "tasks", back.name, `背面的實裝狀態「${back.status}」和正面「${front.status}」不同，背面不會被匯入`);
    }
  }

  // 王國榮譽
  for (const c of data.honors) {
    if (!active(c.status)) continue;
    if (!HONOR_ROUTES.includes(c.route)) add("error", "honors", c.name, `路線「${c.route}」不是 ${HONOR_ROUTES.join("／")} 之一`);
    if (!HONOR_KINDS.includes(c.kind)) add("error", "honors", c.name, `類型「${c.kind}」不是 ${HONOR_KINDS.join("／")} 之一`);
    if (!c.condition) add("error", "honors", c.name, "缺少條件");
  }

  // 文字中引用的標籤與卡名
  const known = new Set<string>(RESERVED_TAGS);
  const names: string[] = [];
  const words = new Set<string>();
  for (const c of [...data.adventurers, ...data.derivatives]) {
    c.traits.forEach((t) => known.add(t));
    names.push(c.name);
    words.add(c.race.replace(/\(B\)$/, ""));
    words.add(c.profession.replace(/\(B\)$/, ""));
  }
  // 卡片文字也會用方括號標示種族與職業，例如 [士兵]、[人類]
  for (const w of words) if (w) known.add(`[${w}]`);
  data.tasks.forEach((t) => t.tags.forEach((x) => known.add(x)));
  data.items.forEach((i) => {
    i.categories.forEach((x) => known.add(x));
    names.push(i.name);
  });
  const texts: [CardKind, string, string, readonly string[]][] = [
    ...data.adventurers.map((c) => ["adventurers", c.name, c.skills.map((s) => s.text).join("\n"), c.skills.map((s) => s.name)] as [CardKind, string, string, readonly string[]]),
    ...data.derivatives.map((c) => ["derivatives", c.name, c.skills.map((s) => s.text).join("\n"), c.skills.map((s) => s.name)] as [CardKind, string, string, readonly string[]]),
    ...data.items.map((c) => ["items", c.name, c.effect, []] as [CardKind, string, string, readonly string[]]),
    ...data.tasks.map((c) => ["tasks", c.name, c.specialRule, []] as [CardKind, string, string, readonly string[]]),
  ];
  const statusOf = (kind: CardKind, name: string) =>
    (data[kind] as readonly { name: string; status: string }[]).find((c) => c.name === name)?.status ?? "";
  // 預留標籤：只有在沒有任何任務使用時才提醒
  const activeTaskTags = new Set(data.tasks.filter((t) => active(t.status)).flatMap((t) => t.tags));
  for (const [kind, name, text, ownSkills] of texts) {
    if (!active(statusOf(kind, name))) continue;
    for (const tag of parseTagRefs(text)) {
      if (names.some((n) => strip(n) === strip(tag.slice(1, -1)))) {
        add("warning", kind, name, `${tag} 是卡名，卡名請用【】標示（方括號用於標籤、種族、職業與分類）`);
        continue;
      }
      if (!known.has(tag)) add("warning", kind, name, `引用的標籤 ${tag} 沒有出現在任何冒險者特質、任務標籤或道具分類中`);
      else if (RESERVED_TAGS.includes(tag) && !activeTaskTags.has(tag)) add("warning", kind, name, `引用預留標籤 ${tag}，目前沒有任務帶這個標籤，能力暫時不會觸發`);
    }
    for (const ref of text.match(/【[^】]+】/g) ?? []) {
      if (ownSkills.includes(ref) || KEYWORDS.includes(ref)) continue;
      const inner = strip(ref.slice(1, -1));
      if (names.some((n) => strip(n) === inner || strip(n).includes(inner))) continue;
      if (words.has(ref.slice(1, -1)) || known.has(`[${ref.slice(1, -1)}]`)) {
        add("warning", kind, name, `${ref} 是標籤、種族、職業或分類，請用方括號 [${ref.slice(1, -1)}] 標示（【】用於卡名與技能名）`);
      } else {
        add("warning", kind, name, `引用的 ${ref} 找不到對應的卡名、種族、職業或分類`);
      }
    }
  }
  return issues;
}

function parseTagRefs(text: string): string[] {
  return [...new Set((text.match(/[\[［][^\]］]+[\]］]/g) ?? []).map((t) => `[${t.slice(1, -1)}]`))].filter(
    (t) => !/^\[\d+\]$/.test(t) && t !== "[∞]",
  );
}

export function kindLabel(kind: Issue["kind"]): string {
  return kind === "mapping" ? "子句對照表" : KIND_LABEL[kind];
}
