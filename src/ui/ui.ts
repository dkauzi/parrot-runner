/**
 * All DOM UI: HUD (FPS + score, mirroring the reference mocks), a progress bar, the start
 * screen, and the end card (styled as a playable CTA). Pure DOM, no framework: every dependency
 * is load weight in a playable.
 */

export class UI {
  private fpsEl: HTMLElement;
  private scoreEl: HTMLElement;
  private comboEl: HTMLElement;
  private barFill: HTMLElement;
  private start: HTMLElement;
  private end: HTMLElement;
  private endScore: HTMLElement;

  constructor(root: HTMLElement, title: string) {
    root.insertAdjacentHTML(
      'beforeend',
      `
      <div id="hud">
        <span id="fps">FPS 60</span>
        <div id="progress"><div id="progress-fill"></div></div>
        <span id="score">Score 0</span>
      </div>
      <div id="combo"></div>
      <div id="start" class="screen">
        <h1>${title}</h1>
        <p>Guide the parrot. Grab the fruit.</p>
        <button id="start-btn" class="cta">Tap to start</button>
        <p class="hint">Arrow keys / WASD, or drag the joystick</p>
      </div>
      <div id="end" class="screen hidden">
        <h1>Run complete</h1>
        <p id="end-score">Score 0</p>
        <button id="cta-btn" class="cta">Download &amp; play</button>
        <button id="replay-btn" class="ghost">Play again</button>
      </div>`
    );

    this.fpsEl = root.querySelector('#fps')!;
    this.scoreEl = root.querySelector('#score')!;
    this.comboEl = root.querySelector('#combo')!;
    this.barFill = root.querySelector('#progress-fill')!;
    this.start = root.querySelector('#start')!;
    this.end = root.querySelector('#end')!;
    this.endScore = root.querySelector('#end-score')!;
  }

  onStart(cb: () => void): void {
    this.start.querySelector('#start-btn')!.addEventListener('click', cb);
  }
  onReplay(cb: () => void): void {
    this.end.querySelector('#replay-btn')!.addEventListener('click', cb);
  }
  onCta(cb: () => void): void {
    this.end.querySelector('#cta-btn')!.addEventListener('click', cb);
  }

  hideStart(): void {
    this.start.classList.add('hidden');
  }
  showEnd(score: number): void {
    this.endScore.textContent = `Score ${score}`;
    this.end.classList.remove('hidden');
  }
  hideEnd(): void {
    this.end.classList.add('hidden');
  }

  setScore(score: number): void {
    this.scoreEl.textContent = `Score ${score}`;
  }
  setFps(fps: number): void {
    this.fpsEl.textContent = `FPS ${Math.round(fps)}`;
  }
  setProgress(p: number): void {
    this.barFill.style.width = `${Math.round(p * 100)}%`;
  }

  /** Brief floating combo flourish on a multiplied pickup. */
  flashCombo(multiplier: number): void {
    if (multiplier <= 1) return;
    this.comboEl.textContent = `x${multiplier}`;
    this.comboEl.classList.remove('pulse');
    // reflow to restart the animation
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('pulse');
  }
}
