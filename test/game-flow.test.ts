import { describe, expect, it } from 'vitest';
import { calibrationShown, codeShown, crewScreen, menuCrewLine, raiseShown, seatsLine, stepRaise, typeCode } from '../src/game-flow.js';

describe('start screen', () => {
  it('types a four-letter crew code', () => {
    let typed = '';
    for (const key of ['A', 'B', 'del', 'C', 'D', 'E', 'F']) {
      typed = typeCode(typed, key);
    }
    expect(typed).toBe('ACDE');
    expect(codeShown('AC')).toBe('A C _ _');
    expect(typeCode('', 'del')).toBe('');
    expect(typeCode('A', '1')).toBe('A');
  });

  it('says how to bring in the practice crewmate', () => {
    const s = crewScreen('practice', 'waiting', 'QRST', '', '', 'example.com/game');
    expect(s.status).toBe('Waiting for the practice crewmate.');
    expect(s.help).toContain('example.com/game/?room=QRST&bot=1');
    expect(s.ready).toBe(false);
  });

  it('tells a host to share the code, and starts once the crewmate is aboard', () => {
    expect(crewScreen('host', 'waiting', 'QRST', '', '', 'x').help).toContain('QRST');
    const aboard = crewScreen('host', 'connected', 'QRST', '', 'Ann', 'x');
    expect(aboard.status).toBe('Ann is aboard.');
    expect(aboard.ready).toBe(true);
  });

  it('explains a full crew or a failed join', () => {
    expect(crewScreen('join', 'full', 'QRST', '', '', 'x').status).toContain('already has two players');
    expect(crewScreen('join', 'error', 'QRST', 'lobby unreachable', '', 'x').status).toContain('lobby unreachable');
  });
});

describe('game menu', () => {
  it('says nothing about a crew when playing solo', () => {
    expect(menuCrewLine('idle', '', '', false)).toBe('');
    expect(menuCrewLine('closed', 'QRST', '', false)).toBe('');
  });

  it('names the crew and the crewmate', () => {
    expect(menuCrewLine('connected', 'QRST', 'Ann', false)).toBe('Crew QRST: playing with Ann.');
    expect(menuCrewLine('waiting', 'QRST', '', true)).toBe('Crew QRST: waiting for the practice crewmate.');
  });
});

describe('eye height in the game menu', () => {
  const step = (raise: number, direction: 1 | -1) => stepRaise(raise, direction, 0.05, 0.15);

  it('steps 5 cm at a time either side of the eye point and stays in range', () => {
    expect(step(0, 1)).toBe(0.05);
    expect(step(0.05, -1)).toBe(0);
    expect(step(0, -1)).toBe(-0.05);
    expect(step(0.15, 1)).toBe(0.15);
    expect(step(-0.15, -1)).toBe(-0.15);
    expect(step(0.1, 1)).toBe(0.15);
  });

  it('shows how far above or below the eye point', () => {
    expect(raiseShown(0)).toBe('0 cm');
    expect(raiseShown(0.05)).toBe('+5 cm');
    expect(raiseShown(-0.1)).toBe('−10 cm');
  });

  it('says what the last calibration found', () => {
    expect(calibrationShown(Number.NaN, Number.NaN)).toBe('Not calibrated yet: eyes measured as you play.');
    expect(calibrationShown(1.183, Number.NaN)).toBe('Calibrated: eyes 1.18 m above your floor.');
    expect(calibrationShown(1.183, 0.584)).toBe('Calibrated: eyes 1.18 m above your floor, reach 58 cm.');
  });
});

describe('seats on the crew page', () => {
  it('says where this player sits, and who keeps a seat both pick', () => {
    expect(seatsLine('driver', 'gunner', false, 'none')).toBe('You drive. If your crewmate picks the same seat, whoever started the crew keeps it.');
    expect(seatsLine('gunner', 'driver', true, 'none')).toBe('You lay and fire the gun; your crewmate is the driver.');
  });

  it('says when a swap waits for a word', () => {
    expect(seatsLine('driver', 'gunner', true, 'asked')).toBe('Asked your crewmate to swap seats.');
    expect(seatsLine('driver', 'gunner', true, 'offered')).toBe('Your crewmate asks to swap seats: pick their seat to agree.');
  });
});
