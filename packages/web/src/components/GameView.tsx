import { useState } from "react";
import {
  abilities as ab,
  activatedSkills,
  adjustOptions,
  currentPlayer,
  items as it,
  outcome,
  penaltyOptions,
  RULES,
  stagingSlots,
  taskDef,
  turnOptions,
  upgradeCost,
  adventurerCapacity,
  type Action,
  type CardLibrary,
  type GameState,
  type PlayerState,
} from "../../../engine/src/index.js";
import { honorText } from "../data.js";
import { useEffect } from "react";
import { AdventurerCard, CardPreview, InspectContext, ItemCard, TaskCard, type Inspected } from "./Cards.js";
import { Codex } from "./Codex.js";
import { ActivateDialog, PendingPanel, UseItemDialog } from "./Dialogs.js";
import { Rules } from "./Rules.js";

type Act = (a: Action) => boolean;

const PHASE: Record<GameState["phase"], string> = { guild: "公會階段", adventure: "冒險階段", cleanup: "公會整理階段", gameOver: "遊戲結束" };

export function GameView({
  state,
  lib,
  act,
  error,
  undo,
  canUndo,
  quit,
}: {
  state: GameState;
  lib: CardLibrary;
  act: Act;
  error: string | null;
  undo: () => void;
  canUndo: boolean;
  quit: () => void;
}) {
  const me = currentPlayer(state);
  const [activating, setActivating] = useState<{ card: string; skill: string } | null>(null);
  const [usingItem, setUsingItem] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [party, setParty] = useState<string[]>([]);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showCodex, setShowCodex] = useState(false);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setInspected(null);
    // 點放大卡片與其他卡片以外的地方時關閉（點其他卡片會換成那一張）
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(".preview") && !t.closest(".card")) setInspected(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  // 換玩家、換階段或換輪時，清空選取的任務與冒險者（避免把上一位玩家選的冒險者一起派遣）
  useEffect(() => {
    setParty([]);
    setTask(null);
  }, [me.id, state.phase, state.round]);

  const blocked = !!state.pending;
  // 過勞死凱菲：本回合第一個任務必須派遣（付得出薪資時自動加入）
  const must = state.phase === "adventure" && me.missionsThisTurn === 0 ? ab.mustDispatch(state, lib, me) : [];
  const dispatch = () => {
    // 只派遣目前玩家公會中、仍然直立的冒險者（選取後可能被橫置、解僱或銷毀）
    const chosen = party.filter((u) => me.adventurers.includes(u) && !state.adventurerCards[u]?.tapped);
    const extra = must.filter((u) => !chosen.includes(u) && me.gold >= ab.salaryFor(state, lib, [...chosen, u]).total);
    // 2. 派遣步驟：出動之後，選擇冒險者並支付薪資
    if (state.mission?.stage === "select" && act({ type: "dispatch", adventurers: [...chosen, ...extra] })) {
      setParty([]);
    }
  };

  return (
    <InspectContext.Provider value={setInspected}>
    <div className="game">
      <header className="topbar">
        <div>
          <b>第 {state.round} 輪</b>　輪到 <b className="you">{me.name}</b>　{PHASE[state.phase]}
          {state.phase === "guild" && `（公會行動剩 ${me.actionsLeft}）`}
        </div>
        <div className="row">
          <button onClick={() => setShowCodex(true)}>圖鑑</button>
          <button onClick={() => setShowRules(true)}>規則</button>
          <button onClick={undo} disabled={!canUndo} title="只能反悔沒有揭露新資訊的操作">反悔</button>
          {confirmQuit ? (
            <>
              <span className="muted">放棄這局？</span>
              <button className="warn" onClick={quit}>放棄並回到設定</button>
              <button onClick={() => setConfirmQuit(false)}>繼續玩</button>
            </>
          ) : (
            <button onClick={() => setConfirmQuit(true)}>新遊戲</button>
          )}
        </div>
      </header>
      {error && <div className="error">{error}</div>}
      {state.pending && <PendingPanel state={state} lib={lib} act={act} />}
      {state.phase === "gameOver" && state.result && <Result state={state} lib={lib} />}

      <div className="layout">
        <main>
          <Honors state={state} />
          <section>
            <h2>王國任務公告欄</h2>
            <div className="cards">
              {state.board.map((uid, i) =>
                uid ? (
                  <TaskCard key={uid} state={state} lib={lib} uid={uid}>
                    {state.phase === "guild" && !blocked && (
                      <button onClick={() => act({ type: "acceptTask", boardIndex: i })}>接取</button>
                    )}
                  </TaskCard>
                ) : (
                  <div key={i} className="card empty">（空位）</div>
                ),
              )}
            </div>
            <p className="muted">
              任務牌庫剩 {state.taskDeck.length} 張
              {state.phase === "guild" && !blocked && state.taskDeck.length > 0 && (state.config.taskSupply ?? RULES.taskSupply) === "deckTop" && (
                <> <button onClick={() => act({ type: "acceptTask", fromDeck: true })}>接取牌庫頂的任務</button></>
              )}
            </p>
          </section>
          <section>
            <h2>綠龍酒館</h2>
            <div className="cards">
              {state.tavern.map((uid, i) => (
                <AdventurerCard key={uid} state={state} lib={lib} uid={uid}>
                  {state.phase === "guild" && !blocked && <RecruitControls state={state} lib={lib} me={me} uid={uid} index={i} act={act} />}
                </AdventurerCard>
              ))}
            </div>
            <p className="muted">冒險者牌庫剩 {state.adventurerDeck.length} 張</p>
          </section>

          {state.mission && (
            <MissionPanel
              state={state}
              lib={lib}
              act={act}
              party={party}
              must={must}
              dispatch={dispatch}
              onActivate={(card, skill) => setActivating({ card, skill })}
              onUseItem={setUsingItem}
            />
          )}

          {[...state.players].sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id)).map((p) => (
            <Guild
              key={p.id}
              state={state}
              lib={lib}
              p={p}
              active={p.id === me.id && state.phase !== "gameOver"}
              act={act}
              blocked={blocked}
              task={task}
              setTask={setTask}
              party={party}
              setParty={setParty}
              dispatch={dispatch}
              must={p.id === me.id ? must : []}
              onActivate={(card, skill) => setActivating({ card, skill })}
              onUseItem={setUsingItem}
            />
          ))}
        </main>
        <Log state={state} />
      </div>

      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showCodex && <Codex onClose={() => setShowCodex(false)} />}
      {activating && <ActivateDialog state={state} lib={lib} card={activating.card} skill={activating.skill} act={act} onClose={() => setActivating(null)} />}
      {usingItem && state.itemCards[usingItem] && <UseItemDialog state={state} lib={lib} item={usingItem} act={act} onClose={() => setUsingItem(null)} />}
      {inspected && <CardPreview state={state} lib={lib} card={inspected} onClose={() => setInspected(null)} />}
    </div>
    </InspectContext.Provider>
  );
}

