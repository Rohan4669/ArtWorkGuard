import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import { LoginPage, RegisterPage, ForgotPasswordPage } from './pages/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewComparison from './pages/NewComparison.jsx';
import ComparisonProgress from './pages/ComparisonProgress.jsx';
import ComparisonResults from './pages/ComparisonResults.jsx';
import ComparisonHistory from './pages/ComparisonHistory.jsx';
import ReportDetail from './pages/ReportDetail.jsx';
import { ProjectsPage, ProjectDetail } from './pages/Projects.jsx';
import Profile from './pages/Profile.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuth } from './context/AuthContext.jsx';

function PublicOnly({ children }) { const { user, loading } = useAuth(); return !loading && user ? <Navigate to="/" replace /> : children; }

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="comparisons" element={<ComparisonHistory />} />
          <Route path="comparisons/new" element={<NewComparison />} />
          <Route path="comparisons/:id" element={<ComparisonResults />} />
          <Route path="comparisons/:id/progress" element={<ComparisonProgress />} />
          <Route path="comparisons/:id/report" element={<ReportDetail />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
