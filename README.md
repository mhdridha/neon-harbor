# Neon Harbor

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/mhdridha/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/mhdridha/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

A top-down 2D open-city crime game built by an AI agent for [make.fun's Make GTA 6 bounty](https://make.fun/bounty/gta6-01) ($1,666 in USDC).

Neon Harbor is a neon-lit harbour city you cross on foot and by car. Traffic fills the streets, pedestrians crowd the sidewalks, and the police are always one bad decision away. Everything — city, names, story, art, sound — is original; nothing comes from Rockstar Games.

## The story

Rico needs a package moved across the city, and the cops disagree. Three missions:

1. **The Package** — meet Rico at the warehouse and pick it up.
2. **Lose the Cops** — the drop went loud; get your wanted level to zero.
3. **The Docks** — deliver the package to the east-side docks.

Finish all three and the story is complete; free roam stays open.

## How it plays

- **On foot:** walk with WASD or the arrow keys. Aim with the mouse, click or hold Space to shoot the pistol (punch when out of ammo).
- **By car:** walk up to any car and press E to steal it — jacking a moving car raises your wanted level. W accelerates, S brakes/reverses, A/D steer. Press E again to get out.
- **Wanted, 0–5 stars:** stealing cars, hitting pedestrians and shooting near police raise the heat. Police cruisers chase and ram you; a cruiser touching you on foot for long enough gets you busted. Stay quiet and out of sight and the stars fade, one at a time.
- **Pickups:** ammo, health and cash scattered on the sidewalks.
- **HUD:** health, money, ammo, mission objective, speed while driving, and a minimap (top right) showing the streets, your position, the mission marker and nearby police.
- **Save:** progress (position, money, mission) autosaves to localStorage every 15 seconds and on mission progress. C on the title screen continues a saved game.

## Controls

| Input | Does |
| --- | --- |
| WASD / arrows | Walk; drive (W accelerate, S brake/reverse, A/D steer) |
| Mouse + click / Space | Aim and shoot (punch when out of ammo) |
| E | Steal a car / get out |
| P / Esc | Pause |
| M | Mute |
| R | Restart after wasted / busted |
| C | Continue a saved game (title screen) |

## Run it

Serve `game/` with any static server and open `game/index.html` in desktop Chrome:

```
node serve.ts        # serves game/ on http://localhost:8080
```

No build step, no network requests, no libraries: plain ES modules, canvas 2D art drawn in code, and sound synthesized with WebAudio. Screenshots are staged from the real game with `?shot=start|drive|mission|wanted&seed=1`.

## Files

- `game/index.html` — the page; `game/src/main.js` — boot, loop, screens, save.
- `game/src/config.js` — all tuning, the city layout, the missions, the palette.
- `game/src/world.js` — city generation, traffic, pedestrians, police, wanted, missions, combat.
- `game/src/render.js` — everything drawn: the night city, the HUD, the minimap.
- `game/src/input.js`, `game/src/audio.js`, `game/src/shots.js` — input, synthesized sound, staged scenes.
- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=brpbx0j7&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
