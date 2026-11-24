import { describe, expect, it } from "vitest";
import { parseCsv, stringifyCsv } from "../src/csv.js";
import { parseCondition, parseSkills, parseTags } from "../src/parse.js";

describe("CSV", () => {
  it("處理引號內的逗號、換行與跳脫的引號", () => {
    const rows = parseCsv('a,"b,c","d\ne","f""g"\n1,2,3,4\n');
    expect(rows).toEqual([
      ["a", "b,c", "d\ne", 'f"g'],
      ["1", "2", "3", "4"],
    ]);
  });

  it("讀寫來回一致，並忽略 BOM", () => {
    const rows = [["卡片編號", "技能"], ["STD-C01", "【坐著數錢就好】\n此冒險者不會於輪末重置。"]];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
  });
});

describe("任務目標", () => {
  it("辨識三種條件", () => {
    expect(parseCondition("≥9")).toEqual({ op: "atLeast", x: 9 });
    expect(parseCondition("≤ 6")).toEqual({ op: "atMost", x: 6 });
    expect(parseCondition("8～13")).toEqual({ op: "between", x: 8, y: 13 });
  });

  it("無法辨識時回傳 null", () => {
    expect(parseCondition("")).toBeNull();
    expect(parseCondition("至少九")).toBeNull();
  });
});

describe("技能與標籤", () => {
  it("依【名稱】與空行切分技能", () => {
    const skills = parseSkills("【坐著數錢就好】\n此冒險者不會於輪末重置。\n輪末結算時……\n\n【時間就是金錢，朋友！】\n支付5金幣：重置一名冒險者。");
    expect(skills.map((s) => s.name)).toEqual(["【坐著數錢就好】", "【時間就是金錢，朋友！】"]);
    expect(skills[0]!.text).toBe("此冒險者不會於輪末重置。\n輪末結算時……");
  });

  it("N/A 與空白沒有技能", () => {
    expect(parseSkills("N/A")).toEqual([]);
    expect(parseSkills("")).toEqual([]);
  });

  it("辨識半形與全形方括號的標籤", () => {
    expect(parseTags("[王國][守則]")).toEqual(["[王國]", "[守則]"]);
    expect(parseTags("［狀態］")).toEqual(["[狀態]"]);
  });
});
