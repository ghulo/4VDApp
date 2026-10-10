import { ErrorBoundary } from './components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n/I18nProvider';
import { EmptyState } from './components/Feedback';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { ApiError } from './services/apiClient';
import { ActivityPage } from './pages/ActivityPage';
import { InboxPage } from './pages/InboxPage';
import { SectionTabs } from './components/SectionTabs';
import { SECTIONS } from './navigation/sections';
import { CategoriesPage } from './pages/CategoriesPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import {
  AcceptInvitePage,
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AccountPages';
import { OverviewPage } from './pages/OverviewPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { ProductsPage } from './pages/ProductsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SalesPage } from './pages/SalesPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { BillDetailPage } from './pages/BillDetailPage';
import { BillsPage } from './pages/BillsPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { ReportPage } from './pages/ReportPage';
import { CarwashPage } from './pages/CarwashPage';
import { CashPage } from './pages/CashPage';
import { DayPage } from './pages/DayPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { CustomerDetailPage, CustomersPage, TabsRedirect } from './pages/CustomersPage';
import { SupplierDetailPage } from './pages/SupplierDetailPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { OrdersPage } from './pages/OrdersPage';
import { LabelsPage } from './pages/LabelsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { PromotionsPage } from './pages/PromotionsPage';
import { AskPage } from './pages/AskPage';
import { StockCountDetailPage } from './pages/StockCountDetailPage';
import { StockCountsPage } from './pages/StockCountsPage';
import { UsersPage } from './pages/UsersPage';
import { ButtonLink } from './components/ui';
import { useT } from './i18n/useT';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 404 or a permission error won't change the answer.
      retry: (failureCount, error) =>
        failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
});

function NotFoundPage() {
  const t = useT();
  return (
    <EmptyState title={t.notFound.title}>
      <ButtonLink to="/" variant="primary">
        {t.notFound.back}
      </ButtonLink>
    </EmptyState>
  );
}

function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
                <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
                <Route path="/confirm-email/:token" element={<ConfirmEmailChangePage />} />
                <Route path="/invite/:token" element={<AcceptInvitePage />} />
                <Route
                  element={
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<OverviewPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="approvals" element={<Navigate to="/inbox" replace />} />
                  <Route path="alerts" element={<Navigate to="/inbox#inbox-alerts" replace />} />
                  <Route element={<SectionTabs tabs={SECTIONS.stock} labelKey="stock" />}>
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="products" element={<ProductsPage />} />
                    <Route path="categories" element={<CategoriesPage />} />
                  </Route>
                  <Route path="inventory/:productId" element={<InventoryDetailPage />} />
                  <Route path="products/new" element={<ProductFormPage />} />
                  <Route path="products/:id" element={<ProductFormPage />} />
                  <Route path="labels" element={<LabelsPage />} />
                  <Route element={<SectionTabs tabs={SECTIONS.sales} labelKey="sales" />}>
                    <Route path="sales" element={<SalesPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                  </Route>
                  <Route path="documents/:id" element={<DocumentDetailPage />} />
                  <Route element={<SectionTabs tabs={SECTIONS.day} labelKey="day" />}>
                    <Route path="day" element={<DayPage />} />
                    <Route path="cash" element={<CashPage />} />
                    <Route path="carwash" element={<CarwashPage />} />
                  </Route>
                  <Route path="expenses" element={<ExpensesPage />} />
                  <Route element={<SectionTabs tabs={SECTIONS.reports} labelKey="reports" />}>
                    <Route path="report" element={<ReportPage />} />
                    <Route path="reports" element={<ReportsPage view="figures" />} />
                    <Route path="reports/team" element={<ReportsPage view="team" />} />
                    <Route path="reports/profit" element={<ReportsPage view="profit" />} />
                    <Route path="reports/downloads" element={<ReportsPage view="downloads" />} />
                  </Route>
                  <Route path="customers" element={<CustomersPage />} />
                  <Route path="customers/:id" element={<CustomerDetailPage />} />
                  <Route path="tabs" element={<TabsRedirect />} />
                  <Route path="suppliers" element={<SuppliersPage />} />
                  <Route path="suppliers/:id" element={<SupplierDetailPage />} />
                  <Route path="orders" element={<OrdersPage />} />
                  <Route path="orders/:id" element={<OrderDetailPage />} />
                  <Route path="bills" element={<BillsPage />} />
                  <Route path="bills/:id" element={<BillDetailPage />} />
                  <Route path="people" element={<UsersPage />} />
                  <Route path="counts" element={<StockCountsPage />} />
                  <Route path="counts/:id" element={<StockCountDetailPage />} />
                  <Route path="promotions" element={<PromotionsPage />} />
                  <Route path="ask" element={<AskPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="activity" element={<ActivityPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

export default App;
