// Neon Harbor's rules and state, with no drawing and no browser in it: the city
// grid, traffic, pedestrians, police, the wanted system, the three-mission story,
// combat and pickups. step() advances one fixed step and returns what happened as
// bit flags, so the caller can react (sound, screens) without the world knowing
// about screens or sound. All randomness comes from the seeded generator passed
// to createWorld, so a fixed seed replays the same city.

import {
  CAR,
  CROWD,
  LANDMARKS,
  LANE,
  MISSIONS,
  PALETTE,
  PICKUP,
  PLAYER,
  STREETS_X,
  STREETS_Y,
  STREET_WIDTH,
  WANTED,
  WORLD,
  angleToward,
  clamp,
  dist2,
  mulberry32,
} from './config.js';

export const EVENT_WASTED = 1;
export const EVENT_BUSTED = 2;
export const EVENT_MISSION = 4;
export const EVENT_STORY = 8;
export const EVENT_SHOT = 16;
export const EVENT_PICKUP = 32;
export const EVENT_CRASH = 64;
export const EVENT_PUNCH = 128;
export const EVENT_CRIME = 256;

const CAR_COLORS = ['#ff5d5d', '#ffd166', '#4cc9f0', '#b5179e', '#80ed99', '#f4845f', '#8ecae6', '#e0aaff'];
const TAXI_COLOR = '#ffd60a';

/** A block's rectangle, from the street lines that bound it. */
function blockRect(bx, by) {
  const half = STREET_WIDTH / 2;
  return {
    x: STREETS_X[bx] + half,
    y: STREETS_Y[by] + half,
    w: STREETS_X[bx + 1] - STREETS_X[bx] - STREET_WIDTH,
    h: STREETS_Y[by + 1] - STREETS_Y[by] - STREET_WIDTH,
  };
}

/** The nearest street-line coordinate to a value, and how far away it is. */
function nearestStreet(value, streets) {
  let best = streets[0];
  let bestD = Math.abs(value - best);
  for (let i = 1; i < streets.length; i += 1) {
    const d = Math.abs(value - streets[i]);
    if (d < bestD) {
      bestD = d;
      best = streets[i];
    }
  }
  return { line: best, dist: bestD };
}

