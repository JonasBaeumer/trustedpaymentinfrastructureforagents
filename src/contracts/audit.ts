export interface AuditEventData {
  id: string;
  intentId: string;
  actor: string;
  event: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}
