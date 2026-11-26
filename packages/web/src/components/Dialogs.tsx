import { useState } from "react";
import {
  abilities as ab,
  activatedSkills,
  items as it,
  type Action,
  type ActivateParams,
  type CardLibrary,
  type GameState,
} from "../../../engine/src/index.js";

type Act = (a: Action) => boolean;

const allAdventurers = (state: GameState) => state.players.flatMap((p) => p.adventurers);
const advName = (state: GameState, lib: CardLibrary, uid: string) => {
  const owner = ab.ownerOf(state, uid);
  return `${ab.faceOf(state, lib, uid).name}${owner ? `（${owner.name}）` : ""}${state.adventurerCards[uid]!.tapped ? "［橫置］" : ""}`;
};

function TargetPicker({
  state,
  lib,
  candidates,
  value,
  onChange,
  label = "指定冒險者",
}: {
  state: GameState;
  lib: CardLibrary;
  candidates: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
  label?: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div className="pick-list">
        {candidates.map((u) => (
          <label key={u} className="check">
            <input type="checkbox" checked={value.includes(u)} onChange={(e) => onChange(e.target.checked ? [...value, u] : value.filter((x) => x !== u))} />
            {advName(state, lib, u)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** 依技能的效果子句，顯示需要的參數欄位。 */
function ParamFields({
  state,
  lib,
  card,
  codes,
  clauseX,
  params,
  set,
}: {
  state: GameState;
  lib: CardLibrary;
  card: string;
  codes: string[];
  clauseX: Record<string, string>;
  params: Partial<ActivateParams>;
  set: (p: Partial<ActivateParams>) => void;
}) {
  const owner = ab.ownerOf(state, card)!;
  const needsTargets = codes.some((c) =>
    ["EFF_RESET", "EFF_TAP_WITH_TRAIT", "EFF_TAP_BASE_DICE_BELOW", "EFF_TRANSFER_TOKENS_DESTROY", "EFF_DISCARD_RECRUIT", "ADD_PARTICIPANT", "EFF_FLIP_DOUBLE_TEMP"].includes(c),
  );
  const ownOnly = codes.some((c) => ["EFF_DISCARD_RECRUIT", "ADD_PARTICIPANT", "EFF_FLIP_DOUBLE_TEMP"].includes(c));
  const candidates = (ownOnly ? owner.adventurers : allAdventurers(state)).filter((u) => u !== card);
  const workshop = state.adventurerCards[card]?.workshop ?? [];
  return (
    <>
      {needsTargets && (
        <TargetPicker state={state} lib={lib} candidates={candidates} value={[...(params.targets ?? [])]} onChange={(v) => set({ ...params, targets: v })} />
      )}
      {codes.some((c) => c.startsWith("EFF_OPPONENT")) && (
        <label>
          選擇玩家
          <select value={params.player ?? ""} onChange={(e) => set({ ...params, player: e.target.value })}>
            <option value="">—</option>
            {state.players.filter((p) => p.id !== owner.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}（金幣 {p.gold}）</option>
            ))}
          </select>
        </label>
      )}
      {codes.includes("EFF_RETRIEVE_TASK") && (
        <label>
          從任務棄置區取回
          <select value={params.task ?? ""} onChange={(e) => set({ ...params, task: e.target.value })}>
            <option value="">—</option>
            {state.taskDiscard.map((t) => (
              <option key={t} value={t}>{lib.task(state.taskCards[t]!.defKey).name}</option>
            ))}
          </select>
        </label>
      )}
      {codes.includes("EFF_DISCARD_RECRUIT") && (
        <label>
          從酒館招募
          <select value={params.tavernIndex ?? ""} onChange={(e) => set({ ...params, tavernIndex: Number(e.target.value) })}>
            <option value="">—</option>
            {state.tavern.map((u, i) => (
              <option key={u} value={i}>{ab.faceOf(state, lib, u).name}</option>
            ))}
          </select>
        </label>
      )}
      {codes.includes("EFF_GAIN_ITEM_CHOICE") && (
        <label>
          獲得的道具
          <select value={params.item ?? ""} onChange={(e) => set({ ...params, item: e.target.value })}>
            <option value="">—</option>
            {it.splitList(clauseX["EFF_GAIN_ITEM_CHOICE"] ?? "").map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {codes.includes("EFF_CREATE_FROM_WORKSHOP") && (
        <label>
          從工作室創造
          <select value={params.derivative ?? ""} onChange={(e) => set({ ...params, derivative: e.target.value })}>
            <option value="">—</option>
            {workshop.map((n, i) => (
              <option key={`${n}${i}`} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}
      {codes.some((c) => ["EFF_ADD_TOKENS_SELF", "EFF_CONVERT_ITEMS", "EFF_CREATE_FROM_WORKSHOP"].includes(c)) && (
        <label>
          {codes.includes("EFF_CREATE_FROM_WORKSHOP") ? "轉移的精工指示物數量（留空＝全部）" : "數量"}
          <input
            type="number"
            min={0}
            value={params.count ?? ""}
            onChange={(e) => set({ ...params, count: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
      )}
    </>
  );
}

/** 發動主動能力的對話框。 */
export function ActivateDialog({
  state,
  lib,
  card,
  skill,
  act,
  onClose,
}: {
  state: GameState;
  lib: CardLibrary;
  card: string;
  skill: string;
  act: Act;
  onClose: () => void;
}) {
  const clauses = activatedSkills(state, lib, card).get(skill) ?? [];
  const codes = clauses.map((c) => c.code);
  const clauseX = Object.fromEntries(clauses.map((c) => [c.code, c.x]));
  const [params, setParams] = useState<Partial<ActivateParams>>({});
  const [copyParams, setCopyParams] = useState<Partial<ActivateParams>>({});
  const owner = ab.ownerOf(state, card)!;
  const birds = owner.adventurers.filter((u) => u !== card && ab.has(state, lib, u, "EFF_COPY_ABILITY") && !state.adventurerCards[u]!.tapped);
  const [bird, setBird] = useState("");
  const name = ab.faceOf(state, lib, card).name;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>
          發動 {name}
          {skill}
        </h3>
        <ParamFields state={state} lib={lib} card={card} codes={codes} clauseX={clauseX} params={params} set={setParams} />
        {birds.length > 0 && (
          <fieldset>
            <legend>學舌鳥【伶牙俐齒】</legend>
            <label>
              <select value={bird} onChange={(e) => setBird(e.target.value)}>
                <option value="">不複製</option>
                {birds.map((b) => (
                  <option key={b} value={b}>用 {ab.faceOf(state, lib, b).name} 複製效果</option>
                ))}
              </select>
            </label>
            {bird && (
              <>
                <p className="muted">複製時另外指定的參數（不指定就沿用上面的設定）：</p>
                <ParamFields state={state} lib={lib} card={card} codes={codes} clauseX={clauseX} params={copyParams} set={setCopyParams} />
              </>
            )}
          </fieldset>
        )}
        <div className="row">
          <button
            className="primary"
            onClick={() => {
              const ok = act({
                type: "activate",
                card,
                skill,
                ...params,
                ...(bird ? { copy: { card: bird, params: copyParams } } : {}),
              } as Action);
              if (ok) onClose();
            }}
          >
            發動
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 使用道具的對話框（需要指定冒險者時）。 */
export function UseItemDialog({
  state,
  lib,
  item,
  act,
  onClose,
}: {
  state: GameState;
  lib: CardLibrary;
  item: string;
  act: Act;
  onClose: () => void;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const name = state.itemCards[item]!.name;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>使用【{name}】</h3>
        <TargetPicker state={state} lib={lib} candidates={allAdventurers(state)} value={targets} onChange={setTargets} label="選擇一名冒險者" />
        <div className="row">
          <button className="primary" onClick={() => act({ type: "useItem", item, targets }) && onClose()}>
            使用
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 等待某位玩家做決定。 */
export function PendingPanel({ state, lib, act }: { state: GameState; lib: CardLibrary; act: Act }) {
  const pending = state.pending!;
  const who = state.players.find((p) => p.id === pending.player)!;
  const [picked, setPicked] = useState<string[]>([]);
  const decide = (decision: object) => act({ type: "decide", decision } as Action);
  const upright = who.adventurers.filter((u) => !state.adventurerCards[u]!.tapped);
  const itemName = (u: string) => state.itemCards[u]?.name ?? u;
  let body: JSX.Element;
  switch (pending.kind) {
    case "tapOrPay":
    case "tapOrFlip":
      body = (
        <>
          <p>
            {ab.faceOf(state, lib, pending.source).name} 的能力：請選擇一項。
          </p>
          <div className="row wrap">
            {upright.map((u) => (
              <button key={u} onClick={() => decide({ option: "tap", target: u })}>
                橫置 {ab.faceOf(state, lib, u).name}
              </button>
            ))}
            {/* 只顯示可以完整執行的選項（例如學舌鳥複製時，學舌鳥無法翻面） */}
            {pending.kind === "tapOrPay"
              ? (state.players.find((x) => x.id === pending.player)?.gold ?? 0) >= pending.amount && (
                  <button onClick={() => decide({ option: "pay" })}>支付 {pending.amount} 金</button>
                )
              : ab.canFlip(state, lib, pending.source) && (
                  <button onClick={() => decide({ option: "flip" })}>讓 {ab.faceOf(state, lib, pending.source).name} 翻面</button>
                )}
          </div>
        </>
      );
      break;
    case "tapTarget":
      body = (
        <div className="row wrap">
          {pending.targets.map((u) => (
            <button key={u} onClick={() => decide({ option: "tap", target: u })}>
              橫置 {advName(state, lib, u)}
            </button>
          ))}
        </div>
      );
      break;
    case "fireForRecruit":
      body = (
        <>
          <p>{ab.faceOf(state, lib, pending.recruit).name} 賴著不走：冒險者已滿，請選擇一名要解僱的冒險者（他會回到酒館）。</p>
          <div className="row wrap">
            {pending.candidates.map((u) => (
              <button key={u} onClick={() => decide({ option: "fire", target: u })}>
                解僱 {advName(state, lib, u)}
              </button>
            ))}
          </div>
        </>
      );
      break;
    case "discardItem":
      body = (
        <>
          <p>道具區已滿，請捨棄一個道具。</p>
          <div className="row wrap">
            {pending.items.map((u) => (
              <button key={u} onClick={() => decide({ option: "discard", target: u })}>捨棄【{itemName(u)}】</button>
            ))}
          </div>
        </>
      );
      break;
    case "chooseItem":
      body = (
        <div className="row wrap">
          {pending.options.map((n) => (
            <button key={n} onClick={() => decide({ option: "item", name: n })}>獲得【{n}】</button>
          ))}
          {pending.optional && <button onClick={() => decide({ option: "skip" })}>不拿</button>}
        </div>
      );
      break;
    case "givePlayer":
      body = (
        <>
          <p>把【{pending.item}】放在哪一位玩家面前？</p>
          <div className="row wrap">
            {state.players.filter((p) => p.id !== who.id).map((p) => (
              <button key={p.id} onClick={() => decide({ option: "player", target: p.id })}>{p.name}</button>
            ))}
          </div>
        </>
      );
      break;
    case "chooseWorkshop":
      body = (
        <>
          <p>選擇 {pending.count} 張不同名稱的小嗶放進工作室：</p>
          <div className="pick-list">
            {pending.options.map((n) => (
              <label key={n} className="check">
                <input type="checkbox" checked={picked.includes(n)} onChange={(e) => setPicked(e.target.checked ? [...picked, n] : picked.filter((x) => x !== n))} />
                {n}
              </label>
            ))}
          </div>
          <button className="primary" onClick={() => decide({ option: "workshop", names: picked }) && setPicked([])}>確定</button>
        </>
      );
      break;
    case "resetAdventurers":
      body = (
        <>
          <p>可以重置至多 {pending.count} 名冒險者：</p>
          <div className="pick-list">
            {pending.candidates.map((u) => (
              <label key={u} className="check">
                <input type="checkbox" checked={picked.includes(u)} onChange={(e) => setPicked(e.target.checked ? [...picked, u] : picked.filter((x) => x !== u))} />
                {ab.faceOf(state, lib, u).name}
              </label>
            ))}
          </div>
          <button className="primary" onClick={() => decide({ option: "reset", targets: picked }) && setPicked([])}>確定</button>
        </>
      );
      break;
    case "extendTask":
      body = (
        <div className="row wrap">
          {pending.candidates.map((t) => (
            <button key={t} onClick={() => decide({ option: "task", target: t })}>「{lib.task(state.taskCards[t]!.defKey).name}」時限 +{pending.amount}</button>
          ))}
          <button onClick={() => decide({ option: "skip" })}>不使用</button>
        </div>
      );
      break;
    case "destroyOwn":
      body = (
        <>
          <p>
            {state.adventurerCards[pending.source]
              ? `${ab.faceOf(state, lib, pending.source).name}【我很抱歉】：請銷毀一名參與這次任務的冒險者。`
              : `【${itemName(pending.source)}】：請銷毀自己公會中的一名冒險者。`}
          </p>
          <div className="row wrap">
            {pending.candidates.map((u) => (
              <button key={u} onClick={() => decide({ option: "destroy", target: u })}>銷毀 {ab.faceOf(state, lib, u).name}</button>
            ))}
          </div>
        </>
      );
      break;
    case "confirmRescue": {
      const targetOwner = ab.ownerOf(state, pending.target);
      body = (
        <>
          <p>
            {targetOwner?.name ?? ""} 的 {ab.faceOf(state, lib, pending.target).name} 將被銷毀。要橫置 {ab.faceOf(state, lib, pending.rescuer).name} 使用【恢復術】，改為橫置該冒險者嗎？
            {targetOwner?.id === pending.player ? "（自己公會：之後會重置該冒險者）" : "（其他公會：你提升 2 聲望）"}
          </p>
          <div className="row">
            <button onClick={() => decide({ option: "yes" })}>使用恢復術</button>
            <button onClick={() => decide({ option: "no" })}>不使用</button>
          </div>
        </>
      );
      break;
    }
    case "confirmReplace":
      body = (
        <>
          <p>
            {pending.what === "adventurer"
              ? `${ab.faceOf(state, lib, pending.target).name} 將被銷毀。要改為銷毀 ${ab.faceOf(state, lib, pending.replacement).name} 嗎？`
              : `【${itemName(pending.target)}】將被銷毀。要改為銷毀【${itemName(pending.replacement)}】嗎？`}
          </p>
          <div className="row">
            <button onClick={() => decide({ option: "yes" })}>是</button>
            <button onClick={() => decide({ option: "no" })}>否</button>
          </div>
        </>
      );
      break;
  }
  return (
    <div className="pending">
      <h3>等待 {who.name} 做決定</h3>
      {body}
    </div>
  );
}
