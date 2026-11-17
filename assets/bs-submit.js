/*!
 * Bright Screen Invites — saves client submissions to the database (via /api/submit),
 * which also forwards them to the business WhatsApp on the server.
 *
 * It wraps the pages' existing submit handlers WITHOUT changing them: the existing
 * WhatsApp share + email flow still runs exactly as before; this adds a permanent record.
 * If the request fails (offline etc.) it is queued in localStorage and retried later.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var PAGE = (script && script.getAttribute('data-page')) || '';
  var API = (script && script.getAttribute('data-api')) || '/api/submit';
  var QUEUE_KEY = 'bs_pending_submissions_v1';

  function val(id) {
    var el = document.getElementById(id);
    return el && typeof el.value === 'string' ? el.value.trim() : '';
  }

  function toast(msg) {
    try { if (typeof window.showToast === 'function') window.showToast(msg); } catch (e) { /* ignore */ }
  }

  // Stable key from the CONTENT, so identical re-submissions never create duplicates.
  function idempotencyKey(obj) {
    var json = JSON.stringify(obj);
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)).then(function (buf) {
        return 'c_' + Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 48);
      });
    }
    var h = 0;
    for (var i = 0; i < json.length; i++) { h = ((h << 5) - h + json.charCodeAt(i)) | 0; }
    return Promise.resolve('c_' + (h >>> 0).toString(16) + '_' + json.length);
  }

  function readQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeQueue(q) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-10))); } catch (e) { /* storage full / private mode */ }
  }

  function post(body, attempt) {
    attempt = attempt || 0;
    var json = JSON.stringify(body);
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: json.length < 60000,
      credentials: 'omit',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.ok && d.ok) return d;
        var err = new Error(d.error || ('HTTP ' + r.status));
        err.permanent = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
        // 503 "not configured" = the admin backend hasn't been set up yet: stay silent, the old flow still works.
        if (r.status === 503 && /not configured/i.test(d.error || '')) { err.permanent = true; err.silent = true; }
        throw err;
      });
    }).catch(function (err) {
      if (err.permanent || attempt >= 2) throw err;
      return new Promise(function (res) { setTimeout(res, 1500 * (attempt + 1)); }).then(function () { return post(body, attempt + 1); });
    });
  }

  function save(body) {
    return post(body).then(function (d) {
      writeQueue(readQueue().filter(function (q) { return q.idempotency_key !== body.idempotency_key; }));
      return d;
    }).catch(function (err) {
      if (!err.permanent) {
        var q = readQueue().filter(function (x) { return x.idempotency_key !== body.idempotency_key; });
        q.push(body);
        writeQueue(q);
      }
      throw err;
    });
  }

  function flushQueue() {
    var q = readQueue();
    if (!q.length) return;
    q.forEach(function (body) { save(body).catch(function () { /* stays queued */ }); });
  }

  function showSaved(ref, container) {
    var box = container && container.querySelector('#bsSavedBanner');
    var html = '✅ Your details have been received by Bright Screen Invites' + (ref ? ' (Ref: <strong>' + ref + '</strong>)' : '') + '. We will contact you shortly!';
    if (container) {
      if (!box) {
        box = document.createElement('div');
        box.id = 'bsSavedBanner';
        box.setAttribute('role', 'status');
        box.style.cssText = 'margin:12px auto 4px;padding:10px 14px;border-radius:10px;background:#e9f9ef;color:#146c3a;font-size:.88rem;font-weight:600;text-align:center;max-width:520px;line-height:1.45';
        var target = container.querySelector('.modal-sub') || container.querySelector('h3') || container.firstElementChild;
        if (target && target.parentNode) target.parentNode.insertBefore(box, target.nextSibling);
        else container.insertBefore(box, container.firstChild);
      }
      box.innerHTML = html;
    }
    toast('✅ Details received' + (ref ? ' · Ref ' + ref : ''));
  }

  // ------------------------------------------------ fill-details.html
  function collectFillDetails() {
    var params = new URLSearchParams(window.location.search);
    var events = [];
    Array.prototype.forEach.call(document.querySelectorAll('#eventsContainer .event-card'), function (card, idx) {
      function q(sel) { var el = card.querySelector(sel); return el ? String(el.value || '').trim() : ''; }
      events.push({ name: q('.event-name') || ('Event #' + (idx + 1)), date: q('.event-date'), time: q('.event-time'), venue: q('.event-venue'), dress: q('.event-dress') });
    });
    var files = [];
    try { if (Array.isArray(window.uploadedFileNames)) files = window.uploadedFileNames.slice(); } catch (e) { /* ignore */ }
    try { if (!files.length && typeof uploadedFileNames !== 'undefined' && Array.isArray(uploadedFileNames)) files = uploadedFileNames.slice(); } catch (e) { /* ignore */ } // eslint-disable-line no-undef
    var sampleName = val('fieldSelectedSample') || 'Custom Wedding Invitation';
    var sampleLink = val('fieldSampleLink');
    if (!sampleLink && typeof window.lookupDirectDesignLink === 'function') {
      try { sampleLink = window.lookupDirectDesignLink(sampleName) || ''; } catch (e) { /* ignore */ }
    }
    return {
      source: 'fill-details',
      category: params.get('cat') || '',
      sample_name: sampleName,
      sample_link: sampleLink,
      client: { name: val('clientName'), whatsapp: val('clientWhatsapp'), email: val('clientEmail') },
      payload: {
        couple: { brideName: val('brideName'), brideParents: val('brideParents'), groomName: val('groomName'), groomParents: val('groomParents') },
        events: events,
        quote: val('customQuote'),
        hashtag: val('weddingHashtag'),
        rsvp: val('rsvpDetails'),
        notes: val('additionalNotes'),
        cloudLink: val('cloudDriveLink'),
        files: files,
      },
    };
  }

  function hookFillDetails() {
    var original = window.handleFormSubmit;
    if (typeof original !== 'function') return;
    var busy = false;
    window.handleFormSubmit = function (e) {
      var body = collectFillDetails();
      // Run the existing flow first (it opens WhatsApp synchronously, so pop-ups aren't blocked).
      var result = original.apply(this, arguments);
      if (busy) return result;
      busy = true;
      try {
        if (typeof currentStructuredText === 'string') body.summary_text = currentStructuredText; // eslint-disable-line no-undef
      } catch (err) { /* ignore */ }
      idempotencyKey([body.sample_name, body.client, body.payload]).then(function (key) {
        body.idempotency_key = key;
        return save(body);
      }).then(function (d) {
        showSaved(d.ref, document.querySelector('#shareModal .modal-dialog'));
      }).catch(function (err) {
        if (!err || !err.silent) toast('⚠️ We could not confirm receipt — please also send your details on WhatsApp.');
      }).then(function () { busy = false; });
      return result;
    };
  }

  // ------------------------------------------------ index.html personalisation form
  function hookIndex() {
    var original = window.handlePersonalizationSubmit;
    if (typeof original !== 'function') return;
    window.handlePersonalizationSubmit = function (e, sampleId) {
      var result = original.apply(this, arguments);
      try {
        var p = (typeof currentPersonalization !== 'undefined') ? currentPersonalization : {}; // eslint-disable-line no-undef
        var list = (typeof SAMPLES !== 'undefined') ? SAMPLES : []; // eslint-disable-line no-undef
        var s = list.filter(function (x) { return x.id === sampleId; })[0] || list[0] || {};
        var payload = {};
        Object.keys(p).forEach(function (k) { if (p[k] !== '' && p[k] != null) payload[k] = p[k]; });
        var body = {
          source: 'index-personalize',
          category: s.category || '',
          sample_name: s.title || '',
          sample_link: s.liveUrl || '',
          client: { name: p.fullName || '', whatsapp: p.whatsapp || p.phone || '', email: p.email || '' },
          payload: payload,
        };
        if (typeof generateEnquiryMessage === 'function') { try { body.summary_text = generateEnquiryMessage(s); } catch (err) { /* ignore */ } } // eslint-disable-line no-undef
        idempotencyKey([body.sample_name, body.client, payload]).then(function (key) {
          body.idempotency_key = key;
          return save(body);
        }).then(function (d) {
          showSaved(d.ref, document.getElementById('formModal'));
        }).catch(function () { /* the WhatsApp confirmation button on screen still works */ });
      } catch (err) { /* never break the page */ }
      return result;
    };
  }

  function init() {
    if (PAGE === 'fill-details') hookFillDetails();
    if (PAGE === 'index') hookIndex();
    setTimeout(flushQueue, 2500);
  }

  init();
  window.BSSubmit = { save: save, flushQueue: flushQueue };
})();
