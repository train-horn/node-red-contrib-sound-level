/**
 * sound-level: a Node-RED node that estimates sound pressure levels.
 *
 * Modes
 *   level    - level at a distance (inverse-square law, optional air absorption)
 *   distance - distance at which a target level is reached
 *   combine  - combined level of several incoherent sources
 *
 * The math comes from the tested `trainhorn-calc` package (an ES module, loaded
 * once with dynamic import). Results are free-field estimates, not measurements.
 */
'use strict';

const MODES = ['level', 'distance', 'combine'];

let calcPromise = null;
/** Load trainhorn-calc once (it is ESM; this file is CommonJS). */
function loadCalc() {
  if (!calcPromise) calcPromise = import('trainhorn-calc');
  return calcPromise;
}

/** Turn a config string into a number, or undefined when blank. */
function configNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return Number(value);
}

/** Round to `decimals` places when decimals is a non-negative integer. */
function round(value, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0) return value;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Pick the first defined value. */
function first(...values) {
  return values.find((v) => v !== undefined && v !== null && v !== '');
}

/**
 * Compute the result for one message payload.
 * @param {object} calc The trainhorn-calc module.
 * @param {object} cfg Node configuration (numbers already parsed).
 * @param {unknown} payload msg.payload.
 * @returns {object} New payload.
 */
function compute(calc, cfg, payload) {
  const { InputError } = calc;
  const isObj = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
  const input = isObj ? payload : {};
  const mode = first(input.mode, cfg.mode);
  if (!MODES.includes(mode)) {
    throw new InputError(`mode must be one of ${MODES.join(', ')}; got ${JSON.stringify(mode)}`);
  }

  if (mode === 'combine') {
    let levels;
    if (Array.isArray(payload)) levels = payload;
    else if (isObj && Array.isArray(input.levels)) levels = input.levels;
    else throw new InputError('combine mode needs msg.payload as an array of dB levels or {levels: [...]}');
    const combinedDb = round(calc.combineLevels(levels), cfg.decimals);
    return { ...(isObj ? input : {}), levels, mode, combinedDb };
  }

  if (!isObj && typeof payload !== 'number' && typeof payload !== 'string') {
    throw new InputError('msg.payload must be a number or an object such as {sourceDb, refDistance, distance, unit}');
  }

  const sourceDb = first(input.sourceDb, cfg.sourceDb);
  const refDistance = first(input.refDistance, cfg.refDistance, 10);
  const unit = first(input.unit, cfg.unit, 'ft');
  const absorptionDbPerKm = first(input.absorptionDbPerKm, cfg.absorptionDbPerKm, 0);
  const options = { refDistance, unit, absorptionDbPerKm };
  if (sourceDb === undefined) throw new InputError('sourceDb is missing: set it in the node or in msg.payload.sourceDb');

  if (mode === 'level') {
    const distance = isObj ? first(input.distance, cfg.distance) : payload;
    if (distance === undefined) throw new InputError('distance is missing: send a number or msg.payload.distance');
    const levelDb = round(calc.splAtDistance(sourceDb, distance, options), cfg.decimals);
    return { ...input, mode, sourceDb: Number(sourceDb), refDistance: Number(refDistance), distance: Number(distance), unit, absorptionDbPerKm: Number(absorptionDbPerKm), levelDb };
  }

  // mode === 'distance'
  const targetDb = isObj ? first(input.targetDb, cfg.targetDb) : payload;
  if (targetDb === undefined) throw new InputError('targetDb is missing: send a number or msg.payload.targetDb');
  const distanceForTarget = round(calc.distanceForSpl(sourceDb, targetDb, options), cfg.decimals);
  return { ...input, mode, sourceDb: Number(sourceDb), refDistance: Number(refDistance), targetDb: Number(targetDb), unit, absorptionDbPerKm: Number(absorptionDbPerKm), distanceForTarget };
}

module.exports = function register(RED) {
  function SoundLevelNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const decimals = configNumber(config.decimals);
    const cfg = {
      mode: config.mode || 'level',
      sourceDb: configNumber(config.sourceDb),
      refDistance: configNumber(config.refDistance),
      distance: configNumber(config.distance),
      targetDb: configNumber(config.targetDb),
      unit: config.unit || 'ft',
      absorptionDbPerKm: configNumber(config.absorptionDbPerKm),
      decimals: decimals === undefined ? undefined : decimals,
    };

    node.on('input', (msg, send, done) => {
      send = send || function (...args) { node.send.apply(node, args); };
      loadCalc()
        .then((calc) => {
          try {
            msg.payload = compute(calc, cfg, msg.payload);
          } catch (err) {
            node.status({ fill: 'red', shape: 'ring', text: err.message.slice(0, 40) });
            if (done) done(err); else node.error(err, msg);
            return;
          }
          const p = msg.payload;
          const text = p.mode === 'level' ? `${p.levelDb} dB @ ${p.distance} ${p.unit}`
            : p.mode === 'distance' ? `${p.targetDb} dB @ ${p.distanceForTarget} ${p.unit}`
              : `${p.combinedDb} dB combined`;
          node.status({ fill: 'green', shape: 'dot', text });
          send(msg);
          if (done) done();
        })
        .catch((err) => {
          if (done) done(err); else node.error(err, msg);
        });
    });
  }

  RED.nodes.registerType('sound-level', SoundLevelNode);
};

module.exports.compute = compute;
module.exports.loadCalc = loadCalc;
