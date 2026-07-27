import './styles.css';
import { Game } from './core/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas is missing.');

const game = new Game(canvas);
void game.start().catch((error: unknown) => {
  console.error(error);
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const fatal = document.getElementById('fatal-error');
  fatal?.classList.remove('is-hidden');
  if (fatal) fatal.textContent = `Ashen Oath could not start.\n${message}`;
});

window.addEventListener('beforeunload', () => game.dispose(), { once: true });
