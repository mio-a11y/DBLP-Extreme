// Mobile presentation only: existing routes, data and API calls stay in app.js.
let rankingPage = 0;
const pageSize = 10;

export function refreshRankingPages() {
  const rows = [...document.querySelectorAll('#top100-table tbody tr')];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  rankingPage = Math.min(rankingPage, totalPages - 1);
  rows.forEach((row, index) => {
    row.classList.toggle('mobile-row-hidden', Math.floor(index / pageSize) !== rankingPage);
  });
  document.getElementById('ranking-page-info').textContent = `${rankingPage + 1} / ${totalPages} 页`;
  document.getElementById('ranking-prev').disabled = rankingPage === 0;
  document.getElementById('ranking-next').disabled = rankingPage >= totalPages - 1;
}

export function syncMobileNavigation(tabName) {
  document.querySelectorAll('.mobile-nav [data-open-tab]').forEach((button) => {
    if (button.dataset.openTab === tabName) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const more = document.getElementById('mobile-more');
  more.classList.toggle('active', !tabName.startsWith('search-'));
  if (!tabName.startsWith('search-')) more.setAttribute('aria-current', 'page');
  else more.removeAttribute('aria-current');
  const dialog = document.getElementById('mobile-tools');
  if (dialog.open) dialog.close();
  if (window.matchMedia('(max-width: 960px)').matches) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
}

export function initMobileLayout() {
  const mobile = window.matchMedia('(max-width: 960px)');
  const advanced = document.querySelector('.advanced-search');
  advanced.open = !mobile.matches;
  const dialog = document.getElementById('mobile-tools');
  const more = document.getElementById('mobile-more');
  more.addEventListener('click', () => {
    dialog.showModal();
    more.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('mobile-tools-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => more.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }
  });
  mobile.addEventListener('change', (event) => {
    advanced.open = !event.matches;
    if (!event.matches && dialog.open) dialog.close();
  });
  for (const [id, direction] of [['ranking-prev', -1], ['ranking-next', 1]]) {
    document.getElementById(id).addEventListener('click', () => {
      rankingPage += direction;
      refreshRankingPages();
      document.querySelector('#view-top100 .split-left').scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  document.querySelectorAll('[data-ranking-display]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('view-top100').dataset.mobileDisplay = button.dataset.rankingDisplay;
      document.querySelectorAll('[data-ranking-display]').forEach((other) => {
        other.setAttribute('aria-pressed', String(other === button));
      });
      // Chart.js observes its container and resizes when the chart becomes visible.
      window.dispatchEvent(new Event('resize'));
    });
  });
}
