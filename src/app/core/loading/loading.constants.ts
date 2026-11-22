import { HttpContextToken } from "@angular/common/http";

export const LOADING_DELAY_MS = 150;

export const DEFAULT_WAIT_LABEL = "Communicating with server...";

export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

export interface RouteWaitRule {
  readonly pattern: RegExp;
  readonly label: string;
}

export const ROUTE_WAIT_LABELS: readonly RouteWaitRule[] = [
  { pattern: /\/api\/rax\//i, label: "Evaluating RAX formula..." },
  { pattern: /\/query\b/i, label: "Running query..." },
  { pattern: /\/api\/ingestion\//i, label: "Processing dataset..." },
  { pattern: /\/api\/export\//i, label: "Generating export..." },
  { pattern: /\/api\/projects?\//i, label: "Syncing project..." },
  { pattern: /\/api\/auth\//i, label: "Authenticating..." },
  { pattern: /\/api\/writeback\//i, label: "Saving changes..." },
];
