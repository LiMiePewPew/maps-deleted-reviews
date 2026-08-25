const DATA_URL = './data/osnabruck.json';

const state = {
  data: null,
  query: '',
  filter: 'all',
  sort: 'notice-desc',
};

const elements = {
  lastUpdated: document.querySelector('#last-updated'),
  snapshotHeadline: document.querySelector('#snapshot-headline'),
  snapshotCopy: document.querySelector('#snapshot-copy'),
  observed: document.querySelector('#stat-observed'),
  notices: document.querySelector('#stat-notices'),
  share: document.querySelector('#stat-share'),
  fiftyPlus: document.querySelector('#stat-50plus'),
  hundredPlus: document.querySelector('#stat-100plus'),
  uncertain: document.querySelector('#stat-uncertain'),
  rangeTotal: document.querySelector('#range-total'),
  rangeChart: document.querySelector('#range-chart'),
  qualityRing: document.querySelector('#quality-ring'),
  qualityValue: document.querySelector('#quality-value'),
  qualityNotice: document.querySelector('#quality-notice'),
  qualityClean: document.querySelector('#quality-clean'),
  qualityUncertain: document.querySelector('#quality-uncertain'),
  categoryChart: document.querySelector('#category-chart'),
  signalReviews: document.querySelector('#signal-reviews'),
  signalLargest: document.querySelector('#signal-largest'),
  signalMedianReviews: document.querySelector('#signal-median-reviews'),
  signalLastDate: document.querySelector('#signal-last-date'),
  highlightGrid: document.querySelector('#highlight-grid'),
  resultsCount: document.querySelector('#results-count'),
  search: document.querySelector('#search-input'),
  sort: document.querySelector('#sort-select'),
  grid: document.querySelector('#venue-grid'),
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
      throw new Error(`Datensatz konnte nicht geladen werden (${response.status})`);
    }

    const data = await response.json();
    state.data = normalizeData(data);
    render();
  } catch (error) {
    console.error(error);
    renderNoData('Der öffentliche Datensatz ist noch nicht verfügbar.');
  }
}

function bindControls() {
  elements.search?.addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLocaleLowerCase('de');
    renderResults();
  });

  elements.sort?.addEventListener('change', (event) => {
    state.sort = event.target.value;
    renderResults();
  });

  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((candidate) => {
        candidate.classList.toggle('is-active', candidate === button);
      });
      renderResults();
    });
  });

  elements.dialogClose?.addEventListener('click', () => elements.dialog.close());
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
    summary: data.summary ?? buildSummary(venues),
  };
}

function normalizeVenue(venue) {
  return {
    venueType: venue.venueType ?? '',
    name: venue.name ?? 'Unbekannter Betrieb',
    totalReviews: nullableNumber(venue.totalReviews),
    deletedReviewsMin: nullableNumber(venue.deletedReviewsMin) ?? 0,
    deletedReviewsMax: nullableNumber(venue.deletedReviewsMax) ?? 0,
    percentageDeleted: nullableNumber(venue.percentageDeleted),
    reviewNotice: venue.reviewNotice || null,
    url: venue.url || '',
    address: venue.address || '',
    status: venue.status || 'partial',
    error: venue.error || null,
    scrapedAt: venue.scrapedAt || null,
    hasNotice: Boolean(
      venue.hasNotice ||
        nullableNumber(venue.deletedReviewsMax) > 0 ||
        String(venue.reviewNotice || '').trim(),
    ),
  };
}

function render() {
  renderSummary();
  renderAnalytics();
  renderHighlights();
  renderResults();
}

function renderSummary() {
  const { data } = state;
  const venues = data.venues;
  const summary = data.summary ?? buildSummary(venues);
  const observed = summary.observedVenues ?? venues.length;
  const notices = summary.noticesFound ?? venues.filter((venue) => venue.hasNotice).length;
  const uncertain = venues.filter((venue) => venue.status !== 'ok').length;
  const fiftyPlus = venues.filter((venue) => venue.hasNotice && venue.deletedReviewsMax >= 50).length;
  const hundredPlus = venues.filter((venue) => venue.hasNotice && venue.deletedReviewsMax >= 100).length;
  const share = observed > 0 ? (notices / observed) * 100 : 0;

  elements.observed.textContent = formatNumber(observed);
  elements.notices.textContent = formatNumber(notices);
  elements.share.textContent = observed > 0 ? formatPercentValue(share) : '—';
  elements.fiftyPlus.textContent = formatNumber(fiftyPlus);
  elements.hundredPlus.textContent = formatNumber(hundredPlus);
  elements.uncertain.textContent = formatNumber(uncertain);

  if (observed > 0) {
    elements.snapshotHeadline.textContent = `${formatNumber(notices)} von ${formatNumber(observed)} Profilen zeigten einen Hinweis.`;
    elements.snapshotCopy.textContent = `${formatPercentValue(share)} des beobachteten Datensatzes. ${formatNumber(hundredPlus)} Profile hatten einen Hinweisbereich mit einer Obergrenze von mindestens 100.`;
  } else {
    elements.snapshotHeadline.textContent = 'Noch kein Datensatz veröffentlicht.';
    elements.snapshotCopy.textContent = 'Nach dem nächsten Export erscheinen hier automatisch die aktuellen Osnabrücker Kennzahlen.';
  }

  const date = data.generatedAt || summary.lastScrapedAt;
  elements.lastUpdated.textContent = date
    ? `Aktualisiert ${formatDateTime(date)}`
    : 'Noch kein Datensatz veröffentlicht';
}

