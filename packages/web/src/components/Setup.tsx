import { useState } from "react";
import type { GameConfig, HonorDraw, HonorMode } from "../../../engine/src/index.js";
import { builtAt } from "../data.js";
import { Rules } from "./Rules.js";

export function Setup({ onStart, error }: { onStart: (c: GameConfig) => void; error: string | null }) {
  const [names, setNames] = useState(["玩家一", "玩家二", "玩家三", "玩家四"]);
  const [honorMode, setHonorMode] = useState<HonorMode>("selection");
  const [honorDraw, setHonorDraw] = useState<HonorDraw>("balanced");
  const [includeTest, setIncludeTest] = useState(true);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1_000_000)));
  const [showRules, setShowRules] = useState(false);

  return (
    <div className="setup">
      <div className="setup-head">
        <h1>冒險者公會　測試模式</h1>
        <button onClick={() => setShowRules(true)}>簡易規則</button>
      </div>
      {showRules && <Rules onClose={() => setShowRules(false)} />}
      <p className="muted">一個人在同一個畫面操作 4 個公會，用來試玩規則與卡片。卡片資料版本：{builtAt.slice(0, 16).replace("T", " ")}</p>
      <section>
        <h2>玩家</h2>
        <div className="grid2">
          {names.map((n, i) => (
            <input key={i} value={n} onChange={(e) => setNames(names.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
        </div>
      </section>
      <section>
        <h2>王國榮譽</h2>
        <label>
          模式
          <select value={honorMode} onChange={(e) => setHonorMode(e.target.value as HonorMode)}>
            <option value="selection">王國評選（隱藏，終局揭示）</option>
            <option value="assignment">王國指派（每人 3 張）</option>
            <option value="competition">王國競爭（開局公開）</option>
          </select>
        </label>
        <label>
          抽卡方式
          <select value={honorDraw} onChange={(e) => setHonorDraw(e.target.value as HonorDraw)}>
            <option value="balanced">依路線平均</option>
            <option value="random">完全隨機</option>
          </select>
        </label>
      </section>
      <section>
        <h2>卡池</h2>
        <label className="check">
          <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
          加入實裝狀態為「測試」的卡片
        </label>
        <p className="muted">史詩任務暫時排除。</p>
        <label>
          種子（同樣的種子會得到同樣的牌序與擲骰）
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} />
        </label>
      </section>
      {error && <div className="error">{error}</div>}
      <button
        className="primary big"
        onClick={() =>
          onStart({
            seed: Number(seed || 1),
            players: names.map((name, i) => ({ id: `P${i + 1}`, name: name || `玩家${i + 1}` })),
            honorMode,
            honorDraw,
            includeEpic: false,
            includeTest,
          })
        }
      >
        開始遊戲
      </button>
    </div>
  );
}
