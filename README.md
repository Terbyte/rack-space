# Rack Space

A data-centre idle tycoon in one screen of telemetry.

Cores earn tokens. Cores make heat. Fans fight heat. Fans eat watts. The PSU caps everything —
buy the wrong thing and the rack throttles, then trips.

## Play

Open `index.html` — no build step, no dependencies, saves to `localStorage`.

## Mechanics

| System | Rule |
|---|---|
| Income | `cores × clock × 75 tok/s × billing × generation` |
| Heat | `cores × clock × 3.2` per second, minus `fans × 8 + 2` |
| Throttle | above 85 °C efficiency falls to 25 % |
| Trip | at 108 °C — 9 s offline, then 10 s of limp mode at 45 % heat |
| Power | cores + clock^1.5 + fans, capped by PSU size |
| Prestige | $20K lifetime → +30 % per generation |

## Version

0.1.2
