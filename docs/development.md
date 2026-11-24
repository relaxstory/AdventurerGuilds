# 開發說明

## 環境

- Node.js 22 以上
- 安裝套件：`npm install`

## 專案結構

| 位置 | 內容 |
|---|---|
| `packages/engine` | 規則引擎（純邏輯，不碰網路與資料庫）。`applyAction(狀態, 操作)` 回傳新狀態；包含開局、公會／冒險／整理階段、輪末、王國榮譽計分與 AI 玩家 |
| `packages/web` | M4 測試模式的網頁（React + Vite），直接在瀏覽器執行規則引擎，打包成單一 HTML 檔 |
| `scripts/simulate.ts` | 多局模擬統計 |
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
| `npm run web:dev` | 啟動測試模式的開發伺服器 |
| `npm run web:build` | 打包測試模式為 `packages/web/dist/index.html`（單一檔案，用瀏覽器直接開啟） |
| `npm run abilities` | 更新能力實作進度表 `docs/ability-status.md` |
| `npm run sim -- 200` | 用 AI 玩家跑 200 局模擬，統計整體數據 |
| `npm run cards:update` | 從 Google 試算表下載最新內容，產生卡片資料與檢查報告 |
| `npm run cards:build` | 不下載，只用 `data/raw/` 的快照重新產生 |
| `npm run cards:publish -- --name alpha1.0` | 把目前的卡片資料發布為新版本，`--name` 為版本名稱（省略時為 v1、v2…）。有錯誤時會拒絕發布 |

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

## 規則引擎

| 檔案 | 內容 |
|---|---|
| `setup.ts` | 開局：依卡池組成牌庫、抽王國榮譽卡 |
| `actions.ts` | 玩家操作：招募、接任務、派遣、逾期懲罰、升級、結束回合；輪末結算 |
| `honors.ts` | 王國榮譽的評選方式與終局計分 |
| `abilities.ts` | 卡片能力：依技能子句查詢修正值、在固定時機觸發效果。`IMPLEMENTED` 列出已實作的技能模板 |
| `activate.ts` | 主動能力（代價：效果）與玩家決定（布魯斯、里諾、狂人里諾） |
| `items.ts` | 道具：取得、道具區上限、使用、出售、【獨特】與 [狀態] 道具 |
| `lifecycle.ts` | 衍生物的創造與銷毀、冒險者與道具的銷毀（含替代效果）、聲望下降觸發、回合開始與任務結算後的效果 |
| `bot.ts` | 簡單的 AI 玩家與整局模擬 |

### 玩家操作

| 階段 | 操作 |
|---|---|
| 公會階段 | `recruit`（招募，可指定解僱對象）、`acceptTask`（接任務）、`endGuildPhase` |
| 冒險階段 | `dispatch`（選任務與冒險者、支付薪資、橫置）→ `roll`（擲骰前的選擇：預言、自選骰數；建立骰池、擲骰）→ `adjust`（擲骰後的能力：重擲、轉動、移除、加注、調整結果值，可使用多次）→ `resolve`（計算結果、判定、結算）；`endAdventurePhase`（進入整理階段，自動處理時限與逾期） |
| 自己的回合 | `useItem`（使用道具）；`activate`（發動主動能力：檢查時機、代價與目標）；`decide`（回應等待中的決定，由被要求的玩家做出） |
| 公會整理階段 | `choosePenalty`（逾期懲罰需要選擇時）、`sell`（出售道具）、`upgrade`（升級公會）、`endTurn` |

能力的實作進度見 `docs/ability-status.md`（`npm run abilities` 產生）。目前所有實裝與測試中的卡片能力都已實作；史詩任務暫時排除，未實裝的卡片（荊棘玫瑰）不實作。

### 實作上的簡化

| 項目 | 做法 |
|---|---|
| 守門員小嗶【不可以過！】 | 對手以不利的效果（橫置、縮小藥劑、紅斑菌菇）指定你的冒險者時，**一定會使用**守門員小嗶（它輪末就會被銷毀，保留沒有好處）。不論擲骰結果是取消或轉移，原本的目標都不受影響 |
| 學舌鳥【伶牙俐齒】 | 發動其他冒險者的主動能力時，以 `copy` 參數同時指定學舌鳥；複製的效果中「此冒險者」指學舌鳥 |
| 回合開始時創造的彌的粉絲 | 自動創造（沒有壞處） |
| 比爾、凱莉回合結束時的道具 | 自動獲得；道具區滿了時，可以捨棄新拿到的那個，等同於不拿 |

## 測試

- `packages/*/test/` 底下的 `*.test.ts`，使用 Vitest。
- `packages/cards/test/snapshot.test.ts` 會用 `data/raw/` 的快照做整體檢查，確保目前的卡片資料沒有錯誤。
