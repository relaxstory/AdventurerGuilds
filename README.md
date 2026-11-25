# AdventurerGuilds《冒險者公會》

線上桌遊專案。

## 文件

| 文件 | 內容 |
|---|---|
| [規則規格書](docs/spec.md) | 遊戲規則（以此為準） |
| [線上版功能規格](docs/digital-spec.md) | 線上版的功能、卡片資料流程 |
| [版本紀錄與設計待辦](docs/versions.md) | 各內部版本的規則變更、待決定的設計事項 |
| [卡片設計紀錄](docs/cards.md) | 卡片規則檢查、試算表修改清單、王國榮譽卡 |
| [任務設計紀錄](docs/tasks.md) | 任務難度參考、任務數值建議 |
| [卡片能力](docs/abilities.md) | 技能模板清單、能力實作進度（程式產生） |
| [模擬紀錄](docs/simulations.md) | AI 模擬報告、給其他 AI 助理的諮詢文件 |

## 開發

- [開發說明](docs/development.md)
- 卡片檢查報告：`data/reports/card-report.md`
- 卡片更新紀錄：`data/CHANGELOG.md`

```
npm install
npm run check          # 型別檢查與測試
npm run cards:update   # 從試算表更新卡片資料
```
