'use strict';

const assert = require('node:assert');
const helper = require('node-red-node-test-helper');
const soundLevel = require('../nodes/sound-level.js');

helper.init(require.resolve('node-red'));

/** Deploy a sound-level node wired to a helper node. */
function flow(props) {
  return [
    Object.assign({ id: 'n1', type: 'sound-level', name: 'sl', wires: [['n2']] }, props),
    { id: 'n2', type: 'helper' },
  ];
}

/** Send one payload and resolve with the output payload. */
function run(props, payload) {
  return new Promise((resolve, reject) => {
    helper.load(soundLevel, flow(props), () => {
      const n1 = helper.getNode('n1');
      const n2 = helper.getNode('n2');
      n2.on('input', (msg) => resolve(msg.payload));
      n1.receive({ payload });
      setTimeout(() => reject(new Error('no output')), 1500);
    });
  });
}

/** Send one payload and resolve with the error that the node reports through done(err). */
function runError(props, payload) {
  return new Promise((resolve, reject) => {
    helper.load(soundLevel, flow(props), () => {
      const n1 = helper.getNode('n1');
      const n2 = helper.getNode('n2');
      n2.on('input', () => reject(new Error('unexpected output')));
      n1.on('call:error', (call) => resolve(call.args[0]));
      n1.receive({ payload });
      setTimeout(() => reject(new Error('no error reported')), 1500);
    });
  });
}

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