function RecruitControls({ state, lib, me, uid, index, act }: { state: GameState; lib: CardLibrary; me: PlayerState; uid: string; index: number; act: Act }) {
  const [replace, setReplace] = useState("");
  const keyword = ab.squadKeyword(state, lib, uid);
  const squads = keyword ? me.adventurers.filter((u) => ab.squadKeyword(state, lib, u) === keyword) : [];
  return (
    <div className="stack">
      <button onClick={() => act({ type: "recruit", tavernIndex: index, ...(replace ? { replace } : {}) })}>招募{replace ? "並解僱" : ""}</button>
      {me.adventurers.length > 0 && (
        <select value={replace} onChange={(e) => setReplace(e.target.value)}>
          <option value="">不解僱</option>
          {me.adventurers.map((u) => (
            <option key={u} value={u}>解僱 {ab.faceOf(state, lib, u).name}</option>
          ))}
        </select>
      )}
      {squads.map((s) => (
        <div key={s} className="row">
          <button onClick={() => act({ type: "recruit", tavernIndex: index, squad: { target: s, position: "top" } })}>放到 {ab.faceOf(state, lib, s).name} 小隊上方</button>
          <button onClick={() => act({ type: "recruit", tavernIndex: index, squad: { target: s, position: "bottom" } })}>下方</button>
        </div>
      ))}
    </div>
  );
}

