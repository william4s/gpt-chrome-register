(function attachVerificationMailReturnHelpers(globalScope) {
  function getMailReturnBehaviorAfterResend(mail = {}) {
    return {
      mode: mail.navigateOnReuse ? 'navigate' : 'activate',
      reloadIfSameUrl: Boolean(mail.reloadIfSameUrl),
    };
  }

  const api = {
    getMailReturnBehaviorAfterResend,
  };

  globalScope.MultiPageVerificationMailReturn = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
