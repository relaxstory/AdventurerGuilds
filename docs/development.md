# 開發說明

## 環境

- Node.js 22 以上
- 安裝套件：`npm install`

## 專案結構

| 位置 | 內容 |
|---|---|
| `packages/engine` | 規則引擎（純邏輯，不碰網路與資料庫）。目前有固定種子亂數、擲骰、難度調整與判定 |
| `packages/cards` | 卡片資料管線：讀取試算表、轉成資料、檢查、比對差異、發布版本 |
| `data/raw/` | 試算表各分頁的 CSV 快照 |
| `data/cards.json` | 由快照產生的卡片資料（工作版本，尚未發布） |
| `data/versions/` | 已發布的卡片版本（`v1.json`、`v2.json`…）與 `index.json` |
| `data/CHANGELOG.md` | 卡片更新紀錄，發布時自動產生 |
| `data/reports/card-report.md` | 最近一次的檢查報告 |
| `data/skill-mapping.csv` | 技能子句對照表（由管線與 Claude 維護，不放進試算表） |
| `data/skill-templates.json` | 技能模板清單，由 `tools/skill_templates.py` 產生 |
| `tools/` | 產生文件用的 Python 腳本 |

## 指令

| 指令 | 用途 |
|---|---|
| `npm run check` | 型別檢查加上全部測試 |
| `npm test` | 執行測試 |
| `npm run cards:update` | 從 Google 試算表下載最新內容，產生卡片資料與檢查報告 |
| `npm run cards:build` | 不下載，只用 `data/raw/` 的快照重新產生 |
| `npm run cards:publish` | 把目前的卡片資料發布為新版本（有錯誤時會拒絕發布） |

`cards:update` 需要能連到 docs.google.com，試算表要開放「知道連結的人可以檢視」。

## 卡片更新流程

對應 `docs/digital-spec.md` 第 7 節。

1. 設計者修改試算表後通知 Claude。
2. 執行 `npm run cards:update`，閱讀 `data/reports/card-report.md`：
   - **錯誤**：必須修正，否則無法發布。例如任務目標無法辨識、技能沒有對應的模板。
   - **提醒**：不影響發布，但建議處理。例如標示方式不一致、引用預留標籤。
   - **技能數值變更**：只改數字時，子句對照表會自動更新；句型改變時標示「需要確認」，由 Claude 檢查子句。
3. 技能沒有對應模板時，Claude 在 `data/skill-mapping.csv` 加上子句；需要新機制時，在 `tools/skill_templates.py` 新增模板並開發程式。
4. 設計者確認後，執行 `npm run cards:publish`。

## 測試

- `packages/*/test/` 底下的 `*.test.ts`，使用 Vitest。
- `packages/cards/test/snapshot.test.ts` 會用 `data/raw/` 的快照做整體檢查，確保目前的卡片資料沒有錯誤。
