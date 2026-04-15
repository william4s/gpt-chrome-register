// content/signup-page.js — Content script for OpenAI auth pages (steps 2, 3, 4-receive, 5)
// Injected on: auth0.openai.com, auth.openai.com, accounts.openai.com

console.log('[MultiPage:signup-page] Content script loaded on', location.href);

// Listen for commands from Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.type === 'EXECUTE_STEP'
    || message.type === 'FILL_CODE'
    || message.type === 'STEP8_FIND_AND_CLICK'
    || message.type === 'STEP8_GET_STATE'
    || message.type === 'STEP8_TRIGGER_CONTINUE'
    || message.type === 'PREPARE_LOGIN_CODE'
    || message.type === 'PREPARE_SIGNUP_VERIFICATION'
    || message.type === 'RESEND_VERIFICATION_CODE'
  ) {
    resetStopState();
    handleCommand(message).then((result) => {
      sendResponse({ ok: true, ...(result || {}) });
    }).catch(err => {
      if (isStopError(err)) {
        log(`步骤 ${message.step || 8}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }

      if (message.type === 'STEP8_FIND_AND_CLICK') {
        log(`步骤 8：${err.message}`, 'error');
        sendResponse({ error: err.message });
        return;
      }

      reportError(message.step, err.message);
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function handleCommand(message) {
  switch (message.type) {
    case 'EXECUTE_STEP':
      switch (message.step) {
        case 'A1': return await stepA1_logoutAndOpenSignup();
        case 'A2': return await stepA2_fillSignupEmail(message.payload);
        case 'A3': return await stepA3_fillSignupPassword(message.payload);
        case 'A5': return await step5_fillNameBirthday(message.payload, 'A5');
        case 2:
        case '2': return await step2_clickRegister();
        case 3:
        case '3': return await step3_fillEmailPassword(message.payload);
        case 5:
        case '5': return await step5_fillNameBirthday(message.payload, '5');
        case 6:
        case '6': return await step6_login(message.payload);
        case 8:
        case '8': return await step8_findAndClick();
        default: throw new Error(`signup-page.js 不处理步骤 ${message.step}`);
      }
    case 'FILL_CODE':
      // Step 4 = signup code, Step 7 = login code (same handler)
      return await fillVerificationCode(message.step, message.payload);
    case 'PREPARE_SIGNUP_VERIFICATION':
      return await prepareSignupVerificationFlow(message.step, message.payload);
    case 'PREPARE_LOGIN_CODE':
      return await prepareLoginCodeFlow();
    case 'RESEND_VERIFICATION_CODE':
      return await resendVerificationCode(message.step);
    case 'STEP8_FIND_AND_CLICK':
      return await step8_findAndClick();
    case 'STEP8_GET_STATE':
      return getStep8State();
    case 'STEP8_TRIGGER_CONTINUE':
      return await step8_triggerContinue(message.payload);
  }
}

const VERIFICATION_CODE_INPUT_SELECTOR = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[autocomplete="one-time-code"]',
  'input[type="text"][maxlength="6"]',
  'input[type="tel"][maxlength="6"]',
  'input[aria-label*="code" i]',
  'input[placeholder*="code" i]',
  'input[inputmode="numeric"]',
].join(', ');

const ONE_TIME_CODE_LOGIN_PATTERN = /使用一次性验证码登录|改用(?:一次性)?验证码(?:登录)?|使用验证码登录|一次性验证码|验证码登录|one[-\s]*time\s*(?:passcode|password|code)|use\s+(?:a\s+)?one[-\s]*time\s*(?:passcode|password|code)(?:\s+instead)?|use\s+(?:a\s+)?code(?:\s+instead)?|sign\s+in\s+with\s+(?:email|code)|email\s+(?:me\s+)?(?:a\s+)?code/i;

const RESEND_VERIFICATION_CODE_PATTERN = /重新发送(?:验证码)?|再次发送(?:验证码)?|重发(?:验证码)?|未收到(?:验证码|邮件)|resend(?:\s+code)?|send\s+(?:a\s+)?new\s+code|send\s+(?:it\s+)?again|request\s+(?:a\s+)?new\s+code|didn'?t\s+receive/i;
const ACTIONABLE_ELEMENT_SELECTOR = 'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]';
const SIGNUP_ENTRY_ACTION_PATTERN = /免\s*费\s*注\s*册|创\s*建\s*账\s*户|创\s*建\s*帐\s*户|注\s*册|sign\s*up|register|create\s*account|free\s*sign\s*up/i;
const PRIMARY_SIGNUP_ENTRY_ACTION_PATTERN = /免\s*费\s*注\s*册|创\s*建\s*账\s*户|创\s*建\s*帐\s*户|free\s*sign\s*up|create\s*account/i;
const WELCOME_DIALOG_PATTERN = /欢\s*迎\s*回\s*来|登\s*录\s*或\s*注\s*册|log\s*back\s*in|welcome\s*back|login\s*or\s*sign\s*up/i;

const AUTH_EMAIL_INPUT_SELECTOR = 'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i], input[placeholder*="Email"]';
const AUTH_PASSWORD_INPUT_SELECTOR = [
  'input[type="password"]',
  'input[name*="password" i]',
  'input[id*="password" i]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete*="password" i]',
  'input[aria-label*="密码" i]',
  'input[aria-label*="password" i]',
  'input[placeholder*="密码" i]',
  'input[placeholder*="password" i]',
  'input[data-testid*="password" i]',
].join(', ');
const AUTH_PASSWORD_FALLBACK_INPUT_SELECTOR = 'input:not([type="hidden"]):not([type="email"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])';
const AUTH_PASSWORD_TEXT_PATTERN = /密码|password/i;
const POST_SIGNUP_ONBOARDING_PATTERN = /是什么促使你使用\s*chatgpt|what\s+brings\s+you\s+to\s+chatgpt|让\s*chatgpt\s*更了解你|help\s+chatgpt\s+understand/i;
const POST_SIGNUP_ONBOARDING_ACTION_PATTERN = /下一步|跳过|next|skip/i;

function normalizeFlowStep(step) {
  const value = String(step ?? '').trim();
  return /^a[1-5]$/i.test(value) ? value.toUpperCase() : value;
}

function isSignupVerificationFlowStep(step) {
  const stepId = normalizeFlowStep(step);
  return stepId === '4' || stepId === 'A4';
}

function isLoginVerificationFlowStep(step) {
  return normalizeFlowStep(step) === '7';
}

function getVisibleAuthEmailInput() {
  return Array.from(document.querySelectorAll(AUTH_EMAIL_INPUT_SELECTOR)).find(isVisibleElement) || null;
}

function getVisibleAuthPasswordInput() {
  const directMatch = Array.from(document.querySelectorAll(AUTH_PASSWORD_INPUT_SELECTOR)).find(isWritableAuthInput);
  if (directMatch) {
    return directMatch;
  }

  return findLabeledAuthPasswordInput();
}

async function getAuthSubmitButton(timeout = 5000) {
  return document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|next|submit|continue with email|继续|下一步/i, timeout).catch(() => null);
}

function isVisibleElement(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0;
}

function isWritableAuthInput(el) {
  return el instanceof HTMLInputElement
    && isVisibleElement(el)
    && !el.disabled
    && el.readOnly !== true
    && el.type !== 'hidden'
    && el.type !== 'email'
    && el.type !== 'checkbox'
    && el.type !== 'radio'
    && el.type !== 'submit'
    && el.type !== 'button';
}

function findFirstWritableAuthInput(root) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return null;
  }

  return Array.from(root.querySelectorAll(AUTH_PASSWORD_FALLBACK_INPUT_SELECTOR)).find(isWritableAuthInput) || null;
}

function findLabeledAuthPasswordInput() {
  const labelCandidates = document.querySelectorAll('label, span, div, p');
  for (const labelEl of labelCandidates) {
    if (!isVisibleElement(labelEl)) continue;

    const labelText = normalizeInlineText(getActionText(labelEl));
    if (!labelText || !AUTH_PASSWORD_TEXT_PATTERN.test(labelText)) continue;

    const targetId = labelEl.getAttribute?.('for');
    if (targetId) {
      const target = document.getElementById(targetId);
      if (isWritableAuthInput(target)) {
        return target;
      }
    }

    if (labelEl.id) {
      const labelledMatch = Array.from(document.querySelectorAll(`[aria-labelledby~="${labelEl.id}"]`))
        .find(isWritableAuthInput);
      if (labelledMatch) {
        return labelledMatch;
      }
    }

    const scopedRoots = [
      labelEl.closest('label'),
      labelEl.closest('[data-rac]'),
      labelEl.closest('[role="group"]'),
      labelEl.parentElement,
      labelEl.closest('form'),
    ].filter(Boolean);

    for (const root of scopedRoots) {
      const input = findFirstWritableAuthInput(root);
      if (input) {
        return input;
      }
    }

    let sibling = labelEl.nextElementSibling;
    let siblingSearchCount = 0;
    while (sibling && siblingSearchCount < 3) {
      const siblingInput = findFirstWritableAuthInput(sibling);
      if (siblingInput) {
        return siblingInput;
      }
      sibling = sibling.nextElementSibling;
      siblingSearchCount += 1;
    }
  }

  return null;
}

async function waitForVisibleAuthPasswordInput(timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const input = getVisibleAuthPasswordInput();
    if (input) {
      return input;
    }

    await sleep(150);
  }

  return null;
}

function isSignupStatePastEmailStep(state) {
  return state === 'password' || state === 'verification' || state === 'step5' || state === 'email_exists';
}

function isSignupStatePastPasswordStep(state) {
  return state === 'verification' || state === 'step5' || state === 'email_exists';
}

async function waitForSignupEmailInputOrLaterState(timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (isSignupStatePastEmailStep(snapshot.state)) {
      return snapshot;
    }

    const emailInput = getVisibleAuthEmailInput();
    if (emailInput) {
      return { state: 'email', emailInput };
    }

    await sleep(150);
  }

  const finalSnapshot = inspectSignupVerificationState();
  if (isSignupStatePastEmailStep(finalSnapshot.state)) {
    return finalSnapshot;
  }

  const emailInput = getVisibleAuthEmailInput();
  if (emailInput) {
    return { state: 'email', emailInput };
  }

  return finalSnapshot;
}

async function waitForSignupPasswordInputOrLaterState(timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (isSignupStatePastPasswordStep(snapshot.state)) {
      return snapshot;
    }

    const passwordInput = snapshot.passwordInput || getVisibleAuthPasswordInput();
    if (passwordInput) {
      return {
        state: 'password',
        passwordInput,
        submitButton: snapshot.submitButton || getSignupPasswordSubmitButton({ allowDisabled: true }),
      };
    }

    await sleep(150);
  }

  const finalSnapshot = inspectSignupVerificationState();
  if (isSignupStatePastPasswordStep(finalSnapshot.state)) {
    return finalSnapshot;
  }

  const passwordInput = finalSnapshot.passwordInput || getVisibleAuthPasswordInput();
  if (passwordInput) {
    return {
      state: 'password',
      passwordInput,
      submitButton: finalSnapshot.submitButton || getSignupPasswordSubmitButton({ allowDisabled: true }),
    };
  }

  return finalSnapshot;
}

function getVerificationCodeTarget() {
  const codeInput = document.querySelector(VERIFICATION_CODE_INPUT_SELECTOR);
  if (codeInput && isVisibleElement(codeInput)) {
    return { type: 'single', element: codeInput };
  }

  const singleInputs = Array.from(document.querySelectorAll('input[maxlength="1"]'))
    .filter(isVisibleElement);
  if (singleInputs.length >= 6) {
    return { type: 'split', elements: singleInputs };
  }

  return null;
}

function getActionText(el) {
  return [
    el?.textContent,
    el?.value,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isActionEnabled(el) {
  return Boolean(el)
    && !el.disabled
    && el.getAttribute('aria-disabled') !== 'true';
}

function resolveActionableElement(el) {
  if (!el) return null;

  if (typeof el.matches === 'function' && el.matches(ACTIONABLE_ELEMENT_SELECTOR)) {
    return isVisibleElement(el) && isActionEnabled(el) ? el : null;
  }

  const nearestAction = typeof el.closest === 'function'
    ? el.closest(ACTIONABLE_ELEMENT_SELECTOR)
    : null;
  if (nearestAction && isVisibleElement(nearestAction) && isActionEnabled(nearestAction)) {
    return nearestAction;
  }

  if ((typeof el.onclick === 'function' || el.hasAttribute?.('onclick') || el.tabIndex >= 0)
    && isVisibleElement(el)
    && isActionEnabled(el)) {
    return el;
  }

  return null;
}

function findSignupEntryTrigger() {
  const candidates = document.querySelectorAll(ACTIONABLE_ELEMENT_SELECTOR);

  let fallback = null;
  for (const el of candidates) {
    if (!isVisibleElement(el) || !isActionEnabled(el)) continue;

    const text = getActionText(el);
    if (!text || !SIGNUP_ENTRY_ACTION_PATTERN.test(text)) continue;

    if (PRIMARY_SIGNUP_ENTRY_ACTION_PATTERN.test(text)) {
      return el;
    }

    if (!fallback) {
      fallback = el;
    }
  }

  return fallback;
}

function findSignupEntryTriggerByKeyword() {
  const candidates = document.querySelectorAll(
    `${ACTIONABLE_ELEMENT_SELECTOR}, div, span, p, strong, h1, h2, h3`
  );

  let fallback = null;
  for (const el of candidates) {
    if (!isVisibleElement(el)) continue;

    const text = getActionText(el);
    if (!text || !SIGNUP_ENTRY_ACTION_PATTERN.test(text)) continue;

    const actionEl = resolveActionableElement(el);
    if (!actionEl) continue;

    const actionText = getActionText(actionEl) || text;
    if (PRIMARY_SIGNUP_ENTRY_ACTION_PATTERN.test(text) || PRIMARY_SIGNUP_ENTRY_ACTION_PATTERN.test(actionText)) {
      return actionEl;
    }

    if (!fallback) {
      fallback = actionEl;
    }
  }

  return fallback;
}

function findWelcomeDialogSignupTrigger() {
  const dialogCandidates = document.querySelectorAll('div[role="dialog"], [aria-modal="true"], body > div, main div');

  for (const container of dialogCandidates) {
    if (!isVisibleElement(container)) continue;

    const containerText = getActionText(container);
    if (!containerText || !WELCOME_DIALOG_PATTERN.test(containerText)) continue;

    const actionCandidates = container.querySelectorAll(ACTIONABLE_ELEMENT_SELECTOR);
    let fallback = null;

    for (const actionEl of actionCandidates) {
      if (!isVisibleElement(actionEl) || !isActionEnabled(actionEl)) continue;

      const actionText = getActionText(actionEl);
      if (!actionText || !SIGNUP_ENTRY_ACTION_PATTERN.test(actionText)) continue;

      if (PRIMARY_SIGNUP_ENTRY_ACTION_PATTERN.test(actionText)) {
        return actionEl;
      }

      if (!fallback) {
        fallback = actionEl;
      }
    }

    if (fallback) {
      return fallback;
    }
  }

  return null;
}

async function waitForSignupEmailInput(timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (getVisibleAuthEmailInput()) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

function findOneTimeCodeLoginTrigger() {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  for (const el of candidates) {
    if (!isVisibleElement(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

    const text = [
      el.textContent,
      el.value,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && ONE_TIME_CODE_LOGIN_PATTERN.test(text)) {
      return el;
    }
  }

  return null;
}

function findResendVerificationCodeTrigger({ allowDisabled = false } = {}) {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  for (const el of candidates) {
    if (!isVisibleElement(el)) continue;
    if (!allowDisabled && !isActionEnabled(el)) continue;

    const text = getActionText(el);
    if (text && RESEND_VERIFICATION_CODE_PATTERN.test(text)) {
      return el;
    }
  }

  return null;
}

function isEmailVerificationPage() {
  return /\/email-verification(?:[/?#]|$)/i.test(location.pathname || '');
}

async function prepareLoginCodeFlow(timeout = 15000) {
  const readyTarget = getVerificationCodeTarget();
  if (readyTarget) {
    log('步骤 7：验证码输入框已就绪。');
    return { ready: true, mode: readyTarget.type };
  }

  if (isEmailVerificationPage() && isVerificationPageStillVisible()) {
    log('步骤 7：已进入邮箱验证码页面，正在等待验证码输入框或重发入口稳定。');
    return { ready: true, mode: 'verification_page' };
  }

  if (isAddPhonePageReady()) {
    log('步骤 7：检测到手机号页面，当前线程需要从步骤 A1 重新开始...', 'warn');
    return getStep7AddPhoneRestartCurrentAttemptSignal();
  }

  const initialRestartCurrentAttemptSignal = getStep7RestartCurrentAttemptSignal();
  if (initialRestartCurrentAttemptSignal) {
    log('步骤 7：检测到验证错误页（max_check_attempts），当前线程需要从步骤 1 重新开始...', 'warn');
    return initialRestartCurrentAttemptSignal;
  }

  const initialRestartSignal = getStep7RestartFromStep6Signal();
  if (initialRestartSignal) {
    log('步骤 7：检测到登录页超时报错，准备回到步骤 6 重新发起登录验证码流程...', 'warn');
    return initialRestartSignal;
  }

  const start = Date.now();
  let switchClickCount = 0;
  let lastSwitchAttemptAt = 0;
  let loggedPasswordPage = false;
  let loggedVerificationPage = false;
  let genericRetryClickCount = 0;
  const maxGenericRetries = 3;

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const target = getVerificationCodeTarget();
    if (target) {
      log('步骤 7：验证码页面已就绪。');
      return { ready: true, mode: target.type };
    }

    if (isEmailVerificationPage() && isVerificationPageStillVisible()) {
      if (!loggedVerificationPage) {
        loggedVerificationPage = true;
        log('步骤 7：页面已进入邮箱验证码流程，继续等待验证码输入框渲染...');
      }
      await sleep(250);
      continue;
    }

    if (isAddPhonePageReady()) {
      log('步骤 7：检测到手机号页面，当前线程需要从步骤 A1 重新开始...', 'warn');
      return getStep7AddPhoneRestartCurrentAttemptSignal();
    }

    const restartCurrentAttemptSignal = getStep7RestartCurrentAttemptSignal();
    if (restartCurrentAttemptSignal) {
      log('步骤 7：检测到验证错误页（max_check_attempts），当前线程需要从步骤 1 重新开始...', 'warn');
      return restartCurrentAttemptSignal;
    }

    const restartSignal = getStep7RestartFromStep6Signal();
    if (restartSignal) {
      log('步骤 7：检测到登录页超时报错，准备回到步骤 6 重新发起登录验证码流程...', 'warn');
      return restartSignal;
    }

    // 检测到通用错误页（如步骤 7 验证码提交时的 405 错误），自动点击"重试"
    const genericErrorRetryBtn = getAuthRetryButton({ allowDisabled: false });
    if (genericErrorRetryBtn && genericRetryClickCount < maxGenericRetries) {
      genericRetryClickCount += 1;
      log(`步骤 7：检测到 405 等异常错误页，正在点击"重试"（第 ${genericRetryClickCount}/${maxGenericRetries} 次）...`, 'warn');
      await humanPause(350, 900);
      simulateClick(genericErrorRetryBtn);
      await sleep(1500);
      continue;
    }

    if (genericErrorRetryBtn && genericRetryClickCount >= maxGenericRetries) {
      throw new Error(`步骤 7：页面持续报错，已重试 ${maxGenericRetries} 次仍未恢复，当前 URL: ${location.href}`);
    }

    const passwordInput = getVisibleAuthPasswordInput();
    const switchTrigger = findOneTimeCodeLoginTrigger();

    if (switchTrigger && (switchClickCount === 0 || Date.now() - lastSwitchAttemptAt > 1500)) {
      switchClickCount += 1;
      lastSwitchAttemptAt = Date.now();
      loggedPasswordPage = false;
      log('步骤 7：检测到密码页，正在切换到一次性验证码登录...');
      await humanPause(350, 900);
      const verificationRequestedAt = Date.now();
      simulateClick(switchTrigger);
      await sleep(1200);
      return { ready: true, mode: 'verification_switch', verificationRequestedAt };
    }

    if (passwordInput && !loggedPasswordPage) {
      loggedPasswordPage = true;
      log('步骤 7：正在等待密码页上的一次性验证码登录入口...');
    }

    await sleep(200);
  }

  throw new Error('无法切换到一次性验证码验证页面。URL: ' + location.href);
}

async function resendVerificationCode(step, timeout = 45000) {
  if (isLoginVerificationFlowStep(step)) {
    const prepareResult = await prepareLoginCodeFlow();
    if (prepareResult?.restartCurrentAttempt || prepareResult?.restartFromStep6) {
      return prepareResult;
    }
  }

  const start = Date.now();
  let action = null;
  let loggedWaiting = false;

  while (Date.now() - start < timeout) {
    throwIfStopped();
    action = findResendVerificationCodeTrigger({ allowDisabled: true });

    if (action && isActionEnabled(action)) {
      log(`步骤 ${step}：重新发送验证码按钮已可用。`);
      await humanPause(350, 900);
      simulateClick(action);
      await sleep(1200);
      return {
        resent: true,
        buttonText: getActionText(action),
      };
    }

    if (action && !loggedWaiting) {
      loggedWaiting = true;
      log(`步骤 ${step}：正在等待重新发送验证码按钮变为可点击...`);
    }

    await sleep(250);
  }

  throw new Error('无法点击重新发送验证码按钮。URL: ' + location.href);
}

// ============================================================
// Step 2: Click Register
// ============================================================

async function stepA1_logoutAndOpenSignup() {
  log('步骤 A1：正在等待 ChatGPT 首页或注册页就绪...');

  const start = Date.now();
  let lastDetectedActionText = '';
  while (Date.now() - start < 30000) {
    throwIfStopped();

    if (getVisibleAuthEmailInput()) {
      log('步骤 A1：当前已进入注册邮箱页。', 'ok');
      reportComplete('A1');
      return;
    }

    const registerBtn = findWelcomeDialogSignupTrigger()
      || findSignupEntryTrigger()
      || findSignupEntryTriggerByKeyword();

    if (registerBtn) {
      const actionText = getActionText(registerBtn) || '注册入口';
      if (actionText !== lastDetectedActionText) {
        lastDetectedActionText = actionText;
        log(`步骤 A1：检测到注册入口：${actionText}`);
      }
      await humanPause(450, 1200);
      simulateClick(registerBtn);
      log(`步骤 A1：已点击首页注册入口：${actionText}`);
      const emailReady = await waitForSignupEmailInput(8000);
      if (emailReady) {
        log('步骤 A1：点击后已进入注册邮箱页。', 'ok');
        reportComplete('A1');
        return;
      }
      log(`步骤 A1：点击“${actionText}”后仍未进入注册邮箱页，继续重试...`, 'warn');
    }

    await sleep(250);
  }

  throw new Error('未找到首页注册入口或注册邮箱输入框。URL: ' + location.href);
}

async function stepA2_fillSignupEmail(payload) {
  const { email } = payload || {};
  if (!email) throw new Error('未提供注册邮箱。');

  const currentSignupState = inspectSignupVerificationState();
  if (isSignupStatePastEmailStep(currentSignupState.state)) {
    log('步骤 A2：页面已越过邮箱页，本步骤按已完成处理。', 'ok');
    reportComplete('A2', { email });
    return;
  }

  log(`步骤 A2：正在填写注册邮箱：${email}`);

  const emailStage = await waitForSignupEmailInputOrLaterState(15000);
  if (isSignupStatePastEmailStep(emailStage.state)) {
    log('步骤 A2：等待期间页面已越过邮箱页，本步骤按已完成处理。', 'ok');
    reportComplete('A2', { email });
    return;
  }

  const emailInput = emailStage.emailInput || getVisibleAuthEmailInput();
  if (!emailInput) {
    throw new Error('在注册页未找到邮箱输入框。URL: ' + location.href);
  }

  await humanPause(500, 1400);
  fillInput(emailInput, email);
  log('步骤 A2：邮箱已填写');

  const submitBtn = await getAuthSubmitButton(5000);
  if (!submitBtn) {
    throw new Error('未找到注册邮箱提交按钮。URL: ' + location.href);
  }

  await sleep(500);
  await humanPause(400, 1100);
  simulateClick(submitBtn);
  log('步骤 A2：邮箱已提交，正在等待密码页...');

  const postSubmitState = await waitForSignupEmailStepResult(10000);
  if (isSignupStatePastEmailStep(postSubmitState.state)) {
    log('步骤 A2：提交后已进入下一阶段。', 'ok');
    reportComplete('A2', { email });
    return;
  }

  throw new Error('提交邮箱后仍未进入密码页。URL: ' + location.href);
}

async function waitForSignupEmailStepResult(timeout = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (snapshot.state === 'password' || snapshot.state === 'verification' || snapshot.state === 'step5' || snapshot.state === 'email_exists') {
      return snapshot;
    }

    await sleep(200);
  }

  return inspectSignupVerificationState();
}

async function waitForSignupPasswordSubmitResult(timeout = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (snapshot.state === 'verification' || snapshot.state === 'step5' || snapshot.state === 'email_exists' || snapshot.state === 'error') {
      return snapshot;
    }

    await sleep(200);
  }

  return inspectSignupVerificationState();
}

async function stepA3_fillSignupPassword(payload) {
  const { password } = payload || {};
  if (!password) throw new Error('步骤 A3 缺少可用密码。');

  const currentSignupState = inspectSignupVerificationState();
  if (isSignupStatePastPasswordStep(currentSignupState.state)) {
    log('步骤 A3：页面已越过密码页，本步骤按已完成处理。', 'ok');
    reportComplete('A3', { signupVerificationRequestedAt: Date.now() });
    return;
  }

  log('步骤 A3：正在填写注册密码...');
  const passwordStage = await waitForSignupPasswordInputOrLaterState(15000);
  if (isSignupStatePastPasswordStep(passwordStage.state)) {
    log('步骤 A3：等待期间页面已越过密码页，本步骤按已完成处理。', 'ok');
    reportComplete('A3', { signupVerificationRequestedAt: Date.now() });
    return;
  }

  const passwordInput = passwordStage.passwordInput || getVisibleAuthPasswordInput();
  if (!passwordInput) {
    throw new Error('提交邮箱后仍未找到密码输入框。URL: ' + location.href);
  }

  await humanPause(600, 1500);
  fillInput(passwordInput, password);
  log('步骤 A3：密码已填写');

  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|sign\s*up|submit|注册|创建|create/i, 5000).catch(() => null);
  if (!submitBtn) {
    throw new Error('未找到注册密码提交按钮。URL: ' + location.href);
  }

  await sleep(500);
  await humanPause(500, 1300);
  const signupVerificationRequestedAt = Date.now();
  simulateClick(submitBtn);
  log('步骤 A3：密码已提交，正在等待验证码页...');

  const postSubmitState = await waitForSignupPasswordSubmitResult(10000);
  if (postSubmitState.state === 'verification' || postSubmitState.state === 'step5' || postSubmitState.state === 'email_exists') {
    if (postSubmitState.state === 'email_exists') {
      log('步骤 A3：提交后进入账号已存在状态，交由步骤 A4 自动恢复。', 'warn');
    } else {
      log('步骤 A3：提交后已进入下一阶段。', 'ok');
    }
    reportComplete('A3', { signupVerificationRequestedAt });
    return;
  }

  if (postSubmitState.state === 'error') {
    throw new Error('提交密码后页面返回错误状态，请重试。');
  }

  throw new Error('提交密码后仍未离开密码页。URL: ' + location.href);
}

async function step2_clickRegister() {
  log('步骤 2：正在查找注册按钮...');

  let registerBtn = null;
  try {
    registerBtn = await waitForElementByText(
      'a, button, [role="button"], [role="link"]',
      /sign\s*up|register|create\s*account|注册/i,
      10000
    );
  } catch {
    // Some pages may have a direct link
    try {
      registerBtn = await waitForElement('a[href*="signup"], a[href*="register"]', 5000);
    } catch {
      throw new Error(
        '未找到注册按钮。' +
        '请在 DevTools 中检查认证页面 DOM。URL: ' + location.href
      );
    }
  }

  await humanPause(450, 1200);
  reportComplete(2);
  simulateClick(registerBtn);
  log('步骤 2：已点击注册按钮');
}

// ============================================================
// Step 3: Fill Email & Password
// ============================================================

async function step3_fillEmailPassword(payload) {
  const { email } = payload;
  if (!email) throw new Error('未提供邮箱地址，请先在侧边栏粘贴邮箱。');

  log(`步骤 3：正在填写邮箱：${email}`);

  // Find email input
  let emailInput = null;
  try {
    emailInput = await waitForElement(
      'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email"], input[placeholder*="Email"]',
      10000
    );
  } catch {
    throw new Error('在注册页未找到邮箱输入框。URL: ' + location.href);
  }

  await humanPause(500, 1400);
  fillInput(emailInput, email);
  log('步骤 3：邮箱已填写');

  // Check if password field is on the same page
  let passwordInput = getVisibleAuthPasswordInput();

  if (!passwordInput) {
    // Need to submit email first to get to password page
    log('步骤 3：暂未发现密码输入框，先提交邮箱...');
    const submitBtn = document.querySelector('button[type="submit"]')
      || await waitForElementByText('button', /continue|next|submit|继续|下一步/i, 5000).catch(() => null);

    if (submitBtn) {
      await humanPause(400, 1100);
      simulateClick(submitBtn);
      log('步骤 3：邮箱已提交，正在等待密码输入框...');
      await sleep(2000);
    }

    try {
      passwordInput = await waitForVisibleAuthPasswordInput(10000);
    } catch {
      throw new Error('提交邮箱后仍未找到密码输入框。URL: ' + location.href);
    }
  }

  if (!payload.password) throw new Error('未提供密码，步骤 3 需要可用密码。');
  await humanPause(600, 1500);
  fillInput(passwordInput, payload.password);
  log('步骤 3：密码已填写');

  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|sign\s*up|submit|注册|创建|create/i, 5000).catch(() => null);

  // Report complete BEFORE submit, because submit causes page navigation
  // which kills the content script connection
  const signupVerificationRequestedAt = submitBtn ? Date.now() : null;
  reportComplete(3, { email, signupVerificationRequestedAt });

  // Submit the form (page will navigate away after this)
  await sleep(500);
  if (submitBtn) {
    await humanPause(500, 1300);
    simulateClick(submitBtn);
    log('步骤 3：表单已提交');
  }
}

// ============================================================
// Fill Verification Code (used by step 4 and step 7)
// ============================================================

const INVALID_VERIFICATION_CODE_PATTERN = /代码不正确|验证码不正确|验证码错误|code\s+(?:is\s+)?incorrect|invalid\s+code|incorrect\s+code|try\s+again/i;
const VERIFICATION_PAGE_PATTERN = /检查您的收件箱|输入我们刚刚向|重新发送电子邮件|重新发送验证码|验证码|代码不正确|email\s+verification/i;
const OAUTH_CONSENT_PAGE_PATTERN = /使用\s*ChatGPT\s*登录到\s*Codex|sign\s+in\s+to\s+codex(?:\s+with\s+chatgpt)?|login\s+to\s+codex|log\s+in\s+to\s+codex|authorize|授权/i;
const OAUTH_CONSENT_FORM_SELECTOR = 'form[action*="/sign-in-with-chatgpt/" i][action*="/consent" i]';
const CONTINUE_ACTION_PATTERN = /继续|continue/i;
const ADD_PHONE_PAGE_PATTERN = /add[\s-]*phone|添加手机号|手机号码|手机号|phone\s+number|telephone/i;
const STEP5_SUBMIT_ERROR_PATTERN = /无法根据该信息创建帐户|请重试|unable\s+to\s+create\s+(?:your\s+)?account|couldn'?t\s+create\s+(?:your\s+)?account|something\s+went\s+wrong|invalid\s+(?:birthday|birth|date)|生日|出生日期/i;
const AUTH_TIMEOUT_ERROR_TITLE_PATTERN = /糟糕，出错了|something\s+went\s+wrong|oops/i;
const AUTH_TIMEOUT_ERROR_DETAIL_PATTERN = /operation\s+timed\s+out|timed\s+out|请求超时|操作超时/i;
const AUTH_MAX_CHECK_ATTEMPTS_ERROR_PATTERN = /max_check_attempts|验证过程中出错|error\s+during\s+verification|verification\s+process/i;
const SIGNUP_EMAIL_EXISTS_PATTERN = /与此电子邮件地址相关联的帐户已存在|account\s+associated\s+with\s+this\s+email\s+address\s+already\s+exists|email\s+address.*already\s+exists/i;

function getVerificationErrorText() {
  const messages = [];
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[data-invalid="true"] + *',
    '[aria-invalid="true"] + *',
    '[class*="error"]',
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        messages.push(text);
      }
    });
  }

  const invalidInput = document.querySelector(`${VERIFICATION_CODE_INPUT_SELECTOR}[aria-invalid="true"], ${VERIFICATION_CODE_INPUT_SELECTOR}[data-invalid="true"]`);
  if (invalidInput) {
    const wrapper = invalidInput.closest('form, [data-rac], ._root_18qcl_51, div');
    if (wrapper) {
      const text = (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        messages.push(text);
      }
    }
  }

  return messages.find((text) => INVALID_VERIFICATION_CODE_PATTERN.test(text)) || '';
}

function isStep5Ready() {
  return Boolean(
    document.querySelector('input[name="name"], input[autocomplete="name"], input[name="birthday"], input[name="age"], [role="spinbutton"][data-type="year"]')
  );
}

function getPageTextSnapshot() {
  return (document.body?.innerText || document.body?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getOAuthConsentForm() {
  return document.querySelector(OAUTH_CONSENT_FORM_SELECTOR);
}

function getPrimaryContinueButton() {
  const consentForm = getOAuthConsentForm();
  if (consentForm) {
    const formButtons = Array.from(
      consentForm.querySelectorAll('button[type="submit"], input[type="submit"], [role="button"]')
    );

    const formContinueButton = formButtons.find((el) => {
      if (!isVisibleElement(el)) return false;

      const ddActionName = el.getAttribute?.('data-dd-action-name') || '';
      return ddActionName === 'Continue' || CONTINUE_ACTION_PATTERN.test(getActionText(el));
    });
    if (formContinueButton) {
      return formContinueButton;
    }

    const firstVisibleSubmit = formButtons.find(isVisibleElement);
    if (firstVisibleSubmit) {
      return firstVisibleSubmit;
    }
  }

  const continueBtn = document.querySelector(
    `${OAUTH_CONSENT_FORM_SELECTOR} button[type="submit"], button[type="submit"][data-dd-action-name="Continue"], button[type="submit"]._primary_3rdp0_107`
  );
  if (continueBtn && isVisibleElement(continueBtn)) {
    return continueBtn;
  }

  const buttons = document.querySelectorAll('button, [role="button"]');
  return Array.from(buttons).find((el) => {
    if (!isVisibleElement(el)) return false;

    const ddActionName = el.getAttribute?.('data-dd-action-name') || '';
    return ddActionName === 'Continue' || CONTINUE_ACTION_PATTERN.test(getActionText(el));
  }) || null;
}

function isOAuthConsentPage() {
  const pageText = getPageTextSnapshot();
  if (OAUTH_CONSENT_PAGE_PATTERN.test(pageText)) {
    return true;
  }

  if (getOAuthConsentForm()) {
    return true;
  }

  return /\bcodex\b/i.test(pageText) && /\bchatgpt\b/i.test(pageText) && Boolean(getPrimaryContinueButton());
}

function isVerificationPageStillVisible() {
  // 如果页面有"重试"按钮（如 405 错误页），即使 URL 或文本包含 email-verification，
  // 也不能误判为验证码页面仍可见，否用步骤 4 无法进入 error 恢复流程
  if (getAuthRetryButton({ allowDisabled: true })) return false;

  if (getVerificationCodeTarget()) return true;
  if (findResendVerificationCodeTrigger({ allowDisabled: true })) return true;
  if (document.querySelector('form[action*="email-verification" i]')) return true;

  return VERIFICATION_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isAddPhonePageReady() {
  const path = `${location.pathname || ''} ${location.href || ''}`;
  if (/\/add-phone(?:[/?#]|$)/i.test(path)) return true;

  const phoneInput = document.querySelector(
    'input[type="tel"]:not([maxlength="6"]), input[name*="phone" i], input[id*="phone" i], input[autocomplete="tel"]'
  );
  if (phoneInput && isVisibleElement(phoneInput)) {
    return true;
  }

  return ADD_PHONE_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isPostSignupOnboardingPage() {
  const pageText = getPageTextSnapshot();
  if (!POST_SIGNUP_ONBOARDING_PATTERN.test(pageText)) {
    return false;
  }

  return Array.from(document.querySelectorAll(ACTIONABLE_ELEMENT_SELECTOR))
    .some((el) => isVisibleElement(el) && POST_SIGNUP_ONBOARDING_ACTION_PATTERN.test(getActionText(el)));
}

function hasExitedStep5Form() {
  return !isStep5Ready()
    && !isVerificationPageStillVisible()
    && !isSignupPasswordPage();
}

function isPostSignupSuccessPage() {
  if (isAddPhonePageReady() || isStep8Ready() || isPostSignupOnboardingPage()) {
    return true;
  }

  if (!hasExitedStep5Form()) {
    return false;
  }

  const pageText = getPageTextSnapshot();
  if (pageText.length < 40) {
    return false;
  }

  return Array.from(document.querySelectorAll(ACTIONABLE_ELEMENT_SELECTOR))
    .some((el) => isVisibleElement(el) && getActionText(el));
}

function isLoginPage() {
  return /\/log-in(?:[/?#]|$)/i.test(location.pathname || '');
}

function isStep8Ready() {
  const continueBtn = getPrimaryContinueButton();
  if (!continueBtn) return false;
  if (isVerificationPageStillVisible()) return false;
  if (isAddPhonePageReady()) return false;

  return isOAuthConsentPage();
}

function normalizeInlineText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function findBirthdayReactAriaSelect(labelText) {
  const normalizedLabel = normalizeInlineText(labelText);
  const roots = document.querySelectorAll('.react-aria-Select');

  for (const root of roots) {
    const labelEl = Array.from(root.querySelectorAll('span')).find((el) => normalizeInlineText(el.textContent) === normalizedLabel);
    if (!labelEl) continue;

    const item = root.closest('[class*="selectItem"], ._selectItem_ppsls_113') || root.parentElement;
    const nativeSelect = item?.querySelector('[data-testid="hidden-select-container"] select') || null;
    const button = root.querySelector('button[aria-haspopup="listbox"]') || null;
    const valueEl = root.querySelector('.react-aria-SelectValue') || null;

    return { root, item, labelEl, nativeSelect, button, valueEl };
  }

  return null;
}

async function setReactAriaBirthdaySelect(control, value) {
  if (!control?.nativeSelect) {
    throw new Error('未找到可写入的生日下拉框。');
  }

  const desiredValue = String(value);
  const option = Array.from(control.nativeSelect.options).find((item) => item.value === desiredValue);
  if (!option) {
    throw new Error(`生日下拉框中不存在值 ${desiredValue}。`);
  }

  control.nativeSelect.value = desiredValue;
  option.selected = true;
  control.nativeSelect.dispatchEvent(new Event('input', { bubbles: true }));
  control.nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(120);
}

function getStep5ErrorText() {
  const messages = [];
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[id$="-errors"]',
    '[role="alert"]',
    '[aria-live="assertive"]',
    '[aria-live="polite"]',
    '[class*="error"]',
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      if (!isVisibleElement(el)) return;
      const text = normalizeInlineText(el.textContent);
      if (text) {
        messages.push(text);
      }
    });
  }

  const invalidField = Array.from(document.querySelectorAll('[aria-invalid="true"], [data-invalid="true"]'))
    .find((el) => isVisibleElement(el));
  if (invalidField) {
    const wrapper = invalidField.closest('form, fieldset, [data-rac], div');
    if (wrapper) {
      const text = normalizeInlineText(wrapper.textContent);
      if (text) {
        messages.push(text);
      }
    }
  }

  return messages.find((text) => STEP5_SUBMIT_ERROR_PATTERN.test(text)) || '';
}

async function waitForStep5SubmitOutcome(timeout = 15000, options = {}) {
  const { successGraceMs = 5000, initialUrl = '' } = options || {};
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const errorText = getStep5ErrorText();
    if (errorText) {
      return { invalidProfile: true, errorText };
    }

    if (isPostSignupSuccessPage()) {
      return {
        success: true,
        addPhonePage: isAddPhonePageReady(),
        onboardingPage: isPostSignupOnboardingPage(),
      };
    }

    if (isStep8Ready()) {
      return { success: true };
    }

    if (Date.now() - start >= successGraceMs) {
      const pageText = getPageTextSnapshot();
      const urlChanged = initialUrl && location.href !== initialUrl;
      if (isPostSignupSuccessPage() || (hasExitedStep5Form() && (urlChanged || pageText.length >= 20))) {
        return { success: true, assumed: true, urlChanged };
      }
    }

    await sleep(150);
  }

  const errorText = getStep5ErrorText();
  if (errorText) {
    return { invalidProfile: true, errorText };
  }

  if (isPostSignupSuccessPage() || hasExitedStep5Form()) {
    return { success: true, assumed: true, urlChanged: Boolean(initialUrl && location.href !== initialUrl) };
  }

  return {
    invalidProfile: true,
    errorText: '提交后未进入下一阶段，请检查生日是否真正被页面接受。',
  };
}

function isSignupPasswordPage() {
  return /\/create-account\/password(?:[/?#]|$)/i.test(location.pathname || '');
}

function getSignupPasswordInput() {
  return getVisibleAuthPasswordInput();
}

function getSignupPasswordSubmitButton({ allowDisabled = false } = {}) {
  const direct = document.querySelector('button[type="submit"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll('button, [role="button"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    const text = getActionText(el);
    return /继续|continue|submit|创建|create/i.test(text);
  }) || null;
}

function getAuthRetryButton({ allowDisabled = false } = {}) {
  const direct = document.querySelector('button[data-dd-action-name="Try again"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll('button, [role="button"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    const text = getActionText(el);
    return /重试|try\s+again/i.test(text);
  }) || null;
}

function matchesAuthTimeoutErrorPage(pathPattern) {
  if (!pathPattern.test(location.pathname || '')) return false;
  const text = getPageTextSnapshot();
  return Boolean(
    getAuthRetryButton({ allowDisabled: true })
    && (AUTH_TIMEOUT_ERROR_TITLE_PATTERN.test(text)
      || AUTH_TIMEOUT_ERROR_DETAIL_PATTERN.test(text)
      || AUTH_TIMEOUT_ERROR_TITLE_PATTERN.test(document.title || ''))
  );
}

function matchesAuthMaxCheckAttemptsErrorPage(pathPattern) {
  if (!pathPattern.test(location.pathname || '')) return false;
  const text = getPageTextSnapshot();
  return Boolean(
    getAuthRetryButton({ allowDisabled: true })
    && AUTH_MAX_CHECK_ATTEMPTS_ERROR_PATTERN.test(text)
  );
}

function isSignupPasswordErrorPage() {
  return matchesAuthTimeoutErrorPage(/\/create-account\/password(?:[/?#]|$)/i);
}

function buildStep7RestartCurrentAttemptMarker(reason, url = location.href) {
  return `STEP7_RESTART_CURRENT_ATTEMPT::${reason || 'unknown'}::${url || ''}`;
}

function getStep7AddPhoneRestartCurrentAttemptSignal(url = location.href) {
  return {
    error: buildStep7RestartCurrentAttemptMarker('add_phone_page', url),
    restartCurrentAttempt: true,
    reason: 'add_phone_page',
    url,
  };
}

function getStep7RestartCurrentAttemptSignal() {
  if (!isLoginPage() || !matchesAuthMaxCheckAttemptsErrorPage(/\/log-in(?:[/?#]|$)/i)) {
    return null;
  }

  return {
    error: buildStep7RestartCurrentAttemptMarker('max_check_attempts_error_page', location.href),
    restartCurrentAttempt: true,
    reason: 'max_check_attempts_error_page',
    url: location.href,
  };
}

function buildStep7RestartFromStep6Marker(reason, url = location.href) {
  return `STEP7_RESTART_FROM_STEP6::${reason || 'unknown'}::${url || ''}`;
}

function getStep7RestartFromStep6Signal() {
  if (!isLoginPage() || !matchesAuthTimeoutErrorPage(/\/log-in(?:[/?#]|$)/i)) {
    return null;
  }

  return {
    error: buildStep7RestartFromStep6Marker('login_timeout_error_page', location.href),
    restartFromStep6: true,
    reason: 'login_timeout_error_page',
    url: location.href,
  };
}

function isSignupEmailAlreadyExistsPage() {
  return isSignupPasswordPage() && SIGNUP_EMAIL_EXISTS_PATTERN.test(getPageTextSnapshot());
}

function inspectSignupVerificationState() {
  if (isStep5Ready()) {
    return { state: 'step5' };
  }

  if (isVerificationPageStillVisible()) {
    return { state: 'verification' };
  }

  if (isSignupPasswordErrorPage()) {
    return {
      state: 'error',
      retryButton: getAuthRetryButton({ allowDisabled: true }),
    };
  }

  if (isSignupEmailAlreadyExistsPage()) {
    return { state: 'email_exists' };
  }

  const genericRetryButton = getAuthRetryButton({ allowDisabled: true });
  if (genericRetryButton) {
    return {
      state: 'error',
      retryButton: genericRetryButton,
    };
  }

  const passwordInput = getSignupPasswordInput();
  if (passwordInput) {
    return {
      state: 'password',
      passwordInput,
      submitButton: getSignupPasswordSubmitButton({ allowDisabled: true }),
    };
  }

  return { state: 'unknown' };
}

async function waitForSignupVerificationTransition(timeout = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (snapshot.state === 'step5' || snapshot.state === 'verification' || snapshot.state === 'error' || snapshot.state === 'email_exists') {
      return snapshot;
    }

    await sleep(200);
  }

  return inspectSignupVerificationState();
}

async function prepareSignupVerificationFlow(step = '4', payload = {}, timeout = 30000) {
  const stepId = normalizeFlowStep(step);
  const { password } = payload;
  const start = Date.now();
  let recoveryRound = 0;
  const maxRecoveryRounds = 3;

  while (Date.now() - start < timeout && recoveryRound < maxRecoveryRounds) {
    throwIfStopped();

    const roundNo = recoveryRound + 1;
    log(`步骤 ${stepId}：等待页面进入验证码阶段（第 ${roundNo}/${maxRecoveryRounds} 轮，先等待 5 秒）...`, 'info');
    const snapshot = await waitForSignupVerificationTransition(5000);

    if (snapshot.state === 'step5') {
      log(`步骤 ${stepId}：页面已进入验证码后的下一阶段，本步骤按已完成处理。`, 'ok');
      return { ready: true, alreadyVerified: true, retried: recoveryRound };
    }

    if (snapshot.state === 'verification') {
      log(`步骤 ${stepId}：验证码页面已就绪${recoveryRound ? `（期间自动恢复 ${recoveryRound} 次）` : ''}。`, 'ok');
      return { ready: true, retried: recoveryRound };
    }

    if (snapshot.state === 'email_exists' && stepId === 'A4') {
      log('步骤 A4：检测到步骤 3 提交后仍停留在注册密码页，准备重新走 OAuth 的步骤 1 和 2，再回到验证码流程。', 'warn');
      return {
        ready: false,
        recoverViaOauthEntry: true,
        retried: recoveryRound,
      };
    }

    if (snapshot.state === 'email_exists') {
      throw new Error('当前邮箱已存在，需要重新开始新一轮。');
    }

    recoveryRound += 1;

    if (snapshot.state === 'error') {
      if (snapshot.retryButton && isActionEnabled(snapshot.retryButton)) {
        log(`步骤 ${stepId}：检测到密码页超时报错，正在点击“重试”（第 ${recoveryRound}/${maxRecoveryRounds} 次）...`, 'warn');
        await humanPause(350, 900);
        simulateClick(snapshot.retryButton);
        await sleep(1200);
        continue;
      }

      log(`步骤 ${stepId}：检测到异常页，但“重试”按钮暂不可用，准备继续等待（${recoveryRound}/${maxRecoveryRounds}）...`, 'warn');
      continue;
    }

    if (snapshot.state === 'password') {
      if (!password) {
        throw new Error('当前回到了密码页，但没有可用密码，无法自动重新提交。');
      }

      if ((snapshot.passwordInput.value || '') !== password) {
        log(`步骤 ${stepId}：页面仍停留在密码页，正在重新填写密码...`, 'warn');
        await humanPause(450, 1100);
        fillInput(snapshot.passwordInput, password);
      }

      if (snapshot.submitButton && isActionEnabled(snapshot.submitButton)) {
        log(`步骤 ${stepId}：页面仍停留在密码页，正在重新点击“继续”（第 ${recoveryRound}/${maxRecoveryRounds} 次）...`, 'warn');
        await humanPause(350, 900);
        simulateClick(snapshot.submitButton);
        await sleep(1200);
        continue;
      }

      log(`步骤 ${stepId}：页面仍停留在密码页，但“继续”按钮暂不可用，准备继续等待（${recoveryRound}/${maxRecoveryRounds}）...`, 'warn');
      continue;
    }

    log(`步骤 ${stepId}：页面仍在切换中，准备继续等待（${recoveryRound}/${maxRecoveryRounds}）...`, 'warn');
  }

  throw new Error(`等待注册验证码页面就绪超时或自动恢复失败（已尝试 ${recoveryRound}/${maxRecoveryRounds} 轮）。URL: ${location.href}`);
}


async function waitForVerificationSubmitOutcome(step, timeout) {
  const resolvedTimeout = timeout ?? (isLoginVerificationFlowStep(step) ? 30000 : 12000);
  const start = Date.now();

  while (Date.now() - start < resolvedTimeout) {
    throwIfStopped();

    const errorText = getVerificationErrorText();
    if (errorText) {
      return { invalidCode: true, errorText };
    }

    if (isLoginVerificationFlowStep(step)) {
      const restartCurrentAttemptSignal = getStep7RestartCurrentAttemptSignal();
      if (restartCurrentAttemptSignal) {
        return restartCurrentAttemptSignal;
      }

      const restartFromStep6Signal = getStep7RestartFromStep6Signal();
      if (restartFromStep6Signal) {
        return restartFromStep6Signal;
      }
    }

    if (isSignupVerificationFlowStep(step) && isStep5Ready()) {
      return { success: true };
    }

    if (isLoginVerificationFlowStep(step) && isStep8Ready()) {
      return { success: true };
    }

    if (isLoginVerificationFlowStep(step) && isAddPhonePageReady()) {
      return getStep7AddPhoneRestartCurrentAttemptSignal();
    }

    await sleep(150);
  }

  if (isLoginVerificationFlowStep(step)) {
    const restartCurrentAttemptSignal = getStep7RestartCurrentAttemptSignal();
    if (restartCurrentAttemptSignal) {
      return restartCurrentAttemptSignal;
    }

    const restartFromStep6Signal = getStep7RestartFromStep6Signal();
    if (restartFromStep6Signal) {
      return restartFromStep6Signal;
    }
  }

  if (isVerificationPageStillVisible()) {
    return {
      invalidCode: true,
      errorText: getVerificationErrorText() || '提交后仍停留在验证码页面，准备重新发送验证码。',
    };
  }

  return { success: true, assumed: true };
}

async function fillVerificationCode(step, payload) {
  const { code } = payload;
  if (!code) throw new Error('未提供验证码。');

  log(`步骤 ${step}：正在填写验证码：${code}`);

  if (isLoginVerificationFlowStep(step)) {
    const prepareResult = await prepareLoginCodeFlow();
    if (prepareResult?.restartCurrentAttempt || prepareResult?.restartFromStep6) {
      return prepareResult;
    }
  }

  // Find code input — could be a single input or multiple separate inputs
  let codeInput = null;
  try {
    codeInput = await waitForElement(VERIFICATION_CODE_INPUT_SELECTOR, 10000);
  } catch {
    // Check for multiple single-digit inputs (common pattern)
    const singleInputs = document.querySelectorAll('input[maxlength="1"]');
    if (singleInputs.length >= 6) {
      log(`步骤 ${step}：发现分开的单字符验证码输入框，正在逐个填写...`);
      for (let i = 0; i < 6 && i < singleInputs.length; i++) {
        fillInput(singleInputs[i], code[i]);
        await sleep(100);
      }
      const outcome = await waitForVerificationSubmitOutcome(step);
      if (outcome.restartCurrentAttempt) {
        if (outcome.reason === 'add_phone_page') {
          log('步骤 7：检测到手机号页面，当前线程需要从步骤 A1 重新开始。', 'warn');
        } else {
          log('步骤 7：检测到验证错误页（max_check_attempts），当前线程需要从步骤 1 重新开始。', 'warn');
        }
      } else if (outcome.restartFromStep6) {
        log('步骤 7：检测到登录页超时报错，准备回到步骤 6 重新发起登录验证码流程...', 'warn');
      } else if (outcome.invalidCode) {
        log(`步骤 ${step}：验证码被拒绝：${outcome.errorText}`, 'warn');
      } else {
        log(`步骤 ${step}：验证码已通过${outcome.assumed ? '（按成功推定）' : ''}。`, 'ok');
      }
      return outcome;
    }
    throw new Error('未找到验证码输入框。URL: ' + location.href);
  }

  fillInput(codeInput, code);
  log(`步骤 ${step}：验证码已填写`);

  // Report complete BEFORE submit (page may navigate away)

  // Submit
  await sleep(500);
  const submitBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /verify|confirm|submit|continue|确认|验证/i, 5000).catch(() => null);

  if (submitBtn) {
    await humanPause(450, 1200);
    simulateClick(submitBtn);
    log(`步骤 ${step}：验证码已提交`);
  }

  const outcome = await waitForVerificationSubmitOutcome(step);
  if (outcome.restartCurrentAttempt) {
    if (outcome.reason === 'add_phone_page') {
      log('步骤 7：检测到手机号页面，当前线程需要从步骤 A1 重新开始。', 'warn');
    } else {
      log('步骤 7：检测到验证错误页（max_check_attempts），当前线程需要从步骤 1 重新开始。', 'warn');
    }
  } else if (outcome.restartFromStep6) {
    log('步骤 7：检测到登录页超时报错，准备回到步骤 6 重新发起登录验证码流程...', 'warn');
  } else if (outcome.invalidCode) {
    log(`步骤 ${step}：验证码被拒绝：${outcome.errorText}`, 'warn');
  } else {
    log(`步骤 ${step}：验证码已通过${outcome.assumed ? '（按成功推定）' : ''}。`, 'ok');
  }

  return outcome;
}

// ============================================================
// Step 6: Login with registered account (on OAuth auth page)
// ============================================================

async function step6_login(payload) {
  const { email } = payload;
  if (!email) throw new Error('登录时缺少邮箱地址。');

  log(`步骤 6：正在使用 ${email} 登录...`);

  // Wait for email input on the auth page
  let emailInput = null;
  try {
    emailInput = await waitForElement(
      'input[type="email"], input[name="email"], input[name="username"], input[id*="email"], input[placeholder*="email" i], input[placeholder*="Email"]',
      15000
    );
  } catch {
    throw new Error('在登录页未找到邮箱输入框。URL: ' + location.href);
  }

  await humanPause(500, 1400);
  fillInput(emailInput, email);
  log('步骤 6：邮箱已填写');

  // Submit email
  await sleep(500);
  const submitBtn1 = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /continue|next|submit|继续|下一步/i, 5000).catch(() => null);
  if (submitBtn1) {
    await humanPause(400, 1100);
    simulateClick(submitBtn1);
    log('步骤 6：邮箱已提交');
  }

  await sleep(2000);

  // 检测到密码页时，优先点击"使用一次性验证码登录"跳过密码输入
  const passwordInput = getVisibleAuthPasswordInput();
  if (passwordInput) {
    log('步骤 6：检测到密码页面，正在查找一次性验证码登录入口...');
    let otpTrigger = findOneTimeCodeLoginTrigger();

    // 首次未找到时，等待一小段时间后重试
    if (!otpTrigger) {
      await sleep(1500);
      otpTrigger = findOneTimeCodeLoginTrigger();
    }

    if (otpTrigger) {
      await humanPause(350, 900);
      reportComplete(6, { needsOTP: true });
      simulateClick(otpTrigger);
      log('步骤 6：已点击"使用一次性验证码登录"，跳过密码输入，直接进入验证码流程（步骤 7）');
      return;
    }

    // 兜底：未找到 OTP 入口，仍按原逻辑填写密码并提交
    log('步骤 6：未找到一次性验证码登录入口，回退为填写密码...');
    await humanPause(550, 1450);
    fillInput(passwordInput, payload.password);

    await sleep(500);
    const submitBtn2 = document.querySelector('button[type="submit"]')
      || await waitForElementByText('button', /continue|log\s*in|submit|sign\s*in|登录|继续/i, 5000).catch(() => null);
    // Report complete BEFORE submit in case page navigates
    reportComplete(6, { needsOTP: true });

    if (submitBtn2) {
      await humanPause(450, 1200);
      simulateClick(submitBtn2);
      log('步骤 6：密码已提交，可能还需要验证码（步骤 7）');
    }
    return;
  }

  // No password field — OTP flow
  log('步骤 6：未发现密码输入框，可能进入验证码流程或自动跳转。');
  reportComplete(6, { needsOTP: true });
}

// ============================================================
// Step 8: Find "继续" on OAuth consent page for debugger click
// ============================================================
// After login + verification, page shows:
// "使用 ChatGPT 登录到 Codex" with a "继续" submit button.
// Background performs the actual click through the debugger Input API.

async function step8_findAndClick() {
  log('步骤 8：正在查找 OAuth 同意页的“继续”按钮...');

  const continueBtn = await prepareStep8ContinueButton();

  const rect = getSerializableRect(continueBtn);
  log('步骤 8：已找到“继续”按钮并准备好调试器点击坐标。');
  return {
    rect,
    buttonText: (continueBtn.textContent || '').trim(),
    url: location.href,
  };
}

function getStep8State() {
  const continueBtn = getPrimaryContinueButton();
  const state = {
    url: location.href,
    consentPage: isOAuthConsentPage(),
    consentReady: isStep8Ready(),
    verificationPage: isVerificationPageStillVisible(),
    addPhonePage: isAddPhonePageReady(),
    buttonFound: Boolean(continueBtn),
    buttonEnabled: isButtonEnabled(continueBtn),
    buttonText: continueBtn ? getActionText(continueBtn) : '',
  };

  if (continueBtn) {
    try {
      state.rect = getSerializableRect(continueBtn);
    } catch {
      state.rect = null;
    }
  }

  return state;
}

async function step8_triggerContinue(payload = {}) {
  const strategy = payload?.strategy || 'requestSubmit';
  const continueBtn = await prepareStep8ContinueButton({
    findTimeoutMs: payload?.findTimeoutMs,
    enabledTimeoutMs: payload?.enabledTimeoutMs,
  });
  const form = continueBtn.form || continueBtn.closest('form');

  switch (strategy) {
    case 'requestSubmit':
      if (!form || typeof form.requestSubmit !== 'function') {
        throw new Error('“继续”按钮当前不在可提交的 form 中，无法使用 requestSubmit。URL: ' + location.href);
      }
      form.requestSubmit(continueBtn);
      break;
    case 'nativeClick':
      continueBtn.click();
      break;
    case 'dispatchClick':
      simulateClick(continueBtn);
      break;
    default:
      throw new Error(`未知的 Step 8 触发策略：${strategy}`);
  }

  log(`Step 8: continue button triggered via ${strategy}.`);
  return {
    strategy,
    ...getStep8State(),
  };
}

async function prepareStep8ContinueButton(options = {}) {
  const {
    findTimeoutMs = 10000,
    enabledTimeoutMs = 8000,
  } = options;

  const continueBtn = await findContinueButton(findTimeoutMs);
  await waitForButtonEnabled(continueBtn, enabledTimeoutMs);

  await humanPause(250, 700);
  continueBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
  continueBtn.focus();
  await waitForStableButtonRect(continueBtn);
  return continueBtn;
}

async function findContinueButton(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isAddPhonePageReady()) {
      throw new Error('当前页面已进入手机号页面，不是 OAuth 授权同意页。URL: ' + location.href);
    }
    const button = getPrimaryContinueButton();
    if (button && isStep8Ready()) {
      return button;
    }
    await sleep(150);
  }

  throw new Error('在 OAuth 同意页未找到“继续”按钮，或页面尚未进入授权同意状态。URL: ' + location.href);
}

async function waitForButtonEnabled(button, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isButtonEnabled(button)) return;
    await sleep(150);
  }
  throw new Error('“继续”按钮长时间不可点击。URL: ' + location.href);
}

function isButtonEnabled(button) {
  return Boolean(button)
    && !button.disabled
    && button.getAttribute('aria-disabled') !== 'true';
}

async function waitForStableButtonRect(button, timeout = 1500) {
  let previous = null;
  let stableSamples = 0;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const rect = button?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      const snapshot = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      if (
        previous
        && Math.abs(snapshot.left - previous.left) < 1
        && Math.abs(snapshot.top - previous.top) < 1
        && Math.abs(snapshot.width - previous.width) < 1
        && Math.abs(snapshot.height - previous.height) < 1
      ) {
        stableSamples += 1;
        if (stableSamples >= 2) {
          return;
        }
      } else {
        stableSamples = 0;
      }

      previous = snapshot;
    }

    await sleep(80);
  }
}

function getSerializableRect(el) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    throw new Error('滚动后“继续”按钮没有可点击尺寸。URL: ' + location.href);
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + (rect.width / 2),
    centerY: rect.top + (rect.height / 2),
  };
}

// ============================================================
// Step 5: Fill Name & Birthday / Age
// ============================================================

async function step5_fillNameBirthday(payload, stepLabel = '5') {
  const stepId = normalizeFlowStep(stepLabel) || '5';
  if (isPostSignupSuccessPage()) {
    log(`步骤 ${stepId}：页面已越过资料页，本步骤按已完成处理。`, 'ok');
    reportComplete(stepId, { addPhonePage: isAddPhonePageReady() });
    return;
  }

  const { firstName, lastName, age, year, month, day } = payload || {};
  if (!firstName || !lastName) throw new Error('未提供姓名数据。');

  const resolvedAge = age ?? (year ? new Date().getFullYear() - Number(year) : null);
  const hasBirthdayData = [year, month, day].every(value => value != null && !Number.isNaN(Number(value)));
  if (!hasBirthdayData && (resolvedAge == null || Number.isNaN(Number(resolvedAge)))) {
    throw new Error('未提供生日或年龄数据。');
  }

  const fullName = `${firstName} ${lastName}`;
  log(`步骤 ${stepId}：正在填写姓名：${fullName}`);

  // Actual DOM structure:
  // - Full name: <input name="name" placeholder="全名" type="text">
  // - Birthday: React Aria DateField or hidden input[name="birthday"]
  // - Age: <input name="age" type="text|number">

  // --- Full Name (single field, not first+last) ---
  let nameInput = null;
  try {
    nameInput = await waitForElement(
      'input[name="name"], input[placeholder*="全名"], input[autocomplete="name"]',
      10000
    );
  } catch {
    throw new Error('未找到姓名输入框。URL: ' + location.href);
  }
  await humanPause(500, 1300);
  fillInput(nameInput, fullName);
  log(`步骤 ${stepId}：姓名已填写：${fullName}`);

  let birthdayMode = false;
  let ageInput = null;
  let yearSpinner = null;
  let monthSpinner = null;
  let daySpinner = null;
  let hiddenBirthday = null;
  let yearReactSelect = null;
  let monthReactSelect = null;
  let dayReactSelect = null;
  let visibleAgeInput = false;
  let visibleBirthdaySpinners = false;
  let visibleBirthdaySelects = false;

  for (let i = 0; i < 100; i++) {
    yearSpinner = document.querySelector('[role="spinbutton"][data-type="year"]');
    monthSpinner = document.querySelector('[role="spinbutton"][data-type="month"]');
    daySpinner = document.querySelector('[role="spinbutton"][data-type="day"]');
    hiddenBirthday = document.querySelector('input[name="birthday"]');
    ageInput = document.querySelector('input[name="age"]');
    yearReactSelect = findBirthdayReactAriaSelect('年');
    monthReactSelect = findBirthdayReactAriaSelect('月');
    dayReactSelect = findBirthdayReactAriaSelect('天');

    visibleAgeInput = Boolean(ageInput && isVisibleElement(ageInput));
    visibleBirthdaySpinners = Boolean(
      yearSpinner
      && monthSpinner
      && daySpinner
      && isVisibleElement(yearSpinner)
      && isVisibleElement(monthSpinner)
      && isVisibleElement(daySpinner)
    );
    visibleBirthdaySelects = Boolean(
      yearReactSelect?.button
      && monthReactSelect?.button
      && dayReactSelect?.button
      && isVisibleElement(yearReactSelect.button)
      && isVisibleElement(monthReactSelect.button)
      && isVisibleElement(dayReactSelect.button)
    );

    if (visibleAgeInput) break;
    if (visibleBirthdaySpinners || visibleBirthdaySelects) {
      birthdayMode = true;
      break;
    }
    await sleep(100);
  }

  if (birthdayMode) {
    if (!hasBirthdayData) {
      throw new Error('检测到生日字段，但未提供生日数据。');
    }

    const yearSpinner = document.querySelector('[role="spinbutton"][data-type="year"]');
    const monthSpinner = document.querySelector('[role="spinbutton"][data-type="month"]');
    const daySpinner = document.querySelector('[role="spinbutton"][data-type="day"]');
    const yearReactSelect = findBirthdayReactAriaSelect('年');
    const monthReactSelect = findBirthdayReactAriaSelect('月');
    const dayReactSelect = findBirthdayReactAriaSelect('天');

    if (yearReactSelect?.nativeSelect && monthReactSelect?.nativeSelect && dayReactSelect?.nativeSelect) {
      const desiredDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const hiddenBirthday = document.querySelector('input[name="birthday"]');

      log(`步骤 ${stepId}：检测到 React Aria 下拉生日字段，正在填写生日...`);
      await humanPause(450, 1100);
      await setReactAriaBirthdaySelect(yearReactSelect, year);
      await humanPause(250, 650);
      await setReactAriaBirthdaySelect(monthReactSelect, month);
      await humanPause(250, 650);
      await setReactAriaBirthdaySelect(dayReactSelect, day);

      if (hiddenBirthday) {
        const start = Date.now();
        while (Date.now() - start < 2000) {
          if ((hiddenBirthday.value || '') === desiredDate) break;
          await sleep(100);
        }

        if ((hiddenBirthday.value || '') !== desiredDate) {
          throw new Error(`生日值未成功写入页面。期望 ${desiredDate}，实际 ${(hiddenBirthday.value || '空')}。`);
        }
      }

      log(`步骤 ${stepId}：React Aria 生日已填写：${desiredDate}`);
    }

    if (yearSpinner && monthSpinner && daySpinner) {
      log(`步骤 ${stepId}：检测到生日字段，正在填写生日...`);

      async function setSpinButton(el, value) {
        el.focus();
        await sleep(100);
        document.execCommand('selectAll', false, null);
        await sleep(50);

        const valueStr = String(value);
        for (const char of valueStr) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Digit${char}`, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Digit${char}`, bubbles: true }));
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: char, bubbles: true }));
          el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: char, bubbles: true }));
          await sleep(50);
        }

        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', bubbles: true }));
        el.blur();
        await sleep(100);
      }

      await humanPause(450, 1100);
      await setSpinButton(yearSpinner, year);
      await humanPause(250, 650);
      await setSpinButton(monthSpinner, String(month).padStart(2, '0'));
      await humanPause(250, 650);
      await setSpinButton(daySpinner, String(day).padStart(2, '0'));
      log(`步骤 ${stepId}：生日已填写：${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }

    const hiddenBirthday = document.querySelector('input[name="birthday"]');
    if (hiddenBirthday) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      hiddenBirthday.value = dateStr;
      hiddenBirthday.dispatchEvent(new Event('input', { bubbles: true }));
      hiddenBirthday.dispatchEvent(new Event('change', { bubbles: true }));
      log(`步骤 ${stepId}：已设置隐藏生日输入框：${dateStr}`);
    }
  } else if (ageInput) {
    if (resolvedAge == null || Number.isNaN(Number(resolvedAge))) {
      throw new Error('检测到年龄字段，但未提供年龄数据。');
    }
    await humanPause(500, 1300);
    fillInput(ageInput, String(resolvedAge));
    log(`步骤 ${stepId}：年龄已填写：${resolvedAge}`);
  } else {
    throw new Error('未找到生日或年龄输入项。URL: ' + location.href);
  }

  // Click "完成帐户创建" button
  await sleep(500);
  const completeBtn = document.querySelector('button[type="submit"]')
    || await waitForElementByText('button', /完成|create|continue|finish|done|agree/i, 5000).catch(() => null);
  if (!completeBtn) {
    throw new Error('未找到“完成帐户创建”按钮。URL: ' + location.href);
  }

  await humanPause(500, 1300);
  const submitUrl = location.href;
  simulateClick(completeBtn);
  log(`步骤 ${stepId}：已点击“完成帐户创建”，正在等待页面结果...`);

  const outcome = await waitForStep5SubmitOutcome(15000, { successGraceMs: 5000, initialUrl: submitUrl });
  if (outcome.invalidProfile) {
    throw new Error(`步骤 ${stepId}：${outcome.errorText}`);
  }

  log(`步骤 ${stepId}：资料已通过${outcome.assumed ? '（按成功推定）' : ''}。`, 'ok');
  reportComplete(stepId, { addPhonePage: Boolean(outcome.addPhonePage) });
}
