import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthContext';
import { EmptyState } from './components/Feedback';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { ApiError } from './services/apiClient';
import { CategoriesPage } from './pages/CategoriesPage';
import { InventoryDetailPage } from './pages/InventoryDetailPage';
import { InventoryPage } from './pages/InventoryPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { ProductsPage } from './pages/ProductsPage';

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
  return (
    <EmptyState title="This page doesn't exist">
      <Link to="/" className="button button--primary">
        Go to overview
      </Link>
    </EmptyState>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<OverviewPage />} />
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="inventory/:productId" element={<InventoryDetailPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="products/new" element={<ProductFormPage />} />
              <Route path="products/:id" element={<ProductFormPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
