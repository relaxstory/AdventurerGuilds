import { useCallback, useEffect, useMemo, useState } from "react";
import { applyAction, CardLibrary, createGame, RuleError, type Action, type GameConfig, type GameState } from "../../engine/src/index.js";
import { source } from "./data.js";

interface Saved {
  readonly config: GameConfig;
  readonly history: GameState[];
}

const KEY = "adventurer-guilds-test-mode";

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // 瀏覽器不允許儲存時，遊戲照常進行，只是重新整理後不會保留
  }
}

/**
 * 可以反悔的操作：沒有揭露新資訊（擲骰、翻開牌庫）的操作（docs/digital-spec.md 4.1）。
 */
function reversible(prev: GameState, next: GameState): boolean {
  return (
    prev.rng.seed === next.rng.seed &&
    prev.adventurerDeck.length === next.adventurerDeck.length &&
    prev.taskDeck.length === next.taskDeck.length &&
    prev.round === next.round
  );
}

export function useGame() {
  const [saved, setSaved] = useState<Saved | null>(() => load());
  const [error, setError] = useState<string | null>(null);
  const lib = useMemo(() => (saved ? new CardLibrary(source, saved.config.includeTest) : null), [saved?.config]);
  const state = saved?.history.at(-1) ?? null;

  // 只保存最後兩個狀態（足夠反悔一步），避免超過瀏覽器的儲存空間
  useEffect(() => save(saved && { ...saved, history: saved.history.slice(-2) }), [saved]);

  const start = useCallback((config: GameConfig) => {
    try {
      setSaved({ config, history: [createGame(config, source)] });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const act = useCallback(
    (action: Action): boolean => {
      if (!saved || !lib || !state) return false;
      try {
        const next = applyAction(state, action, lib);
        setSaved({ ...saved, history: [...saved.history.slice(-30), next] });
        setError(null);
        return true;
      } catch (e) {
        if (e instanceof RuleError) {
          setError(e.message);
          return false;
        }
        throw e;
      }
    },
    [saved, lib, state],
  );

  const history = saved?.history ?? [];
  const canUndo = history.length > 1 && reversible(history.at(-2)!, history.at(-1)!);
  const undo = useCallback(() => {
    if (!saved || !canUndo) return;
    setSaved({ ...saved, history: saved.history.slice(0, -1) });
    setError(null);
  }, [saved, canUndo]);

  const quit = useCallback(() => {
    setSaved(null);
    setError(null);
  }, []);

  return { state, lib, config: saved?.config ?? null, error, setError, start, act, undo, canUndo, quit };
}
