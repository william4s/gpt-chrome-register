const assert = require('assert');
const fs = require('fs');

const backgroundSource = fs.readFileSync('background.js', 'utf8');
const signupPageSource = fs.readFileSync('content/signup-page.js', 'utf8');
const mail2925Source = fs.readFileSync('content/mail-2925.js', 'utf8');

function extractFunctionFromSource(sourceText, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map(marker => sourceText.indexOf(marker))
    .find(index => index >= 0);
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

function extractFunction(name) {
  return extractFunctionFromSource(backgroundSource, name);
}

function extractSignupPageFunction(name) {
  return extractFunctionFromSource(signupPageSource, name);
}

function extractMail2925Function(name) {
  return extractFunctionFromSource(mail2925Source, name);
}

async function testPollFreshVerificationCodeRethrowsStop() {
  const bundle = [
    extractFunction('isStopError'),
    extractFunction('throwIfStopped'),
    extractFunction('pollFreshVerificationCode'),
  ].join('\n');

  const api = new Function(`
let stopRequested = false;
const STOP_ERROR_MESSAGE = '流程已被用户停止。';
const HOTMAIL_PROVIDER = 'hotmail-api';
const VERIFICATION_POLL_MAX_ROUNDS = 5;
const logs = [];
let resendCalls = 0;

function getHotmailVerificationPollConfig() {
  return {};
}
async function pollHotmailVerificationCode() {
  throw new Error('hotmail path should not run in this test');
}
function getVerificationCodeStateKey(step) {
  return step === 4 ? 'lastSignupCode' : 'lastLoginCode';
}
function getVerificationPollPayload(step, state, overrides = {}) {
  return {
    filterAfterTimestamp: 123,
    ...overrides,
  };
}
async function sendToMailContentScriptResilient() {
  throw new Error(STOP_ERROR_MESSAGE);
}
async function requestVerificationCodeResend() {
  resendCalls += 1;
}
async function addLog(message, level) {
  logs.push({ message, level });
}
async function getTabId() {
  return null;
}
const chrome = { tabs: { update: async () => {} } };

${bundle}

return {
  pollFreshVerificationCode,
  snapshot() {
    return { logs, resendCalls };
  },
};
`)();

  let error = null;
  try {
    await api.pollFreshVerificationCode(7, {}, { provider: 'qq' }, {});
  } catch (err) {
    error = err;
  }

  const state = api.snapshot();
  assert.strictEqual(error?.message, '流程已被用户停止。', 'Stop 错误应原样向上抛出');
  assert.strictEqual(state.resendCalls, 0, 'Stop 后不应继续请求新的验证码');
  assert.deepStrictEqual(state.logs, [], 'Stop 后不应再记录普通失败或重试日志');
}

async function testResolveVerificationStepRethrowsStopFromFreshRequest() {
  const bundle = [
    extractFunction('isStopError'),
    extractFunction('resolveVerificationStep'),
  ].join('\n');

  const api = new Function(`
const STOP_ERROR_MESSAGE = '流程已被用户停止。';
const HOTMAIL_PROVIDER = 'hotmail-api';
const logs = [];
let pollCalls = 0;

function getVerificationCodeStateKey(step) {
  return step === 4 ? 'lastSignupCode' : 'lastLoginCode';
}
function getHotmailVerificationPollConfig() {
  return {};
}
function getVerificationCodeLabel(step) {
  return step === 4 ? '注册' : '登录';
}
function isRestartCurrentAttemptError() {
  return false;
}
function isStep7RestartFromStep6Error() {
  return false;
}
async function requestVerificationCodeResend() {
  throw new Error(STOP_ERROR_MESSAGE);
}
async function addLog(message, level) {
  logs.push({ message, level });
}
async function pollFreshVerificationCode() {
  pollCalls += 1;
  return { code: '123456', emailTimestamp: Date.now() };
}
async function submitVerificationCode() {
  throw new Error('submit should not run in this test');
}
async function setState() {}
async function completeStepFromBackground() {}

${bundle}

return {
  resolveVerificationStep,
  snapshot() {
    return { logs, pollCalls };
  },
};
`)();

  let error = null;
  try {
    await api.resolveVerificationStep(7, {}, { provider: 'qq' }, { requestFreshCodeFirst: true });
  } catch (err) {
    error = err;
  }

  const state = api.snapshot();
  assert.strictEqual(error?.message, '流程已被用户停止。', '首次请求新验证码收到 Stop 后应立即终止');
  assert.strictEqual(state.pollCalls, 0, 'Stop 后不应继续进入邮箱轮询');
  assert.deepStrictEqual(state.logs, [], 'Stop 后不应追加降级日志');
}

async function testWaitForVerificationSubmitOutcomeReturnsRestartCurrentAttempt() {
  const bundle = [
    extractSignupPageFunction('normalizeFlowStep'),
    extractSignupPageFunction('isSignupVerificationFlowStep'),
    extractSignupPageFunction('isLoginVerificationFlowStep'),
    extractSignupPageFunction('waitForVerificationSubmitOutcome'),
  ].join('\n');

  const api = new Function(`
let currentTime = 0;
let sleepCalls = 0;
const Date = {
  now() {
    return currentTime;
  },
};

function throwIfStopped() {}
function getVerificationErrorText() {
  return '';
}
function getStep7RestartCurrentAttemptSignal() {
  if (currentTime < 300) {
    return null;
  }
  return {
    restartCurrentAttempt: true,
    error: 'STEP7_RESTART_CURRENT_ATTEMPT::max_check_attempts_error_page::https://auth.openai.com/log-in',
  };
}
function getStep7RestartFromStep6Signal() {
  return null;
}
function isStep5Ready() {
  return false;
}
function isStep8Ready() {
  return false;
}
function isAddPhonePageReady() {
  return false;
}
function isVerificationPageStillVisible() {
  return false;
}
async function sleep(ms) {
  sleepCalls += 1;
  currentTime += ms;
}

${bundle}

return {
  waitForVerificationSubmitOutcome,
  snapshot() {
    return { currentTime, sleepCalls };
  },
};
`)();

  const outcome = await api.waitForVerificationSubmitOutcome(7, 300);
  const state = api.snapshot();

  assert.strictEqual(outcome.restartCurrentAttempt, true, '步骤 7 命中 max_check_attempts 错误页时应返回整轮重开信号');
  assert.match(outcome.error, /max_check_attempts/, '返回结果应保留 max_check_attempts marker');
  assert.strictEqual(state.currentTime, 300, '应在超时边界复查错误页，而不是直接按成功推定');
  assert.strictEqual(state.sleepCalls, 2, '应等待到超时边界后再做最终复查');
}

async function testWaitForSignupEmailInputOrLaterStateRecognizesAdvancedVerificationPage() {
  const bundle = [
    extractSignupPageFunction('isSignupStatePastEmailStep'),
    extractSignupPageFunction('waitForSignupEmailInputOrLaterState'),
  ].join('\n');

  const api = new Function(`
let currentTime = 0;
let sleepCalls = 0;
const Date = {
  now() {
    return currentTime;
  },
};

function throwIfStopped() {}
function getVisibleAuthEmailInput() {
  return null;
}
function inspectSignupVerificationState() {
  if (currentTime < 300) {
    return { state: 'unknown' };
  }
  return { state: 'verification' };
}
async function sleep(ms) {
  sleepCalls += 1;
  currentTime += ms;
}

${bundle}

return {
  waitForSignupEmailInputOrLaterState,
  snapshot() {
    return { currentTime, sleepCalls };
  },
};
`)();

  const result = await api.waitForSignupEmailInputOrLaterState(600);
  const state = api.snapshot();

  assert.strictEqual(result.state, 'verification', 'A2 等待期间若页面已进入验证码页，应直接识别为已越过邮箱页');
  assert.strictEqual(state.currentTime, 300, '应轮询到验证码页出现为止');
  assert.strictEqual(state.sleepCalls, 2, '应在页面切换期内继续轮询，而不是直接失败');
}

async function testWaitForSignupPasswordInputOrLaterStateRecognizesAdvancedVerificationPage() {
  const bundle = [
    extractSignupPageFunction('isSignupStatePastPasswordStep'),
    extractSignupPageFunction('waitForSignupPasswordInputOrLaterState'),
  ].join('\n');

  const api = new Function(`
let currentTime = 0;
let sleepCalls = 0;
const Date = {
  now() {
    return currentTime;
  },
};

function throwIfStopped() {}
function getVisibleAuthPasswordInput() {
  return null;
}
function getSignupPasswordSubmitButton() {
  return null;
}
function inspectSignupVerificationState() {
  if (currentTime < 300) {
    return { state: 'unknown' };
  }
  return { state: 'verification' };
}
async function sleep(ms) {
  sleepCalls += 1;
  currentTime += ms;
}

${bundle}

return {
  waitForSignupPasswordInputOrLaterState,
  snapshot() {
    return { currentTime, sleepCalls };
  },
};
`)();

  const result = await api.waitForSignupPasswordInputOrLaterState(600);
  const state = api.snapshot();

  assert.strictEqual(result.state, 'verification', 'A3 等待期间若页面已进入验证码页，应直接识别为已越过密码页');
  assert.strictEqual(state.currentTime, 300, '应轮询到验证码页出现为止');
  assert.strictEqual(state.sleepCalls, 2, '应在页面切换期内继续轮询，而不是直接失败');
}

async function testIsPostSignupSuccessPageAcceptsChatGptLandingWhenWindowStateAffectsVisibility() {
  const bundle = [
    extractSignupPageFunction('isChatGptAppLandingPage'),
    extractSignupPageFunction('isPostSignupSuccessPage'),
  ].join('\n');

  const api = new Function(`
const location = {
  hostname: 'chatgpt.com',
  pathname: '/',
};

function hasExitedStep5Form() {
  return true;
}
function getPageTextSnapshot() {
  return 'ChatGPT 可以帮助你写作 编程 总结 更多内容';
}
function isAddPhonePageReady() {
  return false;
}
function isStep8Ready() {
  return false;
}
function isPostSignupOnboardingPage() {
  return false;
}

${bundle}

return {
  isChatGptAppLandingPage,
  isPostSignupSuccessPage,
};
`)();

  assert.strictEqual(
    api.isChatGptAppLandingPage(),
    true,
    'chatgpt.com 落地页在已离开 step5 form 后应被识别为成功落地页'
  );
  assert.strictEqual(
    api.isPostSignupSuccessPage(),
    true,
    '即使窗口状态影响可见元素判断，A5 READY 重放到 chatgpt.com 落地页也应直接按成功处理'
  );
}

async function testMail2925SeenMailKeyIncludesMailContentBeyondItemId() {
  const bundle = [
    extractMail2925Function('normalizeMailIdentityPart'),
    extractMail2925Function('buildSeenMailKey'),
  ].join('\n');

  const api = new Function(`
${bundle}

return {
  buildSeenMailKey,
};
`)();

  const firstKey = api.buildSeenMailKey({
    itemId: 'row-1',
    itemTimestamp: 1710000000000,
    text: '你的 ChatGPT 代码为 123456',
    code: '123456',
  });
  const secondKey = api.buildSeenMailKey({
    itemId: 'row-1',
    itemTimestamp: 1710000060000,
    text: '你的 ChatGPT 代码为 654321',
    code: '654321',
  });

  assert.notStrictEqual(
    firstKey,
    secondKey,
    '2925 邮箱即使复用了同一个 itemId，只要新邮件时间或验证码变化，就不应被视为同一封已处理邮件'
  );
}

(async () => {
  await testPollFreshVerificationCodeRethrowsStop();
  await testResolveVerificationStepRethrowsStopFromFreshRequest();
  await testWaitForVerificationSubmitOutcomeReturnsRestartCurrentAttempt();
  await testWaitForSignupEmailInputOrLaterStateRecognizesAdvancedVerificationPage();
  await testWaitForSignupPasswordInputOrLaterStateRecognizesAdvancedVerificationPage();
  await testIsPostSignupSuccessPageAcceptsChatGptLandingWhenWindowStateAffectsVisibility();
  await testMail2925SeenMailKeyIncludesMailContentBeyondItemId();
  console.log('verification stop propagation tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
