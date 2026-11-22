export type WritebackStatus = "PENDING" | "APPROVED" | "CONFLICT_WARNING";

export interface WritebackSubmissionCommand {
  readonly targetTable: string;
  readonly recordIdJson: Record<string, string | number>;
  readonly payloadJson: Record<string, string | number>;
  readonly expectedVersion: number;
  readonly author: string;
  readonly overrideReason?: string;
}

export interface WritebackStagingReceipt {
  readonly stagingId: string;
  readonly status: WritebackStatus;
  readonly targetTable: string;
  readonly expectedVersion: number;
  readonly submittedAt: string;
}

export interface WritebackBackendResponse {
  readonly id?: string | number;
  readonly status?: WritebackStatus;
  readonly targetTable?: string;
  readonly expectedVersion?: number;
  readonly createdAt?: string;
}
