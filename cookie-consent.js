/**
 * LIUV Cookie Consent & GDPR Compliance
 * Manages cookie consent banner and conditionally loads Google Analytics.
 * GA (G-ZWJSY8PV3S) is only loaded after explicit user consent.
 */
(function () {
  'use strict';

  var CONSENT_KEY = 'liuv_cookie_consent';
  var GA_ID = 'G-ZWJSY8PV3S';

  // Always define gtag so calls in other scripts don't throw errors
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
  }

  function loadGA() {
    if (document.getElementById('ga-script')) return;
    var s = document.createElement('script');
    s.id = 'ga-script';
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true });
  }

  function removeGACookies() {
    var cookies = document.cookie.split(';');
    for (var i = 0; i < cookies.length; i++) {
      var name = cookies[i].split('=')[0].trim();
      if (name.indexOf('_ga') === 0 || name.indexOf('_gid') === 0 || name.indexOf('_gat') === 0) {
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=' + location.hostname;
        document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.' + location.hostname;
      }
    }
  }

  function hideBanner() {
    var b = document.getElementById('cookie-consent-banner');
    if (b) { b.style.opacity = '0'; b.style.transform = 'translateY(20px)'; setTimeout(function () { b.remove(); }, 300); }
  }

  function acceptCookies() {
    setConsent('accepted');
    loadGA();
    hideBanner();
  }

  function declineCookies() {
    setConsent('declined');
    removeGACookies();
    hideBanner();
  }

  // Check existing consent
  var consent = getConsent();
  if (consent === 'accepted') {
    loadGA();
    return;
  }
  if (consent === 'declined') {
    return;
  }

  // No consent yet — show banner on DOMContentLoaded
  function showBanner() {
    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML =
      '<div class="cc-inner">' +
        '<div class="cc-text">' +
          '<strong>Cookie Notice</strong>' +
          '<p>This site uses cookies for analytics to improve your experience. ' +
          'By accepting, you consent to the use of Google Analytics cookies. ' +
          'See our <a href="/privacy-policy.html">Privacy Policy</a> for details.</p>' +
        '</div>' +
        '<div class="cc-actions">' +
          '<button id="cc-decline" class="cc-btn cc-btn--decline">Decline</button>' +
          '<button id="cc-accept" class="cc-btn cc-btn--accept">Accept</button>' +
        '</div>' +
      '</div>';

    // Inject scoped styles
    var style = document.createElement('style');
    style.textContent =
      '#cookie-consent-banner{position:fixed;bottom:0;left:0;right:0;z-index:10000;' +
      'background:rgba(12,16,25,0.97);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);' +
      'border-top:1px solid rgba(20,184,156,0.15);padding:20px 24px;' +
      'opacity:0;transform:translateY(20px);transition:opacity .3s ease,transform .3s ease;font-family:"DM Sans",sans-serif;}' +
      '#cookie-consent-banner.cc-visible{opacity:1;transform:translateY(0);}' +
      '.cc-inner{max-width:1200px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}' +
      '.cc-text{flex:1;min-width:280px;}' +
      '.cc-text strong{color:#E8ECF1;font-size:15px;display:block;margin-bottom:4px;}' +
      '.cc-text p{color:#6B7A8D;font-size:13px;line-height:1.6;margin:0;}' +
      '.cc-text a{color:#14B89C;text-decoration:underline;}' +
      '.cc-actions{display:flex;gap:12px;flex-shrink:0;}' +
      '.cc-btn{padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;font-family:"DM Sans",sans-serif;cursor:pointer;border:none;transition:all .2s;}' +
      '.cc-btn--decline{background:transparent;color:#6B7A8D;border:1px solid rgba(107,122,141,0.3);}' +
      '.cc-btn--decline:hover{color:#E8ECF1;border-color:rgba(107,122,141,0.5);}' +
      '.cc-btn--accept{background:#14B89C;color:#060910;}' +
      '.cc-btn--accept:hover{box-shadow:0 0 30px rgba(20,184,156,0.3);transform:translateY(-1px);}' +
      '@media(max-width:600px){.cc-inner{flex-direction:column;text-align:center;}.cc-actions{width:100%;justify-content:center;}}';
    document.head.appendChild(style);
    document.body.appendChild(banner);

    // Trigger animation
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        banner.classList.add('cc-visible');
      });
    });

    document.getElementById('cc-accept').addEventListener('click', acceptCookies);
    document.getElementById('cc-decline').addEventListener('click', declineCookies);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();
