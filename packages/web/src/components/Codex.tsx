import { useEffect, useMemo, useRef, useState } from "react";
import { backFaces, codexAdventurers, codexDerivatives, type RawAdventurer } from "../data.js";
import { RichText } from "./Cards.js";

type Kind = "adventurer" | "derivative";

/** 冒險者圖鑑：可以篩選、捲動瀏覽，點一張卡進入單張模式左右滑動查看。 */
export function Codex({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("adventurer");
  const [query, setQuery] = useState("");
  const [race, setRace] = useState("");
  const [profession, setProfession] = useState("");
  const [dice, setDice] = useState("");
  const [focus, setFocus] = useState<number | null>(null);

  const pool = kind === "adventurer" ? codexAdventurers : codexDerivatives;
  const races = useMemo(() => [...new Set(pool.map((a) => a.race).filter(Boolean))].sort(), [pool]);
  const professions = useMemo(() => [...new Set(pool.map((a) => a.profession).filter(Boolean))].sort(), [pool]);
  const list = useMemo(() => {
    const q = query.trim();
    return pool.filter((a) => {
      if (race && a.race !== race) return false;
      if (profession && a.profession !== profession) return false;
      if (dice && String(a.baseDice ?? 0) !== dice) return false;
      if (!q) return true;
      const back = backFaces.get(a.id);
      const text = [a, back].filter(Boolean).map((x) => [x!.name, x!.race, x!.profession, x!.traits.join(""), x!.skills.map((s) => s.name + s.text).join("")].join(" ")).join(" ");
      return text.includes(q);
    });
  }, [pool, query, race, profession, dice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") (focus === null ? onClose() : setFocus(null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, onClose]);

  const reset = () => [setRace, setProfession, setDice, setQuery].forEach((f) => f(""));

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog codex" role="dialog" aria-label="冒險者圖鑑" onClick={(e) => e.stopPropagation()}>
        <div className="codex-head">
          <h2>冒險者圖鑑</h2>
          <button onClick={onClose}>關閉</button>
        </div>
        {focus === null ? (
          <>
            <div className="codex-filters">
              <div className="segmented" role="tablist">
                <button className={kind === "adventurer" ? "on" : ""} onClick={() => (setKind("adventurer"), reset())}>冒險者 {codexAdventurers.length}</button>
                <button className={kind === "derivative" ? "on" : ""} onClick={() => (setKind("derivative"), reset())}>衍生物 {codexDerivatives.length}</button>
              </div>
              <input type="search" placeholder="搜尋名稱、特質、技能…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select value={race} onChange={(e) => setRace(e.target.value)} aria-label="種族">
                <option value="">全部種族</option>
                {races.map((r) => <option key={r}>{r}</option>)}
              </select>
              <select value={profession} onChange={(e) => setProfession(e.target.value)} aria-label="職業">
                <option value="">全部職業</option>
                {professions.map((r) => <option key={r}>{r}</option>)}
              </select>
              <select value={dice} onChange={(e) => setDice(e.target.value)} aria-label="基礎骰數">
                <option value="">全部骰數</option>
                {[0, 1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} 骰</option>)}
              </select>
            </div>
            <p className="muted">共 {list.length} 張，點卡片可以放大，並左右滑動查看。</p>
            <div className="codex-grid">
              {list.map((a, i) => (
                <button key={a.id} className="codex-thumb" onClick={() => setFocus(i)}>
                  <CodexCard card={a} />
                </button>
              ))}
              {!list.length && <p className="muted">沒有符合條件的卡片。</p>}
            </div>
          </>
        ) : (
          <Carousel list={list} start={focus} onBack={() => setFocus(null)} />
        )}
      </div>
    </div>
  );
}

/** 單張模式：橫向捲動（手機可以滑動），每次停在一張卡。 */
function Carousel({ list, start, onBack }: { list: readonly RawAdventurer[]; start: number; onBack: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  // 平滑捲動進行中時的目標位置，連續按鍵時從目標繼續往前
  const target = useRef<number | null>(null);

  useEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  const go = (i: number) => {
    const el = track.current;
    if (!el) return;
    const next = Math.max(0, Math.min(list.length - 1, i));
    target.current = next;
    setIndex(next);
    el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const from = target.current ?? index;
      if (e.key === "ArrowRight") go(from + 1);
      if (e.key === "ArrowLeft") go(from - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="carousel">
      <div className="carousel-nav">
        <button onClick={onBack}>← 回到列表</button>
        <span className="muted">{index + 1} / {list.length}</span>
        <span className="row">
          <button onClick={() => go((target.current ?? index) - 1)} disabled={index === 0} aria-label="上一張">‹</button>
          <button onClick={() => go((target.current ?? index) + 1)} disabled={index === list.length - 1} aria-label="下一張">›</button>
        </span>
      </div>
      <div
        className="carousel-track"
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (target.current === null) setIndex(at);
          else if (at === target.current) target.current = null; // 到達目標
        }}
        onTouchStart={() => {
          target.current = null; // 手指滑動時以實際位置為準
        }}
      >
        {list.map((a) => (
          <div key={a.id} className="carousel-slide">
            <CodexCard card={a} large />
          </div>
        ))}
      </div>
    </div>
  );
}

function CodexCard({ card, large }: { card: RawAdventurer; large?: boolean }) {
  const back = backFaces.get(card.id);
  return (
    <div className={`card adventurer codex-card${large ? " large" : ""}`}>
      <Face card={card} large={large} badge={back ? "雙面" : undefined} />
      {large && back && (
        <div className="codex-back">
          <div className="muted">背面</div>
          <Face card={back} large />
        </div>
      )}
    </div>
  );
}

function Face({ card, large, badge }: { card: RawAdventurer; large?: boolean; badge?: string }) {
  return (
    <>
      <div className="card-head">
        <span className="card-name">{card.name}</span>
        {badge && <span className="badge alt">{badge}</span>}
        {card.status === "測試" && <span className="badge">測試</span>}
      </div>
      <div className="card-type">{[card.race, card.profession].filter(Boolean).join("．")}</div>
      {card.traits.length > 0 && <div className="card-type traits">{card.traits.join("")}</div>}
      <div className="card-stats">
        <span title="基礎骰數">🎲 {card.baseDice ?? 0}</span>
        <span title="薪資">💰 {card.salary ?? 0}</span>
        {large && <span className="muted">{card.id}</span>}
      </div>
      <div className="card-body">
        {card.skills.map((s) => (
          <div key={s.name} className="skill">
            <b>{s.name}</b>
            <div>
              <RichText text={s.text} />
            </div>
          </div>
        ))}
        {card.flavor && <div className="flavor">{card.flavor}</div>}
        {large && card.englishName && <div className="muted">{card.englishName}</div>}
        {large && card.story && <div className="story">{card.story}</div>}
      </div>
    </>
  );
}
