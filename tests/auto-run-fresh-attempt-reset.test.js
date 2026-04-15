const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map(marker => source.indexOf(marker))
    .find(index => index >= 0);
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

const bundle = [
  extractFunction('clearStopRequest'),
  extractFunction('throwIfStopped'),
  extractFunction('isStopError'),
  extractFunction('isStepDoneStatus'),
  extractFunction('getErrorMessage'),
  extractFunction('isRestartCurrentAttemptError'),
  extractFunction('normalizeRegistrationMode'),
  extractFunction('getOrderedStepIds'),
  extractFunction('getFirstUnfinishedStep'),
  extractFunction('hasSavedProgress'),
  extractFunction('getRunningSteps'),
  extractFunction('getAutoRunStatusPayload'),
  extractFunction('autoRunLoop'),
].join('\n');

const api = new Function(`
const REGISTRATION_MODE_OAUTH = 'oauth';
const REGISTRATION_MODE_GPT = 'gpt';
const OAUTH_STEP_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const GPT_STEP_ORDER = ['A1', 'A2', 'A3', 'A4', 'A5', '1', '6', '7', '8', '9'];
const ALL_STEP_IDS = [...new Set([...GPT_STEP_ORDER, ...OAUTH_STEP_ORDER])];
const DEFAULT_STEP_STATUSES = Object.fromEntries(ALL_STEP_IDS.map((stepId) => [stepId, 'pending']));
const STOP_ERROR_MESSAGE = 'Flow stopped.';
const DEFAULT_STATE = {
  registrationMode: REGISTRATION_MODE_OAUTH,
  stepStatuses: { ...DEFAULT_STEP_STATUSES },
};

let stopRequested = false;
let autoRunActive = false;
let autoRunCurrentRun = 0;
let autoRunTotalRuns = 1;
let autoRunAttemptRun = 0;
let runCalls = 0;
const AUTO_RUN_MAX_RETRIES_PER_ROUND = 2;
const AUTO_RUN_RETRY_DELAY_MS = 1000;

const logs = [];
const broadcasts = [];
let currentState = {
  ...DEFAULT_STATE,
  stepStatuses: { ...DEFAULT_STATE.stepStatuses },
  email: 'manual@example.com',
  vpsUrl: 'https://example.com/vps',
  vpsPassword: 'secret',
  customPassword: '',
  autoRunSkipFailures: false,
  autoRunFallbackThreadIntervalMinutes: 0,
  autoRunDelayEnabled: false,
  autoRunDelayMinutes: 30,
  autoStepDelaySeconds: null,
  mailProvider: '163',
  emailGenerator: 'custom',
  customEmailAliasMode: false,
  emailPrefix: 'demo',
  inbucketHost: '',
  inbucketMailbox: '',
  cloudflareDomain: '',
  cloudflareDomains: [],
  tabRegistry: {},
  sourceLastUrls: {},
};

async function getState() {
  return {
    ...currentState,
    stepStatuses: { ...(currentState.stepStatuses || {}) },
    tabRegistry: { ...(currentState.tabRegistry || {}) },
    sourceLastUrls: { ...(currentState.sourceLastUrls || {}) },
  };
}

async function setState(updates) {
  currentState = {
    ...currentState,
    ...updates,
    stepStatuses: updates.stepStatuses
      ? { ...updates.stepStatuses }
      : currentState.stepStatuses,
    tabRegistry: updates.tabRegistry
      ? { ...updates.tabRegistry }
      : currentState.tabRegistry,
    sourceLastUrls: updates.sourceLastUrls
      ? { ...updates.sourceLastUrls }
      : currentState.sourceLastUrls,
  };
}

async function resetState() {
  const prev = await getState();
  currentState = {
    ...DEFAULT_STATE,
    stepStatuses: { ...DEFAULT_STATE.stepStatuses },
    vpsUrl: prev.vpsUrl,
    vpsPassword: prev.vpsPassword,
    customPassword: prev.customPassword,
    autoRunSkipFailures: prev.autoRunSkipFailures,
    autoRunFallbackThreadIntervalMinutes: prev.autoRunFallbackThreadIntervalMinutes,
    autoRunDelayEnabled: prev.autoRunDelayEnabled,
    autoRunDelayMinutes: prev.autoRunDelayMinutes,
    autoStepDelaySeconds: prev.autoStepDelaySeconds,
    mailProvider: prev.mailProvider,
    emailGenerator: prev.emailGenerator,
    emailPrefix: prev.emailPrefix,
    inbucketHost: prev.inbucketHost,
    inbucketMailbox: prev.inbucketMailbox,
    cloudflareDomain: prev.cloudflareDomain,
    cloudflareDomains: [...(prev.cloudflareDomains || [])],
    tabRegistry: { ...(prev.tabRegistry || {}) },
    sourceLastUrls: { ...(prev.sourceLastUrls || {}) },
  };
}

async function addLog(message, level = 'info') {
  logs.push({ message, level });
}

async function broadcastAutoRunStatus(phase, payload = {}) {
  broadcasts.push({ phase, ...payload });
  await setState({
    ...getAutoRunStatusPayload(phase, payload),
  });
}

async function sleepWithStop() {}
async function waitForRunningStepsToFinish() {
  return getState();
}
async function broadcastStopToContentScripts() {}
function cancelPendingCommands() {}
function shouldUseCustomRegistrationEmail(state = {}) {
  return state.mailProvider !== 'hotmail-api'
    && state.mailProvider !== '2925'
    && state.emailGenerator === 'custom'
    && !state.customEmailAliasMode;
}
function normalizeAutoRunFallbackThreadIntervalMinutes(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
function buildAutoRunRoundSummaries(totalRuns, existing = []) {
  return Array.from({ length: totalRuns }, (_, index) => {
    const current = existing[index] || {};
    return {
      status: current.status || 'pending',
      attempts: current.attempts || 0,
      failureReasons: [...(current.failureReasons || [])],
      finalFailureReason: current.finalFailureReason || '',
    };
  });
}
function serializeAutoRunRoundSummaries(totalRuns, roundSummaries) {
  return roundSummaries.slice(0, totalRuns).map((item) => ({
    ...item,
    failureReasons: [...(item.failureReasons || [])],
  }));
}
async function logAutoRunFinalSummary() {}

const chrome = {
  runtime: {
    sendMessage() {
      return Promise.resolve();
    },
  },
};

async function runAutoSequenceFromStep() {
  runCalls += 1;
  const state = await getState();

  if (
    runCalls === 2
    && (Object.keys(state.tabRegistry || {}).length || Object.keys(state.sourceLastUrls || {}).length)
  ) {
    throw new Error('fresh auto-run attempt reused stale runtime tab context');
  }

  currentState = {
    ...currentState,
    stepStatuses: {
      1: 'completed',
      2: 'completed',
      3: 'completed',
      4: 'completed',
      5: 'completed',
      6: 'completed',
      7: 'completed',
      8: 'completed',
      9: 'completed',
    },
    tabRegistry: {
      'signup-page': { tabId: 88, ready: true },
    },
    sourceLastUrls: {
      'signup-page': 'https://auth.openai.com/authorize',
    },
  };
}

${bundle}

return {
  autoRunLoop,
  isRestartCurrentAttemptError,
  snapshot() {
    return {
      runCalls,
      autoRunActive,
      autoRunCurrentRun,
      autoRunTotalRuns,
      autoRunAttemptRun,
      currentState,
      logs,
      broadcasts,
    };
  },
};
`)();

