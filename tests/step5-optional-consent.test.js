const test = require('node:test');
const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('content/signup-page.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function buildApi() {
  const bundle = [
    extractFunction('getStep5CheckableState'),
    extractFunction('ensureStep5OptionalConsentAllAccepted'),
  ].join('\n');

  return new Function(`
let clicked = 0;
const logs = [];
let control = null;

function findStep5OptionalConsentAllControl() {
  return control;
}

async function humanPause() {}
async function sleep() {}

function simulateClick(target) {
  clicked += 1;
  if (control?.toggle) {
    control.toggle.checked = true;
  }
}

function log(message) {
  logs.push(message);
}

${bundle}

return {
  setControl(value) {
    control = value;
  },
  async ensure(stepId = '5') {
    return ensureStep5OptionalConsentAllAccepted(stepId);
  },
  getStep5CheckableState,
  snapshot() {
    return {
      clicked,
      logs: [...logs],
      checked: control?.toggle?.checked ?? null,
    };
  },
};
`)();
}

test('ensureStep5OptionalConsentAllAccepted skips cleanly when optional consent is absent', async () => {
  const api = buildApi();

  const result = await api.ensure('5');
  const state = api.snapshot();

  assert.strictEqual(result, false);
  assert.strictEqual(state.clicked, 0);
  assert.deepStrictEqual(state.logs, []);
});

test('ensureStep5OptionalConsentAllAccepted does not re-click an already checked consent', async () => {
  const api = buildApi();
  api.setControl({
    toggle: { checked: true },
    clickTarget: { id: 'consent-all' },
  });

  const result = await api.ensure('5');
  const state = api.snapshot();

  assert.strictEqual(result, true);
  assert.strictEqual(state.clicked, 0);
  assert.match(state.logs[state.logs.length - 1], /已勾选/);
});

test('ensureStep5OptionalConsentAllAccepted clicks optional consent when it is unchecked', async () => {
  const api = buildApi();
  api.setControl({
    toggle: { checked: false },
    clickTarget: { id: 'consent-all' },
  });

  const result = await api.ensure('5');
  const state = api.snapshot();

  assert.strictEqual(result, true);
  assert.strictEqual(state.clicked, 1);
  assert.strictEqual(state.checked, true);
  assert.match(state.logs[state.logs.length - 1], /已勾选“我同意以下所有各项”/);
});

test('getStep5CheckableState supports aria and data-state fallbacks', () => {
  const api = buildApi();

  assert.strictEqual(
    api.getStep5CheckableState({
      getAttribute(name) {
        return name === 'aria-checked' ? 'true' : null;
      },
    }),
    true
  );

  assert.strictEqual(
    api.getStep5CheckableState({
      getAttribute(name) {
        return name === 'data-state' ? 'checked' : null;
      },
    }),
    true
  );
});
