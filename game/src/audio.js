// Every sound is synthesized with WebAudio: no audio files ship with the game.
// The context is created on the first user gesture (browsers block audio before
// that); every call before unlock() is a safe no-op, and M toggles the master gain.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let muted = false;
  let time = 0;

  function unlock() {
    if (ctx !== null) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.4;
      master.connect(ctx.destination);
      // One second of white noise, reused by every percussive sound.
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      // The engine hum: a sawtooth through a low-pass, silent until driving.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      // The police siren: a square wave that alternates two tones, silent until near.
      sirenOsc = ctx.createOscillator();
      sirenOsc.type = 'square';
      sirenOsc.frequency.value = 720;
      sirenGain = ctx.createGain();
      sirenGain.gain.value = 0;
      sirenOsc.connect(sirenGain);
      sirenGain.connect(master);
      sirenOsc.start();
    } catch {
      ctx = null;
    }
  }

  /** A short tone: frequency slide from `from` to `to` over `seconds`. */
  function tone(type, from, to, seconds, volume, delay = 0) {
    if (ctx === null) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + seconds + 0.02);
  }

  /** A burst of the shared noise buffer through a filter. */
  function noise(seconds, volume, filterType, frequency, delay = 0) {
    if (ctx === null) return;
    const t0 = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t0);
    source.stop(t0 + seconds + 0.02);
  }

  return {
    unlock,
    isMuted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      if (master !== null) master.gain.value = muted ? 0 : 0.4;
    },
    click() {
      tone('square', 950, 700, 0.04, 0.08);
    },
    shoot() {
      noise(0.09, 0.5, 'bandpass', 1700);
      tone('square', 240, 55, 0.08, 0.22);
    },
    punch() {
      noise(0.07, 0.35, 'lowpass', 500);
    },
    pickup() {
      tone('sine', 660, 660, 0.09, 0.2);
      tone('sine', 990, 990, 0.12, 0.2, 0.08);
    },
    crash(strength = 1) {
      noise(0.22, 0.35 * strength, 'lowpass', 320);
      tone('sine', 90, 38, 0.2, 0.4 * strength);
    },
    jingle() {
      // Mission complete: a rising four-note arpeggio.
      const notes = [523, 659, 784, 1046];
      for (let i = 0; i < notes.length; i += 1) tone('sine', notes[i], notes[i], 0.16, 0.22, i * 0.1);
    },
    sting() {
      // Wasted / busted: three falling notes.
      const notes = [392, 311, 233];
      for (let i = 0; i < notes.length; i += 1) tone('triangle', notes[i], notes[i] * 0.94, 0.3, 0.25, i * 0.16);
    },
    /**
     * Per-frame loop update: the engine hum follows the driven car's speed, the
     * siren follows the nearest police car (0 = silent, 1 = on top of you).
     */
    update(dt, driving, speed01, police01) {
      time += dt;
      if (ctx === null) return;
      if (engineOsc !== null) {
        engineOsc.frequency.value = 52 + speed01 * 150;
        engineGain.gain.value = driving ? 0.05 + speed01 * 0.075 : 0;
      }
      if (sirenOsc !== null) {
        sirenOsc.frequency.value = Math.floor(time * 2) % 2 === 0 ? 715 : 960;
        sirenGain.gain.value = police01 * 0.045;
      }
    },
  };
}
