import './styles.css';
import { Game } from './core/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Game canvas is missing.');

const game = new Game(canvas);
void game.start().catch((error: unknown) => {
  console.error(error);
  showStartupFailure(error);
});

window.addEventListener('beforeunload', () => game.dispose(), { once: true });

function showStartupFailure(error: unknown): void {
  const fatal = document.getElementById('fatal-error');
  if (!fatal) return;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const normalized = detail.toLowerCase();
  const guidance = normalized.includes('webgl') || normalized.includes('context')
    ? 'WebGL 2와 하드웨어 가속을 지원하는 최신 브라우저가 필요합니다. 브라우저의 하드웨어 가속을 켠 뒤 다시 시도해 주세요.'
    : normalized.includes('rapier') || normalized.includes('wasm')
      ? '물리 모듈을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
      : '게임 데이터를 초기화하지 못했습니다. 페이지를 새로 불러오거나 다른 최신 브라우저에서 실행해 주세요.';

  fatal.replaceChildren();
  fatal.classList.remove('is-hidden');
  const heading = document.createElement('strong');
  heading.textContent = 'Ashen Oath를 시작하지 못했습니다.';
  const copy = document.createElement('span');
  copy.textContent = guidance;
  const technical = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '기술 정보';
  const code = document.createElement('code');
  code.textContent = detail;
  technical.append(summary, code);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '다시 시도';
  retry.addEventListener('click', () => window.location.reload(), { once: true });
  fatal.append(heading, copy, technical, retry);
}
