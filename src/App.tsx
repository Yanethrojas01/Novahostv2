import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/auth/ProtectedRoute';
import LoadingScreen from './components/ui/LoadingScreen';

// Lazy load pages for better performance
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));
const CreateVM = lazy(() => import('./pages/CreateVM'));
const VMDetails = lazy(() => import('./pages/VMDetails'));
const Settings = lazy(() => import('./pages/Settings'));
const Hypervisors = lazy(() => import('./pages/Hypervisors'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Profile = lazy(() => import('./pages/Profile'));

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/" replace />} />
        
        <Route element={<Layout />}>
          <Route path="/" element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } />
          
          <Route path="/create-vm" element={
            <ProtectedRoute>
              <CreateVM />
            </ProtectedRoute>
          } />
          
          <Route path="/vm/:id" element={
            <ProtectedRoute>
              <VMDetails />
            </ProtectedRoute>
          } />
          
          <Route path="/hypervisors" element={
            <ProtectedRoute>
              <Hypervisors />
            </ProtectedRoute>
          } />
          
          <Route path="/settings" element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } />

          <Route path="/profile" element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          } />

        </Route>

        
        
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;