function renderAnalytics() {
  const venues = state.data?.venues ?? [];
  renderRangeDistribution(venues);
  renderQuality(venues);
  renderCategoryStats(venues);
  renderSignals(venues);
}

function renderRangeDistribution(venues) {
  const notices = venues.filter((venue) => venue.hasNotice);
  const distribution = new Map();

  for (const venue of notices) {
    const key = rangeBucket(venue);
    distribution.set(key, (distribution.get(key) ?? 0) + 1);
  }

  const preferredOrder = ['1', '2–5', '6–10', '11–20', '21–50', '51–100', '101–150', '151–200', '201–250', '250+'];
  const rows = [...distribution.entries()].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left[0]);
    const rightIndex = preferredOrder.indexOf(right[0]);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
    }
    return left[0].localeCompare(right[0], 'de');
  });

  elements.rangeTotal.textContent = `${formatNumber(notices.length)} ${notices.length === 1 ? 'Hinweis' : 'Hinweise'}`;

  if (rows.length === 0) {
    elements.rangeChart.innerHTML = '<p class="chart-empty">Noch keine Hinweise im veröffentlichten Datensatz.</p>';
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

function renderCategoryStats(venues) {
  const groups = new Map();

  for (const venue of venues) {
    const label = normalizeCategory(venue.venueType);
    const current = groups.get(label) ?? { label, observed: 0, notices: 0 };
    current.observed += 1;
    if (venue.hasNotice) current.notices += 1;
    groups.set(label, current);
  }

  const rows = [...groups.values()]
    .filter((row) => row.notices > 0)
    .sort((left, right) => right.notices - left.notices || right.observed - left.observed || left.label.localeCompare(right.label, 'de'))
    .slice(0, 8);

  if (rows.length === 0) {
    elements.categoryChart.innerHTML = '<p class="chart-empty">Noch keine Kategorien mit Hinweisen verfügbar.</p>';
    return;
  }

  const maxNotices = Math.max(...rows.map((row) => row.notices), 1);
  elements.categoryChart.innerHTML = rows
    .map((row) => {
      const width = Math.max(5, (row.notices / maxNotices) * 100);
      const share = row.observed ? (row.notices / row.observed) * 100 : 0;
      return `
        <div class="category-row">
          <div class="category-copy">
            <strong>${escapeHtml(row.label)}</strong>
            <span>${formatNumber(row.notices)} von ${formatNumber(row.observed)} · ${formatPercentValue(share)}</span>
          </div>
          <div class="category-track"><span style="width:${width}%"></span></div>
        </div>
      `;
    })
    .join('');
}

function renderSignals(venues) {
  const notices = venues.filter((venue) => venue.hasNotice);
  const visibleReviewCounts = venues.reduce((sum, venue) => sum + (venue.totalReviews ?? 0), 0);
  const reviewCounts = venues
    .map((venue) => venue.totalReviews)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const medianReviews = median(reviewCounts);
  const largestVenue = [...notices].sort(
    (left, right) => right.deletedReviewsMax - left.deletedReviewsMax || right.deletedReviewsMin - left.deletedReviewsMin,
  )[0];
  const timestamps = venues
    .map((venue) => Date.parse(venue.scrapedAt || ''))
    .filter((value) => Number.isFinite(value));

  elements.signalReviews.textContent = formatCompactNumber(visibleReviewCounts);
  elements.signalLargest.textContent = largestVenue ? formatNoticeRange(largestVenue) : '—';
  elements.signalMedianReviews.textContent = medianReviews === null ? '—' : formatNumber(Math.round(medianReviews));
  elements.signalLastDate.textContent = timestamps.length
    ? formatDate(new Date(Math.max(...timestamps)).toISOString())
    : '—';
}

function renderHighlights() {
  const venues = state.data?.venues ?? [];
  const highlights = venues
    .filter((venue) => venue.hasNotice)
    .sort(
      (left, right) =>
        right.deletedReviewsMax - left.deletedReviewsMax ||
        right.deletedReviewsMin - left.deletedReviewsMin ||
        (right.totalReviews ?? 0) - (left.totalReviews ?? 0) ||
        compareNames(left, right),
    )
    .slice(0, 6);

  if (highlights.length === 0) {
    elements.highlightGrid.innerHTML = '<p class="chart-empty">Noch keine Profile mit Hinweis im veröffentlichten Datensatz.</p>';
    return;
  }

  elements.highlightGrid.innerHTML = highlights
    .map(
      (venue, index) => `
        <button class="highlight-card" type="button" data-highlight-index="${index}">
          <span class="highlight-category">${escapeHtml(venue.venueType || 'Gastronomie')}</span>
          <strong class="highlight-range">${escapeHtml(formatNoticeRange(venue))}</strong>
          <span class="highlight-name">${escapeHtml(venue.name)}</span>
          <span class="highlight-meta">${venue.totalReviews !== null ? `${formatNumber(venue.totalReviews)} sichtbare Reviews` : 'Reviewzahl nicht verfügbar'}</span>
        </button>
      `,
    )
    .join('');

  elements.highlightGrid.querySelectorAll('[data-highlight-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const venue = highlights[Number(button.dataset.highlightIndex)];
      if (venue) openDetails(venue);
    });
  });
}

