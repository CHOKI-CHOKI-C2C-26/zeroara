/*! Zeroara Verify SDK v1.0.0
 *  Drop-in "Verify with Zeroara" for any website. Zero dependencies.
 *
 *  <script src="https://zeroara.vercel.app/sdk/zeroara.js"></script>
 *  const result = await Zeroara.verify({
 *    document: 'aadhaar',
 *    claim: { field: 'Age', op: '>=', value: 18, unit: 'years' },
 *    requester: 'Aegis Rentals',
 *    purpose: 'Renters must be 18 or older',
 *  });
 *  result.ok            // true when the receipt satisfies the request
 *  result.bundle        // the cryptographic receipt (audit package)
 *  result.redactedPdfBytes // the flattened, redacted PDF (Uint8Array)
 *
 *  Your site never receives the original document or the private value.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var scriptOrigin = (function () {
    try {
      var s = document.currentScript;
      if (s && s.src) return new URL(s.src, location.href).origin;
    } catch (e) { /* ignore */ }
    return 'https://zeroara.vercel.app';
  })();

  function randomHex(bytes) {
    var a = new Uint8Array(bytes);
    (global.crypto || global.msCrypto).getRandomValues(a);
    var s = '';
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }

  function base64UrlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function fail(message, code) {
    var err = new Error(message);
    err.code = code;
    return err;
  }

  /** Build a protocol request from developer-friendly options. */
  function buildRequest(options) {
    options = options || {};
    if (typeof options.document !== 'string' || !options.document) {
      throw fail('Zeroara.verify: options.document is required (e.g. "aadhaar")', 'BAD_REQUEST');
    }
    var claim = null;
    if (options.claim) {
      if (options.claim.op !== undefined && options.claim.op !== '>=') {
        throw fail('Zeroara.verify: only the ">=" claim operator is supported', 'BAD_REQUEST');
      }
      if (typeof options.claim.value !== 'number' || !isFinite(options.claim.value)) {
        throw fail('Zeroara.verify: claim.value must be a number', 'BAD_REQUEST');
      }
      claim = { field: options.claim.field, op: '>=', value: options.claim.value, unit: options.claim.unit };
    }
    return {
      version: 1,
      requestId: options.requestId || randomHex(8),
      requester: options.requester || document.title || location.host,
      purpose: options.purpose || '',
      document: options.document,
      claim: claim,
      nonce: options.nonce || ('0x' + randomHex(24)),
      replyOrigin: location.origin,
      issuedAt: new Date().toISOString(),
    };
  }

  /** The relying party's acceptance policy: does the receipt satisfy the request? */
  function check(result, request) {
    var reasons = [];
    var b = result && result.bundle;
    if (!b || !b.masterAuditSeal || !b.sanitizedDocument) {
      return { ok: false, reasons: ['No audit package was returned.'] };
    }
    var req = b.enterpriseRequirement || {};
    if (!b.scenario || b.scenario.id !== request.document) reasons.push('The document type does not match the request.');
    if (req.challengeNonce !== request.nonce) reasons.push('The challenge nonce does not match this session (replay rejected).');
    if (request.claim) {
      if (b.redactionMode !== 'PROOF_BACKED' || !b.zeroKnowledgeProof) reasons.push('No zero-knowledge proof was included for the requested claim.');
      else if (!b.zeroKnowledgeProof.verified) reasons.push('The zero-knowledge proof did not verify.');
      if (typeof req.thresholdValue !== 'number' || req.thresholdValue < request.claim.value) reasons.push('The proven threshold is below the requested value.');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  function openPopup(url) {
    var w = global.open(url, 'zeroara_verify', 'popup=yes,width=1360,height=880');
    if (!w) return null;
    return { kind: 'popup', target: w, close: function () { try { w.close(); } catch (e) { /* ignore */ } }, onClose: null };
  }

  function openFrame(url, options) {
    var host = options.container || document.body;
    var overlay = document.createElement('div');
    overlay.setAttribute('data-zeroara', 'overlay');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:2vh 2vw;box-sizing:border-box;';
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.setAttribute('allow', 'clipboard-write');
    frame.style.cssText = 'width:min(1400px,96vw);height:96vh;border:0;border-radius:18px;background:#E0E5EC;box-shadow:0 30px 80px rgba(0,0,0,.45);';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close Zeroara');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'position:absolute;top:10px;right:14px;width:36px;height:36px;border:0;border-radius:50%;background:#fff;color:#0f172a;font-size:22px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    var closeHandlers = [];
    closeBtn.onclick = function () { closeHandlers.forEach(function (h) { h(); }); };
    overlay.appendChild(frame);
    overlay.appendChild(closeBtn);
    host.appendChild(overlay);
    return {
      kind: 'iframe',
      target: frame.contentWindow,
      close: function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); },
      onClose: function (h) { closeHandlers.push(h); },
    };
  }

  function openZeroara(url, mode, options) {
    if (mode === 'iframe') return openFrame(url, options);
    var popup = openPopup(url);
    if (popup) return popup;
    if (mode === 'popup') throw fail('The browser blocked the Zeroara popup. Call Zeroara.verify from a click handler, or use mode: "iframe".', 'POPUP_BLOCKED');
    return openFrame(url, options);
  }

  /**
   * Ask Zeroara to verify a condition about a document. Resolves with the
   * receipt + redacted PDF once the user completes the flow; rejects when the
   * user cancels, the window is closed, the popup is blocked, or it times out.
   */
  function verify(options) {
    options = options || {};
    var origin = options.origin || scriptOrigin;
    var request;
    try { request = buildRequest(options); } catch (e) { return Promise.reject(e); }
    var url = origin + '/?request=' + base64UrlEncode(JSON.stringify(request));

    return new Promise(function (resolve, reject) {
      var handle;
      try { handle = openZeroara(url, options.mode || 'auto', options); } catch (e) { reject(e); return; }
      var settled = false, timer = null, poll = null;

      function cleanup() {
        settled = true;
        global.removeEventListener('message', onMessage);
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        if (!options.keepOpen) handle.close();
      }

      function onMessage(e) {
        if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
        var msg = e.data;
        if (msg.type === 'zeroara:ready') {
          if (handle.target) handle.target.postMessage({ type: 'zeroara:request', version: 1, request: request }, origin);
          return;
        }
        if (msg.requestId !== request.requestId) return;
        if (msg.type === 'zeroara:result') {
          var result = {
            ok: false,
            requestId: msg.requestId,
            request: request,
            bundle: msg.bundle,
            redactedPdfBase64: msg.redactedPdfBase64 || '',
            redactedPdfBytes: base64ToBytes(msg.redactedPdfBase64),
            fileName: msg.fileName || 'redacted.pdf',
            deliveredAt: msg.deliveredAt,
            origin: e.origin,
          };
          result.checks = check(result, request);
          result.ok = result.checks.ok;
          cleanup();
          resolve(result);
        } else if (msg.type === 'zeroara:cancel') {
          cleanup();
          reject(fail('The user cancelled the verification.', 'CANCELLED'));
        }
      }

      global.addEventListener('message', onMessage);
      if (handle.kind === 'popup') {
        poll = setInterval(function () {
          if (!settled && handle.target && handle.target.closed) {
            cleanup();
            reject(fail('The Zeroara window was closed before a result was returned.', 'CLOSED'));
          }
        }, 500);
      }
      if (handle.onClose) {
        handle.onClose(function () {
          if (!settled) { cleanup(); reject(fail('The Zeroara panel was closed.', 'CLOSED')); }
        });
      }
      if (options.timeoutMs) {
        timer = setTimeout(function () {
          if (!settled) { cleanup(); reject(fail('Timed out waiting for Zeroara.', 'TIMEOUT')); }
        }, options.timeoutMs);
      }
    });
  }

  /**
   * Independently re-verify a receipt (five cryptographic checks, including the
   * Groth16 pairing check) using Zeroara's verifier code in a hidden frame.
   * Nothing is uploaded anywhere; the frame runs in the user's browser.
   */
  function audit(bundle, options) {
    options = options || {};
    var origin = options.origin || scriptOrigin;
    return new Promise(function (resolve, reject) {
      var frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = origin + '/?audit=1';
      var requestId = randomHex(6);
      var done = false;
      function cleanup() { done = true; global.removeEventListener('message', onMessage); if (frame.parentNode) frame.parentNode.removeChild(frame); }
      function onMessage(e) {
        if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
        if (e.data.type === 'zeroara:ready' && e.source === frame.contentWindow) {
          frame.contentWindow.postMessage({ type: 'zeroara:audit', version: 1, requestId: requestId, bundle: bundle }, origin);
        } else if (e.data.type === 'zeroara:audit-result' && e.data.requestId === requestId) {
          cleanup();
          if (e.data.report) resolve(e.data.report); else reject(fail('Zeroara could not audit this bundle.', 'AUDIT_FAILED'));
        }
      }
      global.addEventListener('message', onMessage);
      document.body.appendChild(frame);
      setTimeout(function () { if (!done) { cleanup(); reject(fail('Timed out waiting for the audit.', 'TIMEOUT')); } }, options.timeoutMs || 60000);
    });
  }

  global.Zeroara = { version: VERSION, origin: scriptOrigin, verify: verify, check: check, audit: audit, buildRequest: buildRequest };
})(window);
