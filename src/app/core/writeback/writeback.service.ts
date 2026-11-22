import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal } from "@angular/core";
import { Observable, catchError, map, throwError } from "rxjs";
import { StateManagerService } from "../state/state.service";
import {
  DEFAULT_WRITEBACK_STATUS,
  DEFAULT_WRITEBACK_TENANT,
  WRITEBACK_SUBMIT_ENDPOINT,
} from "./writeback.constants";
import {
  WritebackBackendResponse,
  WritebackStagingReceipt,
  WritebackSubmissionCommand,
} from "./writeback.interface";

export type {
  WritebackBackendResponse,
  WritebackStagingReceipt,
  WritebackStatus,
  WritebackSubmissionCommand,
} from "./writeback.interface";

@Injectable({ providedIn: "root" })
export class WritebackService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(StateManagerService);

  public readonly stagingQueue = signal<WritebackStagingReceipt[]>([]);

  public submitWriteback(
    command: WritebackSubmissionCommand,
  ): Observable<WritebackStagingReceipt> {
    this.state.setLoading(
      true,
      `Submitting write-back adjustment to ${command.targetTable}...`,
    );

    const requestPayload = {
      targetTable: command.targetTable,
      recordIdJson:
        typeof command.recordIdJson === "string"
          ? command.recordIdJson
          : JSON.stringify(command.recordIdJson),
      payloadJson:
        typeof command.payloadJson === "string"
          ? command.payloadJson
          : JSON.stringify(command.payloadJson),
      expectedVersion: command.expectedVersion,
      userId: command.author,
      tenantId: DEFAULT_WRITEBACK_TENANT,
    };

    return this.http
      .post<WritebackBackendResponse>(WRITEBACK_SUBMIT_ENDPOINT, requestPayload)
      .pipe(
        map((entity): WritebackStagingReceipt => {
          const receipt: WritebackStagingReceipt = {
            stagingId: entity.id?.toString() ?? "",
            status: entity.status ?? DEFAULT_WRITEBACK_STATUS,
            targetTable: entity.targetTable ?? command.targetTable,
            expectedVersion: entity.expectedVersion ?? command.expectedVersion,
            submittedAt: entity.createdAt ?? new Date().toISOString(),
          };
          this.stagingQueue.update((list) => [receipt, ...list]);
          this.state.announce(
            `Staged write-back mutation (${receipt.stagingId}) to writeback_staging with status ${receipt.status}.`,
          );
          return receipt;
        }),
        catchError((error) => {
          this.state.announceError(
            `Write-back submission to ${command.targetTable}`,
            error,
          );
          return throwError(() => error);
        }),
      );
  }
}
