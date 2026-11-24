import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMapping, parseMapping, type Template } from "../src/mapping.js";
import { parseAll } from "../src/parse.js";
import { path } from "../src/store.js";
import { SHEETS } from "../src/sheets.js";
import type { CardKind } from "../src/types.js";
import { validate } from "../src/validate.js";

/** 以存放庫中的試算表快照（data/raw）做整體檢查。 */
const raw = Object.fromEntries(Object.keys(SHEETS).map((k) => [k, readFileSync(path("raw", `${k}.csv`), "utf-8")])) as Record<CardKind, string>;
const data = parseAll(raw);

describe("試算表快照", () => {
  it("讀得到每一類卡片", () => {
    expect(data.adventurers.length).toBeGreaterThan(60);
    expect(data.tasks.length).toBeGreaterThan(20);
    expect(data.honors.length).toBeGreaterThanOrEqual(12);
  });

  it("冒險者的基礎骰數與薪資來自沒有欄名的欄位", () => {
    const buck = data.adventurers.find((a) => a.id === "STD-C01")!;
    expect(buck.baseDice).toBe(0);
    expect(buck.salary).toBe(5);
    expect(buck.skills.map((s) => s.name)).toEqual(["【坐著數錢就好】", "【時間就是金錢，朋友！】"]);
  });

  it("雙面卡的背面連到正面", () => {
    expect(data.adventurers.find((a) => a.id === "STD-C01B")!.backOf).toBe("STD-C01");
  });

  it("沒有錯誤", () => {
    const templates = JSON.parse(readFileSync(path("skill-templates.json"), "utf-8")) as Template[];
    const clauses = parseMapping(readFileSync(path("skill-mapping.csv"), "utf-8"));
    const errors = [...validate(data), ...checkMapping(data, clauses, templates)].filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });
});
