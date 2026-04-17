const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const backgroundSource = fs.readFileSync('background.js', 'utf8');

function extractFunctionFromSource(sourceText, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => sourceText.indexOf(marker))
    .find((index) => index >= 0);

  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
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
  for (; end < sourceText.length; end += 1) {
    const ch = sourceText[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return sourceText.slice(start, end);
}

test('resolveVerificationStep 在首次 resend 后会先返回邮箱页再轮询', async () => {
  const bundle = [
    extractFunctionFromSource(backgroundSource, 'resolveVerificationStep'),
  ].join('\n');

  const api = new Function(`
const HOTMAIL_PROVIDER = 'hotmail-api';
const calls = [];

function getVerificationCodeStateKey(step) {
  return step === 4 ? 'lastSignupCode' : 'lastLoginCode';
}
function getHotmailVerificationPollConfig() {
  return {};
}
function getVerificationCodeLabel(step) {
  return step === 4 ? '注册' : '登录';
}
function isLoginVerificationStep() {
  return false;
}
function isStep7RestartFromStep6Error() {
  return false;
}
function isStopError() {
  return false;
}
async function requestVerificationCodeResend() {
  calls.push('resend');
}
async function returnToMailPageAfterResend() {
  calls.push('return-mail');
}
async function addLog(message) {
  calls.push(['log', message]);
}
async function pollFreshVerificationCode() {
  calls.push('poll');
  return { code: '123456', emailTimestamp: 111 };
}
function throwIfStopped() {}
async function submitVerificationCode() {
  calls.push('submit');
  return {};
}
async function setState() {
  calls.push('set-state');
}
async function completeStepFromBackground() {
  calls.push('complete');
}

${bundle}

return {
  resolveVerificationStep,
  calls,
};
`)();

  await api.resolveVerificationStep(4, {}, { provider: '2925', label: '2925 邮箱' }, { requestFreshCodeFirst: true });

  const sequence = api.calls.filter((item) => typeof item === 'string');
  assert.deepEqual(sequence, ['resend', 'return-mail', 'poll', 'submit', 'set-state', 'complete']);
});

test('pollFreshVerificationCode 在下一轮重试前会先返回邮箱页', async () => {
  const bundle = [
    extractFunctionFromSource(backgroundSource, 'pollFreshVerificationCode'),
  ].join('\n');

  const api = new Function(`
const HOTMAIL_PROVIDER = 'hotmail-api';
const VERIFICATION_POLL_MAX_ROUNDS = 2;
const calls = [];
let sendRound = 0;

function getVerificationCodeStateKey(step) {
  return step === 4 ? 'lastSignupCode' : 'lastLoginCode';
}
function getVerificationPollPayload(step, state, overrides = {}) {
  return {
    filterAfterTimestamp: 0,
    ...overrides,
  };
}
async function sendToMailContentScriptResilient() {
  sendRound += 1;
  calls.push('send');
  if (sendRound === 1) {
    throw new Error('步骤 4：邮箱轮询结束，但未获取到验证码。');
  }
  return { code: '654321', emailTimestamp: 222 };
}
async function requestVerificationCodeResend() {
  calls.push('resend');
}
async function returnToMailPageAfterResend() {
  calls.push('return-mail');
}
async function addLog(message) {
  calls.push(['log', message]);
}
function getVerificationCodeLabel(step) {
  return step === 4 ? '注册' : '登录';
}
function isStopError() {
  return false;
}
function throwIfStopped() {}
function getHotmailVerificationPollConfig() {
  return {};
}
async function pollHotmailVerificationCode() {
  throw new Error('unexpected hotmail path');
}

${bundle}

return {
  pollFreshVerificationCode,
  calls,
};
`)();

  const result = await api.pollFreshVerificationCode(4, {}, { provider: '2925', label: '2925 邮箱' }, {});
  assert.equal(result.code, '654321');

  const sequence = api.calls.filter((item) => typeof item === 'string');
  assert.deepEqual(sequence, ['send', 'resend', 'return-mail', 'send']);
});
