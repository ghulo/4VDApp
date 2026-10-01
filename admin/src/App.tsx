import { ApiStatus } from './components/ApiStatus';
import { DashboardPage } from './pages/DashboardPage';

function App() {
  return (
    <div className="layout">
      <header className="topbar">
        <h1 className="brand">4VD App Admin</h1>
        <ApiStatus />
      </header>
      <main className="content">
        <DashboardPage />
      </main>
    </div>
  );
}

export default App;
