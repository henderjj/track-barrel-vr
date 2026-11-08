import { CanvasTexture, createSystem, type Entity, type Mesh, MeshBasicMaterial, type Object3D, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { onSettingChange } from '../live-settings.js';
import { createCalloutCard } from '../scene-assets/callout-card.scene-asset.js';
import { settings } from '../settings.js';
import { CARDS, cardText, type CardText, clockAngle } from '../sim/callout-card.js';
import { SEAT_IDS, type SeatId } from '../sim/cabin.js';

interface CardDebug {
  /** Whether the cards show (the Callout card setting). */
  shown(): boolean;
  /** What `seat`'s card says. */
  text(seat: SeatId): CardText;
  /** The middle of `seat`'s card's face in world space, and the way it faces (a unit vector). */
  face(seat: SeatId): { at: number[]; normal: number[] };
}

/** The canvas's size: the card's 3:2, at about 2.9 px a millimetre on the driver's card. */
const PX_W = 1200;
const PX_H = 800;

const PAPER = '#26281f';
const INK = '#e6dcbc';
const HEAD = '#d9a441';
const RULE = '#6f6c58';

/**
 * Hangs a callout card in each seat (F2.6, docs/callout-card.md): the
 * driver's on the hull's left wall, the gunner's on the turret's front
 * wall, turning with it. Each face is drawn once, as the seat's card says;
 * the Callout card setting (game menu → Sound and view) hides both at once.
 * Nothing per frame.
 */
export class CalloutCardSystem extends createSystem({}) {
  private cards: { seat: SeatId; mesh: Mesh }[] = [];

  init(): void {
    for (const seat of SEAT_IDS) {
      const place = CARDS[seat];
      const { texture, material } = this.drawFace(cardText(seat));
      const mesh = createCalloutCard(place, material);
      mesh.name = `Callout Card ${seat}`;
      const parent: Entity | undefined = this.world.getSceneEntity(place.frame) ?? undefined;
      if (parent === undefined) console.warn(`[CalloutCard] no ${place.frame} in the scene: the ${seat}'s card hangs in the world`);
      this.world.createTransformEntity(mesh, parent ? { parent } : undefined);
      this.cards.push({ seat, mesh });
      this.cleanupFuncs.push(() => {
        texture.dispose();
        material.dispose();
      });
    }
    this.applySetting();
    this.cleanupFuncs.push(
      onSettingChange((key) => {
        if (key === 'card') this.applySetting();
      }),
    );
    const at = new Vector3();
    const normal = new Vector3();
    const card = (seat: SeatId): Object3D => this.cards.find((c) => c.seat === seat)!.mesh.getObjectByName('Callout Card Face')!;
    (window as unknown as { __calloutCard: CardDebug }).__calloutCard = {
      shown: () => this.cards.every((c) => c.mesh.visible),
      text: (seat) => cardText(seat),
      face: (seat) => {
        const face = card(seat);
        face.updateWorldMatrix(true, false);
        face.getWorldPosition(at);
        face.getWorldDirection(normal);
        return { at: at.toArray(), normal: normal.toArray() };
      },
    };
  }

  private applySetting(): void {
    for (const { mesh } of this.cards) mesh.visible = settings.card;
  }

  /** The card's face, drawn once: the calls this seat makes, the ones it hears, and a clock face over a hull outline. */
  private drawFace(text: CardText): { texture: CanvasTexture; material: MeshBasicMaterial } {
    const canvas = document.createElement('canvas');
    canvas.width = PX_W;
    canvas.height = PX_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PX_W, PX_H);
    ctx.strokeStyle = RULE;
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, PX_W - 28, PX_H - 28);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = HEAD;
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(text.title, PX_W / 2, 74);
    ctx.fillStyle = RULE;
    ctx.fillRect(40, 118, PX_W - 80, 4);

    // Two columns of calls on the left two thirds, the clock on the right third.
    const colW = 400;
    const column = (x: number, heading: string, lines: readonly string[]) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = HEAD;
      ctx.font = 'bold 30px sans-serif';
      ctx.fillText(heading, x, 166, colW - 20);
      ctx.fillStyle = INK;
      ctx.font = 'bold 36px sans-serif';
      const step = Math.min(78, (PX_H - 250) / Math.max(1, lines.length));
      lines.forEach((line, i) => ctx.fillText(line, x, 230 + i * step, colW - 20));
    };
    column(44, text.sayHeading, text.say);
    column(44 + colW, text.hearHeading, text.hear);
    ctx.fillStyle = RULE;
    ctx.fillRect(44 + colW - 22, 150, 4, PX_H - 190);
    ctx.fillRect(44 + 2 * colW - 22, 150, 4, PX_H - 190);

    // The clock: twelve hours round a hull outline seen from above, its front (and the gun) towards 12.
    const cx = 44 + 2 * colW + 168;
    const cy = 440;
    const r = 130;
    ctx.textAlign = 'center';
    ctx.fillStyle = HEAD;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(text.clockHeading, cx, 166, 330);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = INK;
    for (let hour = 1; hour <= 12; hour++) {
      const a = clockAngle(hour);
      const major = hour % 3 === 0;
      ctx.font = major ? 'bold 40px sans-serif' : '28px sans-serif';
      ctx.fillText(String(hour), cx + Math.sin(a) * (r - 34), cy - Math.cos(a) * (r - 34));
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * (r - (major ? 14 : 8)), cy - Math.cos(a) * (r - (major ? 14 : 8)));
      ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
      ctx.stroke();
    }
    // The hull, its front up, with the turret and the gun forward.
    ctx.strokeStyle = HEAD;
    ctx.lineWidth = 4;
    ctx.strokeRect(cx - 22, cy - 38, 44, 76);
    ctx.beginPath();
    ctx.arc(cx, cy + 4, 15, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx, cy - 56);
    ctx.stroke();
    // "2 o'clock": an arrow from the hull to the 2.
    const two = clockAngle(2);
    ctx.strokeStyle = INK;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(two) * 30, cy - Math.cos(two) * 30);
    ctx.lineTo(cx + Math.sin(two) * (r - 60), cy - Math.cos(two) * (r - 60));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(text.clockNote, cx, cy + r + 44, 330);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
    return { texture, material };
  }
}
