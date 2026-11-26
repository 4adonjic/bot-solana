(function () {
  const pages = [
    ['index.html', 'Dashboard'],
    ['wallets.html', 'Wallets'],
    ['stats.html', 'Suivi'],
    ['control.html', 'Contrôle'],
    ['settings.html', 'Paramètres']
  ];
  const current = location.pathname.split('/').pop() || 'index.html';

  const nav = document.createElement('div');
  nav.style.cssText = 'display:flex;gap:8px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #2a2e3d;';
  nav.innerHTML = pages.map(([file, label]) => {
    const active = file === current;
    return `<a href="${file}" style="padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;
      background:${active ? '#3d6bff' : '#1a1d27'};color:${active ? 'white' : '#8b90a0'};">${label}</a>`;
  }).join('');
  document.body.prepend(nav);
})();