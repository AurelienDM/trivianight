import type { SpellingSlack } from '../shared/settings.js';

export interface GradingConfig {
  spellingSlack: SpellingSlack;
  acceptIncompleteNames: boolean;
}

export const DEFAULT_GRADING_CONFIG: GradingConfig = {
  spellingSlack: 'normal',
  acceptIncompleteNames: true,
};

/** Multipliers / thresholds driven by spellingSlack */
export function slackThresholds(slack: SpellingSlack) {
  switch (slack) {
    case 'strict':
      return { jwCorrect: 0.96, jwReview: 0.9, editBonus: 0, incompleteOk: false };
    case 'loose':
      return { jwCorrect: 0.86, jwReview: 0.75, editBonus: 1, incompleteOk: true };
    default:
      return { jwCorrect: 0.92, jwReview: 0.85, editBonus: 0, incompleteOk: true };
  }
}
