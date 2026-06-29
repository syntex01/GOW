# Grimdark Tabletop — Wargame Simulator

A turn-based, **tabletop-faithful** grimdark wargame simulator built to test armies
and develop strategies. It mirrors the rules of the current edition of the
38th-millennium tabletop game: the full turn structure, the dice resolution
sequence, objectives and scoring — reproduced 1:1 with the tabletop math
(validated against published profiles and verified by an automated test suite).

This is an early but **fully playable** vertical slice. The general systems are
built once and faction-agnostic; the slice ships **2 factions with 2 units each**
(Necrons: Warriors + Overlord — Ultramarines: Intercessors + Captain) and is
designed to expand to the whole game.

## Status

- ✅ Deterministic, seedable rules engine (pure TypeScript, headless-testable)
- ✅ Full attack sequence: hit → wound (S-vs-T chart) → save (AP + invuln) →
  damage → Feel No Pain, with weapon abilities (Rapid Fire, Sustained Hits,
  Lethal Hits, Devastating Wounds, Twin-linked, Anti-X, Melta, Blast, Torrent…)
- ✅ Five-phase turn: Command (CP, battle-shock, reanimation) → Movement
  (move / advance / fall back) → Shooting → Charge (2D6) → Fight (chargers first)
- ✅ Objectives, objective control (OC), progressive scoring, win conditions
- ✅ Graphically rich Three.js battlefield: PBR battlemat, terrain, glowing
  objective markers, faction-themed procedural model proxies, measurement &
  range tools, damage popups, orbit camera
- ✅ Interactive hotseat HUD: phase tracker, unit datacards, battle log
- ✅ **Army importer**: paste an army-list text export (Warhammer app / New
  Recruit / BattleScribe) and deploy it
- ✅ **Custom model import** slot (glTF / GLB / OBJ / STL) for publicly available models
- ✅ 85 passing tests, incl. empirical-vs-analytic combat fidelity checks

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # rules + fidelity test suite
npm run build    # production bundle
```

## Architecture

```
src/
  engine/      pure rules engine (no DOM) — the source of truth
    types.ts       data model (datasheets + live instances)
    dice.ts        seedable RNG + dice expressions
    geometry.ts    distances, engagement, coherency, objective control
    combat.ts      the attack sequence
    game.ts        turn/phase state machine
    factory.ts     army assembly + battlefield setup
    data/          faction datasheets (Necrons, Ultramarines)
  render/      Three.js renderer (implements SceneController)
  ui/          interactive HUD + input wiring
  import/      army-list text importer
tests/         vitest suite (engine + fidelity)
old/           the previous project, preserved
```

The renderer talks to the rest of the app only through `SceneController`, so it
can evolve (or be swapped for mobile/2D) independently. The engine is fully
deterministic given a seed, which is what makes the tabletop fidelity testable.

## Roadmap

Detachments, stratagems & enhancements; leader attachment in play; reserves /
deep strike UI; terrain LoS & cover from real geometry; more factions/units;
online multiplayer; touch/mobile controls; optional animations.
