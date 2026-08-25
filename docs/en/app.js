const DATA_URL = '../data/osnabruck.json';
const PAGE_SIZE = 50;
const LOCALE = 'en-GB';

const state = {
  data: null,
  query: '',
  filter: 'all',
  sort: 'notice-desc',
  limit: PAGE_SIZE,
};

const elements = {
  lastUpdated: document.querySelector('#last-updated'),
  snapshotHeadline: document.querySelector('#snapshot-headline'),
  snapshotCopy: document.querySelector('#snapshot-copy'),
  observed: document.querySelector('#stat-observed'),
  notices: document.querySelector('#stat-notices'),
  share: document.querySelector('#stat-share'),
  fiftyOnePlus: document.querySelector('#stat-51plus'),
  hundredOnePlus: document.querySelector('#stat-101plus'),
  uncertain: document.querySelector('#stat-uncertain'),
  rangeTotal: document.querySelector('#range-total'),
  rangeChart: document.querySelector('#range-chart'),
  qualityRing: document.querySelector('#quality-ring'),
  qualityValue: document.querySelector('#quality-value'),
  qualityNotice: document.querySelector('#quality-notice'),
  qualityClean: document.querySelector('#quality-clean'),
  qualityUncertain: document.querySelector('#quality-uncertain'),
  signalCandidates: document.querySelector('#signal-candidates'),
  signalAreaExcluded: document.querySelector('#signal-area-excluded'),
  signalNonGastroExcluded: document.querySelector('#signal-nongastro-excluded'),
  signalLastDate: document.querySelector('#signal-last-date'),
  resultsCount: document.querySelector('#results-count'),
  search: document.querySelector('#search-input'),
  sort: document.querySelector('#sort-select'),
  grid: document.querySelector('#venue-grid'),
  loadMore: document.querySelector('#load-more'),
  empty: document.querySelector('#empty-state'),
  dataMessage: document.querySelector('#data-message'),
  dialog: document.querySelector('#venue-dialog'),
  dialogContent: document.querySelector('#dialog-content'),
  dialogClose: document.querySelector('#dialog-close'),
};

await boot();

