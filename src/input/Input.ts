/**
 * Unified input: keyboard (fallback) and an on-screen virtual joystick (mobile-first, primary
 * for a playable) both feed the same axis in [-1, 1]. The game reads getAxis() and never cares
 * which device produced it. A touch start anywhere also fires onFirstTouch (used to unlock audio
 * and dismiss the start screen).
 */

export interface Axis {
  x: number;
  y: number;
}

export class Input {
  private keys = new Set<string>();
  private joystick: Axis = { x: 0, y: 0 };
  private joyActive = false;
  private base: HTMLElement;
  private knob: HTMLElement;
  private baseRect: DOMRect | null = null;

  constructor(root: HTMLElement) {
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    // Build the virtual joystick.
    this.base = document.createElement('div');
    this.base.className = 'joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.base.appendChild(this.knob);
    root.appendChild(this.base);

    this.base.addEventListener('pointerdown', this.onDown, { passive: false });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.joyActive = true;
    this.baseRect = this.base.getBoundingClientRect();
    this.updateKnob(e);
  };

  private onMove = (e: PointerEvent) => {
    if (!this.joyActive) return;
    e.preventDefault();
    this.updateKnob(e);
  };

  private onUp = () => {
    this.joyActive = false;
    this.joystick = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(0px, 0px)';
  };

  private updateKnob(e: PointerEvent) {
    if (!this.baseRect) return;
    const cx = this.baseRect.left + this.baseRect.width / 2;
    const cy = this.baseRect.top + this.baseRect.height / 2;
    const radius = this.baseRect.width / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, radius);
    dx = (dx / dist) * clamped;
    dy = (dy / dist) * clamped;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Screen-down is +y; flying "up" should be negative screen-y -> invert.
    this.joystick = { x: dx / radius, y: -dy / radius };
  }

  /** Combined axis from keyboard + joystick, each component clamped to [-1, 1]. */
  getAxis(): Axis {
    let x = this.joystick.x;
    let y = this.joystick.y;
    if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) y += 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) y -= 1;
    return { x: clamp(x), y: clamp(y) };
  }
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
