import { Routes } from "@angular/router";
import { authGuard } from "./core/auth.guard";
import { guestGuard } from "./core/guest.guard";

export const routes: Routes = [
  {
    path: "",
    pathMatch: "full",
    redirectTo: "report-builder",
  },
  {
    path: "login",
    title: "Log In — RollerCoaster",
    loadComponent: () =>
      import("./features/auth/login.component").then((m) => m.LoginComponent),
    canActivate: [guestGuard],
  },
  {
    path: "signup",
    title: "Sign Up — RollerCoaster",
    loadComponent: () =>
      import("./features/auth/signup.component").then((m) => m.SignupComponent),
    canActivate: [guestGuard],
  },
  {
    path: "report-builder",
    title: "Report Canvas — RollerCoaster",
    loadComponent: () =>
      import("./features/report-builder/report-builder.component").then(
        (m) => m.ReportBuilderComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "table-view",
    title: "Table View — RollerCoaster",
    loadComponent: () =>
      import("./features/table-view/table-view.component").then(
        (m) => m.TableViewComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "model-view",
    title: "Semantic Data Model — RollerCoaster",
    loadComponent: () =>
      import("./features/model-view/model-view.component").then(
        (m) => m.ModelViewComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "data-prep",
    title: "Data Preparation — RollerCoaster",
    loadComponent: () =>
      import("./features/data-prep/data-prep.component").then(
        (m) => m.DataPrepComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "rax-requests",
    title: "RAX Requests — RollerCoaster",
    loadComponent: () =>
      import("./features/rax-requests/rax-requests.component").then(
        (m) => m.RaxRequestsComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "print-view/:reportId",
    title: "Print View — RollerCoaster",
    loadComponent: () =>
      import("./features/print-view/print-view.component").then(
        (m) => m.PrintViewComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: "accessibility",
    title: "Accessibility Statement (RGAA 4.1.2 / WCAG 2.1 AA) — RollerCoaster",
    loadComponent: () =>
      import("./features/compliance/accessibility.component").then(
        (m) => m.accessibilityComponent,
      ),
  },
  {
    path: "accessibilite",
    redirectTo: "accessibility",
  },
  {
    path: "privacy",
    title: "GDPR Privacy Policy — RollerCoaster",
    loadComponent: () =>
      import("./features/compliance/privacy.component").then(
        (m) => m.privacyComponent,
      ),
  },
  {
    path: "confidentialite",
    redirectTo: "privacy",
  },
  {
    path: "**",
    redirectTo: "report-builder",
  },
];
