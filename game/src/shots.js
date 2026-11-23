// The screenshot scenes behind ?shot=start|drive|mission|wanted. Each one plays
// the real rules forward from a fresh world for a fixed number of steps, steered
// by a simple autopilot (hold the throttle, steer back to the lane), so the frame
// is what a short game really looks like and the same seed always gives the same
// frame. The staged scenes also place a few cars where the camera will see them,
// so the shots are never empty streets.

import { LANE, STEP } from './config.js';
import { angleDiff, clamp } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const DRIVE_SECONDS = 6;
const MISSION_SECONDS = 2;
const WANTED_SECONDS = 5;

const IDLE_INPUT = { move: { x: 0, y: 0 }, steer: 0, throttle: false, brake: false, firing: false, aimX: 0, aimY: 0, enter: false };

/** Drive straight down a street: full throttle, steer back to the lane line. */
function driveInput(world, laneY) {
  const car = world.state.player.car;
  const targetAngle = clamp((laneY - car.y) * 0.004, -0.35, 0.35);
  const steer = clamp(angleDiff(car.angle, targetAngle) * 2.5, -1, 1);
  return { move: { x: 0, y: 0 }, steer, throttle: true, brake: false, firing: false, aimX: car.x + 100, aimY: car.y, enter: false };
}

/** Put two oncoming cars on the street so the drive shot has traffic to pass. */
function stageOncomingTraffic(world, streetY, playerX) {
  const oncoming = world.state.cars.filter((car) => car.role === 'traffic');
  const placed = oncoming.slice(0, 2);
  placed.forEach((car, i) => {
    car.axis = 'x';
    car.dir = -1;
    car.angle = Math.PI;
    car.y = streetY - LANE;
    car.x = playerX + 320 + i * 260;
    car.speed = car.targetSpeed;
  });
}

function stepFor(world, seconds, inputFn) {
  for (let i = 0; i < seconds / STEP; i += 1) {
    world.step(STEP, inputFn === null ? IDLE_INPUT : inputFn(world), false);
  }
}

/**
 * Set `world` to the named scene (start, drive, mission or wanted; any other
 * name is start) and return the screen to draw over it.
 */
export function stageShot(name, world) {
  world.reset();
  const ui = { saveExists: false, overKind: 'wasted', muted: false };
  if (name !== 'drive' && name !== 'mission' && name !== 'wanted') {
    // Title: the city lives behind the logo for five seconds.
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, IDLE_INPUT, true);
    return { screen: SCREEN_TITLE, ui };
  }
  if (name === 'drive') {
    // East down the 1000 street, oncoming traffic passing on the left.
    world.debugGiveCar(1000, 1000, 0);
    stageOncomingTraffic(world, 1000, 1000);
    stepFor(world, DRIVE_SECONDS, (w) => driveInput(w, 1000 + LANE));
    return { screen: SCREEN_PLAY, ui };
  }
  if (name === 'mission') {
    // On foot by the warehouse, the package beacon just down the street.
    world.debugTeleport(600, 1750);
    stepFor(world, MISSION_SECONDS, null);
    return { screen: SCREEN_PLAY, ui };
  }
  // wanted: three stars, three police cars closing in on a getaway drive.
  world.debugGiveCar(1800, 1400, 0);
  world.debugSetWanted(3);
  const p = world.state.player;
  const cops = world.state.cars.filter((car) => car.role === 'police');
  const spots = [
    { x: p.x - 320, y: p.y - 130 },
    { x: p.x + 480, y: p.y + 190 },
    { x: p.x - 520, y: p.y + 160 },
  ];
  cops.forEach((car, i) => {
    const spot = spots[i % spots.length];
    car.x = spot.x;
    car.y = spot.y;
    car.speed = 240;
  });
  stepFor(world, WANTED_SECONDS, (w) => driveInput(w, 1400 + LANE));
  return { screen: SCREEN_PLAY, ui };
}
