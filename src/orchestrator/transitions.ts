import { IntentStatus, IntentEvent, IllegalTransitionError } from '@/contracts';

// Map of [currentStatus, event] -> nextStatus
export const TRANSITION_TABLE: ReadonlyMap<string, IntentStatus> = new Map([
  [`${IntentStatus.RECEIVED}:${IntentEvent.INTENT_CREATED}`, IntentStatus.SEARCHING],
  [`${IntentStatus.SEARCHING}:${IntentEvent.QUOTE_RECEIVED}`, IntentStatus.QUOTED],
  [`${IntentStatus.QUOTED}:${IntentEvent.APPROVAL_REQUESTED}`, IntentStatus.AWAITING_APPROVAL],
  [`${IntentStatus.AWAITING_APPROVAL}:${IntentEvent.USER_APPROVED}`, IntentStatus.APPROVED],
  [`${IntentStatus.AWAITING_APPROVAL}:${IntentEvent.USER_DENIED}`, IntentStatus.DENIED],
  [`${IntentStatus.APPROVED}:${IntentEvent.CARD_ISSUED}`, IntentStatus.CARD_ISSUED],
  [`${IntentStatus.CARD_ISSUED}:${IntentEvent.CHECKOUT_STARTED}`, IntentStatus.CHECKOUT_RUNNING],
  [`${IntentStatus.CHECKOUT_RUNNING}:${IntentEvent.CHECKOUT_SUCCEEDED}`, IntentStatus.DONE],
  [`${IntentStatus.CHECKOUT_RUNNING}:${IntentEvent.CHECKOUT_FAILED}`, IntentStatus.FAILED],
]);

// Active states that can be expired
export const ACTIVE_STATES = new Set<IntentStatus>([
  IntentStatus.RECEIVED,
  IntentStatus.SEARCHING,
  IntentStatus.QUOTED,
  IntentStatus.AWAITING_APPROVAL,
  IntentStatus.APPROVED,
  IntentStatus.CARD_ISSUED,
  IntentStatus.CHECKOUT_RUNNING,
]);

export function getNextStatus(currentStatus: IntentStatus, event: IntentEvent): IntentStatus {
  // INTENT_EXPIRED can happen from any active state
  if (event === IntentEvent.INTENT_EXPIRED && ACTIVE_STATES.has(currentStatus)) {
    return IntentStatus.EXPIRED;
  }

  const key = `${currentStatus}:${event}`;
  const next = TRANSITION_TABLE.get(key);
  if (next === undefined) {
    throw new IllegalTransitionError(currentStatus, event);
  }
  return next;
}