async function boot() {
  bindControls();

  try {
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Dataset could not be loaded (${response.status})`);
    }

    const data = await response.json();
    state.data = normalizeData(data);
    render();
  } catch (error) {
    console.error(error);
    renderNoData('The dataset could not be loaded.');
  }
}

function bindControls() {
  elements.search?.addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLocaleLowerCase(LOCALE);
    state.limit = PAGE_SIZE;
    renderResults();
  });

  elements.sort?.addEventListener('change', (event) => {
    state.sort = event.target.value;
    state.limit = PAGE_SIZE;
    renderResults();
  });

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      state.limit = PAGE_SIZE;
      document.querySelectorAll('[data-filter]').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('is-active', active);
        candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      renderResults();
    });
  });

  elements.loadMore?.addEventListener('click', () => {
    state.limit += PAGE_SIZE;
    renderResults();
  });

  elements.dialogClose?.addEventListener('click', () => elements.dialog?.close());
  elements.dialog?.addEventListener('click', (event) => {
    if (event.target === elements.dialog) {
      elements.dialog.close();
    }
  });
}

function normalizeData(data) {
  const venues = Array.isArray(data.venues) ? data.venues.map(normalizeVenue) : [];
  return {
    ...data,
    venues,
    summary: { ...buildSummary(venues), ...(data.summary ?? {}) },
  };
}

function normalizeVenue(venue) {
  const legacyMin = nullableNumber(venue.deletedReviewsMin);
  const legacyMax = nullableNumber(venue.deletedReviewsMax);
  const rawNotice = String(venue.reviewNotice || '').trim();
  const legacyHasNotice = Boolean(
    venue.hasNotice ||
      (legacyMax !== null && legacyMax > 0) ||
      (legacyMin !== null && legacyMin > 0) ||
      rawNotice,
  );
  const noticeOpenEnded = Boolean(
    venue.noticeOpenEnded ||
      venue.noticeRangeKey === 'over-250' ||
      /(?:über|ueber)\s+250/i.test(rawNotice) ||
      (legacyHasNotice && legacyMin === 250 && legacyMax === 250),
  );
  const noticeMin = nullableNumber(venue.noticeMin) ?? (noticeOpenEnded ? 251 : legacyMin ?? 0);
  const noticeMax = noticeOpenEnded
    ? null
    : nullableNumber(venue.noticeMax) ?? legacyMax ?? (legacyHasNotice ? noticeMin : 0);

  return {
    searchTerm: venue.searchTerm ?? venue.venueType ?? '',
    googleCategory: venue.googleCategory || null,
    name: venue.name ?? 'Unknown profile',
    totalReviews: nullableNumber(venue.totalReviews),
    noticeRangeKey: venue.noticeRangeKey || null,
    noticeMin,
    noticeMax,
    noticeOpenEnded,
    reviewNotice: rawNotice || null,
    url: venue.url || '',
    address: venue.address || '',
    status: venue.status || 'partial',
    scrapedAt: venue.scrapedAt || null,
    hasNotice: Boolean(legacyHasNotice || noticeMin > 0),
  };
}

function render() {
  renderSummary();
  renderAnalytics();
  renderResults();
}

function renderSummary() {
  const { data } = state;
  const venues = data.venues;
  const summary = data.summary ?? buildSummary(venues);
  const observed = summary.observedVenues ?? venues.length;
  const notices = summary.noticesFound ?? venues.filter((venue) => venue.hasNotice).length;
  const uncertain = venues.filter((venue) => venue.status !== 'ok').length;
  const atLeast51 = venues.filter((venue) => venue.hasNotice && venue.noticeMin >= 51).length;
  const atLeast101 = venues.filter((venue) => venue.hasNotice && venue.noticeMin >= 101).length;
  const share = observed > 0 ? (notices / observed) * 100 : 0;

  elements.observed.textContent = formatNumber(observed);
  elements.notices.textContent = formatNumber(notices);
  elements.share.textContent = observed > 0 ? formatPercentValue(share) : '—';
  elements.fiftyOnePlus.textContent = formatNumber(atLeast51);
  elements.hundredOnePlus.textContent = formatNumber(atLeast101);
  elements.uncertain.textContent = formatNumber(uncertain);

  if (observed > 0) {
    elements.snapshotHeadline.textContent = `A notice was observed on ${formatNumber(notices)} of ${formatNumber(observed)} profiles.`;
    elements.snapshotCopy.textContent = `${formatPercentValue(share)} of the published dataset. This is not an estimate for all food and drink businesses in Osnabrück.`;
  } else {
    elements.snapshotHeadline.textContent = 'No data published yet.';
    elements.snapshotCopy.textContent = 'The current figures will appear here after the next export.';
  }

  const date = summary.lastScrapedAt || data.generatedAt;
  elements.lastUpdated.textContent = date
    ? `Latest profile check: ${formatDateTime(date)}`
    : 'No data published yet';
}

function renderAnalytics() {
  const venues = state.data?.venues ?? [];
  renderRangeDistribution(venues);
  renderQuality(venues);
  renderScopeStats();
}

function renderRangeDistribution(venues) {
  const notices = venues.filter((venue) => venue.hasNotice);
  const distribution = new Map();

  for (const venue of notices) {
    const key = rangeBucket(venue);
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
  }

  const preferredOrder = [
    '1',
    '2–5',
    '6–10',
    '11–20',
    '21–50',
    '51–100',
    '101–150',
    '151–200',
    '201–250',
    'Over 250',
  ];
  const rows = [...distribution.entries()].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left[0]);
    const rightIndex = preferredOrder.indexOf(right[0]);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
    return left[0].localeCompare(right[0], LOCALE);
  });

  elements.rangeTotal.textContent = `${formatNumber(notices.length)} ${notices.length === 1 ? 'notice' : 'notices'}`;

  if (rows.length === 0) {
    elements.rangeChart.innerHTML = '<p class="chart-empty">No notices in the current dataset.</p>';
    return;
  }

  const maxCount = Math.max(...rows.map(([, count]) => count), 1);
  elements.rangeChart.innerHTML = rows
    .map(([label, count]) => {
      const width = Math.max(4, (count / maxCount) * 100);
      const share = notices.length ? (count / notices.length) * 100 : 0;
      return `
        <div class="bar-row">
          <span class="bar-label">${escapeHtml(label)}</span>
          <div class="bar-track"><span class="bar-fill" style="width:${width}%"></span></div>
          <strong class="bar-value">${formatNumber(count)}</strong>
          <span class="bar-share">${formatPercentValue(share)}</span>
        </div>
      `;
    })
    .join('');
}

function renderQuality(venues) {
  const total = venues.length;
  const notices = venues.filter((venue) => venue.status === 'ok' && venue.hasNotice).length;
  const clean = venues.filter((venue) => venue.status === 'ok' && !venue.hasNotice).length;
  const uncertain = venues.filter((venue) => venue.status !== 'ok').length;
  const complete = notices + clean;
  const completeShare = total > 0 ? (complete / total) * 100 : 0;
  const noticeShare = total > 0 ? (notices / total) * 100 : 0;
  const cleanShare = total > 0 ? (clean / total) * 100 : 0;

  elements.qualityValue.textContent = total > 0 ? formatPercentValue(completeShare) : '—';
  elements.qualityNotice.textContent = formatNumber(notices);
  elements.qualityClean.textContent = formatNumber(clean);
  elements.qualityUncertain.textContent = formatNumber(uncertain);

  elements.qualityRing.style.background = total
    ? `conic-gradient(var(--notice) 0 ${noticeShare}%, var(--observed) ${noticeShare}% ${noticeShare + cleanShare}%, var(--uncertain) ${noticeShare + cleanShare}% 100%)`
    : 'var(--line)';
}

function renderScopeStats() {
  const summary = state.data?.summary ?? {};
  elements.signalCandidates.textContent = formatNumber(summary.candidateProfiles ?? state.data?.venues.length ?? 0);
  elements.signalAreaExcluded.textContent = formatNumber(summary.excludedOutsideArea ?? 0);
  elements.signalNonGastroExcluded.textContent = formatNumber(summary.excludedClearlyNonGastro ?? 0);
  elements.signalLastDate.textContent = summary.lastScrapedAt ? formatDate(summary.lastScrapedAt) : '—';
}

function renderResults() {
  if (!state.data) return;

  const allVenues = getFilteredSortedVenues();
  const venues = allVenues.slice(0, state.limit);
  elements.resultsCount.textContent =
    venues.length < allVenues.length
      ? `${formatNumber(venues.length)} of ${formatNumber(allVenues.length)} results`
      : `${formatNumber(allVenues.length)} ${allVenues.length === 1 ? 'result' : 'results'}`;
  elements.grid.innerHTML = venues.map(renderVenueCard).join('');

  elements.grid.querySelectorAll('[data-venue-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const venue = venues[Number(button.dataset.venueIndex)];
      if (venue) openDetails(venue);
    });
  });

  const hasDataset = state.data.venues.length > 0;
  elements.empty.hidden = hasDataset;
  elements.grid.hidden = !hasDataset;
  elements.loadMore.hidden = !hasDataset || venues.length >= allVenues.length;

  if (hasDataset && allVenues.length === 0) {
    elements.dataMessage.hidden = false;
    elements.dataMessage.textContent = 'No results for this selection.';
  } else {
    elements.dataMessage.hidden = true;
  }
}

function renderNoData(message) {
  state.data = {
    city: 'Osnabrück',
    generatedAt: null,
    venues: [],
    summary: buildSummary([]),
  };
  render();
  elements.grid.hidden = true;
  elements.empty.hidden = false;
  elements.loadMore.hidden = true;
  elements.dataMessage.hidden = false;
  elements.dataMessage.textContent = message;
}

function getFilteredSortedVenues() {
  const venues = state.data.venues.filter((venue) => {
    const haystack = `${venue.name} ${venue.googleCategory || ''} ${venue.searchTerm} ${venue.address}`.toLocaleLowerCase(LOCALE);
    if (state.query && !haystack.includes(state.query)) return false;

    if (state.filter === 'notice') return venue.hasNotice;
    if (state.filter === '51') return venue.hasNotice && venue.noticeMin >= 51;
    if (state.filter === '101') return venue.hasNotice && venue.noticeMin >= 101;
    if (state.filter === 'uncertain') return venue.status !== 'ok';
    return true;
  });

  return [...venues].sort((left, right) => {
    if (state.sort === 'reviews-desc') {
      return (right.totalReviews ?? -1) - (left.totalReviews ?? -1) || compareNames(left, right);
    }
    if (state.sort === 'name-asc') return compareNames(left, right);

    return (
      Number(right.hasNotice) - Number(left.hasNotice) ||
      noticeSortValue(right) - noticeSortValue(left) ||
      compareNames(left, right)
    );
  });
}

function renderVenueCard(venue, index) {
  const status = venueStatus(venue);
  const noticeText = venue.hasNotice ? formatNoticeRange(venue) : 'No notice observed';
  const category = venue.googleCategory
    ? venue.googleCategory
    : venue.searchTerm
      ? `Search term: ${venue.searchTerm}`
      : 'Google Maps profile';

  return `
    <article class="venue-card ${venue.hasNotice ? 'has-notice' : ''}">
      <div class="card-top">
        <span class="venue-category">${escapeHtml(category)}</span>
        <span class="venue-status ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      <h3 class="venue-name">${escapeHtml(venue.name)}</h3>
      <p class="venue-address">${escapeHtml(venue.address || 'Address not separately captured')}</p>

      <div class="notice-block">
        <span class="notice-label">Google notice</span>
        <strong class="notice-range ${venue.hasNotice ? '' : 'muted'}">${escapeHtml(noticeText)}</strong>
      </div>

      <div class="card-metrics">
        <span class="metric">
          <strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : '—'}</strong>
          <span>reviews visible during the crawl</span>
        </span>
        <span class="metric">
          <strong>${venue.scrapedAt ? formatDate(venue.scrapedAt) : '—'}</strong>
          <span>checked on</span>
        </span>
      </div>

      <button class="card-action" type="button" data-venue-index="${index}" aria-label="View details for ${escapeAttribute(venue.name)}">View</button>
    </article>
  `;
}

function openDetails(venue) {
  const noticeText = venue.hasNotice ? formatNoticeRange(venue) : 'No notice observed';
  const status = venueStatus(venue);
  const category = venue.googleCategory
    ? venue.googleCategory
    : venue.searchTerm
      ? `found through “${venue.searchTerm}”`
      : 'Google Maps profile';

  elements.dialogContent.innerHTML = `
    <p class="dialog-kicker">${escapeHtml(category)} · ${escapeHtml(status.label)}</p>
    <h2 class="dialog-title">${escapeHtml(venue.name)}</h2>
    <p class="dialog-subtitle">${escapeHtml(venue.address || 'Address not separately captured')}</p>

    <div class="dialog-notice">
      <span class="notice-label">Google notice</span>
      <strong>${escapeHtml(noticeText)}</strong>
      <p>${
        venue.hasNotice
          ? 'This range was observed as a public Google transparency notice during the crawl.'
          : venue.status === 'ok'
            ? 'No corresponding notice was observed during this crawl.'
            : 'This profile could not be fully checked for the notice.'
      }</p>
    </div>

    <div class="dialog-grid">
      <div class="dialog-metric"><span>Reviews visible during the crawl</span><strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : 'Not available'}</strong></div>
      <div class="dialog-metric"><span>Status</span><strong>${escapeHtml(status.label)}</strong></div>
      <div class="dialog-metric"><span>Checked on</span><strong>${venue.scrapedAt ? formatDate(venue.scrapedAt) : 'Unknown'}</strong></div>
    </div>

    <p class="dialog-explanation">
      Individual review texts were not analysed. The notice alone does not show whether a removal was
      justified or unjustified. The absence of a notice is not evidence that zero reviews were removed.
    </p>

    <div class="dialog-actions">
      ${venue.url ? `<a class="primary-link" href="${escapeAttribute(venue.url)}" target="_blank" rel="noreferrer">Open in Google Maps ↗</a>` : ''}
      <a class="secondary-link" href="https://github.com/LiMiePewPew/maps-deleted-reviews" target="_blank" rel="noreferrer">Source code and methodology ↗</a>
    </div>
  `;

  if (typeof elements.dialog?.showModal === 'function') {
    elements.dialog.showModal();
  } else {
    elements.dialog?.setAttribute('open', '');
  }
}

function venueStatus(venue) {
  if (venue.status === 'failed' || venue.status === 'partial') {
    return { label: 'Incomplete', className: 'uncertain' };
  }
  if (venue.hasNotice) return { label: 'Notice observed', className: 'notice' };
  return { label: 'No notice observed', className: '' };
}

function rangeBucket(venue) {
  if (venue.noticeOpenEnded) return 'Over 250';
  if (venue.noticeMin === venue.noticeMax) return formatNumber(venue.noticeMax ?? venue.noticeMin);
  return `${formatNumber(venue.noticeMin)}–${formatNumber(venue.noticeMax)}`;
}

function formatNoticeRange(venue) {
  if (venue.noticeOpenEnded) return 'Over 250 reviews';
  if (venue.noticeMin === venue.noticeMax) {
    return `${formatNumber(venue.noticeMin)} ${venue.noticeMin === 1 ? 'review' : 'reviews'}`;
  }
  return `${formatNumber(venue.noticeMin)}–${formatNumber(venue.noticeMax)} reviews`;
}

function noticeSortValue(venue) {
  if (!venue.hasNotice) return 0;
  if (venue.noticeOpenEnded) return 1_000_000;
  return venue.noticeMax ?? venue.noticeMin ?? 0;
}

function buildSummary(venues) {
  const notices = venues.filter((venue) => venue.hasNotice);
  const timestamps = venues
    .map((venue) => Date.parse(venue.scrapedAt || ''))
    .filter((value) => Number.isFinite(value));

  return {
    candidateProfiles: venues.length,
    observedVenues: venues.length,
    noticesFound: notices.length,
    noNoticeObserved: venues.filter((venue) => venue.status === 'ok' && !venue.hasNotice).length,
    uncertain: venues.filter((venue) => venue.status === 'partial').length,
    failed: venues.filter((venue) => venue.status === 'failed').length,
    firstScrapedAt: timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null,
    lastScrapedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
    excludedOutsideArea: 0,
    excludedClearlyNonGastro: 0,
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareNames(left, right) {
  return left.name.localeCompare(right.name, LOCALE, { sensitivity: 'base' });
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(LOCALE).format(value);
}

function formatPercentValue(value) {
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown'
    : new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'unknown'
    : new Intl.DateTimeFormat(LOCALE, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
