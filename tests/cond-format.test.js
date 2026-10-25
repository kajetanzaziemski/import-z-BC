// Conditional formatting through the Grid: grid.setFormulaFontColors(range, rules, ownedFormulas), both commit paths. Registered by tests/run.js.
//   rules = [{ formula: '=...', fontColor: '#999999' }] for the range (r2 missing = down to the last row of the sheet)
//   ownedFormulas = the formulas the caller manages: existing custom-formula rules with one of them are replaced (wherever they are - a paste splits a rule
//   into pieces); every other rule of the sheet is left as it is.
'use strict';
const assert = require('assert');

module.exports = function register(t) {
  const { both, Grid } = t;
  const GREY = '#999999';
  const A = '=AND($B6="table",COLUMN()>3)', B = '=AND($B6="x",COLUMN()>4)', OLD = '=AND($B6="old",COLUMN()>9)';
  const rules = () => JSON.parse(JSON.stringify(Object.values(globalThis.__book.sheets)[0].snapshot().condRules || []));
  const open = env => { globalThis.__book = env.book; return Grid.open({ sheetName: 'S' }); };
  const range = { r1: 6, c1: 2, c2: 6 };
  const OWNED = [A, B, OLD];

  both('conditional formats: the rules are added for the range (down to the last row of the sheet) in the given colour', env => {
    env.sheet('S', 50, 8);
    const g = open(env);
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }, { formula: B, fontColor: GREY }], OWNED);
    g.commit();
    assert.deepStrictEqual(rules(), [{ formula: A, color: GREY, ranges: ['6,2,50,6'] }, { formula: B, color: GREY, ranges: ['6,2,50,6'] }]);
  });

  both('conditional formats: an explicit last row is respected', env => {
    env.sheet('S', 50, 8);
    const g = open(env);
    g.setFormulaFontColors({ r1: 6, c1: 2, r2: 20, c2: 6 }, [{ formula: A, fontColor: GREY }], OWNED);
    g.commit();
    assert.deepStrictEqual(rules()[0].ranges, ['6,2,20,6']);
  });

  both('conditional formats: applying the same rules again writes nothing (no rule is added, deleted or set)', env => {
    env.sheet('S', 50, 8);
    let g = open(env);
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }, { formula: B, fontColor: GREY }], OWNED);
    g.commit();
    const writes = env.book.condWrites;
    assert.ok(writes > 0);
    g = open(env);
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }, { formula: B, fontColor: GREY }], OWNED);
    g.commit();
    assert.strictEqual(env.book.condWrites, writes, 'the second commit wrote no rule');
    assert.deepStrictEqual(rules().length, 2);
  });

  both('conditional formats: other rules of the sheet stay where they are; ours are replaced, also the ones a paste split into pieces or left with an old formula', env => {
    const s = env.sheet('S', 50, 8);
    s.condRules.push({ formula: '=$D1>5', color: '#ff0000', ranges: [{ r1: 1, c1: 4, r2: 50, c2: 4 }] });                       // somebody else's
    s.condRules.push({ formula: A, color: GREY, ranges: [{ r1: 6, c1: 2, r2: 9, c2: 6 }] }, { formula: A, color: GREY, ranges: [{ r1: 12, c1: 2, r2: 50, c2: 6 }] });   // ours, split by a paste
    s.condRules.push({ formula: OLD, color: GREY, ranges: [{ r1: 6, c1: 2, r2: 50, c2: 6 }] });                                // ours, an old version
    s.condRules.push({ formula: '=$E1="x"', color: '#00ff00', ranges: [{ r1: 1, c1: 5, r2: 50, c2: 5 }] });                    // somebody else's, after ours
    const g = open(env);
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }, { formula: B, fontColor: GREY }], OWNED);
    g.commit();
    const r = rules();
    assert.deepStrictEqual(r.map(x => x.formula), ['=$D1>5', '=$E1="x"', A, B], 'foreign rules first, in their order; ours after them');
    assert.deepStrictEqual(r.filter(x => x.formula === A).map(x => x.ranges), [['6,2,50,6']]);
  });

  both('conditional formats: an empty rule list removes ours and nothing else (switching the greying off)', env => {
    const s = env.sheet('S', 50, 8);
    s.condRules.push({ formula: '=$D1>5', color: '#ff0000', ranges: [{ r1: 1, c1: 4, r2: 50, c2: 4 }] }, { formula: A, color: GREY, ranges: [{ r1: 6, c1: 2, r2: 50, c2: 6 }] });
    const g = open(env);
    g.setFormulaFontColors(range, [], OWNED);
    g.commit();
    assert.deepStrictEqual(rules().map(x => x.formula), ['=$D1>5']);
  });

  both('conditional formats: they go together with other changes of the same commit (one batchUpdate on the API path)', env => {
    env.sheet('S', 50, 8);
    const g = open(env);
    g.getRange(1, 1).setValue('x');
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }], OWNED);
    g.commit();
    if (env.mode === 'api') assert.strictEqual(env.book.requests.length, 1);
    assert.strictEqual(Object.values(env.book.sheets)[0].cell(1, 1).v, 'x');
    assert.strictEqual(rules().length, 1);
  });

  both('conditional formats: a commit can be repeated - the second commit knows what the first one wrote and only changes what changed since', env => {
    env.sheet('S', 50, 8);
    const g = open(env);
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }], OWNED);
    g.commit();
    g.setFormulaFontColors(range, [{ formula: A, fontColor: GREY }, { formula: B, fontColor: GREY }], OWNED);
    g.commit();
    assert.deepStrictEqual(rules().map(x => x.formula), [A, B]);
    g.setFormulaFontColors(range, [{ formula: B, fontColor: GREY }], OWNED);
    g.commit();
    assert.deepStrictEqual(rules().map(x => x.formula), [B]);
  });

  both('conditional formats: a colour that is not a colour fails when the rule is given, not at the commit', env => {
    env.sheet('S', 50, 8);
    const g = open(env);
    assert.throws(() => g.setFormulaFontColors(range, [{ formula: A, fontColor: 'nope' }], OWNED), /unknown colour/);
  });

  both('conditional formats: on a sheet made by Grid.create the rules are part of the same commit', env => {
    const g = Grid.create({ sheetName: 'N', rows: 5, cols: 6 });
    g.getRange(1, 1).setValue('x');
    g.setFormulaFontColors({ r1: 2, c1: 2, c2: 6 }, [{ formula: A, fontColor: GREY }], OWNED);
    g.commit();
    assert.deepStrictEqual(env.book.sheets['N'].snapshot().condRules, [{ formula: A, color: GREY, ranges: ['2,2,1000,6'] }]);
  });
};
