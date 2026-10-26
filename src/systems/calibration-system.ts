import { createSystem, InputComponent, Vector3 } from '@iwsdk/core';
import { Calibration, type CalibrationStep, levelDistance } from '../sim/calibration.js';
import { settings } from '../settings.js';
import { body } from './body-height-system.js';
import { drawSignBackground, FloatingSign } from './floating-sign.js';
import { gameMenu } from './game-menu-system.js';
import { grip } from './grip-system.js';
import { seating } from './seating.js';
import { startScreen } from './start-screen-system.js';

/** How long "Calibrated" stays up once both steps are done, s. */
const DONE_SECONDS = 2.5;

interface CalibrationDebug {
  readonly step: CalibrationStep;
  readonly eye: number;
  readonly reach: number;
  readonly progress: number;
  /** The sign is showing, and what it says. */
  readonly sign: string;
  start(): void;
  skip(): void;
}

/**
 * Seat calibration (F1.2, src/sim/calibration.ts, docs/seat-choice.md): each
 * time VR starts, once the start screen is out of the way, a sign asks the
 * player to sit back (or stand) as they will play and look ahead, then to
 * hold both hands out and squeeze both grips. The eye height goes to the
 * body-height system, which puts it on the seat's eye point; the reach is
 * kept for the controls and the stats. A on the right controller skips a
 * step; the game menu's Calibrate again starts over. It waits while the
 * start screen or the game menu is open or a spike seats the player
 * elsewhere, and the practice crewmate's page never calibrates.
 */
export class CalibrationSystem extends createSystem({}) {
  private cal = new Calibration();
  private sign!: FloatingSign;
  private inVr = false;
  private pending = false;
  private doneUntil = 0;
  private time = 0;
  private drawn = '';
  private signText = '';
  private head = new Vector3();
  private hand = new Vector3();

  init(): void {
    this.sign = new FloatingSign('Calibration Sign', 0.62, [600, 200], 1.0, 0.35);
    this.world.createTransformEntity(this.sign.mesh);
    body.calibrate = () => {
      if (!settings.bot) this.pending = true;
    };
    const self = this;
    (window as unknown as { __calibration: CalibrationDebug }).__calibration = {
      get step() { return self.cal.step; },
      get eye() { return self.cal.eye; },
      get reach() { return self.cal.reach; },
      get progress() { return self.cal.progress; },
      get sign() { return self.sign.visible ? self.signText : ''; },
      start: () => body.calibrate(),
      skip: () => this.skip(),
    };
  }

  update(delta: number): void {
    this.time += delta;
    if (!this.world.session) {
      if (this.inVr) {
        this.inVr = false;
        this.cal.step = 'off';
        this.sign.setVisible(false);
      }
      return;
    }
    if (!this.inVr) {
      // Someone else may be wearing the headset now: calibrate afresh.
      this.inVr = true;
      this.cal.eye = Number.NaN;
      this.cal.reach = Number.NaN;
      this.pending = !settings.bot;
    }
    if (startScreen.open || gameMenu.open || seating.away) {
      // Not looking ahead from the seat: wait.
      this.sign.setVisible(false);
      this.drawn = '';
      return;
    }
    if (this.pending) {
      this.pending = false;
      this.cal.start();
    }
    const step = this.cal.step;
    if (step === 'off') {
      return;
    }
    if (step === 'done') {
      if (this.time > this.doneUntil) {
        this.cal.step = 'off';
        this.sign.setVisible(false);
        return;
      }
    } else if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.skip();
    } else if (step === 'eyes') {
      if (this.cal.pushHead(this.player.head.position.y, delta)) {
        body.calibratedEye = this.cal.eye;
        body.changed = true;
        console.info(`[Calibration] eyes at ${this.cal.eye.toFixed(3)} m`);
      }
    } else if (step === 'reach') {
      this.player.head.getWorldPosition(this.head);
      const left = this.reachOf('left');
      const right = this.reachOf('right');
      if (this.cal.pushReach(left, right, grip.left.pressed && grip.right.pressed)) {
        body.reach = this.cal.reach;
        console.info(`[Calibration] reach ${this.cal.reach.toFixed(3)} m`);
        this.finish();
      }
    }
    this.draw();
    this.sign.follow(this.player.head, delta);
  }

  /** The level distance from the eyes to a hand, m. */
  private reachOf(side: 'left' | 'right'): number {
    this.player.gripSpaces[side].getWorldPosition(this.hand);
    return levelDistance(this.head, this.hand);
  }

  private skip(): void {
    const was = this.cal.step;
    this.cal.skip();
    console.info(`[Calibration] skipped the ${was} step`);
    if (this.cal.step === 'done') {
      this.finish();
    }
  }

  private finish(): void {
    this.doneUntil = this.time + DONE_SECONDS;
  }

  /** Draw the sign for the step in hand (only when its words or the progress bar change). */
  private draw(): void {
    const step = this.cal.step;
    const progress = step === 'eyes' ? Math.round(this.cal.progress * 10) : 0;
    const key = `${step}:${progress}:${body.choice.seated}`;
    if (key === this.drawn) {
      if (!this.sign.visible) this.sign.setVisible(true);
      return;
    }
    this.drawn = key;
    const lines: [string, string, string] =
      step === 'eyes'
        ? [
            body.choice.seated ? 'Sit back as you will play' : 'Stand as you will play',
            'Look straight ahead and hold still',
            'A: skip',
          ]
        : step === 'reach'
          ? ['Hold both hands out in front', 'as far as is comfortable, and squeeze both grips', 'A: skip']
          : [
              'Calibrated',
              Number.isFinite(this.cal.reach) ? `Reach ${Math.round(this.cal.reach * 100)} cm` : 'Reach not measured',
              'Game menu (Y): Calibrate again',
            ];
    const { ctx, width, height } = this.sign;
    drawSignBackground(ctx, width, height);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px sans-serif';
    ctx.fillText(lines[0], width / 2, 62);
    ctx.font = '28px sans-serif';
    ctx.fillText(lines[1], width / 2, 110);
    ctx.font = '22px sans-serif';
    ctx.fillStyle = '#c9b48a';
    ctx.fillText(lines[2], width / 2, 176);
    if (step === 'eyes') {
      // How long left to hold still.
      ctx.fillStyle = 'rgba(244, 234, 216, 0.25)';
      ctx.fillRect(100, 132, width - 200, 12);
      ctx.fillStyle = '#c9a03a';
      ctx.fillRect(100, 132, ((width - 200) * progress) / 10, 12);
    }
    this.sign.refresh();
    this.sign.setVisible(true);
    this.signText = lines.join(' / ');
  }
}
