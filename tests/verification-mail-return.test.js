const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMailReturnBehaviorAfterResend,
} = require('../shared/verification-mail-return.js');

test('getMailReturnBehaviorAfterResend 对可复用邮箱页返回 navigate 模式', () => {
  assert.deepEqual(
    getMailReturnBehaviorAfterResend({
      source: 'mail-2925',
      navigateOnReuse: true,
      reloadIfSameUrl: true,
    }),
    {
      mode: 'navigate',
      reloadIfSameUrl: true,
    }
  );
});

test('getMailReturnBehaviorAfterResend 对普通邮箱页返回 activate 模式', () => {
  assert.deepEqual(
    getMailReturnBehaviorAfterResend({
      source: 'mail-163',
      navigateOnReuse: false,
      reloadIfSameUrl: false,
    }),
    {
      mode: 'activate',
      reloadIfSameUrl: false,
    }
  );
});
