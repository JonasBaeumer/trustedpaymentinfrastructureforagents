// Re-export job payload types from contracts
export { SearchIntentJob, CheckoutIntentJob } from '@/contracts';

export const JOB_NAMES = {
  SEARCH_INTENT: 'SEARCH_INTENT',
  CHECKOUT_INTENT: 'CHECKOUT_INTENT',
} as const;
