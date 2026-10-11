import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./CropBudget.css";

const DEFAULT_CROPS = [
    { key: "wheat", name: "Wheat" },
    { key: "rice", name: "Rice (Paddy)" },
    { key: "cotton", name: "Cotton" },
    { key: "maize", name: "Maize (Corn)" },
    { key: "sugarcane", name: "Sugarcane" },
    { key: "potato", name: "Potato" },
    { key: "tomato", name: "Tomato" },
    { key: "mango", name: "Mango" },
    { key: "chickpea", name: "Chickpea (Chana)" },
    { key: "onion", name: "Onion" },
    { key: "groundnut", name: "Groundnut (Peanut)" },
];

const SOIL_OPTIONS = [
    { id: "alluvial", label: "Alluvial Loam" },
    { id: "loamy", label: "Loamy Soil" },
    { id: "clay", label: "Clay Soil" },
    { id: "sandy", label: "Sandy Loam" },
    { id: "black-cotton", label: "Black Cotton" },
    { id: "silt", label: "Silt" },
    { id: "other", label: "Other / Mixed" },
];

const SEASON_OPTIONS = [
    { id: "rabi", label: "Rabi (Winter: Nov – Apr)" },
    { id: "kharif", label: "Kharif (Monsoon: Jun – Oct)" },
    { id: "zaid", label: "Zaid (Summer: Apr – Jun)" },
    { id: "year-round", label: "Year-Round" },
];

const IRRIGATION_OPTIONS = [
    { id: "drip", label: "Drip Irrigation (High Efficiency)" },
    { id: "sprinkler", label: "Sprinkler System" },
    { id: "furrow", label: "Furrow / Bed System" },
    { id: "flood", label: "Flood Irrigation (Canal / Tubewell)" },
    { id: "rainfed", label: "Rainfed (Barani)" },
];

