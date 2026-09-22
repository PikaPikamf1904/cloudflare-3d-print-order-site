(() => {
  const root = document.documentElement;
  const saved = localStorage.getItem('3d-print-theme');
  root.dataset.theme = saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const current = () => root.dataset.theme;
  const sync = () => document.querySelectorAll('.theme-toggle').forEach((button) => {
    const dark = current() === 'dark';
    button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    const icon = button.querySelector('[aria-hidden="true"]');
    if (icon) icon.textContent = dark ? '☀' : '☾';
  });
  addEventListener('DOMContentLoaded', () => {
    sync();
    document.querySelectorAll('.theme-toggle').forEach((button) => button.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      localStorage.setItem('3d-print-theme', next);
      sync();
    }));
  });
})();
