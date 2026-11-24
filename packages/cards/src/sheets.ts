/** Google 試算表「卡片設計表」。卡片的唯一正本。 */
export const SHEET_ID = "1MH1l8YF89ZLhqfS7JgtykSwjbNcJa_H65Zye-xB3lzY";

/** 管線讀取的分頁：key 為本地檔名，value 為試算表的分頁名稱。 */
export const SHEETS = {
  adventurers: "冒險者",
  derivatives: "衍生物",
  items: "道具",
  tasks: "任務",
  honors: "王國榮譽",
} as const;

export function sheetCsvUrl(sheetName: string): string {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

/** 下載一個分頁的 CSV。試算表需要開放「知道連結的人可以檢視」。 */
export async function fetchSheet(sheetName: string): Promise<string> {
  const res = await fetch(sheetCsvUrl(sheetName));
  if (!res.ok) throw new Error(`下載「${sheetName}」失敗：HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`下載「${sheetName}」得到網頁而不是 CSV，請確認試算表的分享設定`);
  }
  return text;
}