export default function CropBudget() {
    const { authHeaders } = useAuth();
    const location = useLocation();

    // Active sub-tab: 'single' | 'compare' | 'history'
    const [activeTab, setActiveTab] = useState("single");

    // Single estimate form state
    const [cropName, setCropName] = useState("wheat");
    const [area, setArea] = useState(location.state?.area || 5);
    const [areaUnit, setAreaUnit] = useState(location.state?.areaUnit || "acres");
    const [soilType, setSoilType] = useState(location.state?.soilType || "loamy");
    const [season, setSeason] = useState("rabi");
    const [irrigationType, setIrrigationType] = useState("drip");
    const [marketPriceOverride, setMarketPriceOverride] = useState("");
    const [notes, setNotes] = useState("");

    // Comparison state
    const [compareCropsList, setCompareCropsList] = useState(["wheat", "rice", "cotton"]);
    const [compareResult, setCompareResult] = useState(null);
    const [compareLoading, setCompareLoading] = useState(false);

    // Results and UI state
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState("");
    const [estimation, setEstimation] = useState(null);
    const [history, setHistory] = useState([]);
    const [supportedCrops, setSupportedCrops] = useState(DEFAULT_CROPS);
    const [error, setError] = useState(null);

    // Fetch supported crops from backend
    useEffect(() => {
        async function fetchCrops() {
            try {
                const res = await fetch("/api/cost/crops");
                if (res.ok) {
                    const data = await res.json();
                    if (data.data?.crops?.length) {
                        setSupportedCrops(data.data.crops);
                    }
                }
            } catch (err) {
                // fallback to default crops
            }
        }
        fetchCrops();
    }, []);

    // Fetch user estimation history when on history tab
    useEffect(() => {
        if (activeTab === "history") {
            fetchHistory();
        }
    }, [activeTab]);

    // Automatically trigger estimation if area passed from Dashboard
    useEffect(() => {
        if (location.state?.area) {
            handleEstimate();
        }
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await fetch("/api/cost/history", {
                headers: authHeaders(),
            });
            if (res.ok) {
                const data = await res.json();
                setHistory(data.data?.estimations || []);
            }
        } catch (err) {
            console.error("Failed to load history:", err);
        }
    };

    const handleEstimate = async (e) => {
        if (e) e.preventDefault();
        setError(null);
        setSaveMessage("");
        setLoading(true);

        try {
            const payload = {
                cropName,
                area: Number(area),
                areaUnit,
                soilType,
                season,
                irrigationType,
            };
            if (marketPriceOverride) {
                payload.marketPrice = Number(marketPriceOverride);
            }

            const res = await fetch("/api/cost/estimate", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders(),
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || "Failed to calculate estimate");
            }

            setEstimation(data.data?.estimation);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveDetailed = async () => {
        if (!estimation) return;
        setSaving(true);
        setSaveMessage("");

        try {
            const payload = {
                cropName,
                area: Number(area),
                areaUnit,
                soilType,
                season,
                irrigationType,
                notes,
            };
            if (marketPriceOverride) {
                payload.marketPrice = Number(marketPriceOverride);
            }

            const res = await fetch("/api/cost/estimate/detailed", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders(),
                },
                body: JSON.stringify(payload),
            });

            const data = await res.json();
            if (res.ok) {
                setSaveMessage("✅ Budget snapshot successfully saved to your farm records!");
            } else {
                throw new Error(data.message || "Could not save budget");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCompare = async () => {
        if (compareCropsList.length < 2) {
            setError("Select at least 2 crops to compare");
            return;
        }
        setCompareLoading(true);
        setError(null);

        try {
            const res = await fetch("/api/cost/compare", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...authHeaders(),
                },
                body: JSON.stringify({
                    cropNames: compareCropsList,
                    area: Number(area),
                    soilType,
                    season,
                    irrigationType,
                }),
            });

            const data = await res.json();
            if (res.ok) {
                setCompareResult(data.data);
            } else {
                throw new Error(data.message || "Comparison failed");
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setCompareLoading(false);
        }
    };

    const handleDeleteHistory = async (id) => {
        try {
            const res = await fetch(`/api/cost/history/${id}`, {
                method: "DELETE",
                headers: authHeaders(),
            });
            if (res.ok) {
                setHistory(history.filter((h) => h._id !== id));
            }
        } catch (err) {
            console.error("Delete failed:", err);
        }
    };

    const toggleCropCompare = (key) => {
        if (compareCropsList.includes(key)) {
            if (compareCropsList.length > 2) {
                setCompareCropsList(compareCropsList.filter((k) => k !== key));
            }
        } else {
            if (compareCropsList.length < 5) {
                setCompareCropsList([...compareCropsList, key]);
            }
        }
    };

    return (
        <div className="budget-page">
            <div className="budget-content">
                {/* Header */}
                <div className="budget-header">
                    <div>
                        <h2>💰 Crop Budgeting & Break-Even Analysis</h2>
                        <p className="budget-subtitle">
                            Estimate per-acre operational costs, projected yields, gross revenues, and economic break-even thresholds.
                        </p>
                    </div>

                    <div className="budget-nav-tabs">
                        <button
                            className={`budget-tab-btn ${activeTab === "single" ? "active" : ""}`}
                            onClick={() => setActiveTab("single")}
                        >
                            📊 Single Crop Estimator
                        </button>
                        <button
                            className={`budget-tab-btn ${activeTab === "compare" ? "active" : ""}`}
                            onClick={() => {
                                setActiveTab("compare");
                                if (!compareResult) handleCompare();
                            }}
                        >
                            ⚖️ Multi-Crop Compare
                        </button>
                        <button
                            className={`budget-tab-btn ${activeTab === "history" ? "active" : ""}`}
                            onClick={() => setActiveTab("history")}
                        >
                            📑 Saved Records ({history.length})
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", color: "#fca5a5", padding: "12px 16px", borderRadius: "10px", marginBottom: "20px" }}>
                        ⚠️ {error}
                    </div>
                )}

                {/* ── Tab 1: Single Crop Estimator ── */}
                {activeTab === "single" && (
                    <div className="budget-grid">
                        {/* Parameter Form */}
                        <div className="budget-card">
                            <h3>⚙️ Farm & Crop Parameters</h3>
                            <form onSubmit={handleEstimate}>
                                <div className="form-group">
                                    <label>Target Crop</label>
                                    <select
                                        className="form-control"
                                        value={cropName}
                                        onChange={(e) => setCropName(e.target.value)}
                                    >
                                        {supportedCrops.map((c) => (
                                            <option key={c.key} value={c.key}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Land Area</label>
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0.1"
                                            className="form-control"
                                            value={area}
                                            onChange={(e) => setArea(e.target.value)}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Unit</label>
                                        <select
                                            className="form-control"
                                            value={areaUnit}
                                            onChange={(e) => setAreaUnit(e.target.value)}
                                        >
                                            <option value="acres">Acres</option>
                                            <option value="hectares">Hectares</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Soil Type</label>
                                    <select
                                        className="form-control"
                                        value={soilType}
                                        onChange={(e) => setSoilType(e.target.value)}
                                    >
                                        {SOIL_OPTIONS.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Growing Season</label>
                                    <select
                                        className="form-control"
                                        value={season}
                                        onChange={(e) => setSeason(e.target.value)}
                                    >
                                        {SEASON_OPTIONS.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Irrigation Method</label>
                                    <select
                                        className="form-control"
                                        value={irrigationType}
                                        onChange={(e) => setIrrigationType(e.target.value)}
                                    >
                                        {IRRIGATION_OPTIONS.map((i) => (
                                            <option key={i.id} value={i.id}>
                                                {i.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Market Price (PKR / Quintal) (Optional Override)</label>
                                    <input
                                        type="number"
                                        className="form-control"
                                        placeholder="Default Mandi baseline"
                                        value={marketPriceOverride}
                                        onChange={(e) => setMarketPriceOverride(e.target.value)}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    className="submit-btn"
                                    disabled={loading}
                                >
                                    {loading ? "Calculating Math..." : "⚡ Calculate Budget & Break-Even"}
                                </button>
                            </form>
                        </div>

                        {/* Results View */}
                        <div className="results-container">
                            {estimation ? (
                                <>
                                    {/* Financial Feasibility Metrics */}
                                    <div className="metrics-banner">
                                        <div className="metric-pill highlight-cost">
                                            <span className="label">Total Cultivation Cost</span>
                                            <span className="value">₨ {Number(estimation.totalCost).toLocaleString()}</span>
                                        </div>
                                        <div className="metric-pill highlight-rev">
                                            <span className="label">Expected Revenue</span>
                                            <span className="value">₨ {Number(estimation.expectedRevenue).toLocaleString()}</span>
                                        </div>
                                        <div className="metric-pill highlight-profit">
                                            <span className="label">Expected Net Profit</span>
                                            <span className="value">₨ {Number(estimation.expectedProfit).toLocaleString()}</span>
                                        </div>
                                        <div className="metric-pill highlight-roi">
                                            <span className="label">Projected ROI</span>
                                            <span className="value">{estimation.roi}</span>
                                        </div>
                                    </div>

                                    {/* Break-Even Gauge */}
                                    <div className="breakeven-banner">
                                        <div className="breakeven-info">
                                            <h4>🎯 Economic Break-Even Analysis</h4>
                                            <p>
                                                You need to harvest a minimum of <strong>{estimation.breakEvenYield.value} {estimation.breakEvenYield.unit}</strong> to cover all cultivation expenses at the current price of ₨ {estimation.marketPrice.value}/quintal.
                                            </p>
                                        </div>
                                        <div className="breakeven-gauge">
                                            <div className="gauge-pct">{estimation.breakEvenPercentOfExpected}</div>
                                            <div className="gauge-label">of expected yield needed</div>
                                        </div>
                                    </div>

                                    {/* Cost Breakdown */}
                                    <div className="budget-card">
                                        <h3>📋 Itemized Cost Breakdown ({area} {areaUnit})</h3>
                                        <div className="breakdown-grid">
                                            {Object.entries(estimation.costBreakdown || {}).map(([key, val]) => (
                                                <div className="breakdown-chip" key={key}>
                                                    <div className="cat">{key.replace(/([A-Z])/g, " $1")}</div>
                                                    <div className="amt">₨ {Number(val).toLocaleString()}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Risk & Agronomic Advice */}
                                    <div className="advice-section">
                                        <div className="advice-card warnings">
                                            <h5>⚠️ Risk Considerations</h5>
                                            <ul>
                                                {estimation.riskFactors?.length ? (
                                                    estimation.riskFactors.map((r, i) => <li key={i}>{r}</li>)
                                                ) : (
                                                    <li>Standard agricultural conditions apply.</li>
                                                )}
                                            </ul>
                                        </div>
                                        <div className="advice-card tips">
                                            <h5>💡 Cost Reduction Strategies</h5>
                                            <ul>
                                                {estimation.costReductionTips?.length ? (
                                                    estimation.costReductionTips.map((t, i) => <li key={i}>{t}</li>)
                                                ) : (
                                                    <li>Follow local IPM recommendations.</li>
                                                )}
                                            </ul>
                                        </div>
                                    </div>

                                    {/* Save to History Button */}
                                    <div className="budget-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
                                        <div>
                                            <h4 style={{ margin: 0, color: "#f8fafc", fontSize: "15px" }}>💾 Save this budget snapshot</h4>
                                            <p style={{ margin: "4px 0 0", color: "#94a3b8", fontSize: "12.5px" }}>Persist this estimation to your farm's records for seasonal tracking.</p>
                                        </div>
                                        <button
                                            onClick={handleSaveDetailed}
                                            disabled={saving}
                                            style={{ background: "#3b82f6", color: "white", border: "none", padding: "10px 18px", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}
                                        >
                                            {saving ? "Saving..." : "Save to Farm Budget"}
                                        </button>
                                    </div>
                                    {saveMessage && (
                                        <div style={{ color: "#34d399", fontWeight: "500", fontSize: "14px" }}>{saveMessage}</div>
                                    )}
                                </>
                            ) : (
                                <div className="budget-card empty-state">
                                    <div className="empty-state-icon">🌾</div>
                                    <h4>Ready to Budget Your Harvest</h4>
                                    <p>Select your crop and field acreage on the left and click "Calculate Budget" to view your financial feasibility report and break-even yield.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Tab 2: Multi-Crop Compare ── */}
                {activeTab === "compare" && (
                    <div className="budget-card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "12px" }}>
                            <div>
                                <h3 style={{ margin: 0 }}>⚖️ Compare Crops Side-by-Side ({area} {areaUnit})</h3>
                                <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0" }}>Select up to 5 crops to find the highest return on investment.</p>
                            </div>
                            <button
                                onClick={handleCompare}
                                className="submit-btn"
                                style={{ width: "auto", margin: 0, padding: "8px 18px" }}
                                disabled={compareLoading}
                            >
                                {compareLoading ? "Evaluating..." : "🔄 Re-Calculate Comparison"}
                            </button>
                        </div>

                        {/* Selectable crop chips */}
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "20px" }}>
                            {supportedCrops.slice(0, 10).map((c) => {
                                const selected = compareCropsList.includes(c.key);
                                return (
                                    <button
                                        key={c.key}
                                        type="button"
                                        onClick={() => toggleCropCompare(c.key)}
                                        style={{
                                            background: selected ? "rgba(16, 185, 129, 0.2)" : "rgba(30, 41, 59, 0.6)",
                                            border: `1px solid ${selected ? "#10b981" : "rgba(255,255,255,0.08)"}`,
                                            color: selected ? "#34d399" : "#94a3b8",
                                            padding: "6px 14px",
                                            borderRadius: "20px",
                                            fontSize: "13px",
                                            cursor: "pointer",
                                        }}
                                    >
                                        {selected ? "✓ " : "+ "} {c.name}
                                    </button>
                                );
                            })}
                        </div>

                        {compareResult?.comparisons?.length ? (
                            <div className="compare-table-wrapper">
                                <table className="compare-table">
                                    <thead>
                                        <tr>
                                            <th>Crop</th>
                                            <th>Total Investment</th>
                                            <th>Expected Yield</th>
                                            <th>Expected Revenue</th>
                                            <th>Net Profit</th>
                                            <th>ROI (%)</th>
                                            <th>Break-Even Yield</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {compareResult.comparisons.map((c, i) => {
                                            const isBest = compareResult.bestChoice?.crop === c.crop;
                                            const isTopProfit = compareResult.highestProfit?.crop === c.crop;
                                            return (
                                                <tr key={i}>
                                                    <td>
                                                        <div className="crop-badge">
                                                            {c.crop}
                                                            {isBest && <span className="badge-tag badge-best">Best Choice</span>}
                                                            {isTopProfit && <span className="badge-tag badge-profit">Top Profit</span>}
                                                        </div>
                                                    </td>
                                                    <td style={{ color: "#f87171", fontWeight: "600" }}>₨ {Number(c.totalCost).toLocaleString()}</td>
                                                    <td>{c.expectedYield.value} {c.expectedYield.unit}</td>
                                                    <td style={{ color: "#60a5fa" }}>₨ {Number(c.expectedRevenue).toLocaleString()}</td>
                                                    <td style={{ color: "#34d399", fontWeight: "700" }}>₨ {Number(c.expectedProfit).toLocaleString()}</td>
                                                    <td style={{ color: "#fbbf24", fontWeight: "700" }}>{c.roi}%</td>
                                                    <td>{c.breakEvenYield.value} {c.breakEvenYield.unit}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        ) : null}
                    </div>
                )}

                {/* ── Tab 3: History ── */}
                {activeTab === "history" && (
                    <div className="budget-card">
                        <h3>📑 Saved Farm Budget Snapshots</h3>
                        {history.length === 0 ? (
                            <div className="empty-state">
                                <p>No saved budget estimations found. Generate an estimate and click "Save to Farm Budget".</p>
                            </div>
                        ) : (
                            <div className="compare-table-wrapper">
                                <table className="compare-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Crop</th>
                                            <th>Area</th>
                                            <th>Total Cost</th>
                                            <th>Expected Profit</th>
                                            <th>ROI</th>
                                            <th>Break-Even</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((h) => (
                                            <tr key={h._id}>
                                                <td style={{ color: "#94a3b8" }}>{new Date(h.createdAt).toLocaleDateString()}</td>
                                                <td style={{ fontWeight: "600" }}>{h.cropName}</td>
                                                <td>{h.area?.value} {h.area?.unit}</td>
                                                <td style={{ color: "#f87171" }}>₨ {Number(h.totalCost).toLocaleString()}</td>
                                                <td style={{ color: "#34d399" }}>₨ {Number(h.expectedProfit).toLocaleString()}</td>
                                                <td style={{ color: "#fbbf24" }}>{h.roi}%</td>
                                                <td>{h.breakEvenYield?.value} {h.breakEvenYield?.unit}</td>
                                                <td>
                                                    <button
                                                        onClick={() => handleDeleteHistory(h._id)}
                                                        style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", fontSize: "14px" }}
                                                        title="Delete record"
                                                    >
                                                        🗑️
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
