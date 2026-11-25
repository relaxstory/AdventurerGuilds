import { createContext, useContext, type ReactNode } from "react";
import { abilities as ab, type CardLibrary, type GameState } from "../../../engine/src/index.js";
import { adventurerText, itemText, taskText } from "../data.js";

/** 點選卡片時放大顯示：kind 為卡片種類，uid 為卡片。 */
export type Inspected = { readonly kind: "adventurer" | "task" | "item"; readonly uid: string };
export const InspectContext = createContext<((c: Inspected) => void) | null>(null);

function useClick(kind: Inspected["kind"], uid: string, onClick?: () => void) {
  const inspect = useContext(InspectContext);
  return () => {
    inspect?.({ kind, uid });
    onClick?.();
  };
}

/** 卡片文字：【技能名】粗體，[標籤] 以標籤樣式顯示，保留換行。 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(【[^】]+】|\[[^\]]+\])/g);
  return (
    <span className="rich">
      {parts.map((p, i) =>
        p.startsWith("【") ? <b key={i}>{p}</b> : p.startsWith("[") ? <span key={i} className="tag">{p}</span> : <span key={i}>{p}</span>,
      )}
    </span>
  );
}

function Tokens({ tokens }: { tokens: Record<string, number> }) {
  const entries = Object.entries(tokens).filter(([, n]) => n > 0);
  if (!entries.length) return null;
  return (
    <div className="tokens">
      {entries.map(([k, n]) => (
        <span key={k} className="token">
          {k} ×{n}
        </span>
      ))}
    </div>
  );
}

export function AdventurerCard({
  state,
  lib,
  uid,
  selected,
  onClick,
  children,
  large,
}: {
  state: GameState;
  lib: CardLibrary;
  uid: string;
  selected?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  large?: boolean;
}) {
  const click = useClick("adventurer", uid, onClick);
  const card = state.adventurerCards[uid]!;
  const face = ab.faceOf(state, lib, uid);
  const raw = adventurerText.get(face.id);
  const members = ab.members(state, uid);
  const dice = ab.unitBaseDice(state, lib, uid);
  const salary = ab.unitSalary(state, lib, uid);
  return (
    <div
      className={`card adventurer${card.tapped ? " tapped" : ""}${selected ? " selected" : ""}${card.derivative ? " derivative" : ""}${large ? " large" : ""}`}
      onClick={large ? undefined : click}
    >
      <div className="card-head">
        <span className="card-name">{face.name}</span>
        {card.tapped && <span className="badge">橫置</span>}
        {card.derivative && <span className="badge alt">衍生物</span>}
      </div>
      <div className="card-type">
        {[face.race, face.profession].filter(Boolean).join("．")} {face.traits.join("")}
      </div>
      <div className="card-stats">
        <span title="基礎骰數">🎲 {dice}</span>
        <span title="薪資">💰 {salary}</span>
        {members.length > 1 && <span title="小隊人數">👥 {members.length}</span>}
      </div>
      {members.length > 1 && (
        <div className="squad">小隊：{members.map((m) => ab.faceOf(state, lib, m).name).join(" › ")}</div>
      )}
      <div className="card-body">
        {(raw?.skills ?? []).map((s) => (
          <div key={s.name} className="skill">
            <b>{s.name}</b>
            <div>
              <RichText text={s.text} />
            </div>
          </div>
        ))}
        {raw?.flavor && <div className="flavor">{raw.flavor}</div>}
        {large && raw?.englishName && <div className="muted">{raw.englishName}</div>}
        {large && raw?.story && <div className="story">{raw.story}</div>}
      </div>
      <Tokens tokens={card.tokens} />
      {card.workshop && card.workshop.length > 0 && <div className="squad">工作室：{card.workshop.join("、")}</div>}
      {children && <div className="card-actions" onClick={(e) => e.stopPropagation()}>{children}</div>}
    </div>
  );
}

export function TaskCard({
  state,
  lib,
  uid,
  timer,
  selected,
  onClick,
  children,
  large,
}: {
  state: GameState;
  lib: CardLibrary;
  uid: string;
  timer?: number | null;
  selected?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  large?: boolean;
}) {
  const click = useClick("task", uid, onClick);
  const card = state.taskCards[uid]!;
  const def = lib.task(card.defKey);
  const raw = taskText.get(card.defKey);
  return (
    <div className={`card task${selected ? " selected" : ""}${large ? " large" : ""}`} onClick={large ? undefined : click}>
      <div className="card-head">
        <span className="card-name">{def.name}</span>
        <span className={`badge type-${def.type}`}>{def.type}</span>
      </div>
      <div className="card-stats">
        <span className="target">目標 {raw?.conditionText}</span>
        <span>💰 {def.gold ?? 0}</span>
        <span>⭐ {def.reputation ?? 0}</span>
      </div>
      <div className="card-type">{def.tags.join("")}</div>
      <div className="card-body">
        <RichText text={raw?.description ?? ""} />
        {raw?.specialRule && raw.specialRule !== "N/A" && (
          <div className="skill">
            <RichText text={raw.specialRule} />
          </div>
        )}
        {raw?.flavor && <div className="flavor">{raw.flavor}</div>}
        {large && raw?.client && <div className="muted">委託人：{raw.client}</div>}
      </div>
      <div className="tokens">
        {timer !== undefined && <span className="token timer">{timer === null ? "[∞]" : `時限 [${timer}]`}</span>}
        {card.attempts > 0 && <span className="token">嘗試 ×{card.attempts}</span>}
        {card.completions > 0 && <span className="token">完成 ×{card.completions}</span>}
      </div>
      {children && <div className="card-actions" onClick={(e) => e.stopPropagation()}>{children}</div>}
    </div>
  );
}

export function ItemCard({ state, uid, children, large }: { state: GameState; uid: string; children?: ReactNode; large?: boolean }) {
  const click = useClick("item", uid);
  const item = state.itemCards[uid]!;
  const raw = itemText.get(item.name);
  return (
    <div className={`card item${large ? " large" : ""}`} onClick={large ? undefined : click}>
      <div className="card-head">
        <span className="card-name">{item.name}</span>
        <span className="badge">售價 {raw?.price ?? 0}</span>
      </div>
      <div className="card-type">{raw?.categories.join("")}</div>
      <div className="card-body">
        {raw?.effect && raw.effect !== "N/A" && <RichText text={raw.effect} />}
        {raw?.flavor && <div className="flavor">{raw.flavor}</div>}
      </div>
      <Tokens tokens={item.tokens} />
      {children && <div className="card-actions">{children}</div>}
    </div>
  );
}

/** 放大顯示的卡片：顯示完整的卡片文字。 */
export function CardPreview({ state, lib, card, onClose }: { state: GameState; lib: CardLibrary; card: Inspected; onClose: () => void }) {
  const exists =
    card.kind === "adventurer" ? !!state.adventurerCards[card.uid] : card.kind === "task" ? !!state.taskCards[card.uid] : !!state.itemCards[card.uid];
  if (!exists) return null;
  return (
    <div className="preview" role="dialog" aria-label="卡片放大">
      <button className="preview-close" onClick={onClose} aria-label="關閉">關閉</button>
      {card.kind === "adventurer" && <AdventurerCard state={state} lib={lib} uid={card.uid} large />}
      {card.kind === "task" && <TaskCard state={state} lib={lib} uid={card.uid} large />}
      {card.kind === "item" && <ItemCard state={state} uid={card.uid} large />}
    </div>
  );
}
