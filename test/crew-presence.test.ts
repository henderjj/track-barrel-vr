import { describe, expect, it } from 'vitest';
import { CrewPresence, SILENT_MS } from '../src/net/crew-presence.js';

describe('CrewPresence', () => {
  it('never pauses a player who has had no crewmate', () => {
    const p = new CrewPresence();
    for (const state of ['idle', 'connecting', 'waiting', 'error'] as const) {
      p.update(state, false, false, 0);
      expect(p.status).toBe('solo');
      expect(p.paused).toBe(false);
    }
  });

  it('pauses while the crewmate is away or silent and resumes when they are back', () => {
    const p = new CrewPresence();
    expect(p.update('connected', false, false, 10)).toBe('together');
    expect(p.paused).toBe(false);
    expect(p.update('connected', false, true, 10)).toBe('away');
    expect(p.message()).toMatch(/stepped away/);
    expect(p.update('connected', false, false, SILENT_MS + 1)).toBe('silent');
    expect(p.paused).toBe(true);
    expect(p.update('connected', false, false, 20)).toBe('together');
    expect(p.paused).toBe(false);
  });

  it('tells a dropped connection from a crewmate who left', () => {
    const p = new CrewPresence();
    p.update('connected', false, false, 0);
    expect(p.update('connecting', true, false, 0)).toBe('reconnecting');
    expect(p.update('waiting', true, false, 0)).toBe('reconnecting');
    expect(p.update('waiting', false, false, 0)).toBe('waiting');
    expect(p.message()).toMatch(/left/);
    expect(p.update('error', false, false, 0)).toBe('lost');
    expect(p.paused).toBe(true);
  });

  it('forgets the crew when this player leaves the room', () => {
    const p = new CrewPresence();
    p.update('connected', false, false, 0);
    expect(p.update('idle', false, false, 0)).toBe('solo');
    expect(p.update('waiting', false, false, 0)).toBe('solo');
    expect(p.hadCrew).toBe(false);
  });

  it('keeps on record every status it has been through, however briefly', () => {
    const p = new CrewPresence();
    expect(p.history).toEqual(['solo']);
    p.update('connected', false, false, 0);
    const mark = p.changes;
    // A drop that mends before anything else looks: connecting, back through the lobby, connected.
    p.update('connecting', true, false, 0);
    p.update('waiting', true, false, 0);
    p.update('connecting', true, false, 0);
    p.update('connected', false, false, 0);
    expect(p.status).toBe('together');
    expect(p.history).toEqual(['solo', 'together', 'reconnecting', 'together']);
    // The same status again is not a change.
    p.update('connected', false, false, 5);
    expect(p.changes - mark).toBe(2);
    // Only the last 16 are kept; `changes` still counts them all.
    for (let i = 0; i < 20; i++) p.update('connected', false, i % 2 === 0, 0);
    expect(p.history).toHaveLength(16);
    expect(p.history[15]).toBe('together');
    expect(p.changes - mark).toBe(22);
  });
});
