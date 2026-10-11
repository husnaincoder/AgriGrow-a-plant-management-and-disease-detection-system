import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import LanguageSwitcher from "./LanguageSwitcher";
import WeatherAlertBadge from "./WeatherAlertBadge";
import { getAvatarUrl } from "../main";
import "./Navbar.css";

export default function Navbar({ modelReady, loadingStatus, isOnline, installPrompt, handleInstall }) {
    const { isAuthenticated, user, logout } = useAuth();
    const { t } = useLanguage();
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [mobileMenuOpen]);

    useEffect(() => {
        const handleOutsideClick = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        if (dropdownOpen) {
            document.addEventListener("mousedown", handleOutsideClick);
            document.addEventListener("touchstart", handleOutsideClick);
        }
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
            document.removeEventListener("touchstart", handleOutsideClick);
        };
    }, [dropdownOpen]);

    const handleLogoutClick = async () => {
        await logout();
        setDropdownOpen(false);
        navigate("/");
    };

    return (
        <nav className={`navbar glass-panel ${mobileMenuOpen ? "menu-open" : ""}`}>
            <div className="nav-container">
                <Link to="/" className="logo" onClick={() => setMobileMenuOpen(false)}>
                    <span className="logo-icon" aria-hidden="true">🌿</span>
                    <h1><span className="highlight">AgriGrow</span></h1>
                </Link>

                {/* Desktop Nav Links */}
                <div className="nav-links-desktop">
                    <Link to="/detect">{t("nav.detector")}</Link>
                    {isAuthenticated ? (
                        <>
                            <Link to="/dashboard">{t("nav.dashboard")}</Link>
                            <Link to="/calendar">{t("nav.calendar")}</Link>
                            <Link to="/market">{t("nav.market")}</Link>
                            <Link to="/qa">{t("nav.qa")}</Link>
                            <Link to="/community">{t("nav.community")}</Link>
                            <Link to="/budget">{t("nav.budget") || "Crop Budget"}</Link>
                        </>
                    ) : (
                        <>
                            <Link to="/dashboard" className="nav-link-locked" title="Login to access Dashboard">{t("nav.dashboard")} <span className="nav-lock-icon">🔒</span></Link>
                            <Link to="/calendar" className="nav-link-locked" title="Login to access Calendar">{t("nav.calendar")} <span className="nav-lock-icon">🔒</span></Link>
                            <Link to="/market" className="nav-link-locked" title="Login to view Market Prices">{t("nav.market")} <span className="nav-lock-icon">🔒</span></Link>
                            <Link to="/qa" className="nav-link-locked" title="Login to view Expert Q&A">{t("nav.qa")} <span className="nav-lock-icon">🔒</span></Link>
                            <Link to="/community" className="nav-link-locked" title="Login to view Community">{t("nav.community")} <span className="nav-lock-icon">🔒</span></Link>
                            <Link to="/budget" className="nav-link-locked" title="Login to view Crop Budget">{t("nav.budget") || "Crop Budget"} <span className="nav-lock-icon">🔒</span></Link>
                        </>
                    )}
                </div>

                <div className="nav-actions-desktop">
                    {/* Active Weather Notification Alert Bell */}
                    <WeatherAlertBadge />

                    {/* Language Switcher */}
                    <LanguageSwitcher />

                    {/* Connection Status indicator */}
                    {modelReady && (
                        <div className={`connection-status ${isOnline ? "online" : "offline"}`}>
                            <span className={isOnline ? "dot-online" : "dot-offline"} />
                            <span className="status-text">{isOnline ? t("nav.online") : t("nav.offline")}</span>
                        </div>
                    )}

                    {/* Install app btn */}
                    {installPrompt && (
                        <button className="install-btn" onClick={handleInstall}>
                            📲 Install
                        </button>
                    )}

                    {/* Admin Dashboard Badge for Admins */}
                    {isAuthenticated && ["superadmin", "admin", "editor"].includes(user?.role) && (
                        <Link to="/admin" className="nav-admin-badge" title="Admin Dashboard">
                            <span className="admin-badge-icon">🛡️</span>
                            <span>Admin</span>
                        </Link>
                    )}

                    {/* Authentication state profile widget */}
                    {isAuthenticated ? (
                        <div className="profile-dropdown-wrapper" ref={dropdownRef}>
                            <button
                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                className="nav-profile-trigger"
                                aria-label="Toggle user profile menu"
                            >
                                <img
                                    src={getAvatarUrl(user?.avatar) || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face"}
                                    alt="User Avatar"
                                    className="nav-avatar-img"
                                    onError={(e) => {
                                        e.target.onerror = null;
                                        e.target.src = "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face";
                                    }}
                                />
                                <span className="nav-username">{user?.name?.split(" ")[0]}</span>
                            </button>

                            {dropdownOpen && (
                                <div className="profile-dropdown">
                                    <div className="profile-dropdown-header">
                                        <div className="profile-user-name">{user?.name || "Farmer"}</div>
                                        <div className="profile-user-role">
                                            {user?.role === "superadmin"
                                                ? "👑 Super Admin"
                                                : user?.role === "admin"
                                                ? "🛡️ Administrator"
                                                : user?.role === "editor"
                                                ? "✏️ Editor"
                                                : "🌱 Farmer"}
                                        </div>
                                    </div>
                                    <div className="profile-dropdown-divider" />
                                    <Link to="/profile" onClick={() => setDropdownOpen(false)} className="profile-dropdown-item">
                                        <span className="dropdown-item-icon">👤</span>
                                        <span>{t("nav.profile")}</span>
                                    </Link>
                                    <Link to="/bookmarks" onClick={() => setDropdownOpen(false)} className="profile-dropdown-item">
                                        <span className="dropdown-item-icon">🔖</span>
                                        <span>{t("nav.bookmarks")}</span>
                                    </Link>
                                    {["superadmin", "admin", "editor"].includes(user?.role) && (
                                        <Link to="/admin" onClick={() => setDropdownOpen(false)} className="profile-dropdown-item nav-admin-link">
                                            <span className="dropdown-item-icon">⚙️</span>
                                            <span>Admin Dashboard</span>
                                        </Link>
                                    )}
                                    <div className="profile-dropdown-divider" />
                                    <button onClick={handleLogoutClick} className="profile-dropdown-item dropdown-logout-btn">
                                        <span className="dropdown-item-icon">🚪</span>
                                        <span>{t("nav.logout")}</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="nav-auth-buttons">
                            <Link to="/login" className="btn-login">{t("nav.login")}</Link>
                            <Link to="/register" className="btn-register">{t("nav.register")}</Link>
                        </div>
                    )}
                </div>

                {/* Mobile Hamburger menu button */}
                <button
                    className={`hamburger-btn ${mobileMenuOpen ? "open" : ""}`}
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    aria-label="Toggle Menu"
                >
                    <span className="bar bar-1"></span>
                    <span className="bar bar-2"></span>
                    <span className="bar bar-3"></span>
                </button>
            </div>

            {/* Mobile Dropdown Nav links drawer */}
            {mobileMenuOpen && (
                <div className="nav-mobile-drawer">
                    <div className="mobile-links">
                        <Link to="/detect" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                            <span className="drawer-icon">🔍</span>
                            <span className="drawer-text">{t("nav.detector")}</span>
                        </Link>
                        {isAuthenticated ? (
                            <>
                                <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">🗺️</span>
                                    <span className="drawer-text">{t("nav.dashboard")}</span>
                                </Link>
                                <Link to="/calendar" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">📅</span>
                                    <span className="drawer-text">{t("nav.calendar")}</span>
                                </Link>
                                <Link to="/market" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">💰</span>
                                    <span className="drawer-text">{t("nav.market")}</span>
                                </Link>
                                <Link to="/qa" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">💬</span>
                                    <span className="drawer-text">{t("nav.qa")}</span>
                                </Link>
                                <Link to="/community" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">👥</span>
                                    <span className="drawer-text">{t("nav.community")}</span>
                                </Link>
                                <Link to="/budget" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">💰</span>
                                    <span className="drawer-text">{t("nav.budget") || "Crop Budget"}</span>
                                </Link>
                                {["superadmin", "admin", "editor"].includes(user?.role) && (
                                    <Link to="/admin" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-admin-link">
                                        <span className="drawer-icon">⚙️</span>
                                        <span className="drawer-text">Admin</span>
                                    </Link>
                                )}
                            </>
                        ) : (
                            <>
                                <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">🗺️</span>
                                    <span className="drawer-text">{t("nav.dashboard")} 🔒</span>
                                </Link>
                                <Link to="/calendar" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">📅</span>
                                    <span className="drawer-text">{t("nav.calendar")} 🔒</span>
                                </Link>
                                <Link to="/market" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">💰</span>
                                    <span className="drawer-text">{t("nav.market")} 🔒</span>
                                </Link>
                                <Link to="/qa" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">💬</span>
                                    <span className="drawer-text">{t("nav.qa")} 🔒</span>
                                </Link>
                                <Link to="/community" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">👥</span>
                                    <span className="drawer-text">{t("nav.community")} 🔒</span>
                                </Link>
                                <Link to="/budget" onClick={() => setMobileMenuOpen(false)} className="drawer-link nav-link-locked">
                                    <span className="drawer-icon">💰</span>
                                    <span className="drawer-text">{t("nav.budget") || "Crop Budget"} 🔒</span>
                                </Link>
                            </>
                        )}
                        
                        <div className="drawer-separator"></div>

                        {isAuthenticated ? (
                            <>
                                <Link to="/profile" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">👤</span>
                                    <span className="drawer-text">{t("nav.profile")}</span>
                                </Link>
                                <Link to="/bookmarks" onClick={() => setMobileMenuOpen(false)} className="drawer-link">
                                    <span className="drawer-icon">🔖</span>
                                    <span className="drawer-text">{t("nav.bookmarks")}</span>
                                </Link>
                                <button onClick={handleLogoutClick} className="drawer-link drawer-logout-btn">
                                    <span className="drawer-icon">🚪</span>
                                    <span className="drawer-text">{t("nav.logout")}</span>
                                </button>
                            </>
                        ) : (
                            <div className="drawer-auth-row">
                                <Link to="/login" onClick={() => setMobileMenuOpen(false)} className="btn-login">{t("nav.login")}</Link>
                                <Link to="/register" onClick={() => setMobileMenuOpen(false)} className="btn-register">{t("nav.register")}</Link>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </nav>
    );
}
