/* 全站共享的用户入口组件。
 * 用法：在 topbar 中放置 <span data-user-chip></span>，并引入本脚本（defer）。
 * 脚本会请求 /api/auth/me，按登录状态渲染「登录/注册」按钮或用户菜单。
 * 用户系统未启用（无 KV）时自动隐藏，不影响公开站点。 */
(function () {
  'use strict';

  var STYLE_ID = 'site-user-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.user-chip { position: relative; display: inline-flex; align-items: center; gap: 8px; }',
      '.user-chip-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 60; display: none;',
      '  flex-direction: column; min-width: 160px; background: var(--c-white, #fff);',
      '  border: var(--bd, 3px) solid var(--c-ink, #111); box-shadow: var(--shadow, 4px 4px 0 #111);',
      '  border-radius: var(--radius-sm, 8px); overflow: hidden; }',
      '.user-chip.open .user-chip-menu { display: flex; animation: pop-in var(--dur-mid, .18s) var(--ease-pop, ease) both; }',
      '.user-chip-menu a, .user-chip-menu button { display: flex; align-items: center; gap: 8px; padding: 10px 14px;',
      '  font: inherit; font-weight: 600; color: var(--c-ink, #111); background: none; border: 0; cursor: pointer;',
      '  text-decoration: none; text-align: left; }',
      '.user-chip-menu a:hover, .user-chip-menu button:hover { background: var(--c-yellow, #ffd23f); }',
      '.user-chip-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
      '@media (max-width: 700px) { .user-chip-name { display: none; } }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'text') el.textContent = attrs[k];
        else el.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }

  function icon(path) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon icon-sm');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    svg.appendChild(p);
    return svg;
  }

  var ICON_USER = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';

  function renderGuest(chip) {
    chip.classList.add('user-chip');
    var login = h('a', { class: 'btn btn-sm', href: '/auth' }, [
      icon(ICON_USER),
      h('span', { class: 'user-chip-name', text: '登录' })
    ]);
    chip.appendChild(login);
  }

  function renderUser(chip, username) {
    chip.classList.add('user-chip');
    var btn = h('button', { class: 'btn btn-sm btn-secondary', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' }, [
      icon(ICON_USER),
      h('span', { class: 'user-chip-name', text: username })
    ]);
    var menu = h('div', { class: 'user-chip-menu', role: 'menu' }, [
      h('a', { href: '/profile', role: 'menuitem', text: '个人中心' }),
      h('a', { href: '/netdisk', role: 'menuitem', text: '我的网盘' }),
      h('button', { type: 'button', role: 'menuitem', text: '退出登录' })
    ]);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = chip.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function () {
      chip.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    });

    menu.querySelector('button').addEventListener('click', function () {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
        .finally(function () { window.location.href = '/'; });
    });

    chip.appendChild(btn);
    chip.appendChild(menu);
  }

  function boot() {
    var chips = document.querySelectorAll('[data-user-chip]');
    if (!chips.length) return;
    injectStyle();

    fetch('/api/auth/me', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data || !data.authEnabled) return; // 用户系统未启用，保持隐藏
        chips.forEach(function (chip) {
          chip.textContent = '';
          if (data.user) renderUser(chip, data.user.username);
          else renderGuest(chip);
        });
      })
      .catch(function () { /* 网络失败时静默：不影响页面主功能 */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