export function createWorld(random) {
  const rng = random ?? mulberry32(1);

  // ---- the city, generated once -------------------------------------------
  const buildings = [];
  for (let bx = 0; bx < STREETS_X.length - 1; bx += 1) {
    for (let by = 0; by < STREETS_Y.length - 1; by += 1) {
      const block = blockRect(bx, by);
      const isWarehouse = bx === LANDMARKS.warehouse.bx && by === LANDMARKS.warehouse.by;
      const isDocks = bx === LANDMARKS.docks.bx && by === LANDMARKS.docks.by;
      if (isDocks) {
        // The docks hold shipping containers, not a building.
        for (let i = 0; i < 5; i += 1) {
          buildings.push({
            x: block.x + 18 + (i % 3) * 96,
            y: block.y + 24 + Math.floor(i / 3) * 110,
            w: 78,
            h: 42,
            color: CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
            landmark: 'container',
            seed: rng(),
          });
        }
        continue;
      }
      const inset = 14 + rng() * 10;
      buildings.push({
        x: block.x + inset,
        y: block.y + inset,
        w: block.w - inset * 2,
        h: block.h - inset * 2,
        color: PALETTE.buildingRoof[Math.floor(rng() * PALETTE.buildingRoof.length)],
        landmark: isWarehouse ? 'warehouse' : null,
        seed: rng(),
      });
      // A second, smaller building on the bigger blocks.
      if (rng() < 0.35 && !isWarehouse) {
        const w = 60 + rng() * 60;
        const h = 50 + rng() * 50;
        buildings.push({
          x: block.x + 20 + rng() * (block.w - w - 40),
          y: block.y + block.h - h - 18,
          w,
          h,
          color: PALETTE.buildingRoof[Math.floor(rng() * PALETTE.buildingRoof.length)],
          landmark: null,
          seed: rng(),
        });
      }
    }
  }

  // ---- dynamic state -------------------------------------------------------
  const state = {
    time: 0,
    playTime: 0,
    player: null,
    cars: [],
    peds: [],
    bullets: [],
    pickups: [],
    particles: [],
    buildings,
    wanted: 0,
    lastCrime: -999,
    decayTimer: 0,
    mission: 0,
    storyDone: false,
    shake: 0,
    message: '',
    messageTimer: 0,
    spawnTimer: 0,
    crashCooldown: 0,
    shootCrimeTimer: 0,
  };

  function pointInBuilding(x, y, pad) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
    }
    return null;
  }

  /** Push a circle out of every building it overlaps; returns the corrected point. */
  function collideCircle(x, y, r) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      const cx = clamp(x, b.x, b.x + b.w);
      const cy = clamp(y, b.y, b.y + b.h);
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 === 0) {
        // Dead centre: push out along the smallest penetration.
        const left = x - b.x;
        const right = b.x + b.w - x;
        const top = y - b.y;
        const bottom = b.y + b.h - y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = b.x - r;
        else if (m === right) x = b.x + b.w + r;
        else if (m === top) y = b.y - r;
        else y = b.y + b.h + r;
        continue;
      }
      const d = Math.sqrt(d2);
      const push = (r - d) / d;
      x += dx * push;
      y += dy * push;
    }
    return { x, y };
  }

  /** A random point on a sidewalk (a street line, offset to the kerb). */
  function sidewalkPoint() {
    if (rng() < 0.5) {
      const sx = STREETS_X[Math.floor(rng() * STREETS_X.length)];
      const y = 120 + rng() * (WORLD.height - 240);
      const off = (rng() < 0.5 ? -1 : 1) * (STREET_WIDTH / 2 + 14);
      return { x: sx + off, y };
    }
    const sy = STREETS_Y[Math.floor(rng() * STREETS_Y.length)];
    const x = 120 + rng() * (WORLD.width - 240);
    const off = (rng() < 0.5 ? -1 : 1) * (STREET_WIDTH / 2 + 14);
    return { x, y: sy + off };
  }

  function newCar(role, kind) {
    const axis = rng() < 0.5 ? 'x' : 'y';
    const dir = rng() < 0.5 ? 1 : -1;
    let x;
    let y;
    if (axis === 'x') {
      const sy = STREETS_Y[Math.floor(rng() * STREETS_Y.length)];
      x = 120 + rng() * (WORLD.width - 240);
      y = sy + (dir > 0 ? LANE : -LANE);
    } else {
      const sx = STREETS_X[Math.floor(rng() * STREETS_X.length)];
      x = sx + (dir > 0 ? -LANE : LANE);
      y = 120 + rng() * (WORLD.height - 240);
    }
    return {
      id: state.cars.length,
      x,
      y,
      angle: axis === 'x' ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2,
      speed: 0,
      targetSpeed: 90 + rng() * 50,
      color: kind === 'taxi' ? TAXI_COLOR : CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)],
      kind,
      role,
      hp: CAR.health,
      wrecked: false,
      axis,
      dir,
      turnTimer: 1 + rng() * 2,
      ramTimer: 0,
      smokeTimer: 0,
    };
  }

  function newPed() {
    const p = sidewalkPoint();
    const axis = rng() < 0.5 ? 'x' : 'y';
    return {
      x: p.x,
      y: p.y,
      angle: rng() * Math.PI * 2,
      speed: 42 + rng() * 28,
      shirt: PALETTE.pedShirt[Math.floor(rng() * PALETTE.pedShirt.length)],
      state: 'walk',
      timer: 0,
      axis,
      dir: rng() < 0.5 ? 1 : -1,
      fleeX: 0,
      fleeY: 0,
    };
  }

  function newPickup(kind) {
    const p = sidewalkPoint();
    return { x: p.x, y: p.y, kind, bob: rng() * Math.PI * 2, taken: false, respawn: 0 };
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      if (state.particles.length > 220) return;
      const a = rng() * Math.PI * 2;
      const v = speed * (0.4 + rng() * 0.6);
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.35 + rng() * 0.4,
        maxLife: 0.75,
        color,
        size: 2 + rng() * 3,
      });
    }
  }

  function addWanted(n) {
    if (n <= 0) return;
    state.wanted = Math.min(WANTED.max, state.wanted + n);
    state.lastCrime = state.time;
    state.decayTimer = 0;
  }

  function reset() {
    state.time = 0;
    state.playTime = 0;
    state.player = {
      x: 1000,
      y: 1000,
      angle: -Math.PI / 2,
      health: PLAYER.health,
      money: 0,
      ammo: PLAYER.ammoStart,
      onFoot: true,
      car: null,
      punchCooldown: 0,
      shootCooldown: 0,
      bustedTimer: 0,
      lastDamage: -999,
      dead: false,
    };
    state.cars = [];
    for (let i = 0; i < CROWD.traffic; i += 1) {
      const car = newCar('traffic', rng() < 0.18 ? 'taxi' : 'sedan');
      car.speed = car.targetSpeed;
      state.cars.push(car);
    }
    for (let i = 0; i < CROWD.parked; i += 1) {
      const car = newCar('parked', rng() < 0.2 ? 'taxi' : 'sedan');
      // Parked at the kerb, facing along the street.
      if (car.axis === 'x') car.y += car.dir > 0 ? 18 : -18;
      else car.x += car.dir > 0 ? -18 : 18;
      car.speed = 0;
      state.cars.push(car);
    }
    state.peds = [];
    for (let i = 0; i < CROWD.pedestrians; i += 1) state.peds.push(newPed());
    state.bullets = [];
    state.pickups = [];
    const kinds = Object.keys(PICKUP.counts);
    for (const kind of kinds) {
      for (let i = 0; i < PICKUP.counts[kind]; i += 1) state.pickups.push(newPickup(kind));
    }
    state.particles = [];
    state.wanted = 0;
    state.lastCrime = -999;
    state.decayTimer = 0;
    state.mission = 0;
    state.storyDone = false;
    state.shake = 0;
    state.message = '';
    state.messageTimer = 0;
    state.spawnTimer = 0;
    state.crashCooldown = 0;
    state.shootCrimeTimer = 0;
  }

  // ---- police ---------------------------------------------------------------
  function nearestPoliceDist() {
    const p = state.player;
    let best = Infinity;
    for (const car of state.cars) {
      if (car.role !== 'police' || car.wrecked) continue;
      best = Math.min(best, Math.sqrt(dist2(car.x, car.y, p.x, p.y)));
    }
    return best;
  }

  function spawnPolice() {
    // At a street intersection far from the player, so the chase arrives, not teleports.
    for (let tries = 0; tries < 12; tries += 1) {
      const sx = STREETS_X[Math.floor(rng() * STREETS_X.length)];
      const sy = STREETS_Y[Math.floor(rng() * STREETS_Y.length)];
      const p = state.player;
      if (Math.sqrt(dist2(sx, sy, p.x, p.y)) < 700) continue;
      const car = newCar('police', 'police');
      car.x = sx;
      car.y = sy;
      car.color = '#e8ecff';
      car.speed = CAR.policeSpeed * 0.7;
      state.cars.push(car);
      return;
    }
  }

  function maintainPolice(dt) {
    const p = state.player;
    let count = 0;
    for (const car of state.cars) if (car.role === 'police' && !car.wrecked) count += 1;
    const want = Math.min(state.wanted, 4);
    if (state.wanted > 0 && count < want) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnPolice();
        state.spawnTimer = 1.2;
      }
    }
    if (state.wanted === 0) {
      // No heat, no cops: far ones drive off and are removed.
      for (let i = state.cars.length - 1; i >= 0; i -= 1) {
        const car = state.cars[i];
        if (car.role === 'police' && Math.sqrt(dist2(car.x, car.y, p.x, p.y)) > 900) state.cars.splice(i, 1);
      }
    }
  }

  // ---- combat ----------------------------------------------------------------
  function fireBullet(angle) {
    const p = state.player;
    state.bullets.push({
      x: p.x + Math.cos(angle) * 20,
      y: p.y + Math.sin(angle) * 20,
      angle,
      speed: 950,
      life: 0.7,
    });
    burst(p.x + Math.cos(angle) * 24, p.y + Math.sin(angle) * 24, '#ffd166', 4, 160);
    p.ammo -= 1;
    p.shootCooldown = 0.16;
    // Firing near a cop is a crime, but not more than once every two seconds.
    if (nearestPoliceDist() < 600 && state.time - state.shootCrimeTimer > 2) {
      state.shootCrimeTimer = state.time;
      addWanted(WANTED.shootNearPolice);
      return EVENT_SHOT | EVENT_CRIME;
    }
    return EVENT_SHOT;
  }

  function punch() {
    const p = state.player;
    p.punchCooldown = PLAYER.punchCooldown;
    let hit = false;
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const d = Math.sqrt(dist2(ped.x, ped.y, p.x, p.y));
      if (d < PLAYER.punchRange) {
        ped.state = 'down';
        ped.timer = 3;
        addWanted(WANTED.killPedestrian);
        burst(ped.x, ped.y, '#ffd166', 8, 140);
        hit = true;
      }
    }
    for (const car of state.cars) {
      if (car.wrecked) continue;
      const d = Math.sqrt(dist2(car.x, car.y, p.x, p.y));
      if (d < PLAYER.punchRange + 18) {
        car.hp -= PLAYER.punchDamage;
        burst(car.x, car.y, '#9aa1c7', 6, 120);
        hit = true;
      }
    }
    return hit ? EVENT_PUNCH | EVENT_CRIME : EVENT_PUNCH;
  }

  // ---- cars ------------------------------------------------------------------
  function stepTraffic(car, dt) {
    car.turnTimer -= dt;
    // The car ahead on this lane: slow down, or stop bumper to bumper.
    let ahead = null;
    let aheadGap = Infinity;
    for (const other of state.cars) {
      if (other === car || other.wrecked) continue;
      if (other.axis !== car.axis || other.dir !== car.dir) continue;
      const laneLine = car.axis === 'x' ? car.y : car.x;
      const otherLane = other.axis === 'x' ? other.y : other.x;
      if (Math.abs(laneLine - otherLane) > 34) continue;
      const along = car.axis === 'x' ? (other.x - car.x) * car.dir : (other.y - car.y) * car.dir;
      if (along > 0 && along < aheadGap) {
        aheadGap = along;
        ahead = other;
      }
    }
    let target = car.targetSpeed;
    if (ahead !== null) {
      if (aheadGap < 40) target = 0;
      else if (aheadGap < 95) target = Math.min(target, ahead.speed);
    }
    car.speed += clamp(target - car.speed, -260 * dt, 200 * dt);
    const stepX = Math.cos(car.angle) * car.speed * dt;
    const stepY = Math.sin(car.angle) * car.speed * dt;
    car.x += stepX;
    car.y += stepY;
    // Keep inside the city: turn around at the edge streets.
    if (car.x < 140 || car.x > WORLD.width - 140 || car.y < 140 || car.y > WORLD.height - 140) {
      // At the city's edge: turn around and come back down the same street.
      car.angle += Math.PI;
      car.dir = -car.dir;
      car.turnTimer = 2;
    }
    // At an intersection, sometimes turn onto the crossing street.
    const along = nearestStreet(car.axis === 'x' ? car.x : car.y, car.axis === 'x' ? STREETS_X : STREETS_Y);
    const cross = nearestStreet(car.axis === 'x' ? car.y : car.x, car.axis === 'x' ? STREETS_Y : STREETS_X);
    if (along.dist < 14 && cross.dist < 2 && car.turnTimer <= 0 && rng() < 0.3) {
      const newDir = rng() < 0.5 ? 1 : -1;
      if (car.axis === 'x') {
        car.axis = 'y';
        car.dir = newDir;
        car.x = along.line + (newDir > 0 ? -LANE : LANE);
        car.angle = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        car.axis = 'x';
        car.dir = newDir;
        car.y = along.line + (newDir > 0 ? LANE : -LANE);
        car.angle = newDir > 0 ? 0 : Math.PI;
      }
      car.turnTimer = 2;
    }
  }

  function stepPolice(car, dt) {
    const p = state.player;
    const desired = Math.atan2(p.y - car.y, p.x - car.x);
    car.angle = angleToward(car.angle, desired, 2.4 * dt);
    const dist = Math.sqrt(dist2(car.x, car.y, p.x, p.y));
    const target = dist > 120 ? CAR.policeSpeed : CAR.policeSpeed * 0.55;
    car.speed += clamp(target - car.speed, -420 * dt, 380 * dt);
    car.x += Math.cos(car.angle) * car.speed * dt;
    car.y += Math.sin(car.angle) * car.speed * dt;
    const fixed = collideCircle(car.x, car.y, CAR.radius);
    car.x = fixed.x;
    car.y = fixed.y;
    car.x = clamp(car.x, 60, WORLD.width - 60);
    car.y = clamp(car.y, 60, WORLD.height - 60);
    car.ramTimer -= dt;
    if (p.onFoot) {
      if (dist < 44) {
        p.bustedTimer += dt;
        if (car.ramTimer <= 0) {
          car.ramTimer = 0.8;
          p.health -= CAR.ramDamage;
          p.lastDamage = state.time;
          burst(p.x, p.y, '#ff3b30', 8, 150);
        }
      } else {
        p.bustedTimer = Math.max(0, p.bustedTimer - dt * 2);
      }
    }
  }

  function stepPlayerCar(car, input, dt) {
    const p = state.player;
    if (input.throttle) car.speed += CAR.accel * dt;
    if (input.brake) {
      if (car.speed > 6) car.speed -= CAR.brake * dt;
      else car.speed -= CAR.accel * 0.5 * dt;
    }
    // Rolling drag, and a little always-on drag so a car coasts to a stop.
    if (!input.throttle && !input.brake) car.speed *= Math.max(0, 1 - 0.45 * dt);
    car.speed *= Math.max(0, 1 - 0.06 * dt);
    car.speed = clamp(car.speed, -CAR.reverseMax, CAR.maxSpeed);
    const steerAuthority = clamp(Math.abs(car.speed) / 130, 0, 1) * (car.speed >= 0 ? 1 : -1);
    car.angle += input.steer * CAR.turnRate * steerAuthority * dt;
    const nx = car.x + Math.cos(car.angle) * car.speed * dt;
    const ny = car.y + Math.sin(car.angle) * car.speed * dt;
    const fixed = collideCircle(nx, ny, CAR.radius);
    car.x = clamp(fixed.x, 60, WORLD.width - 60);
    car.y = clamp(fixed.y, 60, WORLD.height - 60);
    const hitWall = Math.abs(car.x - nx) > 0.5 || Math.abs(car.y - ny) > 0.5;
    let events = 0;
    if (hitWall && Math.abs(car.speed) > CAR.crashDamageSpeed && state.crashCooldown <= 0) {
      state.crashCooldown = 0.3;
      car.hp -= (Math.abs(car.speed) - CAR.crashDamageSpeed) / 12;
      p.health -= (Math.abs(car.speed) - CAR.crashDamageSpeed) / 34;
      p.lastDamage = state.time;
      car.speed *= 0.3;
      state.shake = 9;
      burst(car.x, car.y, '#ffd166', 10, 200);
      events |= EVENT_CRASH;
    }
    // Running a pedestrian over is a crime; a fast car keeps going, a slow one stops.
    for (const ped of state.peds) {
      if (ped.state === 'down') continue;
      const d = Math.sqrt(dist2(ped.x, ped.y, car.x, car.y));
      if (d < CAR.radius + 10 && Math.abs(car.speed) > 60) {
        ped.state = 'down';
        ped.timer = 3;
        addWanted(WANTED.hitPedestrian);
        car.speed *= 0.85;
        burst(ped.x, ped.y, '#ffd166', 10, 170);
        events |= EVENT_CRIME;
      }
    }
    // Bumping other cars: shove them, lose speed, take damage when it is hard.
    for (const other of state.cars) {
      if (other === car || other.wrecked) continue;
      const d = Math.sqrt(dist2(other.x, other.y, car.x, car.y));
      if (d < CAR.radius * 2 && d > 0.01) {
        const push = (CAR.radius * 2 - d) / 2;
        const ux = (other.x - car.x) / d;
        const uy = (other.y - car.y) / d;
        other.x += ux * push;
        other.y += uy * push;
        car.x -= ux * push * 0.4;
        car.y -= uy * push * 0.4;
        const closing = Math.abs(car.speed - other.speed);
        if (closing > 130 && state.crashCooldown <= 0) {
          state.crashCooldown = 0.3;
          car.hp -= closing / 22;
          p.health -= closing / 60;
          p.lastDamage = state.time;
          car.speed *= 0.55;
          other.speed *= 0.5;
          state.shake = 7;
          burst(car.x, car.y, '#ffd166', 8, 180);
          events |= EVENT_CRASH;
        } else {
          car.speed *= 0.94;
        }
      }
    }
    if (car.hp <= 0 && !car.wrecked) {
      car.wrecked = true;
      car.speed = 0;
      burst(car.x, car.y, '#3a3f63', 24, 120);
      events |= EVENT_CRASH;
      exitCar(true);
    }
    p.x = car.x;
    p.y = car.y;
    p.angle = car.angle;
    return events;
  }

  function exitCar(wrecked) {
    const p = state.player;
    const car = p.car;
    if (car === null) return;
    p.car = null;
    p.onFoot = true;
    if (!wrecked) {
      car.role = 'parked';
      car.speed = 0;
    }
    const side = { x: p.x + Math.cos(p.angle + Math.PI / 2) * 42, y: p.y + Math.sin(p.angle + Math.PI / 2) * 42 };
    const fixed = collideCircle(side.x, side.y, PLAYER.radius);
    p.x = clamp(fixed.x, 40, WORLD.width - 40);
    p.y = clamp(fixed.y, 40, WORLD.height - 40);
  }

  function enterCar() {
    const p = state.player;
    let best = null;
    let bestD = 78;
    for (const car of state.cars) {
      if (car.wrecked) continue;
      if (car.role === 'police') continue;
      const d = Math.sqrt(dist2(car.x, car.y, p.x, p.y));
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (best === null) return;
    if (best.role === 'traffic') {
      // Jack the car: the driver becomes a fleeing pedestrian, and it is a crime.
      const driver = newPed();
      driver.x = best.x + Math.cos(best.angle + Math.PI / 2) * 40;
      driver.y = best.y + Math.sin(best.angle + Math.PI / 2) * 40;
      driver.state = 'flee';
      driver.timer = 3;
      state.peds.push(driver);
      addWanted(WANTED.stealCar);
    }
    best.role = 'player';
    best.speed = 0;
    p.car = best;
    p.onFoot = false;
    p.x = best.x;
    p.y = best.y;
    p.angle = best.angle;
  }

  // ---- pedestrians -------------------------------------------------------------
  function stepPed(ped, dt) {
    ped.timer -= dt;
    if (ped.state === 'down') {
      if (ped.timer <= 0) {
        ped.state = 'flee';
        ped.timer = 3;
      }
      return;
    }
    const p = state.player;
    const pd = Math.sqrt(dist2(ped.x, ped.y, p.x, p.y));
    // A fast car or a gunshot nearby sends them running.
    if (ped.state === 'walk') {
      const carNear = state.cars.some(
        (car) => !car.wrecked && Math.abs(car.speed) > 120 && Math.sqrt(dist2(car.x, car.y, ped.x, ped.y)) < 110,
      );
      if (carNear || (pd < 130 && !p.onFoot)) {
        ped.state = 'flee';
        ped.timer = 2;
        ped.fleeX = ped.x - p.x;
        ped.fleeY = ped.y - p.y;
      }
    }
    let vx = 0;
    let vy = 0;
    if (ped.state === 'flee') {
      const len = Math.hypot(ped.fleeX, ped.fleeY) || 1;
      vx = (ped.fleeX / len) * 135;
      vy = (ped.fleeY / len) * 135;
      if (ped.timer <= 0) ped.state = 'walk';
    } else {
      // Stroll the sidewalk: along the current street, turning at intersections.
      const speed = ped.speed;
      if (ped.axis === 'x') {
        vx = ped.dir * speed;
        const near = nearestStreet(ped.x, STREETS_X);
        if (near.dist < 16 && rng() < 0.012) {
          ped.axis = 'y';
          ped.dir = rng() < 0.5 ? 1 : -1;
          ped.x = near.line;
        }
      } else {
        vy = ped.dir * speed;
        const near = nearestStreet(ped.y, STREETS_Y);
        if (near.dist < 16 && rng() < 0.012) {
          ped.axis = 'x';
          ped.dir = rng() < 0.5 ? 1 : -1;
          ped.y = near.line;
        }
      }
    }
    ped.x += vx * dt;
    ped.y += vy * dt;
    if (vx !== 0 || vy !== 0) ped.angle = Math.atan2(vy, vx);
    const fixed = collideCircle(ped.x, ped.y, 10);
    ped.x = clamp(fixed.x, 40, WORLD.width - 40);
    ped.y = clamp(fixed.y, 40, WORLD.height - 40);
  }

  // ---- the step ------------------------------------------------------------------
  /**
   * One fixed step. `input` is { move:{x,y}, steer, throttle, brake, firing,
   * aimX, aimY, enter } in world coordinates; with `attract` set (the title
   * screen's backdrop) the city lives but nothing touches the player.
   */
  function step(dt, input, attract) {
    let events = 0;
    state.time += dt;
    if (!attract) state.playTime += dt;
    state.crashCooldown = Math.max(0, state.crashCooldown - dt);
    state.shake = Math.max(0, state.shake - dt * 22);
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    const p = state.player;

    if (attract) {
      for (const car of state.cars) if (car.role === 'traffic') stepTraffic(car, dt);
      for (const ped of state.peds) stepPed(ped, dt);
      return 0;
    }

    // --- the player ------------------------------------------------------------
    p.punchCooldown = Math.max(0, p.punchCooldown - dt);
    p.shootCooldown = Math.max(0, p.shootCooldown - dt);
    if (p.onFoot) {
      const mx = input.move.x;
      const my = input.move.y;
      const nx = p.x + mx * PLAYER.walkSpeed * dt;
      const ny = p.y + my * PLAYER.walkSpeed * dt;
      const fixed = collideCircle(nx, ny, PLAYER.radius);
      p.x = clamp(fixed.x, 40, WORLD.width - 40);
      p.y = clamp(fixed.y, 40, WORLD.height - 40);
      if (mx !== 0 || my !== 0) p.angle = Math.atan2(my, mx);
      // Walking through a car is not allowed: push out of its circle.
      for (const car of state.cars) {
        if (car.wrecked) continue;
        const d = Math.sqrt(dist2(car.x, car.y, p.x, p.y));
        if (d < CAR.radius + PLAYER.radius && d > 0.01) {
          const push = CAR.radius + PLAYER.radius - d;
          p.x += ((p.x - car.x) / d) * push;
          p.y += ((p.y - car.y) / d) * push;
        }
      }
      if (input.enter) enterCar();
      if (input.firing) {
        if (p.ammo > 0 && p.shootCooldown <= 0) {
          const aim = Math.atan2(input.aimY - p.y, input.aimX - p.x);
          p.angle = aim;
          events |= fireBullet(aim);
        } else if (p.ammo <= 0 && p.punchCooldown <= 0) {
          events |= punch();
        }
      }
    } else if (p.car !== null) {
      if (input.enter) exitCar(false);
      else events |= stepPlayerCar(p.car, input, dt);
    }

    // Slow health regen when nothing has hurt the player for a while.
    if (state.time - p.lastDamage > 10 && p.health > 0 && p.health < PLAYER.health) {
      p.health = Math.min(PLAYER.health, p.health + 3 * dt);
    }

    // --- pickups ----------------------------------------------------------------
    for (const pickup of state.pickups) {
      pickup.bob += dt * 3;
      if (pickup.taken) {
        pickup.respawn -= dt;
        if (pickup.respawn <= 0) {
          const spot = sidewalkPoint();
          pickup.x = spot.x;
          pickup.y = spot.y;
          pickup.taken = false;
        }
        continue;
      }
      if (Math.sqrt(dist2(pickup.x, pickup.y, p.x, p.y)) < PICKUP.radius + PLAYER.radius) {
        pickup.taken = true;
        pickup.respawn = PICKUP.respawnSeconds;
        if (pickup.kind === 'ammo') p.ammo = Math.min(PLAYER.ammoMax, p.ammo + PICKUP.ammo);
        else if (pickup.kind === 'health') p.health = Math.min(PLAYER.health, p.health + PICKUP.health);
        else p.money += PICKUP.money;
        burst(pickup.x, pickup.y, '#39ff88', 10, 130);
        events |= EVENT_PICKUP;
      }
    }

    // --- the city -----------------------------------------------------------------
    for (const car of state.cars) {
      if (car.wrecked) {
        car.smokeTimer -= dt;
        if (car.smokeTimer <= 0) {
          car.smokeTimer = 0.4;
          state.particles.push({
            x: car.x + (rng() - 0.5) * 20,
            y: car.y - 10,
            vx: (rng() - 0.5) * 12,
            vy: -34 - rng() * 20,
            life: 0.9,
            maxLife: 0.9,
            color: '#3a3f63',
            size: 5,
          });
        }
        continue;
      }
      if (car.role === 'traffic') stepTraffic(car, dt);
      else if (car.role === 'police') stepPolice(car, dt);
    }
    for (const ped of state.peds) stepPed(ped, dt);

    // --- bullets -------------------------------------------------------------------
    for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
      const b = state.bullets[i];
      b.x += Math.cos(b.angle) * b.speed * dt;
      b.y += Math.sin(b.angle) * b.speed * dt;
      b.life -= dt;
      let dead = b.life <= 0 || b.x < 0 || b.x > WORLD.width || b.y < 0 || b.y > WORLD.height;
      if (!dead && pointInBuilding(b.x, b.y, 0) !== null) {
        burst(b.x, b.y, '#9aa1c7', 4, 110);
        dead = true;
      }
      if (!dead) {
        for (const ped of state.peds) {
          if (ped.state === 'down') continue;
          if (dist2(ped.x, ped.y, b.x, b.y) < 15 * 15) {
            ped.state = 'down';
            ped.timer = 3;
            addWanted(WANTED.killPedestrian);
            burst(ped.x, ped.y, '#ff3b30', 10, 160);
            dead = true;
            events |= EVENT_CRIME;
            break;
          }
        }
      }
      if (!dead) {
        for (const car of state.cars) {
          if (car.wrecked) continue;
          if (dist2(car.x, car.y, b.x, b.y) < CAR.radius * CAR.radius) {
            car.hp -= PLAYER.pistolDamage;
            burst(b.x, b.y, '#ffd166', 6, 140);
            if (car.hp <= 0) {
              car.wrecked = true;
              car.speed = 0;
              burst(car.x, car.y, '#3a3f63', 24, 120);
              if (car.role === 'player') exitCar(true);
              else if (car.role === 'police') events |= EVENT_CRIME;
            }
            dead = true;
            break;
          }
        }
      }
      if (dead) state.bullets.splice(i, 1);
    }

    // --- particles ------------------------------------------------------------------
    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const pt = state.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 1 - 2.4 * dt;
      pt.vy *= 1 - 2.4 * dt;
      pt.life -= dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }

    // --- wanted decay -----------------------------------------------------------------
    if (state.wanted > 0 && state.time - state.lastCrime > WANTED.quietSeconds) {
      if (nearestPoliceDist() > WANTED.policeSight) {
        state.decayTimer += dt;
        if (state.decayTimer >= WANTED.decaySeconds) {
          state.wanted -= 1;
          state.decayTimer = 0;
        }
      } else {
        state.decayTimer = 0;
      }
    }
    maintainPolice(dt);

    // --- missions -----------------------------------------------------------------------
    if (!state.storyDone) {
      const mission = MISSIONS[state.mission];
      if (state.mission === 0 || state.mission === 2) {
        if (Math.sqrt(dist2(p.x, p.y, mission.marker.x, mission.marker.y)) < mission.radius) {
          p.money += mission.reward;
          if (state.mission === 0) {
            state.mission = 1;
            addWanted(2);
            state.message = 'THE DROP WENT LOUD — LOSE THE COPS';
            state.messageTimer = 4;
          } else {
            state.storyDone = true;
            events |= EVENT_STORY;
          }
          events |= EVENT_MISSION;
        }
      } else if (state.mission === 1 && state.wanted === 0) {
        p.money += mission.reward;
        state.mission = 2;
        events |= EVENT_MISSION;
      }
    }

    // --- the contextual hint ---------------------------------------------------------------
    if (state.messageTimer <= 0) {
      let hint = '';
      if (!p.onFoot) hint = 'E — GET OUT   ·   W/S DRIVE   ·   A/D STEER';
      else {
        let near = null;
        let nearD = 78;
        for (const car of state.cars) {
          if (car.wrecked || car.role === 'police') continue;
          const d = Math.sqrt(dist2(car.x, car.y, p.x, p.y));
          if (d < nearD) {
            nearD = d;
            near = car;
          }
        }
        if (near !== null) hint = near.role === 'traffic' ? 'E — JACK THE CAR  (WANTED +1)' : 'E — GET IN THE CAR';
        else if (p.ammo <= 0) hint = 'OUT OF AMMO — FIND A CYAN PICKUP';
        else hint = 'WASD MOVE   ·   CLICK / SPACE SHOOT   ·   E ENTER CAR';
      }
      state.message = hint;
    }

    // --- wasted / busted ----------------------------------------------------------------------
    if (p.health <= 0 && !p.dead) {
      p.dead = true;
      events |= EVENT_WASTED;
    }
    if (p.bustedTimer >= WANTED.bustedSeconds && !p.dead) {
      p.dead = true;
      events |= EVENT_BUSTED;
    }
    return events;
  }

  // ---- helpers the screenshot scenes use -----------------------------------------
  function debugTeleport(x, y) {
    const p = state.player;
    p.x = x;
    p.y = y;
    p.onFoot = true;
    p.car = null;
  }

  function debugGiveCar(x, y, angle) {
    const car = newCar('player', 'sedan');
    car.x = x;
    car.y = y;
    car.angle = angle;
    car.speed = 0;
    car.color = '#ff5d5d';
    state.cars.push(car);
    const p = state.player;
    p.car = car;
    p.onFoot = false;
    p.x = x;
    p.y = y;
    p.angle = angle;
  }

  function debugSetWanted(n) {
    state.wanted = n;
    state.lastCrime = state.time;
    state.decayTimer = 0;
    for (let i = 0; i < n; i += 1) spawnPolice();
  }

  function debugSetMission(n) {
    state.mission = n;
  }

  function saveData() {
    const p = state.player;
    return {
      x: Math.round(p.x),
      y: Math.round(p.y),
      money: p.money,
      mission: state.mission,
      health: Math.round(p.health),
      ammo: p.ammo,
      wanted: state.wanted,
      storyDone: state.storyDone,
    };
  }

  function loadData(data) {
    const p = state.player;
    p.x = clamp(data.x ?? 1000, 40, WORLD.width - 40);
    p.y = clamp(data.y ?? 1000, 40, WORLD.height - 40);
    p.money = data.money ?? 0;
    p.health = clamp(data.health ?? PLAYER.health, 1, PLAYER.health);
    p.ammo = data.ammo ?? PLAYER.ammoStart;
    p.onFoot = true;
    p.car = null;
    state.mission = clamp(data.mission ?? 0, 0, 2);
    state.wanted = clamp(data.wanted ?? 0, 0, WANTED.max);
    state.storyDone = Boolean(data.storyDone);
    state.lastCrime = state.time;
    if (state.wanted > 0) for (let i = 0; i < state.wanted; i += 1) spawnPolice();
  }

  reset();
  return {
    state,
    reset,
    step,
    exitCar,
    enterCar,
    debugTeleport,
    debugGiveCar,
    debugSetWanted,
    debugSetMission,
    saveData,
    loadData,
  };
}
