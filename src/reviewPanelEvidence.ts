import type { Page } from 'playwright';

export interface ReviewPanelEvidence {
  positiveNoticeVisible: boolean;
  sortControlVisible: boolean;
  reviewCardVisible: boolean;
  selectedReviewTabVisible: boolean;
}

export function isNegativeReviewPanelReady(
  evidence: Pick<
    ReviewPanelEvidence,
    'positiveNoticeVisible' | 'sortControlVisible' | 'reviewCardVisible'
  >,
): boolean {
  return (
    !evidence.positiveNoticeVisible && evidence.sortControlVisible && evidence.reviewCardVisible
  );
}

export async function getReviewPanelEvidence(page: Page): Promise<ReviewPanelEvidence> {
  return page
    .evaluate(() => {
      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };

      const labelOf = (element: Element): string =>
        `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`.trim();

      const bodyText = document.body?.innerText ?? '';
      const positiveNoticeVisible =
        /Bewertung(?:en)?\s+aufgrund\s+von\s+Beschwerden\s+wegen\s+Diffamierung\s+entfernt/i.test(
          bodyText,
        );

      const controls = Array.from(
        document.querySelectorAll('button, [role="button"], [aria-label]'),
      ).filter(isVisible);
      const sortControlVisible = controls.some((element) =>
        /Sortieren|Sort reviews|Sort by|Neueste|Relevanteste|Newest|Most relevant/i.test(
          labelOf(element),
        ),
      );

      const selectedReviewTabVisible = Array.from(
        document.querySelectorAll('[role="tab"][aria-selected="true"]'),
      )
        .filter(isVisible)
        .some((element) => /Rezension|Bewertung|Reviews?/i.test(labelOf(element)));

      const explicitReviewCards = Array.from(
        document.querySelectorAll('[data-review-id]'),
      ).filter(isVisible).length;

      const visibleStarLabels = Array.from(document.querySelectorAll('[aria-label]'))
        .filter(isVisible)
        .filter((element) =>
          /(?:^|\s)[1-5](?:[,.]\d+)?\s*(?:Sterne|stars?)(?:\s|$)/i.test(
            element.getAttribute('aria-label') ?? '',
          ),
        ).length;

      // Google Maps currently marks review cards with data-review-id. The star-label
      // fallback covers layout variants where that attribute is absent: the venue
      // header contributes at most one visible rating label, so two or more visible
      // rating labels strongly indicate at least one hydrated review card.
      const reviewCardVisible = explicitReviewCards > 0 || visibleStarLabels >= 2;

      return {
        positiveNoticeVisible,
        sortControlVisible,
        reviewCardVisible,
        selectedReviewTabVisible,
      };
    })
    .catch(() => ({
      positiveNoticeVisible: false,
      sortControlVisible: false,
      reviewCardVisible: false,
      selectedReviewTabVisible: false,
    }));
}
