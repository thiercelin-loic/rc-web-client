import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { filter } from "rxjs";
import { FormsModule } from "@angular/forms";
import {
  ExchangeLogEntry,
  StateManagerService,
} from "./core/state-manager.service";
import { ExportFormatType } from "./core/export/export.interface";
import { ExportService } from "./core/export/export.service";
import { AuthService } from "./core/auth.service";
import { ProjectSerializationService } from "./core/project-serialization.service";
import { IngestionWorkflowService } from "./core/ingestion-workflow.service";

interface NavModuleItem {
  readonly route: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly iconPath: string;
}

interface FullscreenDocument extends Document {
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

@Component({
  selector: "rc-root",
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .rc-rail-btn {
        width: 48px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        color: var(--rc-neutral-soft);
        text-decoration: none;
        transition:
          background-color var(--rc-transition-fast),
          color var(--rc-transition-fast);
      }
      .rc-rail-btn svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }
      .rc-rail-btn:hover {
        background-color: rgba(255, 255, 255, 0.08);
        color: var(--rc-text-pure);
      }
      .rc-rail-btn.active {
        background-color: var(--rc-rail-active-bg);
        color: var(--rc-primary);
      }
      .rc-rail-btn.active::before {
        content: "";
        position: absolute;
        left: 0;
        top: 6px;
        width: 3px;
        height: 28px;
        border-radius: var(--rc-radius-xs);
        background-color: var(--rc-primary);
      }
      .rc-project-badge {
        max-width: 240px;
      }
      .rc-page-tab-input {
        min-height: 24px;
        max-width: 140px;
        min-width: 72px;
        margin: 0 6px;
        padding: 2px 6px;
        font-size: var(--rc-font-size-sm);
        font-family: var(--rc-font-sans);
        color: var(--rc-text-pure);
        background: #23272b;
        border: 1px solid var(--rc-primary);
        border-radius: var(--rc-radius-xs);
        outline: none;
        box-shadow: 0 0 0 2px var(--rc-primary-glow);
      }
      .rc-page-menu-container,
      .rc-export-menu,
      .rc-import-menu,
      .rc-user-menu,
      .rc-project-menu {
        z-index: var(--rc-z-modal, 1050);
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        background-color: var(--rc-surface-dark) !important;
        color: var(--rc-text-pure) !important;
        border-radius: var(--rc-radius-sm);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45) !important;
      }
      .rc-page-menu-container {
        position: absolute;
        top: 100%;
        left: 0;
        min-width: 160px;
      }
      .rc-export-menu {
        min-width: 140px;
      }
      .rc-import-menu {
        min-width: 185px;
      }
      .rc-user-menu {
        min-width: 220px;
      }
      .rc-project-menu {
        position: absolute;
        top: 100%;
        right: 0;
        left: auto;
        min-width: 180px;
      }
      .rc-ribbon-page-title {
        font-family: var(--rc-font-heading);
        font-size: var(--rc-font-size-md);
        font-weight: var(--rc-font-weight-bold);
        color: var(--rc-text-pure);
        letter-spacing: -0.01em;
        line-height: 1.2;
      }
      .rc-page-menu-container .dropdown-item,
      .rc-export-menu .dropdown-item,
      .rc-import-menu .dropdown-item,
      .rc-user-menu .dropdown-item,
      .rc-project-menu .dropdown-item {
        color: var(--rc-text-pure) !important;
        font-family: var(--rc-font-sans);
        font-size: var(--rc-font-size-sm);
        border-radius: var(--rc-radius-xs);
      }
      .rc-page-menu-container .dropdown-item svg,
      .rc-export-menu .dropdown-item svg,
      .rc-import-menu .dropdown-item svg,
      .rc-user-menu .dropdown-item svg,
      .rc-project-menu .dropdown-item svg {
        color: currentColor;
        stroke: currentColor;
        flex-shrink: 0;
      }
      .rc-page-menu-container
        .dropdown-item:hover:not(:disabled):not(.disabled),
      .rc-page-menu-container
        .dropdown-item:focus:not(:disabled):not(.disabled),
      .rc-export-menu .dropdown-item:hover:not(:disabled):not(.disabled),
      .rc-export-menu .dropdown-item:focus:not(:disabled):not(.disabled),
      .rc-import-menu .dropdown-item:hover:not(:disabled):not(.disabled),
      .rc-import-menu .dropdown-item:focus:not(:disabled):not(.disabled),
      .rc-user-menu .dropdown-item:hover:not(:disabled):not(.disabled),
      .rc-user-menu .dropdown-item:focus:not(:disabled):not(.disabled),
      .rc-project-menu .dropdown-item:hover:not(:disabled):not(.disabled),
      .rc-project-menu .dropdown-item:focus:not(:disabled):not(.disabled) {
        background-color: rgba(255, 255, 255, 0.12) !important;
        color: var(--rc-text-pure) !important;
      }
      .rc-page-menu-container
        .dropdown-item.text-danger:not(:disabled):not(.disabled),
      .rc-user-menu .dropdown-item.text-danger:not(:disabled):not(.disabled) {
        color: #ff7b7b !important;
      }
      .rc-page-menu-container
        .dropdown-item.text-danger:hover:not(:disabled):not(.disabled),
      .rc-page-menu-container
        .dropdown-item.text-danger:focus:not(:disabled):not(.disabled),
      .rc-user-menu
        .dropdown-item.text-danger:hover:not(:disabled):not(.disabled),
      .rc-user-menu
        .dropdown-item.text-danger:focus:not(:disabled):not(.disabled) {
        background-color: rgba(224, 82, 82, 0.22) !important;
        color: #ff9494 !important;
      }
      .rc-page-menu-container .dropdown-item:disabled,
      .rc-page-menu-container .dropdown-item.disabled,
      .rc-export-menu .dropdown-item:disabled,
      .rc-export-menu .dropdown-item.disabled,
      .rc-user-menu .dropdown-item:disabled,
      .rc-user-menu .dropdown-item.disabled,
      .rc-project-menu .dropdown-item:disabled,
      .rc-project-menu .dropdown-item.disabled {
        color: var(--rc-neutral-soft) !important;
        opacity: 0.5 !important;
        background-color: transparent !important;
      }
      .rc-page-menu-container .dropdown-divider,
      .rc-export-menu .dropdown-divider,
      .rc-user-menu .dropdown-divider,
      .rc-project-menu .dropdown-divider {
        border-top-color: rgba(255, 255, 255, 0.15) !important;
      }
      .rc-user-menu .border-bottom {
        border-bottom-color: rgba(255, 255, 255, 0.15) !important;
      }
      .rc-ribbon-brand {
        width: var(--rc-rail-width, 48px);
        min-width: var(--rc-rail-width, 48px);
        height: var(--rc-ribbon-height, 40px);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .rc-project-tab-group {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .rc-project-btn {
        min-height: 26px;
      }
      .rc-project-tab-input {
        min-height: 26px;
        height: 26px;
        margin: 0;
      }
      .rc-project-title {
        max-width: 140px;
      }
      .rc-fx-badge {
        background-color: var(--rc-surface-dark);
        color: var(--rc-primary);
        font-family: var(--rc-font-sans);
        font-weight: var(--rc-font-weight-bold);
        font-size: var(--rc-font-size-xs);
        padding: 2px 7px;
        border-radius: var(--rc-radius-sm);
        line-height: 1.2;
      }
      .rc-formula-input {
        font-family: var(--rc-font-mono);
        font-size: var(--rc-font-size-xs);
        color: var(--rc-text-primary);
        background: var(--rc-card-bg);
        border: 1px solid var(--rc-border-strong);
        border-radius: var(--rc-radius-sm);
        padding: 3px 8px;
        transition:
          border-color var(--rc-transition-fast),
          box-shadow var(--rc-transition-fast);
      }
      .rc-formula-input::placeholder {
        color: var(--rc-text-muted);
        opacity: 0.85;
      }
      .rc-formula-input:focus {
        outline: none;
        border-color: var(--rc-primary-dark);
        box-shadow: 0 0 0 2px var(--rc-primary-glow);
      }
      .rc-mobile-drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(20, 24, 28, 0.65);
        z-index: var(--rc-z-modal);
        display: flex;
        justify-content: flex-end;
      }
      .rc-mobile-drawer-panel {
        width: min(390px, 92vw);
        height: 100%;
        background: var(--rc-card-bg);
        color: var(--rc-text-primary);
        border-left: 1px solid var(--rc-border-color);
        overflow-y: auto;
        box-shadow: var(--rc-shadow-floating);
      }
      .rc-auth-viewport {
        min-height: 100vh;
        width: 100vw;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
      }
    `,
  ],
  template: `
    <a
      class="visually-hidden-focusable rc-skip-link"
      href="#rc-main-canvas"
      lang="fr"
    >
      Aller au contenu principal
    </a>

    <div class="visually-hidden" aria-live="polite" aria-atomic="true">
      {{ state.liveAnnouncement() }}
    </div>

    @if (isAuthRoute()) {
      <main
        id="rc-main-canvas"
        class="rc-auth-viewport"
        tabindex="-1"
        role="main"
        aria-label="Authentication"
      >
        <router-outlet></router-outlet>
      </main>
    } @else {
      <div
        class="app-workspace-layout utility-collapsed"
        [attr.data-bs-theme]="state.theme()"
      >
        <header
          class="rc-zone-ribbon d-flex align-items-center justify-content-between"
          role="banner"
        >
          <div
            class="rc-ribbon-brand d-flex align-items-center justify-content-center flex-shrink-0"
          >
            <img
              src="./assets/icon.svg"
              width="24"
              height="24"
              alt="Roller Coaster Logo"
            />
          </div>
          <div class="d-flex align-items-center min-w-0 flex-grow-1 gap-2 me-2">
            <button
              type="button"
              class="rc-btn rc-btn-md rc-btn-outline d-md-none px-2 d-inline-flex align-items-center justify-content-center flex-shrink-0"
              (click)="state.toggleMobileDrawer(true)"
              aria-label="Open Workspace and Tools Drawer"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <h1
              id="rc-ribbon-page-title"
              class="rc-ribbon-page-title h6 mb-0 fw-bold text-white text-truncate"
            >
              {{ currentPageTitle() }}
            </h1>
          </div>

          <div
            class="d-flex align-items-center gap-2 flex-shrink-0 pe-2 pe-md-3"
          >
            <div
              id="rc-current-project-container"
              class="rc-project-tab-group position-relative d-inline-flex align-items-center flex-shrink-0"
            >
              @if (editingProject()) {
                <input
                  #renameProjectInput
                  type="text"
                  class="rc-page-tab-input rc-project-tab-input"
                  [value]="editingProjectValue()"
                  (input)="editingProjectValue.set(renameProjectInput.value)"
                  (keydown.enter)="commitRenameProject()"
                  (keydown.escape)="cancelRenameProject()"
                  (blur)="commitRenameProject()"
                  aria-label="Rename active project"
                />
              } @else {
                <button
                  type="button"
                  id="rc-current-project"
                  class="rc-btn rc-btn-sm rc-btn-outline rc-project-btn d-inline-flex align-items-center gap-2 fw-semibold text-truncate"
                  (click)="toggleProjectMenu($event)"
                  (dblclick)="startRenameProject($event)"
                  (keydown.f2)="startRenameProject($event)"
                  [attr.aria-expanded]="projectMenuOpen()"
                  aria-haspopup="menu"
                  [title]="
                    state.activeProject().filename +
                    ' — ' +
                    state.activeProject().statusPill +
                    ' (Double-click or press F2 to rename, click to manage .rcp project)'
                  "
                  [attr.aria-label]="
                    'Current project: ' +
                    state.activeProject().filename +
                    '. Double-click or press F2 to rename, click to open project actions'
                  "
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="currentColor"
                    class="flex-shrink-0"
                    aria-hidden="true"
                  >
                    <path
                      d="M8,18h8V16H8v2Zm0-4h8V12H8v2ZM6,22q-0.82,0-1.41-0.59T4,20V4Q4,3.17 4.59,2.59T6,2h8l6,6V20q0,0.82-0.59,1.41T18,22H6ZM13,9V4H6V20H18V9H13ZM6,4V9V4V9V20V4Z"
                    />
                  </svg>
                  <span class="text-truncate rc-project-title">{{
                    state.activeProject().filename
                  }}</span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                    style="transition: transform 0.2s;"
                    [style.transform]="
                      projectMenuOpen() ? 'rotate(180deg)' : 'none'
                    "
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              }

              <input
                #rcpFileInput
                type="file"
                accept=".rcp,.zip,application/json"
                class="d-none"
                (change)="onOpenRcpFile($event)"
                aria-label="Upload .rcp file"
              />

              @if (projectMenuOpen()) {
                <ul
                  class="rc-project-menu dropdown-menu show start-0 top-100 mt-1 shadow-sm p-1 list-unstyled mb-0"
                  role="menu"
                  aria-label="Project file options"
                >
                  <li role="none">
                    <button
                      type="button"
                      class="dropdown-item  py-1 d-flex align-items-center gap-2"
                      (click)="startRenameProject($event)"
                      role="menuitem"
                      title="Rename active project"
                      id="rc-rename-project-btn"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        ></path>
                        <path
                          d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        ></path>
                      </svg>
                      <span>Rename Project...</span>
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      class="dropdown-item  py-1 d-flex align-items-center gap-2"
                      (click)="onSaveProject()"
                      role="menuitem"
                      title="Save current project to .rcp package"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
                        ></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                      </svg>
                      <span>Save Project (.rcp)</span>
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      class="dropdown-item  py-1 d-flex align-items-center gap-2"
                      (click)="triggerOpenProjectDialog(rcpFileInput)"
                      role="menuitem"
                      title="Open and load an existing .rcp file"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                        ></path>
                        <polyline points="12 11 12 17"></polyline>
                        <polyline points="9 14 12 11 15 14"></polyline>
                      </svg>
                      <span>Open .rcp Project...</span>
                    </button>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      class="dropdown-item  py-1 d-flex align-items-center gap-2"
                      (click)="onCreateNewProject()"
                      role="menuitem"
                      title="Create a new blank .rcp project"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                        ></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="12" y1="18" x2="12" y2="12"></line>
                        <line x1="9" y1="15" x2="15" y2="15"></line>
                      </svg>
                      <span>New Project (.rcp)</span>
                    </button>
                  </li>
                </ul>
              }
            </div>

            <div id="import-dropdown-container" class="position-relative">
              <input
                #globalSourceFileInput
                type="file"
                accept=".csv,.tsv,.json,.txt,.xml,.xlsx,.parquet,.avro"
                class="d-none"
                (change)="ingestion.handleFileSelection($event)"
                aria-label="Upload dataset file"
              />
              <button
                type="button"
                id="ribbon-import-btn"
                class="rc-btn rc-btn-sm rc-btn-outline d-inline-flex align-items-center gap-2"
                (click)="ingestion.toggleImportMenu()"
                [attr.aria-expanded]="ingestion.importMenuOpen()"
                aria-haspopup="true"
                title="Import file formats (.xlsx, .csv, .json, .xml, .parquet)"
                aria-label="Import file formats"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                <span class="d-none d-sm-inline">Import</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  style="transition: transform 0.2s;"
                  [style.transform]="
                    ingestion.importMenuOpen() ? 'rotate(180deg)' : 'none'
                  "
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              @if (ingestion.importMenuOpen()) {
                <ul
                  class="rc-import-menu dropdown-menu show end-0 top-100 mt-1 shadow-sm p-1 list-unstyled mb-0"
                  role="menu"
                  aria-label="Import formats"
                >
                  @for (
                    connector of ingestion.fileConnectors;
                    track connector.id
                  ) {
                    <li role="none">
                      <button
                        type="button"
                        class="dropdown-item py-1 d-flex align-items-center gap-2"
                        role="menuitem"
                        (click)="
                          ingestion.triggerFileConnector(
                            connector.id,
                            globalSourceFileInput
                          )
                        "
                      >
                        @switch (connector.id) {
                          @case ("excel") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <rect
                                x="3"
                                y="3"
                                width="18"
                                height="18"
                                rx="2"
                                ry="2"
                              ></rect>
                              <line x1="3" y1="9" x2="21" y2="9"></line>
                              <line x1="3" y1="15" x2="21" y2="15"></line>
                              <line x1="9" y1="3" x2="9" y2="21"></line>
                              <line x1="15" y1="3" x2="15" y2="21"></line>
                            </svg>
                          }
                          @case ("csv") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              ></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                              <line x1="8" y1="13" x2="16" y2="13"></line>
                              <line x1="8" y1="17" x2="16" y2="17"></line>
                            </svg>
                          }
                          @case ("json") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path
                                d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"
                              ></path>
                              <path
                                d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"
                              ></path>
                            </svg>
                          }
                          @case ("xml") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <polyline points="16 18 22 12 16 6"></polyline>
                              <polyline points="8 6 2 12 8 18"></polyline>
                            </svg>
                          }
                          @case ("parquet") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                              <path
                                d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"
                              ></path>
                              <path
                                d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"
                              ></path>
                            </svg>
                          }
                        }
                        <span>{{ connector.name }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>

            <div id="export-dropdown-container" class="position-relative">
              <button
                type="button"
                class="rc-btn rc-btn-sm rc-btn-outline d-none d-sm-inline-flex align-items-center gap-2"
                (click)="toggleExportMenu()"
                [attr.aria-expanded]="exportMenuOpen()"
                aria-haspopup="true"
                aria-label="Export report formats"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span>Export</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                  style="transition: transform 0.2s;"
                  [style.transform]="
                    exportMenuOpen() ? 'rotate(180deg)' : 'none'
                  "
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              @if (exportMenuOpen()) {
                <ul
                  class="rc-export-menu dropdown-menu show end-0 top-100 mt-1 shadow-sm p-1 list-unstyled mb-0"
                  role="menu"
                  aria-label="Export formats"
                >
                  @for (fmt of exportFormats; track fmt) {
                    <li role="none">
                      <button
                        type="button"
                        class="dropdown-item py-1 d-flex align-items-center gap-2"
                        role="menuitem"
                        (click)="triggerQuickExport(fmt)"
                      >
                        @switch (fmt) {
                          @case (".pdf") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              ></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                              <line x1="16" y1="13" x2="8" y2="13"></line>
                              <line x1="16" y1="17" x2="8" y2="17"></line>
                              <polyline points="10 9 9 9 8 9"></polyline>
                            </svg>
                          }
                          @case (".xlsx") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <rect
                                x="3"
                                y="3"
                                width="18"
                                height="18"
                                rx="2"
                                ry="2"
                              ></rect>
                              <line x1="3" y1="9" x2="21" y2="9"></line>
                              <line x1="3" y1="15" x2="21" y2="15"></line>
                              <line x1="9" y1="3" x2="9" y2="21"></line>
                              <line x1="15" y1="3" x2="15" y2="21"></line>
                            </svg>
                          }
                          @case (".parquet") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                              <path
                                d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"
                              ></path>
                              <path
                                d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"
                              ></path>
                            </svg>
                          }
                          @case (".csv") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <path
                                d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                              ></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                              <line x1="8" y1="13" x2="16" y2="13"></line>
                              <line x1="8" y1="17" x2="16" y2="17"></line>
                            </svg>
                          }
                          @case (".tsv") {
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              aria-hidden="true"
                            >
                              <rect
                                x="3"
                                y="3"
                                width="18"
                                height="18"
                                rx="2"
                              ></rect>
                              <line x1="12" y1="3" x2="12" y2="21"></line>
                              <line x1="3" y1="12" x2="21" y2="12"></line>
                            </svg>
                          }
                        }

                        <span>{{ fmt }}</span>
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>

            <button
              type="button"
              id="ribbon-fullscreen-btn"
              class="rc-btn rc-btn-sm rc-btn-outline d-inline-flex align-items-center gap-2"
              (click)="toggleFullscreen()"
              [attr.aria-label]="
                isFullscreen()
                  ? 'Exit full screen mode'
                  : 'Enter full screen mode'
              "
              [title]="
                isFullscreen()
                  ? 'Exit full screen mode (Esc)'
                  : 'Enter full screen mode'
              "
            >
              @if (isFullscreen()) {
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3"></path>
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3"></path>
                  <path d="M3 16h3a2 2 0 0 1 2 2v3"></path>
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3"></path>
                </svg>
              } @else {
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
                  <path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
                </svg>
              }
              <span class="d-none d-md-inline">{{
                isFullscreen() ? "Exit Full Screen" : "Full Screen"
              }}</span>
            </button>

            <button
              type="button"
              class="rc-btn rc-btn-sm rc-btn-outline d-inline-flex align-items-center gap-2"
              (click)="state.toggleTheme()"
              [attr.aria-label]="
                'Switch to ' +
                (state.theme() === 'light' ? 'dark' : 'light') +
                ' mode'
              "
              [title]="
                state.themePreference() === 'system'
                  ? 'Theme: System (' + state.theme() + ') — Click to switch'
                  : 'Theme: ' + state.theme() + ' (manual) — Click to switch'
              "
              id="ribbon-theme-toggle-btn"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                ></path>
              </svg>
              <span>{{ state.theme() === "light" ? "Dark" : "Light" }}</span>
            </button>

            <div id="user-profile-menu-container" class="position-relative">
              <button
                type="button"
                class="rc-btn rc-btn-outline rc-btn-sm d-none d-sm-inline-flex align-items-center gap-2"
                [title]="
                  authService.currentUser()?.fullName || 'Operator Profile'
                "
                [attr.aria-label]="
                  authService.currentUser()?.fullName || 'Operator Profile'
                "
                [attr.aria-expanded]="userMenuOpen()"
                aria-haspopup="true"
                (click)="toggleUserMenu()"
                id="rail-operator-profile-btn"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>{{
                  authService.currentUser()?.username || "Profile"
                }}</span>
              </button>

              @if (userMenuOpen()) {
                <ul
                  class="rc-user-menu dropdown-menu show end-0 top-100 mt-1 shadow p-2 list-unstyled mb-0"
                  role="menu"
                  aria-label="Operator profile menu"
                >
                  @if (authService.isAuthenticated()) {
                    <li role="none" class="px-2 py-1 border-bottom mb-1">
                      <div class="fw-semibold text-white text-truncate">
                        {{
                          authService.currentUser()?.fullName ||
                            authService.currentUser()?.username
                        }}
                      </div>
                      <div class="text-white-50 text-truncate">
                        {{ authService.currentUser()?.email }}
                      </div>
                    </li>

                    <li role="none">
                      <button
                        type="button"
                        class="dropdown-item  py-1 text-danger"
                        role="menuitem"
                        (click)="onLogout()"
                        id="user-menu-logout-btn"
                      >
                        Log Out
                      </button>
                    </li>
                  } @else {
                    <li role="none">
                      <button
                        type="button"
                        class="dropdown-item  py-1"
                        role="menuitem"
                        (click)="navigateTo('/login'); userMenuOpen.set(false)"
                      >
                        Log In
                      </button>
                    </li>
                    <li role="none">
                      <button
                        type="button"
                        class="dropdown-item  py-1 fw-bold"
                        role="menuitem"
                        (click)="navigateTo('/signup'); userMenuOpen.set(false)"
                      >
                        Sign Up
                      </button>
                    </li>
                  }
                </ul>
              }
            </div>
          </div>
        </header>
        <nav
          class="rc-zone-rail d-none d-md-flex flex-column justify-content-center align-items-center py-2"
          aria-label="Primary Workspace Modules"
        >
          <div class="d-flex flex-column align-items-center w-100 gap-4">
            @for (mod of navModules; track mod.route) {
              <a
                [routerLink]="mod.route"
                routerLinkActive="active"
                class="rc-rail-btn"
                [title]="mod.label"
                [attr.aria-label]="mod.label"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path [attr.d]="mod.iconPath"></path>
                </svg>
              </a>
            }
          </div>
        </nav>

        <main
          id="rc-main-canvas"
          class="rc-zone-canvas"
          tabindex="-1"
          role="main"
          aria-label="Analytical Workspace Content"
        >
          <router-outlet></router-outlet>
        </main>

        <footer
          class="rc-zone-status d-flex align-items-center justify-content-between px-2 px-md-3 "
          [class.rc-zone-status-error]="state.statusIsError()"
          style="font-size: 11px;"
          role="contentinfo"
        >
          <div
            class="d-flex align-items-center gap-2 text-truncate me-3"
            role="status"
            aria-live="polite"
            [attr.title]="state.statusMessage()"
          >
            @if (state.isLoading()) {
              <span
                class="spinner-border spinner-border-sm text-info flex-shrink-0"
                role="status"
                aria-hidden="true"
                style="width: 11px; height: 11px; border-width: 1.5px;"
              ></span>
            }
            <span class="text-truncate text-white">
              {{ state.statusMessage() }}
            </span>
          </div>

          @if (state.latestExchange(); as exchange) {
            <div
              class="d-none d-lg-flex align-items-center gap-2 text-truncate me-auto ms-2"
              role="log"
              aria-live="polite"
              [attr.title]="exchangeLabel(exchange)"
            >
              <span
                class="rounded-circle flex-shrink-0"
                [class.bg-success]="exchange.level === 'success'"
                [class.bg-danger]="exchange.level === 'error'"
                [class.bg-info]="exchange.level === 'request'"
                style="width: 6px; height: 6px;"
                aria-hidden="true"
              ></span>
              <span class="text-white-50 text-truncate">
                {{ exchangeLabel(exchange) }}
              </span>
            </div>
          }

          <div class="d-flex align-items-center gap-3">
            <a
              href="https://www.linkedin.com/in/lo%C3%AFc-thiercelin/"
              class="text-white text-decoration-underline"
              title="Contact"
            >
              Contact
            </a>
            <span>-</span>
            <a
              routerLink="/accessibility"
              class="text-white text-decoration-underline"
              title="RGAA 4.1.2 &amp; WCAG 2.1 Accessibility Statement"
            >
              Accessibility
            </a>
            <span>-</span>
            <a
              routerLink="/privacy"
              class="text-white text-decoration-underline d-none d-sm-inline"
              title="GDPR Privacy Policy"
            >
              Privacy Policy
            </a>
          </div>
        </footer>

        @if (ingestion.isNavigatorModalOpen()) {
          <div
            class="rc-modal-backdrop"
            (click)="ingestion.cancelNavigator()"
            role="dialog"
            aria-modal="true"
            aria-labelledby="navigator-modal-title"
          >
            <div
              class="rc-modal-dialog rc-modal-lg"
              style="max-width: 920px"
              (click)="$event.stopPropagation()"
            >
              <div class="rc-modal-header">
                <div class="d-flex align-items-center gap-2">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      ry="2"
                    ></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="9" y1="21" x2="9" y2="9"></line>
                  </svg>
                  <div>
                    <h2 class="rc-modal-title" id="navigator-modal-title">
                      Navigator
                    </h2>
                    <div class="text-muted" style="font-size: 11px">
                      {{ ingestion.pendingFileName() }}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  class="rc-modal-close"
                  (click)="ingestion.cancelNavigator()"
                  aria-label="Close Navigator"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    aria-hidden="true"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              <div class="rc-modal-body p-0 d-flex" style="height: 440px">
                <div
                  class="border-end p-2 d-flex flex-column"
                  style="width: 250px; background-color: var(--rc-surface-subtle)"
                >
                  <div
                    class="overflow-y-auto flex-grow-1"
                    role="tree"
                    aria-label="Workbook Sheets"
                  >
                    <div
                      class="fw-semibold text-truncate px-2 py-1 text-secondary"
                      style="font-size: 11px"
                    >
                      {{ ingestion.pendingFileName() }}
                    </div>
                    <ul
                      class="list-unstyled mb-0 d-flex flex-column gap-1 ps-2"
                    >
                      @for (
                        sheet of ingestion.navigatorSheets();
                        track sheet.id
                      ) {
                        <li>
                          <button
                            type="button"
                            class="rc-btn rc-btn-sm w-100 justify-content-start text-start d-flex align-items-center gap-2"
                            [class.rc-btn-primary]="
                              ingestion.selectedNavigatorSheetId() === sheet.id
                            "
                            [class.rc-btn-ghost]="
                              ingestion.selectedNavigatorSheetId() !== sheet.id
                            "
                            (click)="
                              ingestion.selectedNavigatorSheetId.set(sheet.id)
                            "
                          >
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              aria-hidden="true"
                            >
                              @if (sheet.kind === "Table") {
                                <rect
                                  x="3"
                                  y="3"
                                  width="18"
                                  height="18"
                                  rx="2"
                                ></rect>
                                <line x1="3" y1="9" x2="21" y2="9"></line>
                                <line x1="3" y1="15" x2="21" y2="15"></line>
                                <line x1="9" y1="3" x2="9" y2="21"></line>
                              } @else {
                                <rect
                                  x="3"
                                  y="3"
                                  width="18"
                                  height="18"
                                  rx="2"
                                ></rect>
                                <line x1="3" y1="9" x2="21" y2="9"></line>
                                <line x1="9" y1="21" x2="9" y2="9"></line>
                              }
                            </svg>
                            <span class="text-truncate">{{ sheet.name }}</span>
                          </button>
                        </li>
                      }
                    </ul>
                  </div>
                </div>

                <div
                  class="flex-grow-1 d-flex flex-column overflow-hidden bg-body"
                >
                  @if (ingestion.selectedNavigatorSheet(); as sheet) {
                    <div
                      class="p-2 px-3 border-bottom d-flex align-items-center justify-content-between bg-body-tertiary"
                    >
                      <div class="d-flex align-items-center gap-2">
                        <span class="fw-bold" style="font-size: 13px">{{
                          sheet.name
                        }}</span>
                        <span
                          class="badge text-bg-secondary"
                          style="font-size: 10px"
                          >{{ sheet.kind }}</span
                        >
                        <span class="text-muted" style="font-size: 11px">
                          ({{
                            sheet.rows.length > 100
                              ? "first 100 of " +
                                sheet.rows.length +
                                " rows preview"
                              : sheet.rows.length + " rows preview"
                          }})
                        </span>
                      </div>
                      <div
                        class="text-muted fst-italic"
                        style="font-size: 11px"
                      >
                        Unpromoted raw data preview
                      </div>
                    </div>

                    <div class="flex-grow-1 overflow-auto">
                      <table class="rc-preview-table mb-0">
                        <thead>
                          <tr>
                            @for (col of sheet.columns; track col.name) {
                              <th>
                                <span
                                  class="fw-semibold"
                                  style="font-size: 11px"
                                  >{{ col.name }}</span
                                >
                              </th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of sheet.rows.slice(0, 100); track $index) {
                            <tr [class.table-light]="$index === 0">
                              @for (col of sheet.columns; track col.name) {
                                <td [class.fw-bold]="$index === 0">
                                  {{ row[col.name] ?? "—" }}
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else {
                    <div
                      class="p-4 text-center text-muted h-100 d-flex align-items-center justify-content-center"
                    >
                      @if (ingestion.navigatorError(); as navError) {
                        <span role="alert" class="text-danger fw-medium">{{
                          navError
                        }}</span>
                      } @else {
                        <span
                          >Select an item on the left to preview its table
                          data.</span
                        >
                      }
                    </div>
                  }
                </div>
              </div>

              <div class="rc-modal-footer justify-content-between">
                <div
                  class="text-muted d-inline-flex align-items-center flex-wrap gap-1"
                  style="font-size: 11px"
                >
                  <span>Generates:</span>
                  <code>Source</code>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                  <code>Navigation</code>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                  <code>Promoted Headers</code>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                  <code>Changed Type</code>
                </div>
                <div class="d-flex align-items-center gap-2">
                  <button
                    type="button"
                    class="rc-btn rc-btn-sm rc-btn-outline"
                    (click)="ingestion.cancelNavigator()"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="rc-btn rc-btn-sm rc-btn-outline d-inline-flex align-items-center gap-2"
                    [disabled]="!ingestion.selectedNavigatorSheet()"
                    (click)="ingestion.confirmNavigatorAndLoad('transform')"
                    id="navigator-transform-btn"
                  >
                    <span>Transform Data</span>
                  </button>
                  <button
                    type="button"
                    class="rc-btn rc-btn-sm rc-btn-primary d-inline-flex align-items-center gap-2"
                    [disabled]="!ingestion.selectedNavigatorSheet()"
                    (click)="ingestion.confirmNavigatorAndLoad('load')"
                    id="navigator-load-btn"
                  >
                    <span>Load</span>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        }
      </div>

      @if (state.mobileDrawerOpen()) {
        <div
          class="rc-mobile-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Workspace and Tools Drawer"
        >
          <div class="rc-mobile-drawer-panel p-3 d-flex flex-column gap-3">
            <div
              class="d-flex justify-content-between align-items-center border-bottom pb-2"
            >
              <div>
                <div class="fw-bold" style="font-size: 14px;">Workspace</div>
                <div class="text-muted" style="font-size: 11px;">
                  {{ state.activeProject().filename }} •
                  {{ state.activeProject().statusPill }}
                </div>
              </div>
              <button
                type="button"
                class="rc-btn rc-btn-secondary rc-btn-sm"
                (click)="state.toggleMobileDrawer(false)"
                aria-label="Close mobile workspace drawer"
              >
                Close
              </button>
            </div>

            <div>
              <div
                class="text-uppercase fw-bold  mb-2"
                style="color: var(--rc-text-secondary);"
              >
                Workspace Modules ({{ navModules.length }})
              </div>
              <div class="row g-2">
                @for (mod of navModules; track mod.route) {
                  <div class="col-6">
                    <button
                      type="button"
                      class="rc-btn rc-btn-outline w-100 text-start p-2 rounded"
                      style="background-color: var(--rc-surface-dark); color: var(--rc-text-pure); font-size: var(--rc-font-size-sm);"
                      (click)="navigateMobile(mod.route)"
                    >
                      <span
                        class="d-block fw-bold"
                        style="color: var(--rc-primary);"
                        >{{ mod.shortLabel }}</span
                      >
                      <span class=" text-white-50">{{ mod.label }}</span>
                    </button>
                  </div>
                }
              </div>
            </div>

            @if (isReportRoute()) {
              <div class="rc-card">
                <div class="card-body p-2">
                  <div class="fw-bold  mb-2">Report Pages</div>
                  <div class="d-flex flex-column gap-2">
                    @for (page of state.reportPages(); track page) {
                      <button
                        type="button"
                        class="rc-btn rc-btn-sm text-start"
                        [class.rc-btn-primary]="state.activePage() === page"
                        [class.rc-btn-outline]="state.activePage() !== page"
                        (click)="
                          onSelectReportPage(page);
                          state.toggleMobileDrawer(false)
                        "
                      >
                        {{ page }}
                      </button>
                    }
                  </div>
                </div>
              </div>
            }

            <div class="rc-card">
              <div class="card-body p-2">
                <div class="fw-bold  mb-2">Export Formats</div>
                <div class="d-flex flex-wrap gap-2">
                  @for (fmt of exportFormats; track fmt) {
                    <button
                      type="button"
                      class="rc-btn rc-btn-outline rc-btn-xs"
                      (click)="triggerQuickExport(fmt)"
                    >
                      {{ fmt }}
                    </button>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class AppComponent {
  public readonly state = inject(StateManagerService);
  public readonly authService = inject(AuthService);
  public readonly projectService = inject(ProjectSerializationService);
  public readonly ingestion = inject(IngestionWorkflowService);
  public readonly userMenuOpen = signal<boolean>(false);
  public readonly projectMenuOpen = signal<boolean>(false);
  public readonly editingProject = signal<boolean>(false);
  public readonly editingProjectValue = signal<string>("");
  public readonly isFullscreen = signal<boolean>(this.readFullscreenState());

  public exchangeLabel(exchange: ExchangeLogEntry): string {
    if (exchange.level === "request") {
      return `${exchange.method} request sent`;
    }
    if (exchange.level === "error") {
      return `${exchange.method} request failed (${exchange.status ?? "network error"}) after ${exchange.durationMs} ms`;
    }
    return `${exchange.method} request completed (${exchange.status ?? "unknown status"}) in ${exchange.durationMs} ms`;
  }
  private readonly exportService = inject(ExportService);
  private readonly router = inject(Router);

  public readonly exportMenuOpen = signal<boolean>(false);

  public readonly exportFormats: readonly ExportFormatType[] = [
    ".pdf",
    ".xlsx",
    ".parquet",
    ".csv",
  ];

  public readonly navModules: readonly NavModuleItem[] = [
    {
      route: "/report-builder",
      label: "Report Builder",
      shortLabel: "Report Builder",
      iconPath:
        "M4 19V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14M9 17v-5M13 17V9M17 17v-3",
    },
    {
      route: "/table-view",
      label: "Table View",
      shortLabel: "Table View",
      iconPath:
        "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5zm0 4h18M3 15h18M9 3v18",
    },
    {
      route: "/model-view",
      label: "Model View",
      shortLabel: "Model View",
      iconPath:
        "M5 5h5v5H5zM14 5h5v5h-5zM9 14h6v5H9zM7.5 10v4h1.5M16.5 10v4H15",
    },
    {
      route: "/rax-requests",
      label: "RAX Requests",
      shortLabel: "RAX Requests",
      iconPath:
        "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 5 3 3-3 3m5 0h3",
    },
    {
      route: "/data-prep",
      label: "Data Preparation",
      shortLabel: "Data Prep",
      iconPath: "M3 5h18l-7 8v6l-4-2v-4L3 5z",
    },
  ];

  public readonly currentUrl = signal<string>(this.router.url);

  private initialNavigation = true;

  constructor() {
    this.router.events
      .pipe(
        takeUntilDestroyed(),
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
      )
      .subscribe((event) => {
        const url = event.urlAfterRedirects || event.url;
        this.currentUrl.set(url);
        if (this.initialNavigation) {
          this.initialNavigation = false;
        } else {
          const mod = this.navModules.find((m) => url.startsWith(m.route));
          if (mod) {
            this.state.announce(`Navigated to ${mod.label}`);
          }
        }
      });
  }

  public readonly isReportRoute = computed(() => {
    const url = this.currentUrl();
    return url === "/" || url.startsWith("/report-builder");
  });

  public readonly isAuthRoute = computed(() => {
    const url = this.currentUrl();
    return url.startsWith("/login") || url.startsWith("/signup");
  });

  public readonly currentPageTitle = computed(() => {
    const url = this.currentUrl();
    const mod = this.navModules.find((m) => url.startsWith(m.route));
    if (mod) return mod.label;
    if (url.startsWith("/accessibility") || url.startsWith("/accessibilite"))
      return "Accessibility Statement";
    if (url.startsWith("/privacy") || url.startsWith("/confidentialite"))
      return "Privacy Policy";
    if (url.startsWith("/print-view")) return "Print View";
    if (url.startsWith("/login")) return "Log In";
    if (url.startsWith("/signup")) return "Sign Up";
    return "Report Builder";
  });

  public navigateTo(route: string): void {
    this.router.navigate([route]);
  }

  public navigateMobile(route: string): void {
    this.state.toggleMobileDrawer(false);
    this.router.navigate([route]);
  }

  public toggleExportMenu(): void {
    this.exportMenuOpen.update((v) => !v);
  }

  public triggerQuickExport(format: ExportFormatType): void {
    this.exportMenuOpen.set(false);
    if (this.state.mobileDrawerOpen()) {
      this.state.toggleMobileDrawer(false);
    }
    const reportId = this.state.activeProject().filename || "workspace-report";
    const visualId = this.state.activePage() || "executive-overview";
    this.exportService.triggerExport(reportId, visualId, format).subscribe({
      error: () => {
        // Error announcement is handled by ExportService
      },
    });
  }

  public toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
  }

  public onLogout(): void {
    this.userMenuOpen.set(false);
    this.authService.logout();
  }

  public toggleProjectMenu(event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    this.projectMenuOpen.update((open) => !open);
  }

  public onSaveProject(): void {
    this.projectMenuOpen.set(false);
    this.projectService.saveProject();
  }

  public triggerOpenProjectDialog(input: HTMLInputElement): void {
    this.projectMenuOpen.set(false);
    input.value = "";
    input.click();
  }

  public onOpenRcpFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void this.projectService.openProjectFile(file);
    }
    input.value = "";
  }

  public onCreateNewProject(): void {
    this.projectMenuOpen.set(false);
    this.projectService.createNewProject();
  }

  public startRenameProject(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.projectMenuOpen.set(false);
    this.editingProjectValue.set(
      this.state.activeProject().filename.replace(/\.rcp$/i, ""),
    );
    this.editingProject.set(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(
        ".rc-project-tab-input",
      );
      if (input) {
        input.focus();
        input.select();
      }
    }, 10);
  }

  public commitRenameProject(): void {
    if (!this.editingProject()) {
      return;
    }
    const newName = this.editingProjectValue().trim();
    this.editingProject.set(false);
    if (newName) {
      this.state.renameProject(newName);
    }
  }

  public cancelRenameProject(): void {
    this.editingProject.set(false);
  }

  public onSelectReportPage(page: string): void {
    this.state.selectPage(page);
    this.router.navigate(["/report-builder"]);
  }

  /** Toggles browser full-screen mode on the document root element. */
  public async toggleFullscreen(): Promise<void> {
    if (typeof document === "undefined") {
      return;
    }

    const doc = document as FullscreenDocument;
    const root = document.documentElement as FullscreenElement | null;
    const currentlyFullscreen = Boolean(this.getFullscreenElement(doc));

    try {
      if (currentlyFullscreen) {
        if (typeof doc.exitFullscreen === "function") {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === "function") {
          await doc.webkitExitFullscreen();
        } else {
          this.state.announce(
            "Full screen exit is not supported in this browser.",
            { safe: true },
          );
          return;
        }
      } else {
        if (root && typeof root.requestFullscreen === "function") {
          await root.requestFullscreen();
        } else if (root && typeof root.webkitRequestFullscreen === "function") {
          await root.webkitRequestFullscreen();
        } else {
          this.state.announce(
            "Full screen mode is not supported in this browser.",
            { safe: true },
          );
          return;
        }
      }
      this.syncFullscreenState(true);
    } catch {
      this.syncFullscreenState(false);
      this.state.announce("Unable to toggle full screen mode.", { safe: true });
    }
  }

  @HostListener("document:fullscreenchange")
  @HostListener("document:webkitfullscreenchange")
  public onFullscreenChange(): void {
    this.syncFullscreenState(true);
  }

  private getFullscreenElement(doc: FullscreenDocument): Element | null {
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  }

  private readFullscreenState(): boolean {
    if (typeof document === "undefined") {
      return false;
    }
    return Boolean(this.getFullscreenElement(document as FullscreenDocument));
  }

  private syncFullscreenState(announceChange: boolean): void {
    const active = this.readFullscreenState();
    const previous = this.isFullscreen();
    this.isFullscreen.set(active);
    if (announceChange && active !== previous) {
      this.state.announce(
        active ? "Entered full screen mode." : "Exited full screen mode.",
      );
    }
  }

  @HostListener("document:keydown.escape")
  public onEscapeKey(): void {
    if (this.editingProject()) {
      this.cancelRenameProject();
    }
    if (this.projectMenuOpen()) {
      this.projectMenuOpen.set(false);
    }
    if (this.userMenuOpen()) {
      this.userMenuOpen.set(false);
    }
    if (this.exportMenuOpen()) {
      this.exportMenuOpen.set(false);
    }
    if (this.ingestion.importMenuOpen()) {
      this.ingestion.closeImportMenu();
    }
    if (this.ingestion.isNavigatorModalOpen()) {
      this.ingestion.cancelNavigator();
    }
  }

  @HostListener("document:click", ["$event"])
  public onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (
      this.projectMenuOpen() &&
      !target.closest("#rc-current-project-container")
    ) {
      this.projectMenuOpen.set(false);
    }
    if (
      this.userMenuOpen() &&
      !target.closest("#user-profile-menu-container")
    ) {
      this.userMenuOpen.set(false);
    }
    if (
      this.exportMenuOpen() &&
      !target.closest("#export-dropdown-container")
    ) {
      this.exportMenuOpen.set(false);
    }
    if (
      this.ingestion.importMenuOpen() &&
      !target.closest("#import-dropdown-container")
    ) {
      this.ingestion.closeImportMenu();
    }
  }
}
