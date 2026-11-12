# Ammunition types (F3.1)

The gun fires three rounds, each with its own job: **AP** (armour piercing) for tanks, **HE** (high explosive) for guns and their crews, and **smoke** to hide the tank. The gunner picks the round by the shell they take from the ready rack. The numbers live in [`src/sim/ammo.ts`](../src/sim/ammo.ts); the flight in [`src/sim/ballistics.ts`](../src/sim/ballistics.ts); the smoke screen is drawn by [`src/systems/smoke-system.ts`](../src/systems/smoke-system.ts).

## What players experience

- **The rack** on the turret wall right of the gunner holds four shells, now in three colours: two **AP** in the lower row (black projectile, a silver band), an **HE** above them nearest the hand (olive, a yellow band) and a **smoke** round at the far end of the upper row (grey, a yellow band). A fired round's slot refills with the same kind, as before. The loading board says what is loaded: "Loaded HE: fire!".
- **AP** flies flat and fast (600 m/s, as every round did in Phase 1) and needs a direct hit. A hit on a board flashes yellow, as before.
- **HE** flies slower (450 m/s), so it drops more: 6 m at 500 m where AP drops 3.4 m. It bursts where it lands in a big orange-and-black fireball. A direct hit counts on any target; on a soft target (the range's 250 m anti-tank gun) a burst within **5 m** of it counts as a hit too: "HE burst 3 m from the 250 m gun: hit". A burst beside a tank board does nothing (its armour; F3.4 brings real armour).
- **Smoke** flies as HE does and lands in a small puff. Where it lands a bank of grey smoke grows to 22 m across within 4 s, holds for 40 s and thins away over 12 s. It stays where it landed and the light breeze from the west (0.8 m/s) draws it out eastwards into a longer bank, up to 24 m longer after 30 s, its upwind end staying put. (At first the whole bank slid downwind like a solid thing; John, 2026-11-12.) Its puffs are solid in the middle, so the gunsight and the periscopes can't see through it, and nor can the enemies (F3.2), but their rims break up into a soft, ragged fringe. A smoke round never counts as a hit: "Smoke on the 250 m gun", or "Smoke 20 m short of the 500 m tank".
- **The gunsight** has a second range scale: AP's marks right of the stem (as before) and the HE's, longer, on the left, each headed "AP" and "HE". Smoke uses the HE scale.
- **The game menu** has a new **Combat** tab for Phase 3's shortcuts:
  - **Ammunition rack**: Mixed (the default), All AP, All HE, All smoke. Either crew member's choice fills the gunner's rack.
  - **Ready on the gun**: AP, HE or Smoke: parks the tank at the range's start, puts a solo player in the gunner's seat, lays the gun on the 250 m gun for that round's drop and loads it.
  - A line under them: the rack's rounds, what is loaded and where the last shot went.
- **Calls**: from the driver's seat, Calls has a new row, **Gunner, load: AP, HE, Smoke**. The practice crewmate as gunner loads that round from then on; the callout card lists the three calls.

## Numbers

| What | Value | Why |
| --- | --- | --- |
| AP | 600 m/s, direct hit only | Phase 1's round; FM 23-95's AP M61 left the M3 at about 620 m/s |
| HE | 450 m/s, 5 m blast on soft targets | The HE M48 at normal charge, 1,470 ft/s. 5 m is a generous lethal radius for a gun crew behind a shield, so a near miss on the ground counts |
| Smoke | 450 m/s, no hit | The real M89 was slower again (about 260 m/s); sharing the HE's speed keeps one scale for both on the sight |
| Smoke screen | 2.5 m radius at once, 11 m within 4 s, 40 s held, 12 s to thin; 0.6 as high as wide; its upwind end where it landed, the wind (0.8 m/s east, 0.2 m/s south) drawing a tail out downwind at its own speed, up to 24 m; four at once | One round hides a tank at a few hundred metres for about a minute, as a 75 mm smoke round did in a light wind; the burning filler keeps feeding the bank where it landed, so it lengthens downwind rather than moving off |
| Smoke's soft edge | Each puff solid where it faces the eye, thinning to clear at its rim (facing 0.7 to 0.05), ragged by ±0.15 of smooth grain | Alpha-to-coverage: the headset's 4× anti-aliasing samples make the fringe, so the bank stays opaque to the renderer (no blending or sorting) and costs about what the solid bank did |
| Mixed rack | slots 0 and 1 (lower) AP, slot 2 HE, slot 3 smoke | AP is the round reached for most and the one the crewmate takes first; a biathlon line (F5.3b) spends the upper slots first and loads all AP |
| HE scale on the sight | 100 m to 1,000 m; 24 mils at 1,000 m | Fits inside the 6° field with room |

## Sharing

- **The rack**: the loading packet (PacketType 8) grows by four bytes on the end, one per shell, saying its round. A page on the build before this reads the first 75 bytes as before; this build reads a 75-byte packet with the mixed rack. Pressing Ammunition rack on either page sets it on both with the reliable event `rack`; the gunner's page loads from it.
- **The shot**: the `shot` event gains `k`, the round (an index into `AMMO_KINDS`; none means AP, as an older page sends). Both pages fly it at that round's speed, so both draw the same tracer, burst and smoke screen; the smoke screen needs nothing more sent.
- **The hit**: the host decides by the round (`decideShot`) and sends `shot-hit` with `counted` (the target it counts, or -1) and `blast` (how far from it an HE round burst). A guest takes its word; from an older host with no `counted`, a direct hit counts as before. The range run, the biathlon and the practice crewmate count `counted`.
- **Ready on the gun** from the driver's seat asks the gunner's page with `range-ready`, which gains `k`.

Alone, this page does both seats' parts as before.

## The practice crewmate

As gunner it loads AP, as before, until the driver calls a round (Calls → Gunner, load), then takes that round from the rack while it has one, and lays for its speed. It counts a hit by the host's `counted`, so an HE burst beside the gun counts and smoke never does. As driver it has nothing new to do.

## Departures from the building skill

- No new model of its own beyond the shells' colours, the HE burst and the smoke bank (`src/scene-assets/smoke.scene-asset.ts`), all in the z-fighting test.
- The smoke bank is drawn with both sides of its faces, so a crew inside one sees grey, as in real smoke. The skill asks for opaque clouds; its material is opaque to the renderer (no blending, no sorting, it writes depth), but alpha-to-coverage gives its puffs soft, ragged rims (John's choice, 2026-11-12). Where a page draws without anti-aliasing the rims are cut clean instead of soft. The puffs are stretched with the bank, so a long bank's puffs are longer than they are wide.
- Smoke on the 250 m gun counts as no hit, which a range run would otherwise have counted; Phase 1's runs used AP only, so nothing changes for them.

## Tests

- `test/ammo.test.ts`: the rounds' speeds and the sight's HE scale; reading a round off the network; the rack's choices and the biathlon's all-AP; laying for each round hits every target, and HE laid as for AP falls short; HE counts by its blast on the gun and not beside a tank or wide; smoke counts nothing and says where it went down; the smoke screen grows, holds, thins, stays where it landed while the wind draws it out, and blocks a line through it along its whole length; the drill gives each shell its slot's round and loads the round asked for; the loading packet carries the rounds and an old packet reads as the mixed rack.
- `test/z-fighting.test.ts`: a shell of each round, the mixed rack in the turret, the HE burst and the smoke bank.
- `npm run test:xr` (step 6s, part 1): Combat → Ammunition rack → All HE and back to Mixed; Ready on the gun → HE hits the gun; an HE round bursting beside the gun counts by its blast; Ready on the gun → Smoke counts no hit and lays a screen that grows and hides the gun, then stays put, its upwind end held, while the wind draws it out. Screenshots: `artifacts/xr-smoke-screen.png`, `artifacts/xr-smoke-stretched.png`.
- `npm run test:net` (`ONLY_FIRING=1`, or `=lag`): after the firing checks, the driver's Ammunition rack reaches the gunner's page; a guest gunner's smoke round counts no hit on either page and both lay its screen; its HE round bursting beside the gun is counted by the host's blast and the guest takes its word.

`window.__loading` gains `setRack(choice)`, `loadNow(kind)` and, in `state()`, `kinds`, `rack` and `loadedRound`. `window.__firing`'s `fire(ammo)`, `predict(ammo)` and `aimAt(i, ammo, rightBy, aboveBy)` take a round, and each record has `ammo`, `counted` and `blast`. `window.__smoke` gives `clouds()` (each with where it landed, its middle, radius, half length along the wind and age), `lay(x, y, z)` and `blocks(a, b)`.

## Headset check

On a Quest 3 after the deploy, with the cache cleared, seated. Stop at once if you feel unwell.

1. Enter VR alone. Game menu (Y) → **Practice → Load and fire → Gunner**. Look right at the rack: two black shells with silver bands below, an olive one with a yellow band above nearest you, a grey one with a yellow band at the far end. Say if the three are easy to tell apart at a glance, and in the dark turret with the hatches shut.
2. Load the olive (HE) shell: the board says "Loaded HE: fire!".
3. Lean in to the gunsight: there are two scales below the chevron, AP on the right and HE on the left. Say if they are readable and if it is clear which is which.
4. Game menu → **Combat → Ready on the gun → HE**. You are laid on the 250 m gun with HE loaded. Fire: a big orange-and-black burst on the gun, and the board says "HE hit". Then lay a little to its right on the ground with the crank and the HE scale's 250 m mark, and fire HE again: a burst within a few metres still counts ("HE burst 3 m from ... hit").
5. **Combat → Ready on the gun → Smoke**, and fire. Watch through the sight: a grey bank grows round the gun within a few seconds and hides it. It stays round the gun while the breeze draws it out to the right into a longer bank, then thins away after about a minute. Its edges should look soft and ragged, not cut clean. Say whether it reads as smoke, whether the edges shimmer as you move your head, and whether the stretched puffs look odd.
6. **Combat → Ammunition rack → All smoke**: every shell in the rack turns grey. Then **Mixed** to put it back.
7. With the crewmate as gunner (`?bot=1` or a second headset), from the driver's seat call **Calls → Gunner, load → HE**: the crewmate's next load is the olive shell and its shot lands where the HE scale says.
8. Press **X** for the perf HUD while a smoke bank is up and you look through it and the gunsight: report the frame time and draw calls.
