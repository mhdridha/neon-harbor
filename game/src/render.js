// Drawing only: the world's state and the current screen in, pixels out. The
// camera follows the player; the HUD, the minimap and the panels are drawn in
// screen space. Everything is flat canvas shapes and text — no images, no fonts
// to load. The render never calls Math.random: pulses and flashes come from
// state.time, so a staged scene paints the same frame every run.

import {
  CAR,
  FONT,
  MISSIONS,
  PALETTE,
  PLAYER,
  STREETS_X,
  STREETS_Y,
  STREET_WIDTH,
  WANTED,
  WORLD,
} from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_STORY = 'story';

const MINIMAP = { w: 208, h: 156, margin: 16 };
const TAU = Math.PI * 2;

/** A rounded rectangle path, for car bodies and panels. */
function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** A deterministic 0..1 hash from two integers (lit windows, roof details). */
function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { w: 1280, h: 720, dpr: 1 };
  const fonts = new Map();

  // One soft glow sprite, reused for streetlights and the mission beacon.
  const glowSprite = document.createElement('canvas');
  glowSprite.width = 128;
  glowSprite.height = 128;
  const gctx = glowSprite.getContext('2d');
  const grad = gctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 190, 90, 0.55)');
  grad.addColorStop(1, 'rgba(255, 190, 90, 0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 128, 128);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    view.dpr = dpr;
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
  }

  function text(value, x, y, size, color, align = 'left', weight = 700) {
    const key = `${weight}|${size}`;
    if (!fonts.has(key)) fonts.set(key, `${weight} ${size}px ${FONT}`);
    ctx.font = fonts.get(key);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function bar(x, y, w, h, frac, fill, bg = 'rgba(0,0,0,0.55)') {
    ctx.fillStyle = bg;
    rr(ctx, x, y, w, h, 3);
    ctx.fill();
    if (frac > 0) {
      ctx.fillStyle = fill;
      rr(ctx, x + 1, y + 1, Math.max(4, (w - 2) * Math.min(1, frac)), h - 2, 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    rr(ctx, x, y, w, h, 3);
    ctx.stroke();
  }

  function drawWorld(state, camera) {
    const left = camera.x - view.w / 2;
    const top = camera.y - view.h / 2;
    const right = left + view.w;
    const bottom = top + view.h;
    const half = STREET_WIDTH / 2;

    ctx.fillStyle = PALETTE.ground;
    ctx.fillRect(0, 0, view.w, view.h);

    // The harbour water along the north-east edge, where the docks are.
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(2400 - left, 0 - top, 800, 128);
    ctx.strokeStyle = 'rgba(120,200,255,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i += 1) {
      const wy = 26 + i * 22 - top;
      ctx.beginPath();
      ctx.moveTo(2400 - left, wy);
      ctx.lineTo(3200 - left, wy);
      ctx.stroke();
    }

    // Asphalt: one strip per street.
    ctx.fillStyle = PALETTE.asphalt;
    for (const sx of STREETS_X) ctx.fillRect(sx - half - left, 0, STREET_WIDTH, WORLD.height);
    for (const sy of STREETS_Y) ctx.fillRect(0, sy - half - top, WORLD.width, STREET_WIDTH);
    // Sidewalk blocks: the ground between the streets.
    ctx.fillStyle = PALETTE.sidewalk;
    for (let i = 0; i < STREETS_X.length - 1; i += 1) {
      for (let j = 0; j < STREETS_Y.length - 1; j += 1) {
        const bx = STREETS_X[i] + half;
        const by = STREETS_Y[j] + half;
        const bw = STREETS_X[i + 1] - STREETS_X[i] - STREET_WIDTH;
        const bh = STREETS_Y[j + 1] - STREETS_Y[j] - STREET_WIDTH;
        if (bx + bw < left || bx > right || by + bh < top || by > bottom) continue;
        ctx.fillRect(bx - left, by - top, bw, bh);
      }
    }
    // Centre dashes and crosswalks.
    ctx.strokeStyle = PALETTE.roadLine;
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 30]);
    for (const sx of STREETS_X) {
      ctx.beginPath();
      ctx.moveTo(sx - left, 0);
      ctx.lineTo(sx - left, WORLD.height);
      ctx.stroke();
    }
    for (const sy of STREETS_Y) {
      ctx.beginPath();
      ctx.moveTo(0, sy - top);
      ctx.lineTo(WORLD.width, sy - top);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = PALETTE.crosswalk;
    for (const sx of STREETS_X) {
      for (const sy of STREETS_Y) {
        ctx.fillRect(sx - half - left, sy - half - top + 6, 10, STREET_WIDTH - 12);
        ctx.fillRect(sx + half - 10 - left, sy - half - top + 6, 10, STREET_WIDTH - 12);
        ctx.fillRect(sx - half - left + 6, sy - half - top, STREET_WIDTH - 12, 10);
        ctx.fillRect(sx - half - left + 6, sy + half - 10 - top, STREET_WIDTH - 12, 10);
      }
    }
    // Streetlight pools at every intersection.
    for (const sx of STREETS_X) {
      for (const sy of STREETS_Y) {
        if (sx < left - 120 || sx > right + 120 || sy < top - 120 || sy > bottom + 120) continue;
        ctx.drawImage(glowSprite, sx - 110 - left, sy - 110 - top, 220, 220);
      }
    }

    // Buildings: roof, neon edge, lit windows; the warehouse and the docks are named.
    for (const b of state.buildings) {
      if (b.x + b.w < left || b.x > right || b.y + b.h < top || b.y > bottom) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x - left, b.y - top, b.w, b.h);
      ctx.strokeStyle = b.landmark === 'warehouse' ? PALETTE.neonPink : PALETTE.buildingEdge;
      ctx.lineWidth = b.landmark === 'warehouse' ? 3 : 2;
      ctx.strokeRect(b.x - left, b.y - top, b.w, b.h);
      if (b.landmark === 'container') {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        for (let x = b.x + 13; x < b.x + b.w; x += 13) {
          ctx.beginPath();
          ctx.moveTo(x - left, b.y - top);
          ctx.lineTo(x - left, b.y + b.h - top);
          ctx.stroke();
        }
        continue;
      }
      // Windows: a grid, some lit warm, most dark.
      const cols = Math.max(2, Math.floor(b.w / 34));
      const rows = Math.max(2, Math.floor(b.h / 34));
      for (let cx = 0; cx < cols; cx += 1) {
        for (let cy = 0; cy < rows; cy += 1) {
          const lit = hash2(Math.floor(b.seed * 1000) + cx * 7, cy * 13) > 0.62;
          ctx.fillStyle = lit ? 'rgba(255, 214, 120, 0.85)' : 'rgba(0,0,0,0.28)';
          ctx.fillRect(b.x + 12 + cx * ((b.w - 24) / cols) - left, b.y + 12 + cy * ((b.h - 24) / rows) - top, 12, 12);
        }
      }
      if (b.landmark === 'warehouse') {
        text('WAREHOUSE', b.x + b.w / 2 - left, b.y + b.h / 2 - top + 6, 20, PALETTE.neonPink, 'center');
      }
    }

    // The mission beacon: a pulsing ring and a beam of light on the marker.
    if (!state.storyDone) {
      const mission = MISSIONS[state.mission];
      if (mission.marker !== null) {
        const mx = mission.marker.x - left;
        const my = mission.marker.y - top;
        const pulse = 0.5 + 0.5 * Math.sin(state.time * 3);
        ctx.fillStyle = `rgba(255, 209, 102, ${0.10 + pulse * 0.08})`;
        ctx.fillRect(mx - 8, 0, 16, view.h);
        ctx.strokeStyle = `rgba(255, 209, 102, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mx, my, 26 + pulse * 14, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = PALETTE.gold;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-9, -9, 18, 18);
        ctx.restore();
      }
    }

    // Pickups, bobbing on the sidewalk.
    for (const pickup of state.pickups) {
      if (pickup.taken) continue;
      if (pickup.x < left - 40 || pickup.x > right + 40 || pickup.y < top - 40 || pickup.y > bottom + 40) continue;
      const bobY = Math.sin(pickup.bob) * 3;
      const px = pickup.x - left;
      const py = pickup.y - top + bobY;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(px, py, 17, 0, TAU);
      ctx.fill();
      if (pickup.kind === 'ammo') {
        ctx.fillStyle = PALETTE.neonCyan;
        rr(ctx, px - 9, py - 9, 18, 18, 3);
        ctx.fill();
        ctx.fillStyle = '#062a33';
        ctx.fillRect(px - 2, py - 6, 4, 12);
      } else if (pickup.kind === 'health') {
        ctx.fillStyle = PALETTE.neonGreen;
        rr(ctx, px - 9, py - 9, 18, 18, 3);
        ctx.fill();
        ctx.fillStyle = '#062a18';
        ctx.fillRect(px - 2, py - 7, 4, 14);
        ctx.fillRect(px - 7, py - 2, 14, 4);
      } else {
        ctx.fillStyle = PALETTE.gold;
        ctx.beginPath();
        ctx.arc(px, py, 11, 0, TAU);
        ctx.fill();
        text('$', px, py + 5, 13, '#4a3200', 'center');
      }
    }

    // Cars.
    for (const car of state.cars) {
      if (car.x < left - 80 || car.x > right + 80 || car.y < top - 80 || car.y > bottom + 80) continue;
      ctx.save();
      ctx.translate(car.x - left, car.y - top);
      ctx.rotate(car.angle);
      const wrecked = car.wrecked;
      // Headlight beams.
      if (!wrecked) {
        ctx.fillStyle = 'rgba(255, 240, 180, 0.10)';
        ctx.beginPath();
        ctx.moveTo(CAR.length / 2, -10);
        ctx.lineTo(CAR.length / 2 + 90, -34);
        ctx.lineTo(CAR.length / 2 + 90, 34);
        ctx.lineTo(CAR.length / 2, 10);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = wrecked ? '#2c2f3a' : car.color;
      rr(ctx, -CAR.length / 2, -CAR.width / 2, CAR.length, CAR.width, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Roof and windshield.
      ctx.fillStyle = wrecked ? '#22242e' : 'rgba(10, 14, 30, 0.55)';
      rr(ctx, -8, -CAR.width / 2 + 5, 20, CAR.width - 10, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(180, 220, 255, 0.35)';
      ctx.fillRect(12, -CAR.width / 2 + 4, 8, CAR.width - 8);
      // Taxi sign and police light bar.
      if (car.kind === 'taxi' && !wrecked) {
        ctx.fillStyle = '#111';
        ctx.fillRect(-6, -5, 14, 10);
        ctx.fillStyle = PALETTE.gold;
        text('TAXI', 1, 3, 7, PALETTE.gold, 'center');
      }
      if (car.role === 'police' && !wrecked) {
        const flash = Math.floor(state.time * 4) % 2 === 0;
        ctx.fillStyle = flash ? PALETTE.policeLightR : PALETTE.policeLightB;
        rr(ctx, -4, -CAR.width / 2 - 2, 10, 6, 2);
        ctx.fill();
        ctx.fillStyle = flash ? PALETTE.policeLightB : PALETTE.policeLightR;
        rr(ctx, -4, CAR.width / 2 - 4, 10, 6, 2);
        ctx.fill();
      }
      // Headlights and taillights.
      ctx.fillStyle = '#fff6c8';
      ctx.fillRect(CAR.length / 2 - 3, -CAR.width / 2 + 3, 3, 5);
      ctx.fillRect(CAR.length / 2 - 3, CAR.width / 2 - 8, 3, 5);
      ctx.fillStyle = '#ff2e2e';
      ctx.fillRect(-CAR.length / 2, -CAR.width / 2 + 3, 3, 5);
      ctx.fillRect(-CAR.length / 2, CAR.width / 2 - 8, 3, 5);
      ctx.restore();
      // The player's car gets a cyan ring so it is never lost in traffic.
      const p = state.player;
      if (!p.onFoot && p.car === car) {
        ctx.strokeStyle = 'rgba(34, 230, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(car.x - left, car.y - top, CAR.radius + 8, 0, TAU);
        ctx.stroke();
      }
    }

    // Pedestrians.
    for (const ped of state.peds) {
      if (ped.x < left - 40 || ped.x > right + 40 || ped.y < top - 40 || ped.y > bottom + 40) continue;
      const px = ped.x - left;
      const py = ped.y - top;
      if (ped.state === 'down') {
        ctx.fillStyle = ped.shirt;
        ctx.beginPath();
        ctx.ellipse(px, py, 13, 6, ped.angle, 0, TAU);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = ped.shirt;
      ctx.beginPath();
      ctx.arc(px, py, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath();
      ctx.arc(px + Math.cos(ped.angle) * 4, py + Math.sin(ped.angle) * 4, 5, 0, TAU);
      ctx.fill();
    }

    // The player on foot: pink jacket, cyan rim, a gun line when aiming.
    const p = state.player;
    if (p.onFoot) {
      const px = p.x - left;
      const py = p.y - top;
      ctx.strokeStyle = 'rgba(34, 230, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, PLAYER.radius + 3, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = PALETTE.playerJacket;
      ctx.beginPath();
      ctx.arc(px, py, PLAYER.radius, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8b98a';
      ctx.beginPath();
      ctx.arc(px + Math.cos(p.angle) * 4, py + Math.sin(p.angle) * 4, 6, 0, TAU);
      ctx.fill();
      if (p.ammo > 0) {
        ctx.strokeStyle = '#2b2f45';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(p.angle) * 8, py + Math.sin(p.angle) * 8);
        ctx.lineTo(px + Math.cos(p.angle) * 22, py + Math.sin(p.angle) * 22);
        ctx.stroke();
      }
    }

    // Bullets: short bright tracers.
    ctx.strokeStyle = '#ffe98a';
    ctx.lineWidth = 3;
    for (const b of state.bullets) {
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(b.angle) * 14 - left, b.y - Math.sin(b.angle) * 14 - top);
      ctx.lineTo(b.x - left, b.y - top);
      ctx.stroke();
    }

    // Particles.
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x - left, pt.y - top, pt.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMinimap(state) {
    const mx = view.w - MINIMAP.w - MINIMAP.margin;
    const my = MINIMAP.margin;
    const sx = MINIMAP.w / WORLD.width;
    const sy = MINIMAP.h / WORLD.height;
    ctx.fillStyle = 'rgba(5, 7, 16, 0.85)';
    rr(ctx, mx - 6, my - 6, MINIMAP.w + 12, MINIMAP.h + 12, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    rr(ctx, mx, my, MINIMAP.w, MINIMAP.h, 3);
    ctx.clip();
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(mx, my, MINIMAP.w, MINIMAP.h);
    ctx.strokeStyle = '#2a2f4d';
    ctx.lineWidth = 2;
    for (const s of STREETS_X) {
      ctx.beginPath();
      ctx.moveTo(mx + s * sx, my);
      ctx.lineTo(mx + s * sx, my + MINIMAP.h);
      ctx.stroke();
    }
    for (const s of STREETS_Y) {
      ctx.beginPath();
      ctx.moveTo(mx, my + s * sy);
      ctx.lineTo(mx + MINIMAP.w, my + s * sy);
      ctx.stroke();
    }
    // The docks water, top-right.
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(mx + 2400 * sx, my, 800 * sx, 128 * sy);
    // The mission marker, pulsing.
    if (!state.storyDone) {
      const mission = MISSIONS[state.mission];
      if (mission.marker !== null) {
        const pulse = 0.5 + 0.5 * Math.sin(state.time * 4);
        ctx.fillStyle = `rgba(255, 209, 102, ${0.6 + pulse * 0.4})`;
        ctx.save();
        ctx.translate(mx + mission.marker.x * sx, my + mission.marker.y * sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-5, -5, 10, 10);
        ctx.restore();
      }
    }
    // Police as red dots.
    ctx.fillStyle = '#ff3b30';
    for (const car of state.cars) {
      if (car.role !== 'police' || car.wrecked) continue;
      ctx.beginPath();
      ctx.arc(mx + car.x * sx, my + car.y * sy, 3, 0, TAU);
      ctx.fill();
    }
    // The player: a white triangle pointing where they face.
    const p = state.player;
    ctx.save();
    ctx.translate(mx + p.x * sx, my + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    text('NEON HARBOR', mx + MINIMAP.w / 2, my + MINIMAP.h + 18, 11, PALETTE.muted, 'center');
  }

  function drawHud(state, ui) {
    const p = state.player;
    const margin = 16;
    // Wanted stars.
    let sx = margin;
    for (let i = 0; i < WANTED.max; i += 1) {
      const lit = i < state.wanted;
      text('★', sx, 34, 26, lit ? PALETTE.gold : 'rgba(255,255,255,0.18)', 'left');
      sx += 26;
    }
    // Health, money, ammo.
    text('HP', margin, 62, 14, PALETTE.muted, 'left');
    const hpFrac = Math.max(0, p.health / PLAYER.health);
    bar(margin + 26, 50, 130, 14, hpFrac, hpFrac > 0.5 ? PALETTE.neonGreen : hpFrac > 0.25 ? PALETTE.gold : PALETTE.danger);
    text(`$${p.money.toLocaleString('en-US')}`, margin, 92, 22, PALETTE.gold, 'left');
    text(`AMMO ${p.ammo}`, margin, 118, 16, p.ammo > 0 ? PALETTE.neonCyan : PALETTE.danger, 'left');
    // A dark pill behind the mission lines so a world sprite (a pickup, a car)
    // can never sit on top of the text.
    ctx.fillStyle = 'rgba(5, 7, 16, 0.55)';
    rr(ctx, view.w / 2 - 320, 8, 640, 78, 10);
    ctx.fill();
    // The mission line, centred at the top.
    const mission = MISSIONS[state.mission];
    const title = state.storyDone ? 'STORY COMPLETE — FREE ROAM' : mission.title;
    const sub = state.storyDone ? 'The package is delivered. Neon Harbor is yours.' : mission.text;
    text(title, view.w / 2, 30, 17, PALETTE.gold, 'center');
    text(sub, view.w / 2, 54, 15, PALETTE.text, 'center');
    if (!state.storyDone && mission.marker !== null) {
      const d = Math.round(Math.hypot(p.x - mission.marker.x, p.y - mission.marker.y));
      text(`${d} m`, view.w / 2, 76, 14, PALETTE.muted, 'center');
    }
    drawMinimap(state);
    // Driving: speed and car health, bottom-right.
    if (!p.onFoot && p.car !== null) {
      const kmh = Math.round(Math.abs(p.car.speed) * 0.55);
      text(`${kmh} km/h`, view.w - margin, view.h - 44, 30, PALETTE.text, 'right');
      text('CAR', view.w - margin - 130, view.h - 16, 13, PALETTE.muted, 'left');
      bar(view.w - margin - 100, view.h - 28, 100, 10, Math.max(0, p.car.hp / CAR.health), p.car.hp > 40 ? PALETTE.neonCyan : PALETTE.danger);
    }
    // The contextual hint, bottom-left.
    if (state.message !== '') {
      ctx.fillStyle = 'rgba(5, 7, 16, 0.65)';
      const w = ctx.measureText(state.message).width;
      rr(ctx, margin - 8, view.h - 44, w + 16, 30, 6);
      ctx.fill();
      text(state.message, margin, view.h - 23, 14, PALETTE.text, 'left');
    }
    // Mute state, tiny, bottom-centre.
    if (ui.muted) text('MUTED — M TO UNMUTE', view.w / 2, view.h - 16, 12, PALETTE.muted, 'center');
    // Low health: a red pulse at the edges.
    if (p.health > 0 && p.health < 32) {
      const pulse = 0.10 + 0.08 * Math.sin(state.time * 5);
      ctx.fillStyle = `rgba(255, 30, 30, ${pulse})`;
      ctx.fillRect(0, 0, view.w, 26);
      ctx.fillRect(0, view.h - 26, view.w, 26);
      ctx.fillRect(0, 0, 26, view.h);
      ctx.fillRect(view.w - 26, 0, 26, view.h);
    }
  }

  function dim(alpha) {
    ctx.fillStyle = `rgba(4, 5, 12, ${alpha})`;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function drawPanel(title, titleColor, lines, prompt, time) {
    const cx = view.w / 2;
    let y = view.h / 2 - 130;
    ctx.textAlign = 'center';
    if (titleColor === 'neon') {
      ctx.save();
      try {
        ctx.letterSpacing = '10px';
      } catch {
        // letterSpacing is Chrome-only; the logo still reads without it.
      }
      text('NEON HARBOR', cx + 4, y + 4, 64, PALETTE.neonPink, 'center');
      text('NEON HARBOR', cx, y, 64, PALETTE.neonCyan, 'center');
      ctx.restore();
    } else {
      text(title, cx, y, 56, titleColor, 'center');
    }
    y += 56;
    for (const line of lines) {
      text(line.text, cx, y, line.size, line.color, 'center');
      y += line.size + 14;
    }
    // The prompt pulses on the world's clock, never the wall clock, so a staged
    // scene paints the same frame every run — and it never fully disappears, so
    // no phase boundary can hide it in a screenshot.
    const pulse = 0.55 + 0.45 * Math.sin(time * 3);
    ctx.save();
    ctx.globalAlpha = pulse;
    text(prompt, cx, y + 26, 20, PALETTE.gold, 'center');
    ctx.restore();
  }

  /** Paint one frame: the world, then the HUD or a panel for the screen the game is on. */
  function draw(state, screen, ui, camera) {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, view.w, view.h);
    // Camera shake: a deterministic wobble from state.time, scaled by state.shake.
    const shaky = {
      x: camera.x + (state.shake > 0 ? Math.sin(state.time * 91) * state.shake : 0),
      y: camera.y + (state.shake > 0 ? Math.cos(state.time * 113) * state.shake : 0),
    };
    drawWorld(state, shaky);
    if (screen === SCREEN_TITLE) {
      dim(0.62);
      drawPanel('', 'neon', [
        { text: 'A tiny open-city crime story — an original city, original names, original art.', size: 17, color: PALETTE.text },
        { text: 'Rico needs a package moved across Neon Harbor. The cops disagree.', size: 17, color: PALETTE.muted },
        { text: '', size: 17, color: PALETTE.text },
        { text: 'WASD / ARROWS — move & drive      E — steal / exit car', size: 16, color: PALETTE.text },
        { text: 'MOUSE + CLICK / SPACE — aim & shoot      P — pause      M — mute', size: 16, color: PALETTE.text },
        { text: '', size: 17, color: PALETTE.text },
        { text: ui.saveExists ? 'A saved game was found — press C to continue it.' : 'Three missions. Five stars of heat. One harbour.', size: 16, color: PALETTE.neonCyan },
      ], ui.saveExists ? 'ENTER — NEW GAME   ·   C — CONTINUE' : 'ENTER OR CLICK — START', state.time);
      return;
    }
    drawHud(state, ui);
    if (screen === SCREEN_PAUSED) {
      dim(0.6);
      drawPanel('PAUSED', PALETTE.text, [
        { text: 'The city waits for no one — except right now.', size: 17, color: PALETTE.muted },
        { text: 'WASD move · E car · CLICK shoot · M mute', size: 16, color: PALETTE.text },
      ], 'P — RESUME', state.time);
    } else if (screen === SCREEN_OVER) {
      dim(0.55);
      const busted = ui.overKind === 'busted';
      drawPanel(busted ? 'BUSTED' : 'WASTED', busted ? '#4d8dff' : PALETTE.danger, [
        { text: busted ? 'The Harbor PD finally caught up with you.' : 'Neon Harbor is not kind to the careless.', size: 17, color: PALETTE.text },
        { text: `Money: $${state.player.money.toLocaleString('en-US')}   ·   Mission ${Math.min(state.mission + 1, 3)} of 3   ·   ${Math.round(state.playTime)}s on the streets`, size: 16, color: PALETTE.muted },
      ], 'R OR SPACE — TRY AGAIN', state.time);
    } else if (screen === SCREEN_STORY) {
      dim(0.5);
      drawPanel('STORY COMPLETE', PALETTE.gold, [
        { text: 'The package is delivered. The docks are quiet. Neon Harbor is yours.', size: 18, color: PALETTE.text },
        { text: `Money: $${state.player.money.toLocaleString('en-US')}   ·   ${Math.round(state.playTime)}s on the streets`, size: 16, color: PALETTE.muted },
        { text: 'Free roam is open — steal cars, dodge the heat, enjoy the city.', size: 16, color: PALETTE.neonCyan },
      ], 'ENTER — KEEP ROAMING', state.time);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, view };
}
