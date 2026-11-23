// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between five screens: title, play, paused,
// game over and story complete. Progress (position, money, mission) is saved to
// localStorage whenever a mission advances and every fifteen seconds of play.
//
// ?seed=N fixes the city. ?shot=start|drive|mission|wanted (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.

import { CAR, SAVE_KEY, STEP, WORLD, mulberry32 } from './config.js';
import { createWorld, EVENT_BUSTED, EVENT_CRASH, EVENT_MISSION, EVENT_PICKUP, EVENT_PUNCH, EVENT_SHOT, EVENT_STORY, EVENT_WASTED } from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_STORY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;
/** How often a running game autosaves, in seconds of play. */
const AUTOSAVE_SECONDS = 15;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(mulberry32(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw === null) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.x !== 'number' || typeof data.y !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.saveData()));
  } catch {
    // Storage can be off (private windows): progress then lasts this visit only.
  }
}

function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** The camera centre for the current player position and viewport. On the title
 *  screen the camera sits a little high, so the player stands below the text
 *  block instead of on top of it. */
function cameraFor(screen) {
  const view = renderer.view;
  const p = world.state.player;
  const x = view.w >= WORLD.width ? WORLD.width / 2 : Math.min(Math.max(p.x, view.w / 2), WORLD.width - view.w / 2);
  let y = view.h >= WORLD.height ? WORLD.height / 2 : Math.min(Math.max(p.y, view.h / 2), WORLD.height - view.h / 2);
  if (screen === SCREEN_TITLE) y = Math.max(view.h / 2, y - 200);
  return { x, y };
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.ui, cameraFor(scene.screen));
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let overKind = 'wasted';
  let save = readSave();
  let muted = false;
  let accumulator = 0;
  let last = performance.now();
  let autosaveTimer = AUTOSAVE_SECONDS;
  let graceTimer = 0;

  const ui = {
    get saveExists() {
      return save !== null;
    },
    get overKind() {
      return overKind;
    },
    get muted() {
      return muted;
    },
  };

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(message) {
    status.textContent = message;
  }

  function startGame(fresh) {
    if (fresh) {
      world.reset();
      clearSave();
      save = null;
    }
    accumulator = 0;
    autosaveTimer = AUTOSAVE_SECONDS;
    graceTimer = 0.25;
    screen = SCREEN_PLAY;
    announce('Playing. Three missions. Lose the cops, deliver the package.');
  }

  function continueGame() {
    if (save === null) return;
    world.reset();
    world.loadData(save);
    accumulator = 0;
    autosaveTimer = AUTOSAVE_SECONDS;
    graceTimer = 0.25;
    screen = SCREEN_PLAY;
    announce('Continuing your saved game.');
  }

  function endGame(kind) {
    overKind = kind;
    screen = SCREEN_OVER;
    clearSave();
    save = null;
    audio.sting();
    announce(kind === 'busted' ? 'Busted. The police caught you.' : 'Wasted. Your health ran out.');
  }

  function handleEvents(events) {
    if (events & EVENT_SHOT) audio.shoot();
    if (events & EVENT_PUNCH) audio.punch();
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_CRASH) audio.crash(1);
    if (events & EVENT_MISSION) {
      audio.jingle();
      writeSave();
      save = readSave();
    }
    if (events & EVENT_STORY) {
      audio.jingle();
      writeSave();
      save = readSave();
      screen = SCREEN_STORY;
      announce('Story complete. The package is delivered.');
    }
    if (events & EVENT_WASTED) endGame('wasted');
    else if (events & EVENT_BUSTED) endGame('busted');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      muted = !muted;
      audio.setMuted(muted);
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) {
        audio.unlock();
        audio.click();
        startGame(true);
      }
      return;
    }
    if (screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) {
        audio.unlock();
        audio.click();
        startGame(true);
      }
      return;
    }
    if (screen === SCREEN_STORY) {
      if (actions & ACTION_CONFIRM) {
        audio.click();
        screen = SCREEN_PLAY;
        announce('Free roam. The city is yours.');
      }
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        audio.click();
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    // SCREEN_PLAY.
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      writeSave();
      save = readSave();
      announce('Paused.');
    }
  }

  // C on the title screen continues a saved game (Enter starts a new one).
  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC' && screen === SCREEN_TITLE && save !== null && !event.repeat) {
      audio.unlock();
      audio.click();
      continueGame();
    }
  });

  function step() {
    graceTimer = Math.max(0, graceTimer - STEP);
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { move: { x: 0, y: 0 }, steer: 0, throttle: false, brake: false, firing: false, aimX: 0, aimY: 0, enter: false }, true);
      return;
    }
    const camera = cameraFor();
    const view = renderer.view;
    const mouse = input.aim();
    const events = world.step(
      STEP,
      {
        move: input.move(),
        steer: input.steer(),
        throttle: input.throttle(),
        brake: input.brake(),
        firing: graceTimer <= 0 && input.shootHeld(),
        aimX: mouse.x + camera.x - view.w / 2,
        aimY: mouse.y + camera.y - view.h / 2,
        enter: false,
      },
      false,
    );
    handleEvents(events);
    if (screen === SCREEN_PLAY) {
      autosaveTimer -= STEP;
      if (autosaveTimer <= 0) {
        autosaveTimer = AUTOSAVE_SECONDS;
        writeSave();
        save = readSave();
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    // The engine hum and the siren follow the game, every frame.
    const p = world.state.player;
    const driving = !p.onFoot && p.car !== null;
    const speed01 = driving ? Math.abs(p.car.speed) / CAR.maxSpeed : 0;
    let nearestPolice = Infinity;
    for (const car of world.state.cars) {
      if (car.role !== 'police' || car.wrecked) continue;
      const d = Math.hypot(car.x - p.x, car.y - p.y);
      if (d < nearestPolice) nearestPolice = d;
    }
    const police01 = world.state.wanted > 0 && nearestPolice < 650 ? 1 - nearestPolice / 650 : 0;
    audio.update(STEP, driving, speed01, police01);
    renderer.draw(world.state, screen, ui, cameraFor(screen));
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      writeSave();
      save = readSave();
      announce('Paused.');
    }
  });

  announce('Neon Harbor. Press Enter or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
