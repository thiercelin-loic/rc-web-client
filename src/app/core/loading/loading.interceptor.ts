import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { finalize } from "rxjs";
import {
  DEFAULT_WAIT_LABEL,
  ROUTE_WAIT_LABELS,
  SKIP_LOADING,
} from "./loading.constants";
import { LoadingService } from "./loading.service";

function resolveLabel(url: string): string {
  const matched = ROUTE_WAIT_LABELS.find((rule) => rule.pattern.test(url));
  return matched ? matched.label : DEFAULT_WAIT_LABEL;
}

export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_LOADING)) {
    return next(req);
  }

  const loading = inject(LoadingService);
  loading.beginRequest(resolveLabel(req.urlWithParams));

  return next(req).pipe(finalize(() => loading.endRequest()));
};
