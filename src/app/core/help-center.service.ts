import { Injectable } from '@angular/core';

export type RcErrorCode =
  | 'ERR_CIRCULAR_DEP'
  | 'ERR_AMBIGUOUS_PATH'
  | 'ERR_DATATYPE_QUARANTINE'
  | 'ERR_RAX_SYNTAX'
  | string;

export interface DiagnosticArticleLink {
  readonly code: RcErrorCode;
  readonly slug: string;
  readonly url: string;
  readonly title: string;
  readonly remediationSummary: string;
}

/**
 * Translates internal platform error codes into direct documentation links
 * hosted on the root domain (https://rollercoaster.com/docs/errors/{error-code}).
 */
@Injectable({ providedIn: 'root' })
export class HelpCenterService {
  private readonly baseDocsUrl = 'https://rollercoaster.com/docs/errors';

  private readonly catalog: Readonly<Record<string, Omit<DiagnosticArticleLink, 'code' | 'slug' | 'url'>>> = {
    ERR_CIRCULAR_DEP: {
      title: 'Circular Dependency Detected in Schema',
      remediationSummary:
        'Deactivate redundant foreign-key edges or invoke USERELATIONSHIP() on secondary role-playing dimensions.'
    },
    ERR_AMBIGUOUS_PATH: {
      title: 'Ambiguous Filter Propagation Path Between Entities',
      remediationSummary:
        'Only one active relationship path is permitted between two tables. Set secondary paths to isActive: false.'
    },
    ERR_DATATYPE_QUARANTINE: {
      title: 'Ingestion Datatype Mismatch in Data Preparation',
      remediationSummary:
        'Inspect the invalid records in Data Preparation and apply a cleansing step or fallback rule.'
    },
    ERR_RAX_SYNTAX: {
      title: 'RAX Syntax Diagnostic',
      remediationSummary:
        'Verify balanced parentheses, single-quoted table identifiers, and bracketed column/measure references.'
    }
  };

  public getErrorDocumentationUrl(errorCode: RcErrorCode): string {
    const slug = errorCode.trim().toLowerCase().replace(/_/g, '-');
    return `${this.baseDocsUrl}/${slug}`;
  }

  public resolveDiagnostic(errorCode: RcErrorCode): DiagnosticArticleLink {
    const normalized = errorCode.trim().toUpperCase();
    const slug = normalized.toLowerCase().replace(/_/g, '-');
    const meta = this.catalog[normalized] ?? {
      title: `Diagnostic Reference: ${normalized}`,
      remediationSummary: 'Consult the documentation guide for schema resolution steps.'
    };
    return {
      code: normalized,
      slug,
      url: `${this.baseDocsUrl}/${slug}`,
      title: meta.title,
      remediationSummary: meta.remediationSummary
    };
  }
}
