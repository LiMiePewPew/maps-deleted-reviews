const DATA_URL = './data/osnabruck.json';

const state = {
  data: null,
  query: '',
  filter: 'all',
  sort: 'notice-desc',
};

const elements = {
  lastUpdated: document.querySelector('#last-updated'),
  observed: document.querySelector('#stat-observed'),
  notices: document.querySelector('#stat-notices'),
  noticeShare: document.querySelector('#stat-notice-share'),
  reviews: document.querySelector('#stat-reviews'),
  largest: document.querySelector('#stat-largest'),
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
  elements.search.addEventListener('input', (event) => {
    state.query = event.target.value.trim().toLocaleLowerCase('de');
    renderResults();
  });

  elements.sort.addEventListener('change', (event) => {
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

  elements.dialogClose.addEventListener('click', () => elements.dialog.close());
  elements.dialog.addEventListener('click', (event) => {
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
    currentStarRating: nullableNumber(venue.currentStarRating),
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
  renderResults();
}

function renderSummary() {
  const { data } = state;
  const summary = data.summary ?? buildSummary(data.venues);
  const observed = summary.observedVenues ?? data.venues.length;
  const notices = summary.noticesFound ?? data.venues.filter((venue) => venue.hasNotice).length;
  const visibleReviews =
    summary.visibleReviews ??
    data.venues.reduce((sum, venue) => sum + (venue.totalReviews ?? 0), 0);
  const largest =
    summary.largestNoticeMax ??
    Math.max(0, ...data.venues.filter((venue) => venue.hasNotice).map((venue) => venue.deletedReviewsMax));

  elements.observed.textContent = formatNumber(observed);
  elements.notices.textContent = formatNumber(notices);
  elements.reviews.textContent = formatCompactNumber(visibleReviews);
  elements.largest.textContent = largest > 0 ? `bis ${formatNumber(largest)}` : '—';
  elements.noticeShare.textContent =
    observed > 0 ? `${formatPercent((notices / observed) * 100)} der beobachteten Betriebe` : 'öffentliche Google-Hinweise';

  const date = data.generatedAt || summary.lastScrapedAt;
  elements.lastUpdated.textContent = date
    ? `Datensatz aktualisiert ${formatDateTime(date)}`
    : 'Noch kein Datensatz veröffentlicht';
}

function renderResults() {
  if (!state.data) {
    return;
  }

  const venues = getVisibleVenues();
  elements.resultsCount.textContent = `${formatNumber(venues.length)} ${venues.length === 1 ? 'Ergebnis' : 'Ergebnisse'}`;
  elements.grid.innerHTML = venues.map(renderVenueCard).join('');

  elements.grid.querySelectorAll('[data-venue-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const venue = venues[Number(button.dataset.venueIndex)];
      if (venue) {
        openDetails(venue);
      }
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
  renderSummary();
  elements.resultsCount.textContent = '0 Ergebnisse';
  elements.grid.innerHTML = '';
  elements.grid.hidden = true;
  elements.empty.hidden = false;
  elements.dataMessage.hidden = false;
  elements.dataMessage.textContent = message;
}

function getVisibleVenues() {
  const venues = state.data.venues.filter((venue) => {
    const haystack = `${venue.name} ${venue.venueType} ${venue.address}`.toLocaleLowerCase('de');
    if (state.query && !haystack.includes(state.query)) {
      return false;
    }

    if (state.filter === 'notice') {
      return venue.hasNotice;
    }
    if (state.filter === '50') {
      return venue.hasNotice && venue.deletedReviewsMax >= 50;
    }
    if (state.filter === '100') {
      return venue.hasNotice && venue.deletedReviewsMax >= 100;
    }
    if (state.filter === 'uncertain') {
      return venue.status !== 'ok';
    }
    return true;
  });

  return [...venues].sort((left, right) => {
    if (state.sort === 'reviews-desc') {
      return (right.totalReviews ?? -1) - (left.totalReviews ?? -1) || compareNames(left, right);
    }
    if (state.sort === 'rating-desc') {
      return (right.currentStarRating ?? -1) - (left.currentStarRating ?? -1) || compareNames(left, right);
    }
    if (state.sort === 'name-asc') {
      return compareNames(left, right);
    }

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
          <strong>${venue.currentStarRating !== null ? `${formatDecimal(venue.currentStarRating)} ★` : '—'}</strong>
          <span>Google Rating</span>
        </span>
        <span class="metric">
          <strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : '—'}</strong>
          <span>sichtbare Reviews</span>
        </span>
      </div>

      <button class="card-action" type="button" data-venue-index="${index}" aria-label="Details zu ${escapeAttribute(venue.name)} anzeigen">→</button>
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
          : 'In diesem Crawl wurde kein entsprechender Transparenzhinweis beobachtet.'
      }</p>
    </div>

    <div class="dialog-grid">
      <div class="dialog-metric">
        <span>Sichtbare Reviews</span>
        <strong>${venue.totalReviews !== null ? formatNumber(venue.totalReviews) : 'Nicht verfügbar'}</strong>
      </div>
      <div class="dialog-metric">
        <span>Google Rating</span>
        <strong>${venue.currentStarRating !== null ? `${formatDecimal(venue.currentStarRating)} ★` : 'Nicht verfügbar'}</strong>
      </div>
      <div class="dialog-metric">
        <span>Rechnerischer Anteil</span>
        <strong>${percentage !== null ? `${formatPercent(percentage)}*` : '—'}</strong>
      </div>
      <div class="dialog-metric">
        <span>Beobachtet</span>
        <strong>${venue.scrapedAt ? formatDate(venue.scrapedAt) : 'Unbekannt'}</strong>
      </div>
    </div>

    <p class="dialog-explanation">
      * Der rechnerische Anteil basiert auf dem Mittelpunkt des von Google angegebenen Bereichs und ist nur eine Näherung.
      Ein entfernter Review-Hinweis beweist weder Fehlverhalten des Betriebs noch, dass die entfernten Bewertungen berechtigt waren.
      Ein fehlender Hinweis bedeutet lediglich, dass während dieses Crawls keiner beobachtet wurde.
    </p>

    <div class="dialog-actions">
      ${
        venue.url
          ? `<a class="primary-link" href="${escapeAttribute(venue.url)}" target="_blank" rel="noreferrer">In Google Maps öffnen ↗</a>`
          : ''
      }
      <a class="secondary-link" href="https://github.com/LiMiePewPew/maps-deleted-reviews" target="_blank" rel="noreferrer">Methodik ansehen</a>
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
  if (venue.hasNotice) {
    return { label: 'Hinweis gefunden', className: 'notice' };
  }
  return { label: 'Beobachtet', className: '' };
}

function formatNoticeRange(venue) {
  const min = venue.deletedReviewsMin;
  const max = venue.deletedReviewsMax;
  if (min === max) {
    return `${formatNumber(max)} entfernt`;
  }
  return `${formatNumber(min)}–${formatNumber(max)} entfernt`;
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

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
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
  if (value < 10_000) {
    return formatNumber(value);
  }
  return new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDecimal(value) {
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value) {
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
