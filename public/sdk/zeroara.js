/*! Zeroara Verify SDK v1.2.0
 *  Drop-in "Verify with Zeroara" for any website. Zero dependencies.
 *
 *  Two transports:
 *   - browser  (mode 'auto' | 'popup' | 'iframe'): Zeroara's web app opens in a
 *     popup or overlay and hands the result back over postMessage.
 *   - desktop  (mode 'desktop'): your verifier API issues a session, the OS opens
 *     the offline Zeroara app through zeroara://verify?request=..., the app POSTs
 *     the result to the API's callback, and this SDK watches the session status.
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

  var VERSION = '1.2.0';
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
      wantRedactedPdf: options.wantRedactedPdf !== false,
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
            status: (msg.verification && msg.verification.status) || (msg.bundle ? 'VERIFIED' : 'FAILED'),
            requestId: msg.requestId,
            request: request,
            bundle: msg.bundle || null,
            verification: msg.verification || null,
            redactedPdfBase64: msg.redactedPdfBase64 || '',
            redactedPdfBytes: base64ToBytes(msg.redactedPdfBase64),
            fileName: msg.fileName || 'redacted.pdf',
            deliveredAt: msg.deliveredAt,
            origin: e.origin,
            transport: 'browser',
          };
          if (msg.verification && msg.verification.status !== 'VERIFIED') {
            result.checks = { ok: false, reasons: [msg.verification.reason || 'The claim was not satisfied.'] };
          } else {
            result.checks = check(result, request);
          }
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

  /* ------------------------------------------------------------------ */
  /* Desktop transport: verifier API session + zeroara:// deep link        */
  /* ------------------------------------------------------------------ */

  function apiBase(options) {
    // Default: the Zeroara deployment this script came from hosts /api/verify/*.
    return (options.api || options.origin || scriptOrigin).replace(/\/+$/, '');
  }

  function desktopInit(api, options) {
    if (typeof options.document !== 'string' || !options.document) throw fail('Zeroara.verify: options.document is required', 'BAD_REQUEST');
    return fetch(api + '/api/verify/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ document: options.document, claim: options.claim || null, requester: options.requester || document.title || location.host, purpose: options.purpose || '', wantRedactedPdf: options.wantRedactedPdf === true }),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw fail((j && j.error) || 'The verifier API refused to create a session.', 'INIT_FAILED');
        return j;
      });
    });
  }

  function fetchStatus(api, id) {
    return fetch(api + '/api/verify/status/' + encodeURIComponent(id), { cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); });
  }

  /** Watch a session: server-sent events when available, polling otherwise. Returns stop(). */
  function watchStatus(api, id, onUpdate) {
    var stopped = false, es = null, pollTimer = null;
    function poll() {
      if (stopped) return;
      fetchStatus(api, id).then(function (s) { if (!stopped) onUpdate(s); }).catch(function () {});
      pollTimer = setTimeout(poll, 1500);
    }
    if (typeof EventSource !== 'undefined') {
      try {
        es = new EventSource(api + '/api/verify/events/' + encodeURIComponent(id));
        es.addEventListener('status', function (e) { try { onUpdate(JSON.parse(e.data)); } catch (err) { /* ignore */ } });
        es.onerror = function () { if (es) { es.close(); es = null; } if (!pollTimer) poll(); };
      } catch (e) { poll(); }
    } else poll();
    var safety = setInterval(function () { fetchStatus(api, id).then(function (s) { if (!stopped) onUpdate(s); }).catch(function () {}); }, 5000);
    return function stop() { stopped = true; if (es) es.close(); if (pollTimer) clearTimeout(pollTimer); clearInterval(safety); };
  }

  /** Ask the OS to open the offline app. Cannot detect whether a handler exists. */
  function launchDeepLink(url) {
    try {
      var a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      try { global.location.assign(url); return true; } catch (e2) { return false; }
    }
  }

  function verifyDesktop(options) {
    var api, origin = options.origin || scriptOrigin;
    try { api = apiBase(options); } catch (e) { return Promise.reject(e); }
    var fallbackMode = options.fallback || 'auto'; // 'auto' | 'iframe' | 'popup' | 'none'
    var fallbackAfterMs = typeof options.fallbackAfterMs === 'number' ? options.fallbackAfterMs : 3500;
    var timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10 * 60 * 1000;

    return desktopInit(api, options).then(function (session) {
      return new Promise(function (resolve, reject) {
        var settled = false, stopWatch = null, frame = null, fbTimer = null, toTimer = null, last = null;
        var webUrl = origin + '/?request=' + base64UrlEncode(JSON.stringify(session.request));

        function notify(s) { last = s; if (options.onStatus) { try { options.onStatus(s); } catch (e) { /* ignore */ } } }
        function cleanup() {
          settled = true;
          if (stopWatch) stopWatch();
          if (frame && !options.keepOpen) frame.close();
          if (fbTimer) clearTimeout(fbTimer);
          if (toTimer) clearTimeout(toTimer);
          global.removeEventListener('message', onMessage);
        }
        function finish(s) {
          if (settled) return;
          var usedWeb = !!frame;
          cleanup();
          resolve({
            ok: s.status === 'VERIFIED',
            status: s.status,
            requestId: s.requestId,
            nonce: session.nonce,
            request: session.request,
            record: s,
            verification: s.verification || null,
            reasons: s.reasons || [],
            redactedPdfUrl: s.redactedPdfUrl || null,
            transport: usedWeb ? 'web-fallback' : 'desktop',
          });
        }
        function onUpdate(s) {
          if (!s || settled || !s.requestId) return;
          notify(s);
          if (s.status && s.status !== 'PENDING') finish(s);
        }
        function openFallback(kind) {
          if (settled || frame) return;
          if (kind === 'popup') { frame = openPopup(webUrl); }
          if (!frame) frame = openFrame(webUrl, options);
          if (frame.onClose) frame.onClose(function () { if (!settled) { cleanup(); reject(fail('The Zeroara panel was closed before a result was returned.', 'CLOSED')); } });
          if (frame.kind === 'popup') {
            var poll = setInterval(function () { if (settled) { clearInterval(poll); return; } if (frame.target && frame.target.closed) { clearInterval(poll); fetchStatus(api, session.requestId).then(function (s) { if (s && s.status !== 'PENDING') onUpdate(s); else { cleanup(); reject(fail('The Zeroara window was closed before a result was returned.', 'CLOSED')); } }).catch(function () { cleanup(); reject(fail('The Zeroara window was closed.', 'CLOSED')); }); } }, 500);
          }
        }
        function onMessage(e) {
          if (e.origin !== origin || !e.data || typeof e.data !== 'object') return;
          var msg = e.data;
          if (msg.type === 'zeroara:ready' && frame && frame.target) {
            // Authenticates this origin for the delivered/cancel notifications.
            frame.target.postMessage({ type: 'zeroara:request', version: 1, request: session.request }, origin);
          } else if (msg.type === 'zeroara:delivered' && msg.requestId === session.requestId) {
            fetchStatus(api, session.requestId).then(onUpdate).catch(function () {});
          } else if (msg.type === 'zeroara:cancel' && msg.requestId === session.requestId) {
            cleanup();
            reject(fail('The user cancelled the verification.', 'CANCELLED'));
          }
        }

        global.addEventListener('message', onMessage);
        stopWatch = watchStatus(api, session.requestId, onUpdate);
        var launched = options.openApp === false ? false : launchDeepLink(session.deepLink);
        notify({ requestId: session.requestId, status: 'PENDING', launched: launched, deepLink: session.deepLink, webFallbackUrl: webUrl });

        var openWeb = function (kind) { openFallback(kind || 'iframe'); };
        if (fallbackMode !== 'none') {
          fbTimer = setTimeout(function () {
            if (settled || (last && last.status && last.status !== 'PENDING')) return;
            if (options.onFallback) { try { options.onFallback(openWeb, session); } catch (e) { /* ignore */ } }
            else if (fallbackMode === 'auto' || fallbackMode === 'iframe') openWeb('iframe');
          }, fallbackAfterMs);
        }
        toTimer = setTimeout(function () { if (!settled) { cleanup(); reject(fail('Timed out waiting for Zeroara.', 'TIMEOUT')); } }, timeoutMs);
      });
    });
  }

  /** Embeddable "Verify with Zeroara" button with a status line and a web fallback link. */
  function mount(target, options) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw fail('Zeroara.mount: target element not found', 'BAD_REQUEST');
    options = options || {};
    var wrap = document.createElement('div');
    wrap.setAttribute('data-zeroara', 'widget');
    wrap.style.cssText = 'display:inline-flex;flex-direction:column;gap:8px;font:14px/1.4 system-ui,-apple-system,sans-serif;';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = options.label || 'Verify with Zeroara';
    btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 18px;border:0;border-radius:12px;background:#EA580C;color:#fff;font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 6px 16px rgba(234,88,12,.35);';
    var status = document.createElement('div');
    status.style.cssText = 'font-size:13px;color:#475569;min-height:18px;';
    status.textContent = options.hint || 'Zero-knowledge · nothing leaves your device';
    var fallbackNotice = document.createElement('div');
    fallbackNotice.style.cssText = 'display:none;max-width:360px;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:13px;line-height:1.4;';
    fallbackNotice.textContent = 'Zeroara Desktop has not opened yet. You can continue securely in this browser.';
    var download = document.createElement('a');
    download.textContent = options.downloadLabel || 'Download Zeroara Desktop';
    download.style.cssText = 'display:none;color:#EA580C;text-decoration:underline;font-size:13px;font-weight:600;';
    // Never put an arbitrary scheme supplied by an integrator into the page.
    // A relative link is also useful for deployments that host their own installer page.
    if (typeof options.desktopDownloadUrl === 'string' && options.desktopDownloadUrl) {
      try {
        var downloadUrl = new URL(options.desktopDownloadUrl, global.location.href);
        if (downloadUrl.protocol === 'https:' || downloadUrl.protocol === 'http:') {
          download.href = downloadUrl.href;
          download.target = '_blank';
          download.rel = 'noopener noreferrer';
        }
      } catch (e) { /* invalid download URL: omit the link */ }
    }
    var link = document.createElement('button');
    link.type = 'button';
    link.textContent = options.fallbackLabel || 'Continue in the browser';
    link.style.cssText = 'display:none;background:none;border:0;padding:0;color:#EA580C;text-decoration:underline;cursor:pointer;font-size:13px;text-align:left;';
    wrap.appendChild(btn); wrap.appendChild(status); wrap.appendChild(fallbackNotice); wrap.appendChild(download); wrap.appendChild(link);
    el.appendChild(wrap);
    var busy = false;
    btn.onclick = function () {
      if (busy) return;
      busy = true; btn.disabled = true; link.style.display = 'none'; download.style.display = 'none'; fallbackNotice.style.display = 'none';
      status.textContent = options.mode === 'desktop' ? 'Opening Zeroara…' : 'Waiting for Zeroara…';
      var opts = Object.assign({}, options, {
        onStatus: function (s) { if (s.status === 'PENDING') status.textContent = 'Waiting for you to finish in Zeroara…'; if (options.onStatus) options.onStatus(s); },
        onFallback: function (open, session) {
          fallbackNotice.style.display = 'block';
          if (download.href) download.style.display = 'inline';
          link.style.display = 'inline';
          link.onclick = function () {
            fallbackNotice.style.display = 'none';
            link.style.display = 'none';
            download.style.display = 'none';
            open('popup');
          };
          if (options.onFallback) options.onFallback(open, session);
        },
      });
      verify(opts).then(function (r) {
        status.textContent = r.ok ? '✔ Verified' : '✖ ' + ((r.checks && r.checks.reasons && r.checks.reasons[0]) || (r.reasons && r.reasons[0]) || r.status);
        if (options.onResult) options.onResult(r);
      }, function (err) {
        status.textContent = '✖ ' + err.message;
        if (options.onError) options.onError(err);
      }).then(function () { busy = false; btn.disabled = false; });
    };
    return { element: wrap, destroy: function () { wrap.remove(); } };
  }

  var verifyBrowser = verify;
  verify = function (options) {
    options = options || {};
    if (options.mode === 'desktop') return verifyDesktop(options);
    return verifyBrowser(options);
  };

  global.Zeroara = { version: VERSION, origin: scriptOrigin, verify: verify, check: check, audit: audit, buildRequest: buildRequest, mount: mount, desktop: { init: desktopInit, watchStatus: watchStatus, fetchStatus: fetchStatus, launchDeepLink: launchDeepLink } };
})(window);