function renderResults() {
  if (!state.data) return;

  const venues = getVisibleVenues();
  elements.resultsCount.textContent = `${formatNumber(venues.length)} ${venues.length === 1 ? 'Ergebnis' : 'Ergebnisse'}`;
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

  if (hasDataset && venues.length === 0) {
    elements.dataMessage.hidden = false;
    elements.dataMessage.textContent = 'Für diese Suche oder diesen Filter gibt es keine Treffer.';
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
  elements.dataMessage.hidden = false;
  elements.dataMessage.textContent = message;
}

function getVisibleVenues() {
  const venues = state.data.venues.filter((venue) => {
    const haystack = `${venue.name} ${venue.venueType} ${venue.address}`.toLocaleLowerCase('de');
    if (state.query && !haystack.includes(state.query)) return false;

    if (state.filter === 'notice') return venue.hasNotice;
    if (state.filter === '50') return venue.hasNotice && venue.deletedReviewsMax >= 50;
    if (state.filter === '100') return venue.hasNotice && venue.deletedReviewsMax >= 100;
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
      right.deletedReviewsMax - left.deletedReviewsMax ||
      right.deletedReviewsMin - left.deletedReviewsMin ||
      compareNames(left, right)
    );
  });
}

function renderVenueCard(venue, index) {
  const status = venueStatus(venue);
  const noticeText = venue.hasNotice ? formatNoticeRange(venue) : 'Kein Hinweis beobachtet';

  return `
    <article class="venue-card ${venue.hasNotice ? 'has-notice' : ''}">
      <div class="card-top">
        <span class="venue-category">${escapeHtml(venue.venueType || 'Gastronomie')}</span>
        <span class="venue-status ${status.className}">${escapeHtml(status.label)}</span>
      </div>
      <h3 class="venue-name">${escapeHtml(venue.name)}</h3>
      <p class="venue-address">${escapeHtml(venue.address || 'Osnabrück')}</p>

      <div class="notice-block">
        <span class="notice-label">Google Maps Hinweis</span>
        <strong class="notice-range ${venue.hasNotice ? '' : 'muted'}">${escapeHtml(noticeText)}</strong>
      </div>

      <div class="card-metrics">
        <span class="metric">
          <strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : '—'}</strong>
          <span>sichtbare Review-Anzahl</span>
        </span>
        <span class="metric">
          <strong>${venue.scrapedAt ? formatDate(venue.scrapedAt) : '—'}</strong>
          <span>beobachtet</span>
        </span>
      </div>

      <button class="card-action" type="button" data-venue-index="${index}" aria-label="Details zu ${escapeAttribute(venue.name)} anzeigen">Details →</button>
    </article>
  `;
}

