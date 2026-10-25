import {
  CanvasTexture,
  createSystem,
  type Entity,
  Mesh,
  MeshBasicMaterial,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { BLOCK_SIZE, createBlock, createColliderBox, DECK_COLLIDERS } from '../scene-assets/deck.scene-asset.js';
import { settings } from '../settings.js';
import { DECK_LENGTH, DECK_WIDTH, HOOP, RAIL_HEIGHT } from '../sim/play-area.js';
import { throughHoop } from '../sim/score.js';
import { netLink } from './net-system.js';
import { type ObjectView, ThrowablesSystem } from './throwables-system.js';

let active: GameSystem | null = null;

/** Start the game again: score to nought and the blocks back on the table, for both players (the menu's Restart). */
export function restartGame(): void {
  active?.restart(true);
}

/** Put the blocks back on the table, for both players (the menu's Practice → Back on the table). */
export function resetBlocks(): void {
  active?.resetBlocks(true);
}

/**
 * The demo game: the static colliders, the throwable blocks, and the hoop
 * that scores a point for each block thrown through it, with a scoreboard
 * on the far rail. Replace it with your game's rules; keep the pattern.
 *
 * Host authority: only the host decides that a block went through (from
 * the blocks as it sees them, including ones the guest threw, which it
 * draws from the guest's packets), and sends the new score as a reliable
 * event. The guest only shows the score it is sent. A guest's Restart asks
 * the host, which restarts and tells the guest. Playing solo, this page is
 * the host. Each player puts back the blocks they simulate (see
 * src/net/ownership.ts), so a reset or restart is sent to the crewmate too.
 */
export class GameSystem extends createSystem({}) {
  readonly blocks: Entity[] = [];
  score = 0;
  private throws: ThrowablesSystem | undefined;
  private prev: [number, number, number][] = [];
  private view: ObjectView = { remote: false, heldBy: null, remoteHeld: false, pos: [0, 0, 0], speed: 0 };
  private board!: { ctx: CanvasRenderingContext2D; texture: CanvasTexture };
  private flashUntil = 0;
  private flashing = false;
  /** The blocks have been put on the table (on the first frame, once ThrowablesSystem has them). */
  private placed = false;

  init(): void {
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });
    for (const collider of DECK_COLLIDERS) {
      const mesh = createColliderBox(collider.size);
      mesh.name = `Collider ${collider.name}`;
      mesh.position.set(...collider.center);
      const entity = this.world.createTransformEntity(mesh);
      entity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: collider.size, friction: 0.7 });
    }
    for (let i = 0; i < settings.blocks; i++) {
      const block = createBlock(i);
      // ThrowablesSystem puts them on the table; until then they wait in a row above it.
      block.position.set((i - settings.blocks / 2) * (BLOCK_SIZE + 0.05), 1.5, -1.2);
      const entity = this.world.createTransformEntity(block);
      entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, angularDamping: 0.2 });
      entity.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE],
        density: 500,
        friction: 0.6,
        restitution: 0.2,
      });
      this.blocks.push(entity);
      this.prev.push([0, 0, 0]);
    }
    this.createBoard();

    netLink.events.set('score', (e) => {
      // The host's word on the score; a guest never counts its own.
      if (!netLink.isHost) this.setScore(Number(e.score), e.point === true);
    });
    netLink.events.set('restart', () => this.restart(false));
    netLink.events.set('blocks', () => this.resetBlocks(false));
    this.cleanupFuncs.push(() => {
      netLink.events.delete('score');
      netLink.events.delete('restart');
      netLink.events.delete('blocks');
    });
    (window as unknown as { __game: unknown }).__game = {
      get score() { return active?.score ?? 0; },
      restart: restartGame,
      resetBlocks,
    };
  }

  update(): void {
    this.throws ??= this.world.getSystem(ThrowablesSystem);
    const throws = this.throws;
    if (!throws) return;
    if (!this.placed) {
      this.placed = true;
      throws.resetBlocks();
    }
    for (let id = 0; id < throws.objectCount; id++) {
      throws.readObject(id, this.view);
      const p = this.view.pos;
      const prev = this.prev[id];
      if (netLink.isHost && !this.view.heldBy && !this.view.remoteHeld && throughHoop(prev, p, HOOP, BLOCK_SIZE / 2)) {
        this.setScore(this.score + 1, true);
        if (netLink.connected) this.sendScore(true);
        console.info(`[Game] block ${id} through the hoop: ${this.score}`);
      }
      prev[0] = p[0];
      prev[1] = p[1];
      prev[2] = p[2];
    }
    if (this.flashing && performance.now() > this.flashUntil) {
      this.flashing = false;
      this.drawBoard();
    }
  }

  /** `ask`: this player pressed it (a guest asks the host; the host tells the guest). */
  restart(ask: boolean): void {
    if (ask && netLink.connected) {
      netLink.sendEvent({ t: 'restart' });
      if (!netLink.isHost) {
        // The host restarts, sends the score, and sends 'restart' back for the blocks.
        return;
      }
    }
    if (netLink.isHost) {
      this.setScore(0, false);
      if (netLink.connected && !ask) netLink.sendEvent({ t: 'restart' });
      if (netLink.connected) this.sendScore(false);
    }
    this.throws?.resetBlocks();
  }

  resetBlocks(ask: boolean): void {
    if (ask && netLink.connected) netLink.sendEvent({ t: 'blocks' });
    this.throws?.resetBlocks();
  }

  /** Host: tell the guest the score (`point`: one was just scored, so its board flashes too). */
  private sendScore(point: boolean): void {
    const event = { t: 'score', score: this.score, point };
    netLink.sendEvent(event);
  }

  private setScore(score: number, point: boolean): void {
    this.score = score;
    if (point) {
      this.flashing = true;
      this.flashUntil = performance.now() + 600;
    }
    this.drawBoard();
  }

  /** A painted board standing on the far rail, to the right of the hoop. */
  private createBoard(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.board = { ctx, texture };
    const mesh = new Mesh(new PlaneGeometry(0.6, 0.3), new MeshBasicMaterial({ map: texture }));
    mesh.name = 'Scoreboard';
    mesh.position.set(DECK_WIDTH / 2 - 0.5, RAIL_HEIGHT + 0.2, -DECK_LENGTH / 2 + 0.1);
    this.world.createTransformEntity(mesh);
    this.drawBoard();
  }

  private drawBoard(): void {
    const { ctx, texture } = this.board;
    ctx.fillStyle = this.flashing ? '#c89b3c' : '#2b2622';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#f4ead8';
    ctx.textAlign = 'center';
    ctx.font = '28px sans-serif';
    ctx.fillText('Through the hoop', 128, 38);
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(String(this.score), 128, 108);
    texture.needsUpdate = true;
  }
}