function Guild({
  state,
  lib,
  p,
  active,
  act,
  blocked,
  task,
  setTask,
  party,
  setParty,
  dispatch,
  must,
  onActivate,
  onUseItem,
}: {
  state: GameState;
  lib: CardLibrary;
  p: PlayerState;
  must: string[];
  active: boolean;
  act: Act;
  blocked: boolean;
  task: string | null;
  setTask: (t: string | null) => void;
  party: string[];
  setParty: (p: string[]) => void;
  dispatch: () => void;
  onActivate: (card: string, skill: string) => void;
  onUseItem: (item: string) => void;
}) {
  const phase = state.phase;
  const canAct = active && !blocked;
  // 1. 選擇任務步驟：沒有進行中的任務時選任務；出動後才選擇要派遣的冒險者
  const choosingTask = canAct && phase === "adventure" && !state.mission;
  const picking = canAct && phase === "adventure" && state.mission?.stage === "select";
  const slots = it.itemSlots(state, lib, p);
  return (
    <section className={`guild${active ? " active" : ""}`}>
      <div className="guild-head">
        <h2>{p.name}</h2>
        <span>💰 {p.gold}</span>
        <span>⭐ 聲望 {p.reputation}</span>
        {p.distrust > 0 && <span className="warn">王國不信任 {p.distrust}</span>}
        <span>{p.upgraded ? `二階公會（${guildLabel(state, p.upgradeBonus ?? "staging")}）` : "一階公會"}</span>
        <span>完成任務 {p.completed.length}</span>
        <span>冒險者 {ab.capacityUsed(state, lib, p)}/{adventurerCapacity(p)}</span>
        <span title="相同道具堆疊在同一格">道具 {it.usedItemSlots(state, lib, p)}/{slots}</span>
      </div>

      {canAct && !(phase === "adventure" && state.mission) && (
        <div className="phase-actions">
          {phase === "guild" && <button className="primary" onClick={() => act({ type: "endGuildPhase" })}>結束公會階段</button>}
          {phase === "adventure" && !state.mission && (
            <>
              <span className="muted">選一個任務後按「出動」，再選擇要派遣的冒險者。</span>
              <button className="primary" disabled={!task} onClick={() => task && act({ type: "deploy", task })}>出動</button>
              <button onClick={() => act({ type: "endAdventurePhase" })}>結束冒險階段</button>
            </>
          )}
          {phase === "cleanup" && <Cleanup state={state} lib={lib} p={p} act={act} />}
        </div>
      )}

      <h3>任務</h3>
      <div className="cards">
        {p.staging.map((t) => (
          <TaskCard key={t} state={state} lib={lib} uid={t} selected={(choosingTask && task === t) || state.mission?.task === t} onClick={choosingTask ? () => setTask(t) : undefined}>
            <span className="muted">暫存格（{p.staging.length}/{stagingSlots(p)}）</span>
          </TaskCard>
        ))}
        {p.formal.map((f) => (
          <TaskCard key={f.uid} state={state} lib={lib} uid={f.uid} timer={f.timer} selected={(choosingTask && task === f.uid) || state.mission?.task === f.uid} onClick={choosingTask ? () => setTask(f.uid) : undefined} />
        ))}
        {!p.staging.length && !p.formal.length && <p className="muted">沒有任務</p>}
      </div>

      <h3>冒險者</h3>
      <div className="cards">
        {p.adventurers.map((u) => {
          // 卡片有寫時機的照卡片（公會階段、回合開始時、任務流程的時機窗口）；沒寫時機的在冒險階段任何可插入的時機（含任務流程的時機窗口）；加入任務的能力在派遣面板中
          const skills = [...activatedSkills(state, lib, u)]
            .filter(([, cs]) => {
              const timing = cs.find((c) => c.code === "TIMING")?.x;
              if (timing && timing in ab.MISSION_WINDOWS) return phase === "adventure" && state.mission?.stage === ab.MISSION_WINDOWS[timing];
              if (cs.some((c) => c.code === "ADD_PARTICIPANT")) return false;
              if (timing === "公會階段") return phase === "guild";
              if (timing === "回合開始時") return state.turnStartOpen;
              return phase === "adventure";
            })
            .map(([s]) => s);
          const chosen = party.includes(u);
          return (
            <AdventurerCard
              key={u}
              state={state}
              lib={lib}
              uid={u}
              selected={picking && (chosen || must.includes(u))}
              onClick={picking && !state.adventurerCards[u]!.tapped ? () => setParty(chosen ? party.filter((x) => x !== u) : [...party, u]) : undefined}
            >
              {canAct &&
                skills.map((s) => (
                  <button key={s} onClick={() => onActivate(u, s)}>
                    發動{s}
                  </button>
                ))}
            </AdventurerCard>
          );
        })}
        {!p.adventurers.length && <p className="muted">沒有冒險者</p>}
      </div>

      {p.items.length > 0 && (
        <>
          <h3>道具</h3>
          <div className="cards">
            {p.items.map((u) => (
              <ItemCard key={u} state={state} uid={u}>
                {canAct && phase === "adventure" && <ItemUse state={state} lib={lib} uid={u} act={act} onUseItem={onUseItem} />}
                {canAct && phase === "cleanup" && !state.pendingExpiry.length && (
                  <button onClick={() => act({ type: "sell", item: u })}>出售（{it.sellPrice(state, lib, p, u)} 金）</button>
                )}
              </ItemCard>
            ))}
          </div>
        </>
      )}
      {p.completed.length > 0 && (
        <p className="muted">任務完成區：{p.completed.map((t) => taskDef(state, lib, t).name).join("、")}</p>
      )}
      {p.assignedHonors.length > 0 && (
        <>
          <h3>王國指派的榮譽</h3>
          <ul className="assigned">
            {p.assignedHonors.map((h) => {
              const t = honorText.get(h);
              return (
                <li key={h}>
                  {t?.name ?? h}（{t?.route}）：<b>{t?.condition}</b>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function ItemUse({ state, lib, uid, act, onUseItem }: { state: GameState; lib: CardLibrary; uid: string; act: Act; onUseItem: (item: string) => void }) {
  const codes = it.itemClauses(state, lib, uid).map((c) => c.code);
  if (!codes.includes("ITEM_CONSUME") && !codes.includes("CONSUME_ALL_TIER_GAIN")) return null;
  // 寫明任務流程時機的道具在該窗口使用；希氏炸藥在擲骰後（在派遣面板中使用）；其餘在冒險階段、派遣流程以外
  // 希氏炸藥：在派遣面板「確認任務結果前」使用（不在道具卡上重複顯示）
  if (codes.includes("ITEM_TOKEN_TIER_RESULT")) return null;
  const timing = it.itemClauses(state, lib, uid).find((c) => c.code === "TIMING")?.x;
  if (timing && timing in ab.MISSION_WINDOWS) {
    if (state.phase !== "adventure" || state.mission?.stage !== ab.MISSION_WINDOWS[timing]) return null;
  } else {
    if (codes.includes("ITEM_TOKEN_TIER_RESULT")) return null;
    if (state.phase !== "adventure") return null;
  }
  const needsTarget = codes.some((c) => c === "EFF_BASE_DICE_ROUND" || c === "EFF_RESET");
  return <button onClick={() => (needsTarget ? onUseItem(uid) : act({ type: "useItem", item: uid }))}>使用</button>;
}

function Cleanup({ state, lib, p, act }: { state: GameState; lib: CardLibrary; p: PlayerState; act: Act }) {
  const pending = state.pendingExpiry[0];
  if (pending) {
    const def = taskDef(state, lib, pending);
    const opt = penaltyOptions(p, def);
    return (
      <>
        <span>任務「{def.name}」逾期，請選擇懲罰：</span>
        <button onClick={() => act({ type: "choosePenalty", task: pending, penalty: "gold" })}>扣 {opt.goldAmount} 金</button>
        <button onClick={() => act({ type: "choosePenalty", task: pending, penalty: "reputation" })}>聲望往 0 移動</button>
      </>
    );
  }
  const guildType = (state.config.upgradeVariant ?? RULES.upgradeVariant) === "guildType";
  const discard = state.adventurerDiscard.filter((u) => state.adventurerCards[u] && !state.adventurerCards[u]!.derivative);
  const [recruit, setRecruit] = useState("");
  const options = guildType ? (["task", "adventurer", "economy"] as const) : (["adventurer", "staging", "item"] as const);
  return (
    <>
      {!p.upgraded && (
        <span className="upgrade">
          升級為二階公會（{upgradeCost(p) === 0 ? "免費" : `${upgradeCost(p)} 金`}）：
          {options.map((bonus) => (
            <button
              key={bonus}
              title={guildType ? GUILD_TYPE_HINT[bonus as keyof typeof GUILD_TYPE_HINT] : undefined}
              onClick={() => act(guildType && bonus === "adventurer" && recruit ? { type: "upgrade", bonus, recruit } : { type: "upgrade", bonus })}
            >
              {guildLabel(state, bonus)}
            </button>
          ))}
          {guildType && (
            <label>
              冒險者型：從棄置區招募
              <select value={recruit} onChange={(e) => setRecruit(e.target.value)}>
                <option value="">{discard.length ? "不招募" : "（棄置區沒有冒險者）"}</option>
                {discard.map((u) => (
                  <option key={u} value={u}>{ab.faceOf(state, lib, u).name}</option>
                ))}
              </select>
            </label>
          )}
        </span>
      )}
      <button className="primary" onClick={() => act({ type: "endTurn" })}>結束回合</button>
    </>
  );
}

const STEP_LABEL = { select: "2. 派遣", assemble: "3. 建立骰池", pooled: "4. 擲骰", adjust: "5. 確認任務結果" } as const;

function MissionPanel({
  state,
  lib,
  act,
  party: chosen,
  must,
  dispatch,
  onActivate,
  onUseItem,
}: {
  state: GameState;
  lib: CardLibrary;
  act: Act;
  party: string[];
  must: string[];
  dispatch: () => void;
  onActivate: (card: string, skill: string) => void;
  onUseItem: (item: string) => void;
}) {
  const m = state.mission!;
  const me = currentPlayer(state);
  const def = taskDef(state, lib, m.task);
  const party = ab.participants(m);
  const [predictions, setPredictions] = useState<Record<string, "odd" | "even">>({});
  const [baseDice, setBaseDice] = useState<Record<string, number>>({});
  const blocked = !!state.pending;
  const joiners = me.adventurers.flatMap((u) =>
    [...activatedSkills(state, lib, u)].filter(([, cs]) => cs.some((c) => c.code === "ADD_PARTICIPANT")).map(([s]) => ({ u, s })),
  );

  void onUseItem;
  return (
    <section className="mission">
      <h2>
        {m.stage === "select" ? "出動" : "派遣"}：「{def.name}」　<small className="muted">目前步驟：{STEP_LABEL[m.stage]}</small>
      </h2>
      {m.stage === "select" ? (
        <>
          <p className="muted">在下方你的冒險者中，點選要派遣的冒險者（須符合任務規定），再按「派遣」支付薪資。</p>
          {must.length > 0 && (
            <p className="notice">
              本回合第一個任務必須派遣 <b>{must.map((u) => ab.faceOf(state, lib, u).name).join("、")}</b>（派遣時自動加入）
            </p>
          )}
          <p>已選擇：{chosen.length ? chosen.map((u) => ab.faceOf(state, lib, u).name).join("、") : "（尚未選擇）"}　薪資 {chosen.length ? ab.salaryFor(state, lib, chosen).total : 0} 金</p>
          <div className="row wrap">
            <button className="primary" disabled={blocked || (!chosen.length && !must.length)} onClick={dispatch}>派遣</button>
            <button disabled={blocked} onClick={() => act({ type: "cancelDeploy" })}>取消出動</button>
          </div>
        </>
      ) : (
        <p>
          參與：{party.map((u) => ab.faceOf(state, lib, u).name).join("、")}　薪資 {m.salary} 金{m.stage !== "assemble" && `　骰池 ${m.pool} 顆`}
        </p>
      )}
      {m.stage === "assemble" && (
        <>
          <p className="muted">建立骰池前：可以使用「加入此次任務」等能力，或自選基礎骰數。</p>
          {m.dispatched.flatMap((u) => ab.clauses(state, lib, u, "BASE_DICE_CHOICE").map((c) => (
            <label key={u}>
              {ab.faceOf(state, lib, u).name} 的基礎骰數（{c.x}～{c.y}）：
              <input type="number" min={Number(c.x)} max={Number(c.y)} value={baseDice[u] ?? ""} onChange={(e) => setBaseDice({ ...baseDice, [u]: Number(e.target.value) })} />
            </label>
          )))}
          <div className="row wrap">
            {joiners.map(({ u, s }) => (
              <button key={u + s} disabled={blocked} onClick={() => onActivate(u, s)}>
                {ab.faceOf(state, lib, u).name}{s}
              </button>
            ))}
            <button className="primary" disabled={blocked} onClick={() => act({ type: "buildPool", baseDice })}>建立骰池</button>
          </div>
        </>
      )}
      {m.stage === "pooled" && (
        <>
          <p className="muted">擲骰前：可以使用寫明「擲骰前」的能力或道具，以及擲骰前的宣告。</p>
          {party.filter((u) => ab.has(state, lib, u, "PREDICT_PARITY")).map((u) => (
            <label key={u}>
              {ab.faceOf(state, lib, u).name} 預言結果值：
              <select value={predictions[u] ?? ""} onChange={(e) => setPredictions({ ...predictions, [u]: e.target.value as "odd" | "even" })}>
                <option value="">—</option>
                <option value="odd">奇數</option>
                <option value="even">偶數</option>
              </select>
            </label>
          ))}
          <div className="row wrap">
            <button className="primary" disabled={blocked} onClick={() => act({ type: "roll", predictions })}>擲骰</button>
          </div>
        </>
      )}
      {m.stage === "adjust" && <Adjust state={state} lib={lib} act={act} />}
    </section>
  );
}

function Adjust({ state, lib, act }: { state: GameState; lib: CardLibrary; act: Act }) {
  const m = state.mission!;
  const me = currentPlayer(state);
  const def = taskDef(state, lib, m.task);
  const o = outcome(state, lib, m);
  const options = adjustOptions(state, lib, m);
  const [die, setDie] = useState(0);
  const [face, setFace] = useState(0);
  const [dice, setDice] = useState<number[]>([]);
  const [count, setCount] = useState(1);
  const [delta, setDelta] = useState(0);
  const bombs = me.items.filter((u) => it.itemClauses(state, lib, u).some((c) => c.code === "ITEM_TOKEN_TIER_RESULT"));
  const c = def.condition!;
  const target = c.op === "atLeast" ? `≥${c.x}` : c.op === "atMost" ? `≤${c.x}` : `${c.x}～${c.y}`;
  return (
    <>
      <div className="dice">
        {m.dice.map((d, i) => (
          <span key={i} className={`die${dice.includes(i) ? " picked" : ""}${die === i ? " focus" : ""}`} onClick={() => { setDie(i); setDice(dice.includes(i) ? dice.filter((x) => x !== i) : [...dice, i]); }}>
            {d}
          </span>
        ))}
        {!m.dice.length && <span className="muted">（沒有骰子）</span>}
      </div>
      <p className={o.success ? "ok" : "bad"}>
        骰面總和 {o.faceSum}，結果值 {o.result}；目標 {target}，難度調整 {o.n}：{o.success ? "目前會成功" : "目前會失敗"}
      </p>
      <div className="adjusts">
        {options.map((opt) => {
          const name = ab.faceOf(state, lib, opt.card).name;
          switch (opt.kind) {
            case "reroll":
              return <button key={opt.card + opt.kind} onClick={() => act({ type: "adjust", adjustment: { kind: "reroll", card: opt.card, dice } }) && setDice([])}>{name}：重擲選取的骰子（至多 {opt.remaining} 顆）</button>;
            case "turn":
              return (
                <span key={opt.card + opt.kind} className="row">
                  {name}：把第 {die + 1} 顆（{m.dice[die]}）轉成
                  <select value={face} onChange={(e) => setFace(Number(e.target.value))}>
                    <option value={0}>—</option>
                    {m.dice[die] !== undefined && turnOptions(m.dice[die]!).map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <button onClick={() => act({ type: "adjust", adjustment: { kind: "turn", card: opt.card, die, face } })}>轉動（剩 {opt.remaining} 次）</button>
                </span>
              );
            case "remove":
              return <button key={opt.card + opt.kind} className="warn" onClick={() => act({ type: "adjust", adjustment: { kind: "remove", card: opt.card, die } })}>{name}：移除第 {die + 1} 顆（必須）</button>;
            case "gamble":
              return (
                <span key={opt.card + opt.kind} className="row">
                  {name}【加注】重擲
                  <input type="number" min={1} max={opt.remaining} value={count} onChange={(e) => setCount(Number(e.target.value))} />顆
                  <button onClick={() => act({ type: "adjust", adjustment: { kind: "gamble", card: opt.card, count } })}>加注</button>
                </span>
              );
            case "adjustResult":
              return (
                <span key={opt.card + opt.kind} className="row">
                  {name}：結果值調整
                  <input type="number" min={-opt.remaining} max={opt.remaining} value={delta} onChange={(e) => setDelta(Number(e.target.value))} />
                  <button onClick={() => act({ type: "adjust", adjustment: { kind: "adjustResult", card: opt.card, delta } })}>調整（±{opt.remaining}）</button>
                </span>
              );
            case "autoSuccess":
              return <button key={opt.card + opt.kind} onClick={() => act({ type: "adjust", adjustment: { kind: "autoSuccess", card: opt.card } })}>{name}：消耗食材，任務視為成功</button>;
          }
        })}
        {bombs.map((u) => (
          <button key={u} onClick={() => act({ type: "useItem", item: u })}>使用【{state.itemCards[u]!.name}】</button>
        ))}
      </div>
      <button className="primary" disabled={!!state.pending} onClick={() => act({ type: "resolve" })}>確認任務結果</button>
      <p className="muted">點選骰子可以選取（重擲）或指定要轉動、移除的骰子。</p>
    </>
  );
}

const BONUS_LABEL = { adventurer: "冒險者格 +1", staging: "任務暫存格 +1", item: "道具格 +1", task: "任務專精", economy: "經濟型" } as const;
const GUILD_TYPE_LABEL = { task: "任務型", adventurer: "冒險者型", economy: "經濟型", staging: "任務暫存格 +1", item: "道具格 +1" } as const;
const GUILD_TYPE_HINT = {
  task: "任務暫存格 +1；接取的緊急任務放在時限 [2]",
  adventurer: "冒險者格 +2；升級時可以從冒險者棄置區招募 1 名（不消耗公會行動）",
  economy: "道具格 +2",
} as const;

/** 二階公會的名稱：公會專精（alpha1.2）顯示公會類型，其他試驗方案顯示加成。 */
function guildLabel(state: GameState, bonus: keyof typeof BONUS_LABEL): string {
  return (state.config.upgradeVariant ?? RULES.upgradeVariant) === "guildType" ? GUILD_TYPE_LABEL[bonus] : BONUS_LABEL[bonus];
}

/** 依路線分組（路線順序依卡池順序），同一路線依編號排列。 */
function byRoute(ids: readonly string[]): [string, string[]][] {
  const routes = new Map<string, string[]>();
  for (const id of [...ids].sort()) {
    const route = honorText.get(id)?.route ?? "其他";
    routes.set(route, [...(routes.get(route) ?? []), id]);
  }
  const order = [...new Set([...honorText.values()].map((h) => h.route))];
  return [...routes.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
}

function Honors({ state }: { state: GameState }) {
  if (state.config.honorMode === "assignment") {
    return (
      <section>
        <h2>王國榮譽（王國指派）</h2>
        <p className="muted">每位玩家的 3 張榮譽卡顯示在各自的公會中，只判定持有者是否為第一名。</p>
      </section>
    );
  }
  const open = state.config.honorMode === "competition" || state.phase === "gameOver";
  return (
    <section>
      <h2>王國榮譽（{state.honors.length} 張{open ? "" : "，終局揭示"}）</h2>
      {open ? (
        <div className="honor-routes">
          {byRoute(state.honors).map(([route, ids]) => (
            <div key={route} className="honor-route">
              <h3>{route}路線</h3>
              <ul className="assigned">
                {ids.map((h) => (
                  <li key={h}>
                    {honorText.get(h)?.name}：<b>{honorText.get(h)?.condition}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="honors">
          {state.honors.map((_, i) => (
            <span key={i} className="honor hidden">？</span>
          ))}
        </div>
      )}
    </section>
  );
}

function Result({ state, lib }: { state: GameState; lib: CardLibrary }) {
  const r = state.result!;
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? id;
  void lib;
  return (
    <section className="result">
      <h2>遊戲結束：{r.winners.map(name).join("、")} 獲勝</h2>
      <table>
        <thead>
          <tr>
            <th>王國榮譽</th>
            {state.players.map((p) => <th key={p.id}>{p.name}</th>)}
            <th>取得</th>
          </tr>
        </thead>
        <tbody>
          {r.honors.map((h, i) => (
            <tr key={i}>
              <td title={honorText.get(h.honorId)?.condition}>
                {honorText.get(h.honorId)?.name}
                {h.holder ? `（${name(h.holder)} 持有）` : ""}
              </td>
              {state.players.map((p) => <td key={p.id}>{h.values[p.id]}</td>)}
              <td>{h.winners.map(name).join("、") || "—"}</td>
            </tr>
          ))}
          <tr>
            <td><b>總計</b></td>
            {state.players.map((p) => <td key={p.id}><b>{r.totals[p.id]}</b></td>)}
            <td />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Log({ state }: { state: GameState }) {
  const name = (id: string | null) => (id ? state.players.find((p) => p.id === id)?.name ?? id : "");
  return (
    <aside className="log">
      <h2>遊戲紀錄</h2>
      <ol>
        {[...state.log].reverse().slice(0, 200).map((l, i) => (
          <li key={i}>
            <span className="muted">{l.round}</span> {l.player && <b>{name(l.player)}</b>} {l.text}
            {l.dice && <span className="dice-inline"> 🎲 {l.dice.join(" ")}</span>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
