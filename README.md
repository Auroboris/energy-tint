# Energy Tint

A [StarMash](https://starmash.airmash.rocks) / SWAM extension that turns every visible plane into a live energy gauge before the next shot gives it away.

Install URL: `https://cdn.jsdelivr.net/gh/Auroboris/energy-tint@b7c93b55d0ac2362318493f906b7e25e1729660a/extension.js`

## What it does

Energy Tint colors plane sprites according to the weapon energy reported by StarMash. By default, high energy is green, middle energy is yellow, low energy is red, and an empty plane returns to its normal appearance.

- Green at 75–100% energy.
- Yellow at 30–74% energy.
- Red above empty and below 30% energy.
- No tint at 0% energy.
- Adjustable thresholds, colors, tint intensity, pulse speed, and pulse strength.
- Separate visibility controls for your plane, enemies, teammates, and bots.
- Any chosen toggle key (`I` by default).

Settings are saved after you apply them and restored after reloading the game.

## Usage

Install the extension, reload StarMash, then open **Mod Settings → Energy Tint**.

Energy values use the latest fire, boost, and stealth information available to the game client, with the client's regeneration estimate between reports. Network delay may cause a brief difference between the tint and the server.
