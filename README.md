# node-red-contrib-sound-level

A Node-RED node for quick sound level estimates in a free field:

- **Level at distance**: dB at a distance from a level known at a reference distance (inverse-square law), with an optional air absorption term.
- **Distance for target level**: how far away a source drops to a given dB.
- **Combine levels**: the total of several incoherent sources (two equal sources add about 3 dB).

Useful for noise dashboards, siren or horn audibility checks, sensor post-processing and "how loud is it over there?" questions in home automation flows. The math comes from the tested [`trainhorn-calc`](https://www.npmjs.com/package/trainhorn-calc) package.

## Install

From the Node-RED palette manager, search for `node-red-contrib-sound-level`, or run in your Node-RED user directory (usually `~/.node-red`):

```sh
npm install node-red-contrib-sound-level
```

Requires Node-RED 3.0 or later and Node.js 18.3 or later.

## Usage

The node is in the **function** category as **sound level**.

### Level at distance

Send either a number (the distance; the other values come from the node settings) or an object:

```json
{ "sourceDb": 150, "refDistance": 10, "distance": 100, "unit": "ft" }
```

Output (`msg.payload`):

```json
{ "mode": "level", "sourceDb": 150, "refDistance": 10, "distance": 100, "unit": "ft", "absorptionDbPerKm": 0, "levelDb": 130 }
```

Formula: `L = sourceDb - 20*log10(distance/refDistance) - absorptionDbPerKm * (d_m - ref_m) / 1000`.

### Distance for target level

Send a number (the target dB) or `{ sourceDb, refDistance, targetDb, unit, absorptionDbPerKm }`. The output adds `distanceForTarget` in the same unit. For 150 dB at 10 ft, 90 dB is reached at 10,000 ft without absorption, and closer with it.

### Combine levels

Send an array of dB values, e.g. `[100, 100]`, or `{ "levels": [100, 100] }`. The output adds `combinedDb` (103.01 here).

### Settings and overrides

| Setting | Payload property | Default |
| --- | --- | --- |
| Mode | `mode` (`level`, `distance`, `combine`) | `level` |
| Source dB | `sourceDb` | 150 |
| Ref. distance | `refDistance` | 10 |
| Distance | `distance` | from payload |
| Target dB | `targetDb` | from payload |
| Unit | `unit` (`ft` or `m`) | `ft` |
| Air absorption, dB/km | `absorptionDbPerKm` | 0 |
| Decimals | (node only) | 1; blank means no rounding |

Payload properties win over node settings. Other payload properties are passed through unchanged.

Typical air absorption at 10 °C and 70 % RH: about 1.9 dB/km at 500 Hz and 3.7 dB/km at 1 kHz.

### Errors

Invalid input (missing values, a distance of 0 or less, an unknown unit, non-numbers, an empty list) is reported with `done(err)`, so a **catch** node can handle it, and the node shows a red status.

## Example

Import **Menu > Import > Examples > node-red-contrib-sound-level > sound-level-basics**. It shows all three modes with inject and debug nodes.

## Notes

The results are free-field estimates, not measurements. Ground, buildings, barriers, wind and temperature gradients change real levels. To try the same calculation in a browser, see the [decibel distance calculator](https://train-horn.com/tools/decibel-distance/).

## Tests

```sh
npm install
npm test
```

The tests use `node-red-node-test-helper` and mocha and cover all modes, the example flow and invalid input.

## License

MIT, see [LICENSE](LICENSE).
