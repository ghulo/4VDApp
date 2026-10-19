import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext';
import { I18nProvider } from './i18n/I18nProvider';
import { EmptyState, Loading } from './components/Feedback';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { ApiError } from './services/apiClient';
import { SectionTabs } from './components/SectionTabs';
import { SECTIONS } from './navigation/sections';
import { LoginPage } from './pages/LoginPage';
import {
  AcceptInvitePage,
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './pages/AccountPages';
import { OverviewPage } from './pages/OverviewPage';
import { ButtonLink } from './components/ui';
import { useT } from './i18n/useT';
import { useCurrentUser } from './auth/useAuth';
import { staffLayout } from './auth/roles';
import { ViewAsBar } from './components/ViewAsBar';

/** Loads a page's code only when someone first opens it, so the first visit stays light. */
function lazyPage<M extends Record<K, ComponentType<any>>, K extends keyof M>(load: () => Promise<M>, name: K) {
  return lazy(async () => ({ default: (await load())[name] }));
}

const ActivityPage = lazyPage(() => import('./pages/ActivityPage'), 'ActivityPage');
const InboxPage = lazyPage(() => import('./pages/InboxPage'), 'InboxPage');
const UpdatesPage = lazyPage(() => import('./pages/InboxPage'), 'UpdatesPage');
const CategoriesPage = lazyPage(() => import('./pages/CategoriesPage'), 'CategoriesPage');
const ProductStockTab = lazyPage(() => import('./pages/InventoryDetailPage'), 'ProductStockTab');
const OldStockPageRedirect = lazyPage(() => import('./pages/ProductPage'), 'OldStockPageRedirect');
const ProductPage = lazyPage(() => import('./pages/ProductPage'), 'ProductPage');
const InventoryPage = lazyPage(() => import('./pages/InventoryPage'), 'InventoryPage');
const ProductFormPage = lazyPage(() => import('./pages/ProductFormPage'), 'ProductFormPage');
const ProductsPage = lazyPage(() => import('./pages/ProductsPage'), 'ProductsPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const SalesPage = lazyPage(() => import('./pages/SalesPage'), 'SalesPage');
const DocumentDetailPage = lazyPage(() => import('./pages/DocumentDetailPage'), 'DocumentDetailPage');
const DocumentsPage = lazyPage(() => import('./pages/DocumentsPage'), 'DocumentsPage');
const OffersPage = lazyPage(() => import('./pages/OffersPage'), 'OffersPage');
const OfferDetailPage = lazyPage(() => import('./pages/OffersPage'), 'OfferDetailPage');
const BillDetailPage = lazyPage(() => import('./pages/BillDetailPage'), 'BillDetailPage');
const ScanCheckPage = lazyPage(() => import('./pages/ScanCheckPage'), 'ScanCheckPage');
const BillsPage = lazyPage(() => import('./pages/BillsPage'), 'BillsPage');
const OrderDetailPage = lazyPage(() => import('./pages/OrderDetailPage'), 'OrderDetailPage');
const ReportPage = lazyPage(() => import('./pages/ReportPage'), 'ReportPage');
const CarwashPage = lazyPage(() => import('./pages/CarwashPage'), 'CarwashPage');
const CashPage = lazyPage(() => import('./pages/CashPage'), 'CashPage');
const DayPage = lazyPage(() => import('./pages/DayPage'), 'DayPage');
const ExpensesPage = lazyPage(() => import('./pages/ExpensesPage'), 'ExpensesPage');
const BooksBalancesPage = lazyPage(() => import('./pages/BooksPages'), 'BooksBalancesPage');
const BooksJournalPage = lazyPage(() => import('./pages/BooksPages'), 'BooksJournalPage');
const BooksAccountsPage = lazyPage(() => import('./pages/BooksPages'), 'BooksAccountsPage');
const OpeningPage = lazyPage(() => import('./pages/OpeningPage'), 'OpeningPage');
const TrefinComparePage = lazyPage(() => import('./pages/TrefinComparePage'), 'TrefinComparePage');
const AccountCardPage = lazyPage(() => import('./pages/BooksPages'), 'AccountCardPage');
const MoneyPage = lazyPage(() => import('./pages/MoneyPages'), 'MoneyPage');
const PlaceBookPage = lazyPage(() => import('./pages/MoneyPages'), 'PlaceBookPage');
const StatementPage = lazyPage(() => import('./pages/MoneyPages'), 'StatementPage');
const VatPage = lazyPage(() => import('./pages/VatPages'), 'VatPage');
const SalesBookPage = lazyPage(() => import('./pages/VatPages'), 'SalesBookPage');
const PurchaseBookPage = lazyPage(() => import('./pages/VatPages'), 'PurchaseBookPage');
const FinancialStatementsPage = lazyPage(() => import('./pages/StatementsPages'), 'StatementsPage');
const YearPage = lazyPage(() => import('./pages/StatementsPages'), 'YearPage');
const CustomerDetailPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomerDetailPage');
const CustomersPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomersPage');
const CustomerStatementPage = lazyPage(() => import('./pages/CustomersPage'), 'CustomerStatementPage');
const TabsRedirect = lazyPage(() => import('./pages/CustomersPage'), 'TabsRedirect');
const SupplierDetailPage = lazyPage(() => import('./pages/SupplierDetailPage'), 'SupplierDetailPage');
const SuppliersPage = lazyPage(() => import('./pages/SuppliersPage'), 'SuppliersPage');
const NewOrderPage = lazyPage(() => import('./pages/NewOrderPage'), 'NewOrderPage');
const NewBillPage = lazyPage(() => import('./pages/NewBillPage'), 'NewBillPage');
const OrdersPage = lazyPage(() => import('./pages/OrdersPage'), 'OrdersPage');
const DuplicatesPage = lazyPage(() => import('./pages/DuplicatesPage'), 'DuplicatesPage');
const LabelsPage = lazyPage(() => import('./pages/LabelsPage'), 'LabelsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage'), 'ProfilePage');
const PromotionDetailPage = lazyPage(() => import('./pages/PromotionsPage'), 'PromotionDetailPage');
const PromotionsPage = lazyPage(() => import('./pages/PromotionsPage'), 'PromotionsPage');
const AskPage = lazyPage(() => import('./pages/AskPage'), 'AskPage');
const StockCountDetailPage = lazyPage(() => import('./pages/StockCountDetailPage'), 'StockCountDetailPage');
const StockCountsPage = lazyPage(() => import('./pages/StockCountsPage'), 'StockCountsPage');
const TrefinStockPage = lazyPage(() => import('./pages/TrefinStockPage'), 'TrefinStockPage');
const PersonPage = lazyPage(() => import('./pages/UsersPage'), 'PersonPage');
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');
const CounterPage = lazyPage(() => import('./pages/CounterPage'), 'CounterPage');
const WelcomePage = lazyPage(() => import('./pages/WelcomePage'), 'WelcomePage');
const DownloadPage = lazyPage(() => import('./pages/DownloadPage'), 'DownloadPage');
const StaffHomePage = lazyPage(() => import('./pages/staff/StaffHomePage'), 'StaffHomePage');
const MySalesPage = lazyPage(() => import('./pages/staff/MySalesPage'), 'MySalesPage');
const EndShiftPage = lazyPage(() => import('./pages/staff/EndShiftPage'), 'EndShiftPage');
const StaffProductsPage = lazyPage(() => import('./pages/staff/StaffProductsPage'), 'StaffProductsPage');
const StaffProductPage = lazyPage(() => import('./pages/staff/StaffProductsPage'), 'StaffProductPage');
const ScanLinkPage = lazyPage(() => import('./pages/staff/StaffProductsPage'), 'ScanLinkPage');
const NewProductPage = lazyPage(() => import('./pages/staff/NewProductPage'), 'NewProductPage');
const DeliveriesPage = lazyPage(() => import('./pages/staff/DeliveriesPage'), 'DeliveriesPage');
const StaffTabsPage = lazyPage(() => import('./pages/staff/StaffTabsPage'), 'StaffTabsPage');
const StaffTabPage = lazyPage(() => import('./pages/staff/StaffTabsPage'), 'StaffTabPage');
const StaffCountsPage = lazyPage(() => import('./pages/staff/StaffCountsPage'), 'StaffCountsPage');
const StaffCountPage = lazyPage(() => import('./pages/staff/StaffCountsPage'), 'StaffCountPage');
const ScanBillPage = lazyPage(() => import('./pages/staff/ScanBillPage'), 'ScanBillPage');

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

/** The Overview; the staff's own Home; or for the accountant (who sees only the money side) the VAT page. */
function HomePage() {
  const { role } = useCurrentUser();
  if (staffLayout(role)) return <StaffHomePage />;
  return role === 'accountant' ? <Navigate to="/books/vat" replace /> : <OverviewPage />;
}

/** One address, two pages: the staff layout's simple one, or the full dashboard's. */
function ByLayout({ staff, full }: { staff: ReactNode; full: ReactNode }) {
  const { role } = useCurrentUser();
  return staffLayout(role) ? staff : full;
}

function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <BrowserRouter>
              <ViewAsBar />
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                  <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
                  <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
                  <Route path="/confirm-email/:token" element={<ConfirmEmailChangePage />} />
                  <Route path="/invite/:token" element={<AcceptInvitePage />} />
                  {/* The Windows app: its download page, open to anyone, and its first-run welcome. */}
                  <Route path="/download" element={<DownloadPage />} />
                  <Route path="/welcome" element={<WelcomePage />} />
                  {/* The Counter fills the screen: no menu, no top bar. */}
                  <Route
                    path="/counter"
                    element={
                      <RequireAuth>
                        <CounterPage />
                      </RequireAuth>
                    }
                  />
                  <Route
                    element={
                      <RequireAuth>
                        <Layout />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<HomePage />} />
                    <Route path="my-sales" element={<MySalesPage />} />
                    <Route path="shift" element={<EndShiftPage />} />
                    <Route path="catalog" element={<StaffProductsPage />} />
                    <Route path="catalog/:id" element={<StaffProductPage />} />
                    <Route path="scan/:code" element={<ScanLinkPage />} />
                    <Route path="new-product" element={<NewProductPage />} />
                    <Route path="deliveries" element={<DeliveriesPage />} />
                    <Route path="scan-bill" element={<ScanBillPage />} />
                    <Route path="tabs/:id" element={<StaffTabPage />} />
                    <Route path="counts/:id/count" element={<StaffCountPage />} />
                    <Route element={<SectionTabs tabs={SECTIONS.inbox} labelKey="inbox" />}>
                      <Route path="inbox" element={<InboxPage />} />
                      <Route path="inbox/updates" element={<UpdatesPage />} />
                    </Route>
                    <Route path="approvals" element={<Navigate to="/inbox" replace />} />
                    <Route path="alerts" element={<Navigate to="/inbox/updates" replace />} />
                    <Route element={<SectionTabs tabs={SECTIONS.stock} labelKey="stock" />}>
                      <Route path="inventory" element={<InventoryPage />} />
                      <Route path="products" element={<ProductsPage />} />
                      <Route path="categories" element={<CategoriesPage />} />
                    </Route>
                    <Route path="inventory/duplicates" element={<DuplicatesPage />} />
                    <Route path="inventory/:productId" element={<OldStockPageRedirect />} />
                    <Route path="products/new" element={<ProductFormPage />} />
                    <Route path="products/:id" element={<ProductPage />}>
                      <Route index element={<ProductStockTab />} />
                      <Route path="details" element={<ProductFormPage />} />
                    </Route>
                    <Route path="labels" element={<LabelsPage />} />
                    <Route element={<SectionTabs tabs={SECTIONS.sales} labelKey="sales" />}>
                      <Route path="sales" element={<SalesPage />} />
                      <Route path="documents" element={<DocumentsPage />} />
                      <Route path="offers" element={<OffersPage />} />
                    </Route>
                    <Route path="documents/:id" element={<DocumentDetailPage />} />
                    <Route path="offers/:id" element={<OfferDetailPage />} />
                    <Route element={<SectionTabs tabs={SECTIONS.day} labelKey="day" />}>
                      <Route path="day" element={<DayPage />} />
                      <Route path="cash" element={<CashPage />} />
                      <Route path="carwash" element={<CarwashPage />} />
                    </Route>
                    <Route path="expenses" element={<ExpensesPage />} />
                    <Route element={<SectionTabs tabs={SECTIONS.books} labelKey="books" />}>
                      <Route path="books" element={<BooksBalancesPage />} />
                      <Route path="books/journal" element={<BooksJournalPage />} />
                      <Route path="books/accounts" element={<BooksAccountsPage />} />
                      <Route path="books/opening" element={<OpeningPage />} />
                      <Route path="books/vat" element={<VatPage />} />
                      <Route path="books/sales-book" element={<SalesBookPage />} />
                      <Route path="books/purchase-book" element={<PurchaseBookPage />} />
                      <Route path="books/statements" element={<FinancialStatementsPage />} />
                      <Route path="books/year" element={<YearPage />} />
                      <Route path="books/trefin" element={<TrefinComparePage />} />
                    </Route>
                    <Route path="books/accounts/:id" element={<AccountCardPage />} />
                    <Route path="money" element={<MoneyPage />} />
                    <Route path="money/:id" element={<PlaceBookPage />} />
                    <Route path="money/:id/statement" element={<StatementPage />} />
                    <Route element={<SectionTabs tabs={SECTIONS.reports} labelKey="reports" />}>
                      <Route path="report" element={<ReportPage />} />
                      <Route path="reports" element={<ReportsPage view="figures" />} />
                      <Route path="reports/team" element={<ReportsPage view="team" />} />
                      <Route path="reports/counter" element={<ReportsPage view="counter" />} />
                      <Route path="reports/profit" element={<ReportsPage view="profit" />} />
                      <Route path="reports/downloads" element={<ReportsPage view="downloads" />} />
                    </Route>
                    <Route path="customers" element={<CustomersPage />} />
                    <Route path="customers/:id" element={<CustomerDetailPage />} />
                    <Route path="customers/:id/statement" element={<CustomerStatementPage />} />
                    <Route path="tabs" element={<ByLayout staff={<StaffTabsPage />} full={<TabsRedirect />} />} />
                    <Route element={<SectionTabs tabs={SECTIONS.buy} labelKey="suppliers" />}>
                      <Route path="suppliers" element={<SuppliersPage />} />
                      <Route path="orders" element={<OrdersPage />} />
                      <Route path="bills" element={<BillsPage />} />
                    </Route>
                    <Route path="suppliers/:id" element={<SupplierDetailPage />} />
                    <Route path="orders/new" element={<NewOrderPage />} />
                    <Route path="orders/:id" element={<OrderDetailPage />} />
                    <Route path="bills/new" element={<NewBillPage />} />
                    <Route path="bills/scans/:id" element={<ScanCheckPage />} />
                    <Route path="bills/:id" element={<BillDetailPage />} />
                    <Route path="people" element={<UsersPage />} />
                    <Route path="people/:id" element={<PersonPage />} />
                    <Route path="counts" element={<ByLayout staff={<StaffCountsPage />} full={<StockCountsPage />} />} />
                    <Route path="counts/trefin/:id" element={<TrefinStockPage />} />
                    <Route path="counts/:id" element={<ByLayout staff={<StaffCountPage />} full={<StockCountDetailPage />} />} />
                    <Route path="promotions" element={<PromotionsPage />} />
                    <Route path="promotions/:id" element={<PromotionDetailPage />} />
                    <Route path="ask" element={<AskPage />} />
                    <Route path="settings/:section?" element={<SettingsPage />} />
                    <Route path="profile/:section?" element={<ProfilePage />} />
                    <Route path="activity" element={<ActivityPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

export default App;
