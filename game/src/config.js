// Neon Harbor — every tuning number, colour and story beat in one place.
// The city is a fixed 3200x2400 world; the camera follows the player, so no rule
// below depends on the screen size. All art is drawn on canvas, all sound is
// synthesized — the game ships zero image or audio files.

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Where a save is kept between visits (this browser only). */
export const SAVE_KEY = 'neon-harbor-save-v1';

/** The city: streets every 400 px, 96 px wide, so blocks are 304 px squares. */
export const WORLD = { width: 3200, height: 2400 };
export const STREETS_X = [200, 600, 1000, 1400, 1800, 2200, 2600, 3000];
export const STREETS_Y = [200, 600, 1000, 1400, 1800, 2200];
export const STREET_WIDTH = 96;
export const LANE = 26; // how far a driving lane sits from a street's centre line

/** The player on foot. */
export const PLAYER = {
  radius: 13,
  walkSpeed: 235,
  health: 100,
  pistolDamage: 34,
  punchDamage: 22,
  punchRange: 52,
  punchCooldown: 0.38,
  ammoStart: 36,
  ammoMax: 120,
};

/** Cars: driving model, health and who drives them. */
export const CAR = {
  length: 62,
  width: 30,
  radius: 26,
  maxSpeed: 345, // player car, px/s
  trafficSpeed: 130,
  policeSpeed: 305,
  accel: 420,
  brake: 620,
  reverseMax: 130,
  turnRate: 2.6, // radians per second at full lock
  health: 100,
  ramDamage: 9,
  crashDamageSpeed: 190, // crashing above this speed hurts
};

/** The wanted system: stars, what earns them, how they fade. */
export const WANTED = {
  max: 5,
  stealCar: 1,
  hitPedestrian: 1,
  shootNearPolice: 1,
  killPedestrian: 1,
  quietSeconds: 12, // no crime for this long before stars start to fall
  decaySeconds: 6, // one star per this many quiet seconds
  policeSight: 560, // a cop closer than this keeps the heat on
  bustedSeconds: 1.2, // a police car touching you on foot for this long busts you
};

/** The three-mission story chain. Markers are world points the player must reach. */
export const MISSIONS = [
  {
    title: 'MISSION 1 — THE PACKAGE',
    text: 'Meet Rico at the warehouse. Pick up the package.',
    marker: { x: 600, y: 1900 },
    reward: 200,
    radius: 78,
  },
  {
    title: 'MISSION 2 — LOSE THE COPS',
    text: 'The drop went loud. Lose the heat — get your wanted level to zero.',
    marker: null,
    reward: 300,
    radius: 0,
  },
  {
    title: 'MISSION 3 — THE DOCKS',
    text: 'Deliver the package to the docks, east side. Do not stop for anyone.',
    marker: { x: 2600, y: 200 },
    reward: 500,
    radius: 78,
  },
];

/** The story's own places: the warehouse block and the docks block. */
export const LANDMARKS = {
  warehouse: { bx: 1, by: 4, label: 'WAREHOUSE' }, // block column/row in the grid
  docks: { bx: 6, by: 0, label: 'DOCKS' },
};

/** Pickups scattered on the sidewalks. */
export const PICKUP = {
  ammo: 24,
  health: 30,
  money: 50,
  radius: 26,
  respawnSeconds: 22,
  counts: { ammo: 6, health: 4, money: 8 },
};

/** How many of each crowd the city holds. */
export const CROWD = { traffic: 14, parked: 9, pedestrians: 24 };

/** Night-neon palette: dark asphalt, cyan and magenta neon, warm sodium streetlight. */
export const PALETTE = {
  backdrop: '#070812',
  ground: '#0d0f1e',
  asphalt: '#151828',
  asphaltEdge: '#1e2238',
  sidewalk: '#232744',
  sidewalkEdge: '#2e3358',
  roadLine: '#c8b45a',
  crosswalk: '#3a3f63',
  buildingRoof: ['#1c2140', '#232847', '#1a2038', '#262b4d', '#1e2442'],
  buildingEdge: '#3d4480',
  neonPink: '#ff2e88',
  neonCyan: '#22e6ff',
  neonAmber: '#ffb02e',
  neonGreen: '#39ff88',
  water: '#0a2a44',
  player: '#22e6ff',
  playerJacket: '#ff2e88',
  police: '#e8ecff',
  policeLightR: '#ff2244',
  policeLightB: '#2266ff',
  pedShirt: ['#ffd166', '#7bd88a', '#c77dff', '#ff8fa3', '#8ecae6', '#f4a261'],
  text: '#eef1f5',
  muted: '#9aa1c7',
  gold: '#ffd166',
  danger: '#ff3b30',
  ok: '#39ff88',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** A seeded generator (mulberry32): the same seed gives the same city, the same
 *  traffic and the same screenshot scenes, which is what makes ?shot= repeatable. */
export function mulberry32(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
export const lerp = (a, b, t) => a + (b - a) * t;

/** The shortest signed turn from angle `from` to angle `to`, in (-PI, PI]. */
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn `from` toward `to` by at most `maxTurn` radians. */
export function angleToward(from, to, maxTurn) {
  const d = angleDiff(from, to);
  if (d > maxTurn) return from + maxTurn;
  if (d < -maxTurn) return from - maxTurn;
  return to;
}

/** Squared distance between two points (no sqrt until it is needed). */
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
