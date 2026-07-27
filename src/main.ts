import './styles.css';
import { Game } from './core/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('게임 캔버스를 찾지 못했습니다.');

const game = new Game(canvas);

void game.start().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const fatal = document.getElementById('fatal-error');
  fatal?.classList.remove('is-hidden');
  if (fatal) fatal.textContent = `기반 빌드를 시작하지 못했습니다.\n${message}`;
});

window.addEventListener('beforeunload', () => game.dispose(), { once: true });