(async () => {
  assert.strictEqual(
    api.isRestartCurrentAttemptError(new Error('STEP7_RESTART_CURRENT_ATTEMPT::max_check_attempts_error_page::https://auth.openai.com/log-in')),
    true,
    '步骤 7 的 max_check_attempts 错误页应触发整轮重开'
  );
  assert.strictEqual(
    api.isRestartCurrentAttemptError(new Error('当前邮箱已存在，需要重新开始新一轮。')),
    true,
    '邮箱已存在分支仍应触发整轮重开'
  );

  await api.autoRunLoop(2, { autoRunSkipFailures: false, mode: 'restart' });

  const snapshot = api.snapshot();
  assert.strictEqual(snapshot.runCalls, 2, 'auto-run should enter the second fresh attempt');
  assert.strictEqual(snapshot.currentState.autoRunPhase, 'complete', 'both runs should complete after reset');
  assert.strictEqual(snapshot.currentState.autoRunCurrentRun, 2, 'final run index should be recorded');
  assert.strictEqual(snapshot.autoRunActive, false, 'auto-run should exit active state after completion');
  assert.strictEqual(snapshot.currentState.email, 'manual@example.com', 'fresh auto-run attempt should preserve manually entered full email');

  console.log('auto-run fresh attempt reset tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
