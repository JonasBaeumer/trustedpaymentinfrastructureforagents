export class IllegalTransitionError extends Error {
  constructor(fromStatus: string, event: string) {
    super(`Illegal transition: cannot apply event ${event} to intent in status ${fromStatus}`);
    this.name = 'IllegalTransitionError';
  }
}

export class IntentNotFoundError extends Error {
  constructor(intentId: string) {
    super(`Intent not found: ${intentId}`);
    this.name = 'IntentNotFoundError';
  }
}

export class InvalidApprovalStateError extends Error {
  constructor(intentId: string, currentStatus: string) {
    super(`Intent ${intentId} is not in AWAITING_APPROVAL state (current: ${currentStatus})`);
    this.name = 'InvalidApprovalStateError';
  }
}