function openDetails(venue) {
  const noticeText = venue.hasNotice ? formatNoticeRange(venue) : 'Kein Hinweis beobachtet';
  const percentage = venue.percentageDeleted;
  const status = venueStatus(venue);

  elements.dialogContent.innerHTML = `
    <p class="dialog-kicker">${escapeHtml(venue.venueType || 'Betrieb')} · ${escapeHtml(status.label)}</p>
    <h2 class="dialog-title">${escapeHtml(venue.name)}</h2>
    <p class="dialog-subtitle">${escapeHtml(venue.address || 'Osnabrück')}</p>

    <div class="dialog-notice">
      <span class="notice-label">Beobachteter Google Maps Hinweis</span>
      <strong>${escapeHtml(noticeText)}</strong>
      <p>${
        venue.reviewNotice
          ? escapeHtml(venue.reviewNotice)
          : venue.status === 'ok'
            ? 'In diesem Crawl wurde kein entsprechender Transparenzhinweis beobachtet.'
            : 'Der Hinweis-Check war bei diesem Profil nicht vollständig.'
      }</p>
    </div>

    <div class="dialog-grid">
      <div class="dialog-metric"><span>Sichtbare Review-Anzahl</span><strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : 'Nicht verfügbar'}</strong></div>
      <div class="dialog-metric"><span>Check-Status</span><strong>${escapeHtml(status.label)}</strong></div>
      <div class="dialog-metric"><span>Rechnerischer Anteil</span><strong>${percentage !== null ? `${formatPercentValue(percentage)}*` : '—'}</strong></div>
      <div class="dialog-metric"><span>Beobachtet</span><strong>${venue.scrapedAt ? formatDate(venue.scrapedAt) : 'Unbekannt'}</strong></div>
    </div>

    <p class="dialog-explanation">
      * Der rechnerische Anteil basiert auf dem Mittelpunkt des von Google angegebenen Bereichs und der sichtbaren Review-Anzahl und ist nur eine Näherung.
      Es wurden keine einzelnen Rezensionstexte für diese Darstellung ausgewertet.
      Ein Transparenzhinweis beweist weder Fehlverhalten des Betriebs noch, dass die entfernten Bewertungen unberechtigt waren.
      Ein fehlender Hinweis bedeutet lediglich, dass während dieses Crawls keiner beobachtet wurde.
    </p>

    <div class="dialog-actions">
      ${venue.url ? `<a class="primary-link" href="${escapeAttribute(venue.url)}" target="_blank" rel="noreferrer">In Google Maps öffnen ↗</a>` : ''}
      <a class="secondary-link" href="https://github.com/LiMiePewPew/maps-deleted-reviews" target="_blank" rel="noreferrer">Methodik & Code ↗</a>
    </div>
  `;

  if (typeof elements.dialog.showModal === 'function') {
    elements.dialog.showModal();
  } else {
    elements.dialog.setAttribute('open', '');
  }
}

function venueStatus(venue) {
  if (venue.status === 'failed' || venue.status === 'partial') {
    return { label: 'Unvollständig', className: 'uncertain' };
  }
  if (venue.hasNotice) return { label: 'Hinweis gefunden', className: 'notice' };
  return { label: 'Beobachtet', className: '' };
}

function rangeBucket(venue) {
  const raw = String(venue.reviewNotice || '');
  if (/\büber\s+250\b|\bover\s+250\b|more than\s+250/i.test(raw)) return '250+';

  const min = venue.deletedReviewsMin;
  const max = venue.deletedReviewsMax;
  if (min === max) return formatNumber(max);
  return `${formatNumber(min)}–${formatNumber(max)}`;
}

function formatNoticeRange(venue) {
  const raw = String(venue.reviewNotice || '');
  if (/\büber\s+250\b/i.test(raw)) return 'über 250 entfernt';
  if (/\bover\s+250\b|more than\s+250/i.test(raw)) return '250+ entfernt';

  const min = venue.deletedReviewsMin;
  const max = venue.deletedReviewsMax;
  if (min === max) return `${formatNumber(max)} entfernt`;
  return `${formatNumber(min)}–${formatNumber(max)} entfernt`;
}

function normalizeCategory(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return 'Sonstige';
  return trimmed.charAt(0).toLocaleUpperCase('de') + trimmed.slice(1);
}

function buildSummary(venues) {
  const notices = venues.filter((venue) => venue.hasNotice);
  const timestamps = venues
    .map((venue) => Date.parse(venue.scrapedAt || ''))
    .filter((value) => Number.isFinite(value));

  return {
    observedVenues: venues.length,
    noticesFound: notices.length,
    noNoticeObserved: venues.filter((venue) => venue.status === 'ok' && !venue.hasNotice).length,
    uncertain: venues.filter((venue) => venue.status === 'partial').length,
    failed: venues.filter((venue) => venue.status === 'failed').length,
    visibleReviews: venues.reduce((sum, venue) => sum + (venue.totalReviews ?? 0), 0),
    largestNoticeMax: Math.max(0, ...notices.map((venue) => venue.deletedReviewsMax)),
    lastScrapedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareNames(left, right) {
  return left.name.localeCompare(right.name, 'de', { sensitivity: 'base' });
}

function formatNumber(value) {
  return new Intl.NumberFormat('de-DE').format(value);
}

function formatCompactNumber(value) {
  if (value < 10_000) return formatNumber(value);
  return new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatPercentValue(value) {
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value)} %`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unbekannt'
    : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'zu unbekanntem Zeitpunkt'
    : new Intl.DateTimeFormat('de-DE', {
        day: '2-digit',
        month: '2-digit',
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
