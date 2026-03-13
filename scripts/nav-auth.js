(function () {
  function applyNavAuth() {
    fetch('/api/auth/check', { credentials: 'include' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.authenticated) return;
        var links = document.querySelectorAll('a[href="/login.html"], a[href$="login.html"]');
        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          a.href = '/dashboard.html';
          a.textContent = 'Dashboard';
        }
      })
      .catch(function () {});
  }
  function run() {
    applyNavAuth();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  window.addEventListener('load', run);
})();
