import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Login from "./pages/Login";
import FacultyDashboard from "./pages/FacultyDashboard";
import HODDashboard from "./pages/HODDashboard";

const queryClient = new QueryClient();

function getAuthPayload() {
  const token = localStorage.getItem("accessToken");
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

function ProtectedRoute({ children, allowedRole }: { children: JSX.Element; allowedRole?: "hod" | "faculty" }) {
  const payload = getAuthPayload();
  if (!payload) return <Navigate to="/login" replace />;

  if (allowedRole && payload.role !== allowedRole) {
    return <Navigate to={payload.role === "hod" ? "/hod" : "/dashboard"} replace />;
  }

  return children;
}

function RootRedirect() {
  const payload = getAuthPayload();
  if (!payload) return <Navigate to="/login" replace />;
  return <Navigate to={payload.role === "hod" ? "/hod" : "/dashboard"} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRole="faculty">
                <FacultyDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hod"
            element={
              <ProtectedRoute allowedRole="hod">
                <HODDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
