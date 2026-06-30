import type { Phase } from './types';

/**
 * Core stratagems, modelled after the 10th-edition core set but with original
 * wording. Each entry describes *when* it can be used and what it costs; the
 * actual mechanical effect is applied by GameEngine.activateStratagem, which
 * knows how to wire each id into the engine.
 *
 * `phase` is the phase the stratagem may be used in ('any' = unrestricted).
 * `when` describes turn ownership:
 *   - 'your-turn'      : only during the active player's own turn
 *   - 'opponents-turn' : only while the opponent is the active player
 *   - 'either'         : usable in either player's turn
 */
export interface Stratagem {
  id: string;
  name: string;
  cost: number;
  phase: Phase | 'any';
  when: 'your-turn' | 'opponents-turn' | 'either';
  detail: string;
}

/**
 * The subset of core stratagems the engine can apply meaningfully. Each detail
 * line is original, concise text describing the engine's faithful approximation.
 * Stratagems that are listed but only partially/symbolically applied note their
 * limitation in the detail string and are documented in stratagems below.
 */
export const CORE_STRATAGEMS: Stratagem[] = [
  {
    id: 'command_reroll',
    name: 'Command Re-roll',
    cost: 1,
    phase: 'any',
    when: 'either',
    detail:
      "Grant a chosen unit a one-shot re-roll: its next shooting or melee attack re-rolls all failed hit rolls.",
  },
  {
    id: 'counter_offensive',
    name: 'Counter-offensive',
    cost: 2,
    phase: 'fight',
    when: 'either',
    detail:
      "In the Fight phase, a chosen eligible unit fights next, out of the normal sequence.",
  },
  {
    id: 'insane_bravery',
    name: 'Insane Bravery',
    cost: 1,
    phase: 'command',
    when: 'your-turn',
    detail: "A chosen unit automatically passes its next Battle-shock test.",
  },
  {
    id: 'go_to_ground',
    name: 'Go to Ground',
    cost: 1,
    phase: 'shooting',
    when: 'opponents-turn',
    detail:
      "A targeted Infantry unit gains the benefit of cover and a 6+ invulnerable save until your next turn.",
  },
  {
    id: 'smokescreen',
    name: 'Smokescreen',
    cost: 1,
    phase: 'shooting',
    when: 'opponents-turn',
    detail:
      "A targeted unit with a smoke-like profile gains cover and a 6+ invulnerable save against shooting until your next turn.",
  },
  {
    id: 'fire_overwatch',
    name: 'Fire Overwatch',
    cost: 1,
    phase: 'any',
    when: 'opponents-turn',
    detail:
      "As an enemy unit moves or charges, a chosen unit shoots it; hits land only on unmodified 6s.",
  },
  {
    id: 'heroic_intervention',
    name: 'Heroic Intervention',
    cost: 1,
    phase: 'charge',
    when: 'opponents-turn',
    detail:
      "No-op approximation: a defending unit declares a reactive charge. The engine logs the intent but charges resolve via the normal charge API.",
  },
  {
    id: 'grenade',
    name: 'Grenade',
    cost: 1,
    phase: 'shooting',
    when: 'your-turn',
    detail:
      "A unit with the Grenades keyword lobs grenades at a nearby enemy: D6 mortal-style hits (S6) inflicted directly.",
  },
  {
    id: 'tank_shock',
    name: 'Tank Shock',
    cost: 1,
    phase: 'charge',
    when: 'your-turn',
    detail:
      "No-op approximation: a Vehicle that charged slams into the enemy. The engine has no mortal-wound-on-charge hook, so this only logs.",
  },
  {
    id: 'epic_challenge',
    name: 'Epic Challenge',
    cost: 1,
    phase: 'fight',
    when: 'either',
    detail:
      "A Character unit gains the Precision ability for its melee attacks this fight, letting it pick off an attached enemy Character.",
  },
  {
    id: 'rapid_ingress',
    name: 'Rapid Ingress',
    cost: 1,
    phase: 'movement',
    when: 'opponents-turn',
    detail:
      "At the end of the opponent's Movement phase, a unit in Reserves can arrive (Deep Strike) early, more than 9\" from enemies.",
  },
  {
    id: 'armour_of_contempt',
    name: 'Armour of Contempt',
    cost: 1,
    phase: 'any',
    when: 'opponents-turn',
    detail:
      "A targeted unit shrugs off enemy fire: incoming attacks suffer -1 AP against it until your next turn.",
  },
  {
    id: 'dark_pact',
    name: 'Dark Pact',
    cost: 0,
    phase: 'any',
    when: 'your-turn',
    detail:
      "Chaos only: a chosen unit swears a pact — pass a Leadership test to gain Lethal Hits on its next attack; fail and it suffers D3 mortal wounds.",
  },
];

/** Look up a stratagem definition by id. */
export function findStratagem(id: string): Stratagem | undefined {
  return CORE_STRATAGEMS.find((s) => s.id === id);
}
