# Neon Harbor

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mhdridha/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mhdridha/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A tiny open-city crime game for make.fun's **gta6-01** bounty: a neon harbour city you cross on foot and by car, in desktop Chrome. Original city, names, story and art — nothing from any real game, brand or place.

## The story

Rico needs a package moved across Neon Harbor. The cops disagree. Three missions:

1. **The Package** — meet Rico at the warehouse and pick it up.
2. **Lose the Cops** — the drop went loud; get your wanted level to zero.
3. **The Docks** — deliver the package to the east-side docks.

Finish all three and the story is complete; free roam stays open.

## How to play

| Input | Does |
| --- | --- |
| WASD / arrows | Walk, and drive (W accelerate, S brake/reverse, A/D steer) |
| Mouse + click / Space | Aim and shoot the pistol (punch when out of ammo) |
| E | Steal a car / get out (jacking a moving car raises your wanted level) |
| P / Esc | Pause |
| M | Mute |
| R | Restart after wasted / busted |
| C | Continue a saved game from the title screen |

The city has a five-star wanted level: stealing cars, hitting pedestrians and shooting near police raise it; police cruisers chase and ram you, and standing next to one on foot gets you busted. Stay quiet and out of sight and the heat fades. Pickups on the sidewalks restock ammo, health and cash. Progress saves to localStorage.

## Run it

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

Or any static server over `game/`. No build step, no network requests, no libraries: plain ES modules, canvas 2D art drawn in code, and sound synthesized with WebAudio. Screenshots are staged from the real game with `?shot=start|drive|mission|wanted&seed=1`.

## Files

- `game/index.html` — the page; `game/src/main.js` — boot, loop, screens, save.
- `game/src/config.js` — all tuning, the city layout, the missions, the palette.
- `game/src/world.js` — city generation, traffic, pedestrians, police, wanted, missions, combat.
- `game/src/render.js` — everything drawn: the night city, the HUD, the minimap.
- `game/src/input.js`, `game/src/audio.js`, `game/src/shots.js` — input, synthesized sound, staged scenes.
- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=brpbx0j7&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
