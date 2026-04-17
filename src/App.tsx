import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { TaskMasterProvider } from './contexts/TaskMasterContext';
import { TasksSettingsProvider } from './contexts/TasksSettingsContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AppContent from './components/app/AppContent';
import SurveyDiagramWindow from './components/survey/view/SurveyDiagramWindow';
import i18n from './i18n/config.js';

export default function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            <TasksSettingsProvider>
              <TaskMasterProvider>
                <ProtectedRoute>
                  <Router basename={window.__ROUTER_BASENAME__ || ''}>
                    <Routes>
                      <Route path="/" element={<AppContent />} />
                      <Route path="/session/:projectName/:sessionId" element={<AppContent />} />
                      <Route path="/session/:sessionId" element={<Navigate to="/" replace />} />
                      <Route path="/survey/diagram" element={<SurveyDiagramWindow />} />
                    </Routes>
                  </Router>
                </ProtectedRoute>
              </TaskMasterProvider>
            </TasksSettingsProvider>
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}
