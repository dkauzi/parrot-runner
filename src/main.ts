import './styles.css';
import { resolveConfig } from './game/config';
import { Game } from './game/Game';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('#app root not found');

const { config, fastEnd } = resolveConfig(window.location.search);

// Test hook: advertise that this build honours ?test=fastend so the e2e suite can drive it.
window.__supportsFastEnd = fastEnd;

const game = new Game(root, config, fastEnd);
game.start();
