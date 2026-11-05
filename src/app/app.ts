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
import { HelpCenterService } from "./core/help-center.service";
import { ExportFormatType, ExportService } from "./core/export.service";
import { AuthService } from "./core/auth.service";
import { ProjectSerializationService } from "./core/project-serialization.service";

interface NavModuleItem {
  readonly route: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly iconPath: string;
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
      .rc-page-tab-group {
        min-height: 38px;
        position: relative;
        display: inline-flex;
        align-items: center;
        background: transparent;
        border-bottom: 2px solid transparent;
        border-radius: var(--rc-radius-xs) var(--rc-radius-xs) 0 0;
        cursor: grab;
        user-select: none;
        transition:
          background-color var(--rc-transition-fast),
          border-color var(--rc-transition-fast);
      }
      .rc-page-tab-group:active {
        cursor: grabbing;
      }
      .rc-page-tab-group:hover {
        background-color: rgba(255, 255, 255, 0.08);
      }
      .rc-page-tab-group.active {
        background-color: rgba(255, 255, 255, 0.12);
        border-bottom-color: var(--rc-primary);
      }
      .rc-page-tab-group.rc-tab-dragging {
        opacity: 0.35;
      }
      .rc-page-tab-group.rc-tab-drop-left {
        box-shadow: inset 2px 0 0 0 var(--rc-primary);
      }
      .rc-page-tab-group.rc-tab-drop-right {
        box-shadow: inset -2px 0 0 0 var(--rc-primary);
      }
      .rc-page-tab {
        min-height: 36px;
        display: inline-flex;
        align-items: center;
        padding: 0 6px 0 10px;
        font-size: var(--rc-font-size-sm);
        font-weight: var(--rc-font-weight-semibold);
        color: var(--rc-neutral-soft);
        background: transparent !important;
        border: none !important;
        border-radius: var(--rc-radius-xs);
        cursor: pointer;
        white-space: nowrap;
        transition: color var(--rc-transition-fast);
      }
      .rc-page-tab:focus-visible {
        outline: 2px solid var(--rc-primary) !important;
        outline-offset: -2px !important;
      }
      .rc-page-tab-title {
        max-width: 140px;
      }
      .rc-page-tab-title svg {
        fill: currentColor;
        flex-shrink: 0;
      }
      .rc-page-tab.active {
        color: var(--rc-text-pure);
      }
      .rc-page-tab-group:hover .rc-page-tab {
        color: var(--rc-text-pure);
      }
      .rc-page-tab-actions {
        padding-right: 6px;
        padding-left: 2px;
        gap: 2px;
        display: inline-flex;
        align-items: center;
      }
      button.rc-tab-action-btn {
        width: 20px;
        height: 20px;
        padding: 0 !important;
        margin: 0 !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent !important;
        border: 0 !important;
        appearance: none !important;
        -webkit-appearance: none !important;
        border-radius: var(--rc-radius-xs);
        color: var(--rc-neutral-soft);
        cursor: pointer;
        opacity: 0;
        transition:
          opacity var(--rc-transition-fast),
          background-color var(--rc-transition-fast),
          color var(--rc-transition-fast);
      }
      .rc-page-tab-group:hover button.rc-tab-action-btn,
      .rc-page-tab-group:focus-within button.rc-tab-action-btn,
      .rc-page-tab-group.active button.rc-tab-action-btn {
        opacity: 0.8;
      }
      button.rc-tab-action-btn:hover,
      button.rc-tab-action-btn:focus-visible {
        opacity: 1 !important;
        background-color: rgba(255, 255, 255, 0.18) !important;
        color: var(--rc-text-pure) !important;
      }
      button.rc-tab-remove-btn:hover,
      button.rc-tab-remove-btn:focus-visible {
        color: var(--rc-status-danger-text, #ff7b7b) !important;
        background-color: rgba(224, 82, 82, 0.25) !important;
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
      .rc-user-menu {
        min-width: 220px;
      }
      .rc-project-menu {
        position: absolute;
        top: 100%;
        left: 0;
        min-width: 180px;
      }
      .rc-page-menu-container .dropdown-item,
      .rc-export-menu .dropdown-item,
      .rc-user-menu .dropdown-item,
      .rc-project-menu .dropdown-item {
        color: var(--rc-text-pure) !important;
        font-family: var(--rc-font-sans);
        font-size: var(--rc-font-size-sm);
        border-radius: var(--rc-radius-xs);
      }
      .rc-page-menu-container .dropdown-item svg,
      .rc-export-menu .dropdown-item svg,
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
        height: var(--rc-ribbon-height, 48px);
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
          <div
            class="d-flex align-items-center min-w-0 flex-grow-1 gap-2  me-2b "
          >
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
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="flex-shrink-0"
                    aria-hidden="true"
                  >
                    <path
                      d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                    ></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
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
                        width="14"
                        height="14"
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
                        width="14"
                        height="14"
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
                        width="14"
                        height="14"
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
                        width="14"
                        height="14"
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

            @if (isReportRoute()) {
              <nav aria-label="Report Pages">
                <ul
                  class="list-unstyled d-flex align-items-center  mb-0 min-w-0"
                >
                  @for (
                    page of state.reportPages();
                    track $index;
                    let i = $index
                  ) {
                    <li
                      class="rc-page-tab-group position-relative d-inline-flex align-items-center"
                      [class.active]="state.activePage() === page"
                      [class.rc-tab-dragging]="draggedPageIndex() === i"
                      [class.rc-tab-drop-left]="
                        dragOverIndex() === i && dragOverPosition() === 'left'
                      "
                      [class.rc-tab-drop-right]="
                        dragOverIndex() === i && dragOverPosition() === 'right'
                      "
                      [attr.draggable]="editingPageIndex() !== i"
                      (dragstart)="onPageDragStart($event, i)"
                      (dragover)="onPageDragOver($event, i)"
                      (dragenter)="onPageDragEnter($event, i)"
                      (dragleave)="onPageDragLeave($event, i)"
                      (drop)="onPageDrop($event, i)"
                      (dragend)="onPageDragEnd()"
                      (contextmenu)="onPageContextMenu($event, i)"
                    >
                      @if (editingPageIndex() === i) {
                        <input
                          #renameInput
                          type="text"
                          class="rc-page-tab-input"
                          [value]="editingPageValue()"
                          (input)="editingPageValue.set(renameInput.value)"
                          (keydown.enter)="commitRenamePage(page)"
                          (keydown.escape)="cancelRenamePage()"
                          (blur)="commitRenamePage(page)"
                          aria-label="Rename report page"
                        />
                      } @else {
                        <button
                          type="button"
                          class="rc-page-tab"
                          [class.active]="state.activePage() === page"
                          [attr.aria-current]="
                            state.activePage() === page ? 'page' : null
                          "
                          (click)="onSelectReportPage(page)"
                          (dblclick)="startRenamePage(i, page)"
                          (keydown)="onTabKeyDown($event, i, page)"
                          [title]="
                            'Page: ' +
                            page +
                            ' (Double-click to rename, drag to reorder)'
                          "
                        >
                          <span
                            class="rc-page-tab-title d-inline-flex align-items-center gap-2 text-truncate"
                          >
                            <svg
                              viewBox="0 -960 960 960"
                              width="18"
                              height="18"
                              fill="currentColor"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <path
                                d="M160-240h640v-320H520v-160H160v480Zm0 80q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"
                              />
                            </svg>
                            {{ page }}
                          </span>
                        </button>

                        <div
                          class="rc-page-tab-actions d-inline-flex align-items-center"
                        >
                          <button
                            type="button"
                            class="rc-tab-action-btn rc-page-menu-trigger"
                            (click)="togglePageMenu($event, i)"
                            [attr.aria-expanded]="pageMenuIndex() === i"
                            aria-label="Page options"
                            title="Page options"
                          >
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
                            >
                              <circle cx="12" cy="12" r="1.5"></circle>
                              <circle cx="12" cy="5" r="1.5"></circle>
                              <circle cx="12" cy="19" r="1.5"></circle>
                            </svg>
                          </button>

                          @if (state.reportPages().length > 1) {
                            <button
                              type="button"
                              class="rc-tab-action-btn rc-tab-remove-btn"
                              (click)="onRemoveReportPage($event, page)"
                              [attr.aria-label]="'Remove ' + page"
                              title="Remove page"
                            >
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
                              >
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          }
                        </div>
                      }

                      @if (pageMenuIndex() === i) {
                        <ul
                          class="rc-page-menu-container dropdown-menu show start-0 top-100 mt-1 shadow-sm p-1 list-unstyled mb-0"
                          role="menu"
                          [attr.aria-label]="page + ' options'"
                        >
                          <li role="none">
                            <button
                              type="button"
                              class="dropdown-item  py-1 d-flex align-items-center gap-2"
                              (click)="startRenamePage(i, page)"
                              role="menuitem"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <path d="M12 20h9"></path>
                                <path
                                  d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"
                                ></path>
                              </svg>
                              <span>Rename</span>
                            </button>
                          </li>

                          <li role="none">
                            <button
                              type="button"
                              class="dropdown-item  py-1 d-flex align-items-center gap-2"
                              [class.disabled]="i === 0"
                              [disabled]="i === 0"
                              [attr.aria-disabled]="i === 0 ? 'true' : null"
                              (click)="moveTab(page, 'left')"
                              role="menuitem"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="15 18 9 12 15 6"></polyline>
                              </svg>
                              <span>Move Left</span>
                            </button>
                          </li>

                          <li role="none">
                            <button
                              type="button"
                              class="dropdown-item  py-1 d-flex align-items-center gap-2"
                              [class.disabled]="
                                i === state.reportPages().length - 1
                              "
                              [disabled]="i === state.reportPages().length - 1"
                              [attr.aria-disabled]="
                                i === state.reportPages().length - 1
                                  ? 'true'
                                  : null
                              "
                              (click)="moveTab(page, 'right')"
                              role="menuitem"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                              <span>Move Right</span>
                            </button>
                          </li>

                          <li
                            role="separator"
                            class="dropdown-divider my-1"
                          ></li>

                          <li role="none">
                            <button
                              type="button"
                              class="dropdown-item  py-1 text-danger d-flex align-items-center gap-2"
                              [class.disabled]="state.reportPages().length <= 1"
                              [disabled]="state.reportPages().length <= 1"
                              (click)="onRemoveReportPage($event, page)"
                              role="menuitem"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="1.8"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path
                                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                                ></path>
                              </svg>
                              <span>Remove</span>
                            </button>
                          </li>
                        </ul>
                      }
                    </li>
                  }
                </ul>
              </nav>
              <button
                type="button"
                class="rc-btn rc-btn-ghost rc-btn-sm d-none d-lg-inline-flex flex-shrink-0 px-2"
                (click)="state.addReportPage()"
                aria-label="Add new report page"
                title="Add new report page"
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
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            }
          </div>

          <div
            class="d-flex align-items-center gap-2 flex-shrink-0 pe-2 pe-md-3"
          >
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
                  width="15"
                  height="15"
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
                              width="14"
                              height="14"
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
                              width="14"
                              height="14"
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
                              width="14"
                              height="14"
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
                              width="14"
                              height="14"
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
                              width="14"
                              height="14"
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
                width="15"
                height="15"
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
                  width="15"
                  height="15"
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
          class="rc-zone-rail d-none d-md-flex flex-column justify-content-between align-items-center py-2"
          aria-label="Primary Workspace Modules"
        >
          <div class="d-flex flex-column align-items-center w-100 my-auto">
            @for (mod of navModules; track mod.route) {
              <a
                [routerLink]="mod.route"
                routerLinkActive="active"
                class="rc-rail-btn mb-4"
                [title]="mod.label"
                [attr.aria-label]="mod.label"
              >
                <svg
                  width="20"
                  height="20"
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

          <div style="width: 36px; height: 36px;" aria-hidden="true"></div>
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
                Workspace Modules (6)
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
  public readonly userMenuOpen = signal<boolean>(false);
  public readonly projectMenuOpen = signal<boolean>(false);
  public readonly editingProject = signal<boolean>(false);
  public readonly editingProjectValue = signal<string>("");

  public exchangeLabel(exchange: ExchangeLogEntry): string {
    if (exchange.level === "request") {
      return `${exchange.method} request sent`;
    }
    if (exchange.level === "error") {
      return `${exchange.method} request failed (${exchange.status ?? "network error"}) after ${exchange.durationMs} ms`;
    }
    return `${exchange.method} request completed (${exchange.status ?? "unknown status"}) in ${exchange.durationMs} ms`;
  }
  public readonly helpCenter = inject(HelpCenterService);
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

  public readonly editingPageIndex = signal<number | null>(null);
  public readonly editingPageValue = signal<string>("");
  public readonly pageMenuIndex = signal<number | null>(null);
  public readonly draggedPageIndex = signal<number | null>(null);
  public readonly dragOverIndex = signal<number | null>(null);
  public readonly dragOverPosition = signal<"left" | "right" | null>(null);

  public onSelectReportPage(page: string): void {
    this.pageMenuIndex.set(null);
    this.state.selectPage(page);
    this.router.navigate(["/report-builder"]);
  }

  public startRenamePage(index: number, page: string): void {
    this.pageMenuIndex.set(null);
    this.editingPageIndex.set(index);
    this.editingPageValue.set(page);
    setTimeout(() => {
      const input =
        document.querySelector<HTMLInputElement>(".rc-page-tab-input");
      if (input) {
        input.focus();
        input.select();
      }
    }, 10);
  }

  public commitRenamePage(oldName: string): void {
    const newName = this.editingPageValue().trim();
    this.editingPageIndex.set(null);
    if (newName && newName !== oldName) {
      this.state.renameReportPage(oldName, newName);
    }
  }

  public cancelRenamePage(): void {
    this.editingPageIndex.set(null);
  }

  public onRemoveReportPage(event: Event, page: string): void {
    event.stopPropagation();
    this.pageMenuIndex.set(null);
    this.state.removeReportPage(page);
  }

  public togglePageMenu(event: Event, index: number): void {
    event.stopPropagation();
    this.pageMenuIndex.update((curr) => (curr === index ? null : index));
  }

  public onPageContextMenu(event: MouseEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.pageMenuIndex.set(index);
  }

  public moveTab(page: string, direction: "left" | "right"): void {
    this.pageMenuIndex.set(null);
    this.state.moveReportPage(page, direction);
  }

  public onPageDragStart(event: DragEvent, index: number): void {
    if (this.editingPageIndex() !== null) {
      event.preventDefault();
      return;
    }
    this.draggedPageIndex.set(index);
    this.pageMenuIndex.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
  }

  public onPageDragEnter(event: DragEvent, index: number): void {
    event.preventDefault();
  }

  public onPageDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    const fromIndex = this.draggedPageIndex();
    if (fromIndex === null || fromIndex === index) {
      this.dragOverIndex.set(null);
      this.dragOverPosition.set(null);
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const pos = event.clientX < midX ? "left" : "right";
    this.dragOverIndex.set(index);
    this.dragOverPosition.set(pos);
  }

  public onPageDragLeave(event: DragEvent, index: number): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.contains(event.relatedTarget as Node)) {
      if (this.dragOverIndex() === index) {
        this.dragOverIndex.set(null);
        this.dragOverPosition.set(null);
      }
    }
  }

  public onPageDrop(event: DragEvent, dropIndex: number): void {
    event.preventDefault();
    const fromIndex = this.draggedPageIndex();
    if (fromIndex !== null && fromIndex !== dropIndex) {
      const pos = this.dragOverPosition();
      let targetIndex = dropIndex;
      if (fromIndex < dropIndex) {
        targetIndex = pos === "left" ? dropIndex - 1 : dropIndex;
      } else {
        targetIndex = pos === "right" ? dropIndex + 1 : dropIndex;
      }
      const total = this.state.reportPages().length;
      if (
        targetIndex >= 0 &&
        targetIndex < total &&
        targetIndex !== fromIndex
      ) {
        this.state.reorderReportPages(fromIndex, targetIndex);
      }
    }
    this.onPageDragEnd();
  }

  public onPageDragEnd(): void {
    this.draggedPageIndex.set(null);
    this.dragOverIndex.set(null);
    this.dragOverPosition.set(null);
  }

  public onTabKeyDown(event: KeyboardEvent, index: number, page: string): void {
    if (event.key === "F2") {
      event.preventDefault();
      this.startRenamePage(index, page);
    } else if (event.key === "Delete") {
      if (this.state.reportPages().length > 1) {
        event.preventDefault();
        this.state.removeReportPage(page);
      }
    } else if (event.altKey && event.key === "ArrowLeft") {
      event.preventDefault();
      this.state.moveReportPage(page, "left");
    } else if (event.altKey && event.key === "ArrowRight") {
      event.preventDefault();
      this.state.moveReportPage(page, "right");
    }
  }

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
    if (this.pageMenuIndex() !== null) {
      this.pageMenuIndex.set(null);
    }
    if (this.editingPageIndex() !== null) {
      this.cancelRenamePage();
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
      this.pageMenuIndex() !== null &&
      !target.closest(".rc-page-tab-group")
    ) {
      this.pageMenuIndex.set(null);
    }
  }
}
