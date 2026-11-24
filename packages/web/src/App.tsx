import { GameView } from "./components/GameView.js";
import { Setup } from "./components/Setup.js";
import { useGame } from "./useGame.js";

export function App() {
  const g = useGame();
  if (!g.state || !g.lib) return <Setup onStart={g.start} error={g.error} />;
  return <GameView state={g.state} lib={g.lib} act={g.act} error={g.error} undo={g.undo} canUndo={g.canUndo} quit={g.quit} />;
}
