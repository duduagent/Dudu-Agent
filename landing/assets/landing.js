/* Dudu Public Landing Page v1 — interaksi minimal (vanilla JS, tanpa dependensi).
 *
 * Prinsip:
 *  - Progressive enhancement: tanpa JS, halaman tetap terbaca & semua tautan bekerja.
 *  - Tidak ada analytics, tidak ada cookie, tidak ada pelacak pihak ketiga.
 *  - Formulir waiting list benar-benar mem-POST ke API Dudu pada origin yang sama dan
 *    menampilkan KEADAAN NYATA (sukses/gagal). Tidak ada pesan sukses karangan.
 */
(function () {
  'use strict'

  document.body.classList.remove('no-js')

  /* ---------------- Navigasi mobile ---------------- */
  var toggle = document.querySelector('[data-nav-toggle]')
  var nav = document.getElementById('site-nav')
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true'
      nav.setAttribute('data-open', open ? 'false' : 'true')
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true')
    })
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && window.matchMedia('(max-width: 900px)').matches) {
        nav.setAttribute('data-open', 'false')
        toggle.setAttribute('aria-expanded', 'false')
      }
    })
  }

  /* ---------------- Muncul perlahan saat digulir ---------------- */
  var revealables = document.querySelectorAll('.reveal')
  if (revealables.length && 'IntersectionObserver' in window) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      revealables.forEach(function (el) { el.classList.add('is-visible') })
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        })
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
      revealables.forEach(function (el) { io.observe(el) })
    }
  }

  /* ---------------- Waiting list ---------------- */
  var form = document.getElementById('wait-form')
  var msg = document.getElementById('wl-msg')
  var submit = document.getElementById('wl-submit')
  if (form && msg && submit) {
    var endpoint = form.getAttribute('data-endpoint') || '/api/waiting-list'

    function say(text, ok) {
      msg.textContent = text
      msg.className = 'form-msg ' + (ok ? 'ok' : 'err')
      msg.hidden = false
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault()
      var email = (form.elements.email && form.elements.email.value || '').trim()
      if (!email || email.indexOf('@') < 1 || email.indexOf('.') < 0) {
        say('That does not look like an email address. Please check it and try again.', false)
        return
      }
      submit.disabled = true
      submit.textContent = 'Sending…'
      msg.hidden = true

      var payload = {
        email: email,
        platform: (form.elements.platform && form.elements.platform.value) || 'web',
        role: (form.elements.role && form.elements.role.value) || '',
        note: ((form.elements.note && form.elements.note.value) || '').trim()
      }

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dudu-Client': '1' },
        body: JSON.stringify(payload)
      }).then(function (res) {
        return res.json().catch(function () { return {} }).then(function (body) {
          if (res.ok && body && body.ok) {
            say('You are on the list' + (body.entry && body.entry.id ? ' (ref ' + body.entry.id + ')' : '') + '. We will only write when there is a new verified build or a mobile beta.', true)
            form.reset()
          } else {
            var m = (body && body.message) || 'The request was rejected (HTTP ' + res.status + ').'
            say(m, false)
          }
        })
      }).catch(function () {
        say('The waiting-list API could not be reached from this page. It posts to ' + endpoint + ' on this origin — start the Dudu server, or use the contact channel documented in the repository.', false)
      }).finally(function () {
        submit.disabled = false
        submit.textContent = 'Join the waiting list'
      })
    })
  }
})()
