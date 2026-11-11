import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { StateManagerService } from './state-manager.service';

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
  readonly status: 'PENDING' | 'APPROVED' | 'CONFLICT_WARNING';
  readonly targetTable: string;
  readonly expectedVersion: number;
  readonly submittedAt: string;
}

/**
 * Actionable Reporting & Staging Write-Back Service
 * Posts operational adjustments to /api/writeback/submit into the writeback_staging queue
 * with status PENDING and optimistic locking version verification.
 */
@Injectable({ providedIn: 'root' })
export class WritebackService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

  public readonly stagingQueue = signal<WritebackStagingReceipt[]>([]);

  public submitWriteback(command: WritebackSubmissionCommand): Observable<WritebackStagingReceipt> {
    this.state.setLoading(true, `Submitting write-back adjustment to ${command.targetTable}...`);

    const requestPayload = {
      targetTable: command.targetTable,
      recordIdJson: typeof command.recordIdJson === 'string' ? command.recordIdJson : JSON.stringify(command.recordIdJson),
      payloadJson: typeof command.payloadJson === 'string' ? command.payloadJson : JSON.stringify(command.payloadJson),
      expectedVersion: command.expectedVersion,
      userId: command.author,
      tenantId: 'default-tenant'
    };

    return this.http.post<{
      id?: string | number;
      status?: WritebackStagingReceipt['status'];
      targetTable?: string;
      expectedVersion?: number;
      createdAt?: string;
    }>('/api/writeback/submit', requestPayload).pipe(
      map((entity): WritebackStagingReceipt => {
        const receipt: WritebackStagingReceipt = {
          stagingId: entity.id?.toString() ?? '',
          status: entity.status ?? 'PENDING',
          targetTable: entity.targetTable ?? command.targetTable,
          expectedVersion: entity.expectedVersion ?? command.expectedVersion,
          submittedAt: entity.createdAt ?? new Date().toISOString()
        };
        this.stagingQueue.update((list) => [receipt, ...list]);
        this.state.announce(
          `Staged write-back mutation (${receipt.stagingId}) to writeback_staging with status ${receipt.status}.`
        );
        return receipt;
      }),
      catchError((error) => {
        this.state.announceError(
          `Write-back submission to ${command.targetTable}`,
          error,
        );
        return throwError(() => error);
      })
    );
  }
}