describe('sound-level node', function () {
  beforeEach((done) => { helper.startServer(done); });
  afterEach((done) => { helper.unload().then(() => helper.stopServer(done)); });

  it('loads with its name', (done) => {
    helper.load(soundLevel, flow({}), () => {
      assert.strictEqual(helper.getNode('n1').name, 'sl');
      done();
    });
  });

  describe('level mode', () => {
    it('150 dB at 10 ft gives 130.0 dB at 100 ft (object payload)', async () => {
      const p = await run({ mode: 'level', decimals: '1' }, { sourceDb: 150, refDistance: 10, distance: 100, unit: 'ft' });
      assert.strictEqual(p.levelDb, 130.0);
      assert.strictEqual(p.distance, 100);
      assert.strictEqual(p.unit, 'ft');
    });

    it('a number payload is the distance; source comes from the node', async () => {
      const p = await run({ mode: 'level', sourceDb: '150', refDistance: '10', unit: 'ft', decimals: '' }, 100);
      near(p.levelDb, 130);
    });

    it('a numeric string payload works', async () => {
      const p = await run({ mode: 'level', sourceDb: '150', decimals: '1' }, '1000');
      assert.strictEqual(p.levelDb, 110.0);
    });

    it('closer than the reference is louder (+6.02 dB at half distance)', async () => {
      const p = await run({ mode: 'level', decimals: '2' }, { sourceDb: 150, distance: 5 });
      assert.strictEqual(p.levelDb, 156.02);
    });

    it('metres and a 1 m reference', async () => {
      const p = await run({ mode: 'level', decimals: '' }, { sourceDb: 120, refDistance: 1, distance: 10, unit: 'm' });
      near(p.levelDb, 100);
    });

    it('air absorption lowers the level by alpha * extra km', async () => {
      const p = await run({ mode: 'level', decimals: '' }, { sourceDb: 150, refDistance: 10, distance: 1010, unit: 'm', absorptionDbPerKm: 2 });
      near(p.levelDb, 150 - 20 * Math.log10(101) - 2);
    });

    it('keeps extra payload properties', async () => {
      const p = await run({ mode: 'level' }, { sourceDb: 150, distance: 100, label: 'crossing A' });
      assert.strictEqual(p.label, 'crossing A');
    });
  });

  describe('distance mode', () => {
    it('150 dB at 10 ft reaches 130 dB at 100 ft', async () => {
      const p = await run({ mode: 'distance', decimals: '1' }, { sourceDb: 150, refDistance: 10, targetDb: 130 });
      assert.strictEqual(p.distanceForTarget, 100.0);
    });

    it('a number payload is the target dB', async () => {
      const p = await run({ mode: 'distance', sourceDb: '150', decimals: '' }, 90);
      near(p.distanceForTarget, 10000, 1e-6);
    });

    it('absorption shortens the distance (two messages through one node)', (done) => {
      helper.load(soundLevel, flow({ mode: 'distance', decimals: '' }), () => {
        const out = [];
        helper.getNode('n2').on('input', (msg) => {
          out.push(msg.payload.distanceForTarget);
          if (out.length < 2) return;
          try {
            near(out[0], 10000, 1e-6);
            assert.ok(out[1] < out[0], `${out[1]} should be < ${out[0]}`);
            done();
          } catch (e) { done(e); }
        });
        const n1 = helper.getNode('n1');
        n1.receive({ payload: { sourceDb: 150, targetDb: 90 } });
        setTimeout(() => n1.receive({ payload: { sourceDb: 150, targetDb: 90, absorptionDbPerKm: 1.9 } }), 50);
      });
    });

    it('payload.mode overrides the node mode', async () => {
      const p = await run({ mode: 'level', decimals: '1' }, { mode: 'distance', sourceDb: 150, targetDb: 130 });
      assert.strictEqual(p.distanceForTarget, 100.0);
    });
  });

  describe('combine mode', () => {
    it('two equal sources add 3.01 dB', async () => {
      const p = await run({ mode: 'combine', decimals: '2' }, [100, 100]);
      assert.strictEqual(p.combinedDb, 103.01);
    });

    it('accepts {levels: [...]}', async () => {
      const p = await run({ mode: 'combine', decimals: '1' }, { levels: [120, 90] });
      assert.strictEqual(p.combinedDb, 120.0);
    });
  });

  describe('example flow', () => {
    const example = require('../examples/sound-level-basics.json');
    const byId = Object.fromEntries(example.map((n) => [n.id, n]));
    const cfg = (id) => { const { id: _i, type: _t, x: _x, y: _y, z: _z, wires: _w, ...rest } = byId[id]; return rest; };

    it('level node turns the inject payload into 130.0 dB', async () => {
      const p = await run(cfg('sl_level'), JSON.parse(byId.sl_inj_level.payload));
      assert.strictEqual(p.levelDb, 130.0);
    });

    it('distance node finds 90 dB at 10000 ft', async () => {
      const p = await run(cfg('sl_distance'), Number(byId.sl_inj_target.payload));
      assert.strictEqual(p.distanceForTarget, 10000.0);
    });

    it('combine node gives 103.01 dB', async () => {
      const p = await run(cfg('sl_combine'), JSON.parse(byId.sl_inj_combine.payload));
      assert.strictEqual(p.combinedDb, 103.01);
    });
  });

  describe('invalid input', () => {
    it('distance 0', async () => {
      const err = await runError({ mode: 'level' }, { sourceDb: 150, distance: 0 });
      assert.match(String(err), /distance must be greater than 0/);
    });

    it('negative distance', async () => {
      const err = await runError({ mode: 'level', sourceDb: '150' }, -5);
      assert.match(String(err), /distance/);
    });

    it('unknown unit', async () => {
      const err = await runError({ mode: 'level' }, { sourceDb: 150, distance: 100, unit: 'yd' });
      assert.match(String(err), /unit must be one of/);
    });

    it('non-numeric source', async () => {
      const err = await runError({ mode: 'level' }, { sourceDb: 'loud', distance: 100 });
      assert.match(String(err), /sourceDb must be a number/);
    });

    it('missing sourceDb', async () => {
      const err = await runError({ mode: 'level', sourceDb: '' }, 100);
      assert.match(String(err), /sourceDb is missing/);
    });

    it('missing distance', async () => {
      const err = await runError({ mode: 'level' }, { sourceDb: 150 });
      assert.match(String(err), /distance is missing/);
    });

    it('negative absorption', async () => {
      const err = await runError({ mode: 'level' }, { sourceDb: 150, distance: 100, absorptionDbPerKm: -1 });
      assert.match(String(err), /absorptionDbPerKm/);
    });

    it('boolean payload', async () => {
      const err = await runError({ mode: 'level', sourceDb: '150' }, true);
      assert.match(String(err), /msg.payload must be a number or an object/);
    });

    it('combine with an empty array', async () => {
      const err = await runError({ mode: 'combine' }, []);
      assert.match(String(err), /at least one level/);
    });

    it('combine with a non-array payload', async () => {
      const err = await runError({ mode: 'combine' }, 100);
      assert.match(String(err), /array of dB levels/);
    });

    it('unknown mode', async () => {
      const err = await runError({ mode: 'level' }, { mode: 'loudness', sourceDb: 150, distance: 10 });
      assert.match(String(err), /mode must be one of/);
    });
  });
});
