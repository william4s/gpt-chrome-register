const test = require('node:test');
const assert = require('node:assert/strict');
const {
  build2925ChildEmail,
  detect2925MainEmailFromPageSnapshot,
  is2925ChildEmailForMain,
  parse2925MainEmail,
  select2925VerificationMessage,
} = require('../shared/mail-2925.js');

test('parse2925MainEmail 识别合法主邮箱', () => {
  assert.deepEqual(parse2925MainEmail('Abc_Test@2925.com'), {
    email: 'abc_test@2925.com',
    localPart: 'abc_test',
    domain: '2925.com',
  });
});

test('detect2925MainEmailFromPageSnapshot 优先使用账号区域邮箱', () => {
  const result = detect2925MainEmailFromPageSnapshot({
    preferredTexts: ['当前账号 demo_main@2925.com'],
    fallbackTexts: ['收件箱里还有 another@2925.com'],
  });

  assert.equal(result.email, 'demo_main@2925.com');
  assert.equal(result.detectionMode, 'preferred');
});

test('build2925ChildEmail 基于主邮箱生成子邮箱', () => {
  const result = build2925ChildEmail('demo@2925.com', () => 0);
  assert.equal(result.mainEmail, 'demo@2925.com');
  assert.equal(result.mainLocalPart, 'demo');
  assert.equal(result.suffix, '000000');
  assert.equal(result.childEmail, 'demo000000@2925.com');
  assert.equal(is2925ChildEmailForMain(result.childEmail, 'demo@2925.com'), true);
});

test('select2925VerificationMessage 会跳过旧邮件并选择最新验证码', () => {
  const result = select2925VerificationMessage([
    {
      matchedEmail: 'demo111111@2925.com',
      subject: 'Your code is 111111',
      combinedText: 'Your code is 111111',
      sender: 'openai',
      emailTimestamp: 1700000000000,
      messageId: 'old-message',
    },
    {
      matchedEmail: 'demo111111@2925.com',
      subject: 'Your code is 222222',
      combinedText: 'Your code is 222222',
      sender: 'openai',
      emailTimestamp: 1700003600000,
      messageId: 'new-message',
    },
  ], {
    allowExistingMessages: false,
    existingMessageIds: ['old-message'],
    filterAfterTimestamp: 1700000000001,
    senderFilters: ['openai'],
    subjectFilters: ['code'],
    targetEmail: 'demo111111@2925.com',
  });

  assert.equal(result.code, '222222');
  assert.equal(result.messageId, 'new-message');
});
