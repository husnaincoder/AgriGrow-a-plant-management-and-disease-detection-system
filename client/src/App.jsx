import { useState, useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import ProtectedRoute from "./components/ProtectedRoute";

// Page Components
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import WeatherAlerts from "./pages/WeatherAlerts";
import CropCalendar from "./pages/CropCalendar";
import MarketPrices from "./pages/MarketPrices";
import ExpertQA from "./pages/ExpertQA";
import Profile from "./pages/Profile";
import Bookmarks from "./pages/Bookmarks";
import CropBudget from "./pages/CropBudget";

// Pre-existing views (refactored to fit routes easily)
import Dashboard from "./Dashboard";
import Community from "./Community";
import AdminDashboard from "./pages/AdminDashboard";

// Offline Support
import { syncToServer } from "./offlineStorage";
import "./App.css";

export default function App() {
    const { isAuthenticated } = useAuth();
    const navigate = useNavigate();
    
    // Global PWA and model health check states
    const [modelReady, setModelReady] = useState(false);
    const [loadingStatus, setLoadingStatus] = useState("Online detection available");
    const [offlineModelReady, setOfflineModelReady] = useState(false);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    /* Check API health. The offline TensorFlow model loads only when the user needs offline detection. */
    useEffect(() => {
        let pollTimer;
        let attempt = 0;
        let cancelled = false;

        async function poll() {
            try {
                const res = await fetch("/api/health");
                if (res.ok) {
                    const data = await res.json();
                    if (data.status === "ready") {
                        if (!cancelled) {
                            setLoadingStatus("Online detection available");
                            setModelReady(true);
                        }
                        return;
                    }

                    if (!cancelled) {
                        setLoadingStatus("AI Detection Ready (Browser Engine)");
                            setModelReady(true);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    setLoadingStatus("AI Detection Ready (Browser Engine)");
                    setModelReady(true);
                }
            }

            attempt++;
            if (cancelled || attempt > 15) return;
            const delay = Math.min(2000 * Math.pow(1.5, attempt - 1), 30000);
            pollTimer = setTimeout(poll, delay);
        }

        poll();

        return () => {
            cancelled = true;
            clearTimeout(pollTimer);
        };
    }, []);
    /* ── online / offline detection + sync ─────────────────────── */
    useEffect(() => {
        const checkRealInternet = async () => {
            if (!navigator.onLine) return false;
            try {
                await fetch("https://www.google.com/favicon.ico", { mode: 'no-cors', cache: 'no-store' });
                return true;
            } catch (e) {
                return false;
            }
        };

        const verifyOnline = async () => {
            const reallyOnline = await checkRealInternet();
            setIsOnline(reallyOnline);
            if (reallyOnline) {
                syncToServer().catch(() => {});
            }
        };

        // Initial check and periodic polling to catch lying browsers
        verifyOnline();
        const interval = setInterval(verifyOnline, 10000);

        window.addEventListener("online", verifyOnline);
        window.addEventListener("offline", () => setIsOnline(false));
        return () => {
            clearInterval(interval);
            window.removeEventListener("online", verifyOnline);
            window.removeEventListener("offline", () => setIsOnline(false));
        };
    }, []);

    /* ── PWA install prompt ─────────────────────────────────────────────── */
    useEffect(() => {
        const handler = (e) => { e.preventDefault(); setInstallPrompt(e); };
        window.addEventListener("beforeinstallprompt", handler);
        return () => window.removeEventListener("beforeinstallprompt", handler);
    }, []);

    const handleInstall = async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
    };

    return (
        <div className="landing-page">
            <Navbar
                modelReady={modelReady}
                loadingStatus={loadingStatus}
                isOnline={isOnline}
                installPrompt={installPrompt}
                handleInstall={handleInstall}
            />

            <div className="bg-blobs">
                <div className="blob blob-1"></div>
                <div className="blob blob-2"></div>
                <div className="blob blob-3"></div>
            </div>

            <div className="main-content-area" style={{ flex: 1, position: "relative", zIndex: 10 }}>
                <Routes>
                    <Route 
                        path="/" 
                        element={
                            <Home 
                                modelReady={modelReady} 
                                loadingStatus={loadingStatus} 
                                isOnline={isOnline}
                                onOfflineModelReady={setOfflineModelReady}
                            />
                        } 
                    />
                    <Route 
                        path="/detect" 
                        element={
                            <Home 
                                modelReady={modelReady} 
                                loadingStatus={loadingStatus} 
                                isOnline={isOnline}
                                onOfflineModelReady={setOfflineModelReady}
                            />
                        } 
                    />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    
                    {/* Protected routing endpoints */}
                    <Route 
                        path="/dashboard" 
                        element={
                            <ProtectedRoute>
                                <Dashboard onBack={() => navigate("/")} />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/budget" 
                        element={
                            <ProtectedRoute>
                                <CropBudget />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/calendar" 
                        element={
                            <ProtectedRoute>
                                <CropCalendar />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/profile" 
                        element={
                            <ProtectedRoute>
                                <Profile />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/bookmarks" 
                        element={
                            <ProtectedRoute>
                                <Bookmarks />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/alerts" 
                        element={
                            <ProtectedRoute>
                                <WeatherAlerts />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/admin" 
                        element={
                            <ProtectedRoute>
                                <AdminDashboard />
                            </ProtectedRoute>
                        } 
                    />

                    <Route 
                        path="/market" 
                        element={
                            <ProtectedRoute>
                                <MarketPrices />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/qa" 
                        element={
                            <ProtectedRoute>
                                <ExpertQA />
                            </ProtectedRoute>
                        } 
                    />
                    <Route 
                        path="/community" 
                        element={
                            <ProtectedRoute>
                                <Community onBack={() => navigate("/")} />
                            </ProtectedRoute>
                        } 
                    />
                </Routes>
            </div>

            <Footer isOnline={isOnline} isModelLoaded={offlineModelReady} />
        </div>
    );
}
