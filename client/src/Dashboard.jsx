/* ==============================================================
   🗺️ Precision Agriculture Dashboard
   ==============================================================
   
   Split-screen dashboard with:
   LEFT:  Interactive Leaflet map with satellite imagery,
          polygon drawing, area calculation
   RIGHT: Control panel with weather, AI analysis,
          disease scan, and saved fields

   ARCHITECTURE:
   ┌──────────────────────────────────────────────────────────┐
   │                    Dashboard                             │
   │  ┌─────────────────────┐  ┌──────────────────────────┐  │
   │  │  Interactive Map     │  │   Control Panel          │  │
   │  │  • Esri Satellite   │  │  ┌────────────────────┐  │  │
   │  │  • Polygon Draw     │  │  │ Field Info Card     │  │  │
   │  │  • Area Calc        │  │  ├────────────────────┤  │  │
   │  │  • Saved Fields     │  │  │ Weather Card        │  │  │
   │  │  • Markers          │  │  ├────────────────────┤  │  │
   │  │                     │  │  │ AI Analysis Card    │  │  │
   │  │                     │  │  ├────────────────────┤  │  │
   │  │                     │  │  │ Disease Scanner     │  │  │
   │  │                     │  │  ├────────────────────┤  │  │
   │  │                     │  │  │ Saved Fields List   │  │  │
   │  └─────────────────────┘  │  └────────────────────┘  │  │
   │                            └──────────────────────────┘  │
   └──────────────────────────────────────────────────────────┘

   GEOSPATIAL MATH:
     • Area: Spherical excess formula (shoelface on sphere)
     • Centroid: Arithmetic mean of polygon vertices
     • @turf/turf equivalent — implemented in pure JS
   
   ============================================================== */

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./Dashboard.css";

/* ── Constants ────────────────────────────────────────────── */

const API_BASE = "/api/dashboard";

// Map defaults (Pakistan / South Asia focus)
const DEFAULT_CENTER = [30.3753, 69.3451]; // Pakistan center
const DEFAULT_ZOOM = 5;
const FIELD_ZOOM = 16;

// Leaflet CDN
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// Tile layers
const TILES = {
    satellite: {
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        attr: "&copy; Google Maps",
        maxNativeZoom: 20,
    },
    street: {
        url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        attr: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxNativeZoom: 19,
    },
    topo: {
        url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
        attr: '&copy; OpenTopoMap',
        maxNativeZoom: 17,
    },
};

// Field colors for multiple saved fields
const FIELD_COLORS = [
    "#10B981", "#3B82F6", "#F59E0B", "#EF4444",
    "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
];

// Weather icon mapping
const WEATHER_ICONS = {
    Clear: "☀️", Clouds: "☁️", Rain: "🌧️", Drizzle: "🌦️",
    Thunderstorm: "⛈️", Snow: "❄️", Mist: "🌫️", Fog: "🌫️",
    Haze: "🌫️", Dust: "💨", Smoke: "💨",
};

/* ── Geospatial Math ─────────────────────────────────────── */

const EARTH_RADIUS = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

/**
 * Calculate polygon area using Spherical Excess Formula.
 * 
 * MATH:
 *   For each edge (i → j) of the polygon:
 *     ΔA = (λ₂ - λ₁) × (2 + sin(φ₁) + sin(φ₂))
 *   Total area = |Σ ΔA| × R² / 2
 * 
 * This is equivalent to @turf/area for small polygons.
 */
function calcArea(latlngs, unit = "acres") {
    if (!latlngs || latlngs.length < 3) return 0;

    let area = 0;
    for (let i = 0; i < latlngs.length; i++) {
        const j = (i + 1) % latlngs.length;
        const lng1 = toRad(latlngs[i].lng);
        const lat1 = toRad(latlngs[i].lat);
        const lng2 = toRad(latlngs[j].lng);
        const lat2 = toRad(latlngs[j].lat);
        area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    const sqm = Math.abs(area) * EARTH_RADIUS * EARTH_RADIUS / 2;

    switch (unit) {
        case "hectares": return Math.round((sqm / 10000) * 10000) / 10000;
        case "sqft": return Math.round(sqm / 0.09290304);
        default: return Math.round((sqm / 4046.8564224) * 10000) / 10000;
    }
}

/**
 * Calculate centroid (arithmetic mean of vertices).
 * Equivalent to @turf/centroid for small polygons.
 */
function calcCentroid(latlngs) {
    if (!latlngs || latlngs.length === 0) return { lat: 0, lng: 0 };
    let sumLat = 0, sumLng = 0;
    for (const p of latlngs) {
        sumLat += p.lat;
        sumLng += p.lng;
    }
    return {
        lat: sumLat / latlngs.length,
        lng: sumLng / latlngs.length,
    };
}

/** Convert Leaflet LatLng[] → GeoJSON polygon coordinates */
function toGeoJSON(latlngs) {
    const ring = latlngs.map((ll) => [ll.lng, ll.lat]);
    ring.push([latlngs[0].lng, latlngs[0].lat]); // Close polygon
    return [ring];
}

/** Convert GeoJSON polygon → Leaflet LatLng[] */
function fromGeoJSON(coordinates) {
    if (!coordinates?.[0]) return [];
    return coordinates[0].slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
}

/* ── Dynamic Script/CSS Loader ──────────────────────────── */
function loadResource(url, type = "script") {
    return new Promise((resolve, reject) => {
        const tag = type === "css" ? "link" : "script";
        const selector = type === "css" ? `link[href="${url}"]` : `script[src="${url}"]`;
        if (document.querySelector(selector)) { resolve(); return; }

        const el = document.createElement(tag);
        if (type === "css") { el.rel = "stylesheet"; el.href = url; }
        else { el.src = url; el.async = true; }
        el.onload = resolve;
        el.onerror = reject;
        document.head.appendChild(el);
    });
}

/* ── Client-side Open-Meteo Weather Fallback ────────────── */
const mapClientWmo = (code) => {
    if (code === 0) return { condition: "Clear", conditionDetail: "clear sky", icon: "01d" };
    if ([1, 2].includes(code)) return { condition: "Clouds", conditionDetail: "partly cloudy", icon: "02d" };
    if (code === 3) return { condition: "Clouds", conditionDetail: "overcast", icon: "04d" };
    if ([45, 48].includes(code)) return { condition: "Fog", conditionDetail: "foggy", icon: "50d" };
    if ([51, 53, 55].includes(code)) return { condition: "Drizzle", conditionDetail: "light drizzle", icon: "09d" };
    if ([61, 63, 65, 80, 81, 82].includes(code)) return { condition: "Rain", conditionDetail: "rain showers", icon: "10d" };
    if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: "Snow", conditionDetail: "snowfall", icon: "13d" };
    if ([95, 96, 99].includes(code)) return { condition: "Thunderstorm", conditionDetail: "thunderstorm", icon: "11d" };
    return { condition: "Clear", conditionDetail: "clear sky", icon: "01d" };
};

async function fetchClientOpenMeteoWeather(lat, lng, locationLabel = "") {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code&hourly=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,precipitation_probability&forecast_days=2`;
        const res = await fetch(url);
        const data = await res.json();
        if (data?.current) {
            const wmo = mapClientWmo(data.current.weather_code);
            const current = {
                temperature: Math.round(data.current.temperature_2m * 10) / 10,
                feelsLike: Math.round(data.current.apparent_temperature * 10) / 10,
                humidity: Math.round(data.current.relative_humidity_2m),
                pressure: Math.round(data.current.surface_pressure),
                windSpeed: Math.round(data.current.wind_speed_10m * 10) / 10,
                windDirection: data.current.wind_direction_10m || 0,
                visibility: 10000,
                cloudCoverage: data.current.cloud_cover || 0,
                condition: wmo.condition,
                conditionDetail: wmo.conditionDetail,
                icon: wmo.icon,
                locationName: locationLabel || `Farmland (${Number(lat).toFixed(4)}°, ${Number(lng).toFixed(4)}°)`,
                fetchedAt: new Date().toISOString()
            };
            const forecast = [];
            const h = data.hourly;
            if (h?.time) {
                for (let i = 0; i < Math.min(h.time.length, 16); i += 2) {
                    const hwmo = mapClientWmo(h.weather_code[i]);
                    forecast.push({
                        dt: Math.floor(new Date(h.time[i]).getTime() / 1000),
                        date: new Date(h.time[i]).toISOString(),
                        temperature: Math.round(h.temperature_2m[i] * 10) / 10,
                        humidity: Math.round(h.relative_humidity_2m[i]),
                        condition: hwmo.condition,
                        conditionDetail: hwmo.conditionDetail,
                        icon: hwmo.icon,
                        windSpeed: Math.round(h.wind_speed_10m[i] * 10) / 10,
                        pop: Math.round(h.precipitation_probability[i] || 0)
                    });
                }
            }
            return { current, forecast };
        }
    } catch (_) {}
    return null;
}

const getClientFallbackCrops = (weather, seasonInfo, area) => ({
    recommendation: {
        fullResponse: `## 🌾 Best Crops to Grow Right Now

*   **Wheat (Gandum)**
    *   **Suitability:** Well-adapted to current temperatures (${weather?.temperature || 24}°C) and ${seasonInfo?.seasonName || "Rabi Season"}. Excellent drought tolerance and high caloric productivity.
    *   **Expected Yield:** 38–48 mounds per acre.
    *   **Water Requirements:** 3–4 timely irrigations during vegetative, tillering, and flowering stages.
    *   **Duration:** 120–135 days to harvest.
    *   **Market Insight:** High baseline demand across national markets with government minimum support pricing.

*   **Barley (Jau)**
    *   **Suitability:** Highly drought-resistant, thrives in low-fertility soils and cool periods.
    *   **Expected Yield:** 25–32 mounds per acre.
    *   **Water Requirements:** Minimal (2 light irrigations).
    *   **Duration:** 100–115 days.
    *   **Market Insight:** Growing demand for animal fodder and dietary grain products.

*   **Mustard / Canola (Sarson / Raya)**
    *   **Suitability:** Thrives in moderate humidity (${weather?.humidity || 50}%) and cool night temperatures.
    *   **Expected Yield:** 18–24 mounds per acre.
    *   **Water Requirements:** 2–3 irrigations with low water demand.
    *   **Duration:** 105–125 days.
    *   **Market Insight:** Outstanding profit margin with high demand for edible domestic oil production.

*   **Chickpeas / Gram (Chana)**
    *   **Suitability:** Deep-rooting nitrogen fixer ideal for sandy loam soils and moisture-constrained land.
    *   **Expected Yield:** 15–20 mounds per acre.
    *   **Water Requirements:** 1–2 irrigations (often rainfed).
    *   **Duration:** 110–130 days.
    *   **Market Insight:** Premium pulse rates in regional grain mandis.`
    }
});

const getClientFallbackDiseases = (weather, seasonInfo) => ({
    recommendation: {
        fullResponse: `## 🛡️ Disease Prevention for Current Conditions

With current humidity (${weather?.humidity || 50}%) and temperature (${weather?.temperature || 24}°C):

*   **Powdery Mildew & Rust Pathogens**
    *   **Cause:** Fungal spores multiplying under mild temperatures and fluctuating day/night moisture.
    *   **Early Symptoms:** White powder patches or orange/yellow rust pustules on leaf surfaces.
    *   **Preventive Measures:** Ensure 15–20cm row spacing for ventilation; apply prophylactic sulfur dusting or neem oil spray.
    *   **Treatment Cost:** ~800–1,200 PKR / acre.

*   **Aphids & Sucking Pests**
    *   **Cause:** Temperature swings favor rapid aphid colonisation on tender shoots.
    *   **Early Symptoms:** Leaf curling, sticky honeydew on stems, stunted growth.
    *   **Preventive Measures:** Yellow sticky traps along field perimeter; spray Imidacloprid (0.5ml/L) only if threshold exceeds 5 aphids/leaf.
    *   **Treatment Cost:** ~950 PKR / acre.

*   **Root Rot & Damping Off**
    *   **Cause:** Soil-borne pathogens in poorly drained patches.
    *   **Early Symptoms:** Yellowing lower foliage, weak root anchor.
    *   **Preventive Measures:** Avoid over-irrigation; treat seed with Trichoderma viride or Carboxin before sowing.
    *   **Treatment Cost:** ~600 PKR / acre.`
    }
});

const getClientFallbackTips = (weather, seasonInfo, area) => ({
    recommendation: {
        fullResponse: `## 🌤️ Weather-Based Farming Tips

*   **Irrigation Timing:** Apply irrigation in the early morning (6:00 AM – 9:00 AM) or late afternoon to minimize evaporation losses given current conditions.
*   **Fieldwork Window:** Ideal field operations between 8:00 AM and 4:00 PM; current wind speed (${weather?.windSpeed || 4} km/h) is suitable for precision spraying.
*   **Soil Management:** Apply straw mulching around field borders to conserve soil moisture and suppress weed emergence.

## 📊 Season Planning Summary (${Number(area || 1).toFixed(1)} Acres)

*   **Key Timeline:** Sowing completion recommended within the next 14 days for optimal tillering.
*   **Rotation Strategy:** Follow Rabi crops with short-duration green manure (Dhaincha/Sesbania) or Zaid pulses before Kharif planting.
*   **Estimated Production Investment:** ~35,000–45,000 PKR per acre covering certified seed, basal fertilizer, and fuel costs.`
    }
});

/* ================================================================
   MAIN DASHBOARD COMPONENT
   ================================================================ */
export default function Dashboard({ onBack }) {
    const { authHeaders } = useAuth();
    /* ── Map State ──────────────────────────────────────────── */
    const [mapReady, setMapReady] = useState(false);
    const [tileLayer, setTileLayer] = useState("satellite");

    /* ── Drawing State ──────────────────────────────────────── */
    const [drawingMode, setDrawingMode] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState([]);
    const [calculatedArea, setCalculatedArea] = useState(null);
    const [areaUnit, setAreaUnit] = useState("acres");

    /* ── Field Data State ───────────────────────────────────── */
    const [fieldName, setFieldName] = useState("");
    const [savedFields, setSavedFields] = useState([]);
    const [activeField, setActiveField] = useState(null);
    const [selectedLand, setSelectedLand] = useState({
        lat: 31.5204,
        lng: 74.3587,
        locationName: "Punjab Agricultural Basin, Pakistan",
        soilType: "Alluvial Loam / Silt Clay",
        season: "Rabi Season (Wheat, Mustard)",
        irrigation: "Canal & Ground Water",
        elevation: "215m ASL"
    });

    /* ── Weather State ──────────────────────────────────────── */
    const [weather, setWeather] = useState(null);
    const [forecast, setForecast] = useState([]);
    const [seasonInfo, setSeasonInfo] = useState(null);
    const [weatherLoading, setWeatherLoading] = useState(false);

    /* ── AI Analysis State ──────────────────────────────────── */
    const [aiSubTab, setAiSubTab] = useState("crops");
    const [aiCrops, setAiCrops] = useState(null);
    const [loadingCrops, setLoadingCrops] = useState(false);
    const [aiDiseases, setAiDiseases] = useState(null);
    const [loadingDiseases, setLoadingDiseases] = useState(false);
    const [aiTips, setAiTips] = useState(null);
    const [loadingTips, setLoadingTips] = useState(false);

    /* ── Disease Scanner State ──────────────────────────────── */
    const [scanFile, setScanFile] = useState(null);
    const [scanPreview, setScanPreview] = useState(null);
    const [scanResult, setScanResult] = useState(null);
    const [scanLoading, setScanLoading] = useState(false);

    /* ── UI State ───────────────────────────────────────────── */
    const [error, setError] = useState(null);
    const [panelTab, setPanelTab] = useState("field"); // field | weather | ai | scan | saved
    const [panelOpen, setPanelOpen] = useState(true);
    const [panelHeight, setPanelHeight] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    /* ── Bottom Sheet Drag & Resize State ───────────────────── */
    const panelRef = useRef(null);
    const dragStartYRef = useRef(0);
    const dragStartHeightRef = useRef(0);
    const isDraggingRef = useRef(false);
    const dragMovedRef = useRef(false);
    const justDraggedRef = useRef(false);

    /* ── Search State ──────────────────────────────────────── */
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [showSearchDropdown, setShowSearchDropdown] = useState(false);
    const searchWrapRef = useRef(null);

    /* ── Close search dropdown when clicking anywhere outside (including map) ── */
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
                setShowSearchDropdown(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("touchstart", handleClickOutside, { passive: true });
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("touchstart", handleClickOutside);
        };
    }, []);

    /* ── Refs ───────────────────────────────────────────────── */
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const tileRef = useRef(null);
    const drawingLayerRef = useRef(null);
    const fieldLayersRef = useRef({});
    const markersRef = useRef([]);
    const scanInputRef = useRef(null);
    const searchMarkerRef = useRef(null);
    const selectedLandMarkerRef = useRef(null);
    const vertexMarkersRef = useRef([]);
    const searchTimeoutRef = useRef(null);
    const hasAutoFlownRef = useRef(false);

    /* ── Toast helpers ──────────────────────────────────────── */
    const [successMsg, setSuccessMsg] = useState(null);
    const showError = (msg) => {
        setError(msg);
        setTimeout(() => setError(null), 5000);
    };
    const showSuccess = (msg) => {
        setSuccessMsg(msg);
        setTimeout(() => setSuccessMsg(null), 5000);
    };

    /* ── Weather Telemetry Loader (Dual: Backend API + Open-Meteo Fallback) ── */
    const loadWeatherTelemetry = useCallback(async (lat, lng, locationLabel = "") => {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null;
        setWeatherLoading(true);
        let resolved = null;
        try {
            const res = await fetch(`${API_BASE}/weather?lat=${lat}&lng=${lng}`);
            const data = await res.json();
            if (data?.success && data?.data?.current) {
                resolved = data.data;
            }
        } catch (_) {}

        // Fallback directly to Open-Meteo in browser if backend is cold/failed or returned mock data
        if (!resolved || !resolved.current || resolved.current.isMock) {
            const fallback = await fetchClientOpenMeteoWeather(lat, lng, locationLabel);
            if (fallback && fallback.current) {
                resolved = fallback;
            }
        }

        if (resolved && resolved.current) {
            const currentWeather = {
                ...resolved.current,
                locationName: locationLabel || resolved.current.locationName || `Farmland (${Number(lat).toFixed(4)}°, ${Number(lng).toFixed(4)}°)`
            };
            setWeather(currentWeather);
            setForecast(resolved.forecast || []);
            if (resolved.season) setSeasonInfo(resolved.season);
            setWeatherLoading(false);
            return currentWeather;
        }
        setWeatherLoading(false);
        return null;
    }, []);

    /* ── Location Search (Multi-provider: Photon + Nominatim) ── */
    const searchLocation = useCallback(async (query) => {
        if (!query || query.trim().length < 2) {
            setSearchResults([]);
            setShowSearchDropdown(false);
            return;
        }

        setSearchLoading(true);
        try {
            const q = query.trim();

            // Fire both free geocoding APIs in parallel for maximum coverage
            const [photonRes, nominatimRes] = await Promise.allSettled([
                // Photon (Komoot) — best rural/village coverage, no rate limit
                // Note: Photon doesn't support country filter in URL, we filter results below
                fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12`)
                    .then(r => r.json()),
                // Nominatim — with Pakistan viewbox bias (covers all of Pakistan)
                // Using viewbox + bounded=0 gives Pakistan priority without excluding other results
                fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=8&addressdetails=1&countrycodes=pk`, {
                    headers: { "Accept-Language": "en" },
                }).then(r => r.json()),
            ]);

            const merged = [];

            // Process Photon results — FILTER to Pakistan only (countrycode === "PK")
            if (photonRes.status === "fulfilled" && photonRes.value?.features) {
                for (const f of photonRes.value.features) {
                    const props = f.properties || {};
                    const [lng, lat] = f.geometry?.coordinates || [0, 0];
                    if (!lat && !lng) continue;

                    // *** CRITICAL: Only include Pakistan results ***
                    if (props.countrycode && props.countrycode.toUpperCase() !== "PK") continue;

                    // Build a readable display name from Photon properties
                    const parts = [props.name, props.street, props.city, props.county, props.state, props.country]
                        .filter(Boolean);
                    const displayName = parts.join(", ");

                    merged.push({
                        display_name: displayName,
                        lat: String(lat),
                        lon: String(lng),
                        type: props.type || props.osm_value || "place",
                        place_id: `photon-${props.osm_id || merged.length}`,
                        _source: "photon",
                    });
                }
            }

            // Add Nominatim results, skipping duplicates (within ~1km)
            if (nominatimRes.status === "fulfilled" && Array.isArray(nominatimRes.value)) {
                for (const r of nominatimRes.value) {
                    const lat = parseFloat(r.lat);
                    const lng = parseFloat(r.lon);
                    // Skip if too close to an already-added result
                    const isDuplicate = merged.some(
                        (m) => Math.abs(parseFloat(m.lat) - lat) < 0.01 && Math.abs(parseFloat(m.lon) - lng) < 0.01
                    );
                    if (!isDuplicate) {
                        merged.push({ ...r, _source: "nominatim" });
                    }
                }
            }

            // Cap at 8 results
            const final8 = merged.slice(0, 8);
            setSearchResults(final8);
            setShowSearchDropdown(final8.length > 0);
        } catch {
            setSearchResults([]);
            setShowSearchDropdown(false);
        }
        setSearchLoading(false);
    }, []);

    /** Debounced search — waits 1000ms after typing stops to prevent rate-limiting */
    const onSearchInput = (value) => {
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(() => searchLocation(value), 1000);
    };

    /** Fly to a search result and place a marker */
    const selectSearchResult = (result) => {
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);
        if (!mapRef.current || isNaN(lat) || isNaN(lng)) return;

        const map = mapRef.current;

        // Determine zoom based on result type
        let zoom = 14;
        const type = result.type || "";
        if (type === "country") zoom = 5;
        else if (type === "state" || type === "region") zoom = 7;
        else if (type === "county" || type === "district") zoom = 10;
        else if (type === "city" || type === "town") zoom = 13;
        else if (type === "village" || type === "hamlet") zoom = 15;
        else if (type === "suburb" || type === "neighbourhood") zoom = 16;

        // Fly to location
        map.flyTo([lat, lng], zoom, { duration: 1.5 });

        // Place a search marker
        if (searchMarkerRef.current) map.removeLayer(searchMarkerRef.current);

        const icon = L.divIcon({
            className: "search-marker-icon",
            html: '<div class="search-pin">📍</div>',
            iconSize: [32, 32],
            iconAnchor: [16, 32],
        });

        searchMarkerRef.current = L.marker([lat, lng], { icon })
            .addTo(map)
            .bindPopup(
                `<div style="font-family:Inter,sans-serif;font-size:13px;"><strong>${result.display_name?.split(",").slice(0, 3).join(", ")}</strong><br/><span style="color:#94a3b8;font-size:11px;">${lat.toFixed(4)}°, ${lng.toFixed(4)}°</span></div>`,
                { className: "search-popup" }
            )
            .openPopup();

        // ── Automatically enable weather & update selected land for the searched location ──
        setWeather(null);
        setAiAnalysis(null);
        setActiveField(null);
        setDrawingPoints([]); // Clear any partial drawing

        setSelectedLand({
            lat,
            lng,
            locationName: result.display_name?.split(",").slice(0, 3).join(", ") || "Selected Farmland",
            soilType: "Alluvial Loam / Clay Loam",
            season: "Rabi Season (Wheat, Mustard)",
            irrigation: "Canal & Ground Water",
            elevation: "Level Agricultural Basin"
        });
        
        // Fetch live weather telemetry for this point
        loadWeatherTelemetry(lat, lng, result.display_name?.split(",")[0]);

        // Close dropdown and keep query text
        setSearchQuery(result.display_name?.split(",").slice(0, 2).join(", ") || "");
        setShowSearchDropdown(false);
        setSearchResults([]);
    };

    /** Clear search */
    const clearSearch = () => {
        setSearchQuery("");
        setSearchResults([]);
        setShowSearchDropdown(false);
        if (searchMarkerRef.current && mapRef.current) {
            mapRef.current.removeLayer(searchMarkerRef.current);
            searchMarkerRef.current = null;
        }
    };

    /* ── Initialize Map ────────────────────────────────────── */
    useEffect(() => {
        if (!mapContainerRef.current || mapRef.current) return;

        const map = L.map(mapContainerRef.current, {
            center: DEFAULT_CENTER,
            zoom: DEFAULT_ZOOM,
            zoomControl: false,
            attributionControl: true,
            // ── Prevent world repetition & gray void ──
            minZoom: 3,
            maxBounds: [[-85, -180], [85, 180]],
            maxBoundsViscosity: 1.0,
            worldCopyJump: true,
        });

        L.control.zoom({ position: "bottomright" }).addTo(map);

        // Start with satellite imagery
        const tile = TILES[tileLayer];
        tileRef.current = L.tileLayer(tile.url, {
            attribution: tile.attr,
            maxZoom: 22,
            maxNativeZoom: tile.maxNativeZoom,
            noWrap: true,
        }).addTo(map);

        mapRef.current = map;
        setMapReady(true);

        // ── Dismiss search dropdown on any map interaction ──
        map.on("click", () => setShowSearchDropdown(false));
        map.on("dragstart", () => setShowSearchDropdown(false));

        // ── FIX: Force Leaflet to recalculate container size ──
        // Leaflet initializes before the flex layout is fully computed,
        // causing gray/missing tiles. Multiple invalidateSize calls at
        // staggered intervals ensure all tiles load correctly.
        setTimeout(() => map.invalidateSize(), 100);
        setTimeout(() => map.invalidateSize(), 300);
        setTimeout(() => map.invalidateSize(), 800);

        // Also recalculate on any window resize
        const onResize = () => map.invalidateSize();
        window.addEventListener("resize", onResize);

        // Geolocation button
        const geoCtrl = L.control({ position: "bottomright" });
        geoCtrl.onAdd = () => {
            const div = L.DomUtil.create("div", "leaflet-bar dash-geo-btn");
            div.innerHTML = "📍";
            div.title = "My Location";
            div.onclick = (e) => {
                e.stopPropagation();
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => map.flyTo([pos.coords.latitude, pos.coords.longitude], FIELD_ZOOM),
                        () => showError("Location access denied"),
                        { enableHighAccuracy: true }
                    );
                }
            };
            return div;
        };
        geoCtrl.addTo(map);

        return () => {
            window.removeEventListener("resize", onResize);
            map.remove();
            mapRef.current = null;
        };
    }, []);

    /* ── Recalculate map size on panel toggle or height change ── */
    useEffect(() => {
        if (!mapRef.current) return;
        const timer = setTimeout(() => {
            mapRef.current?.invalidateSize();
        }, 320);
        return () => clearTimeout(timer);
    }, [panelOpen, panelHeight]);

    useEffect(() => {
        if (!mapContainerRef.current || !mapRef.current) return;
        const resizeObserver = new ResizeObserver(() => {
            mapRef.current?.invalidateSize();
        });
        resizeObserver.observe(mapContainerRef.current);
        return () => resizeObserver.disconnect();
    }, [mapReady]);

    /* ── Toggle tile layers ────────────────────────────────── */
    useEffect(() => {
        if (!mapRef.current || !tileRef.current) return;
        mapRef.current.removeLayer(tileRef.current);
        const tile = TILES[tileLayer];
        tileRef.current = L.tileLayer(tile.url, {
            attribution: tile.attr,
            maxZoom: 22,
            maxNativeZoom: tile.maxNativeZoom,
            noWrap: true
        });
        tileRef.current.addTo(mapRef.current);
    }, [tileLayer]);

    /* ── Drawing Mode ──────────────────────────────────────── */
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;

        if (drawingMode) {
            map.getContainer().style.cursor = "crosshair";

            const onMapClick = (e) => {
                setShowSearchDropdown(false);
                setDrawingPoints((prev) => {
                    const next = [...prev, { lat: e.latlng.lat, lng: e.latlng.lng }];

                    // Update polygon preview
                    if (drawingLayerRef.current) map.removeLayer(drawingLayerRef.current);

                    if (next.length >= 2) {
                        drawingLayerRef.current = L.polygon(next, {
                            color: "#00ff88",
                            fillColor: "#00ff88",
                            fillOpacity: 0.12,
                            weight: 2.5,
                            dashArray: "8 6",
                        }).addTo(map);
                    }

                    // Add vertex marker
                    const vm = L.circleMarker([e.latlng.lat, e.latlng.lng], {
                        radius: 5,
                        color: "#fff",
                        fillColor: "#00ff88",
                        fillOpacity: 1,
                        weight: 2,
                        className: "draw-vertex",
                    }).addTo(map);
                    vertexMarkersRef.current.push(vm);

                    // Calculate area when we have 3+ points
                    if (next.length >= 3) {
                        setCalculatedArea(calcArea(next, areaUnit));
                    }

                    return next;
                });
            };

            map.on("click", onMapClick);

            return () => {
                map.off("click", onMapClick);
                map.getContainer().style.cursor = "";
            };
        } else {
            // When not drawing, clicking on map selects that land parcel and loads its live telemetry
            const onInspectClick = async (e) => {
                setShowSearchDropdown(false);
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;

                if (selectedLandMarkerRef.current && mapRef.current) {
                    mapRef.current.removeLayer(selectedLandMarkerRef.current);
                }

                const pinIcon = L.divIcon({
                    className: "dash-inspect-pin",
                    html: '<div class="inspect-pin-marker">📍</div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 28],
                });

                selectedLandMarkerRef.current = L.marker([lat, lng], { icon: pinIcon }).addTo(map);

                setSelectedLand({
                    lat,
                    lng,
                    locationName: `Farmland (${lat.toFixed(4)}°, ${lng.toFixed(4)}°)`,
                    soilType: "Fertile Alluvial Loam",
                    season: "Rabi Season (Wheat, Pulses)",
                    irrigation: "Canal & Tubewell Irrigated",
                    elevation: "Level Agricultural Basin"
                });

                setActiveField(null);

                // Fetch live weather telemetry for clicked coordinates
                loadWeatherTelemetry(lat, lng);

                // Reverse geocode in background
                try {
                    const rev = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
                    const revData = await rev.json();
                    const props = revData?.features?.[0]?.properties;
                    if (props) {
                        const parts = [props.name, props.city || props.district || props.county, props.state || props.country].filter(Boolean);
                        if (parts.length > 0) {
                            setSelectedLand(prev => ({
                                ...prev,
                                locationName: parts.join(", ")
                            }));
                        }
                    }
                } catch (_) {}
            };

            map.on("click", onInspectClick);

            return () => {
                map.off("click", onInspectClick);
                map.getContainer().style.cursor = "";
            };
        }
    }, [drawingMode, areaUnit]);

    /* ── Recalculate area when unit changes ─────────────────── */
    useEffect(() => {
        if (drawingPoints.length >= 3) {
            setCalculatedArea(calcArea(drawingPoints, areaUnit));
        }
    }, [areaUnit, drawingPoints]);

    /* ── Render saved fields on map ─────────────────────────── */
    useEffect(() => {
        if (!mapRef.current) return;
        const map = mapRef.current;

        // Clear existing field layers
        Object.values(fieldLayersRef.current).forEach((l) => map.removeLayer(l));
        markersRef.current.forEach((m) => map.removeLayer(m));
        fieldLayersRef.current = {};
        markersRef.current = [];

        savedFields.forEach((field, idx) => {
            if (!field.boundary?.coordinates?.[0]) return;
            const latlngs = fromGeoJSON(field.boundary.coordinates);
            if (latlngs.length < 3) return;

            const color = FIELD_COLORS[idx % FIELD_COLORS.length];
            const fieldId = field._id || field.id;
            const currentActiveId = activeField?._id || activeField?.id;
            const isActive = Boolean(currentActiveId && currentActiveId === fieldId);

            const polygon = L.polygon(latlngs, {
                color: isActive ? "#FFD700" : color,
                fillColor: color,
                fillOpacity: isActive ? 0.35 : 0.15,
                weight: isActive ? 3 : 2,
            }).addTo(map);

            polygon.bindTooltip(
                `<strong>${field.name}</strong><br/>${field.area?.value?.toFixed(2) || "?"} acres`,
                { permanent: false, direction: "center", className: "field-tooltip" }
            );

            polygon.on("click", (e) => {
                if (e) {
                    L.DomEvent.stopPropagation(e);
                    if (e.originalEvent) {
                        e.originalEvent.stopPropagation();
                        e.originalEvent.preventDefault?.();
                    }
                }
                flyToField(field);
            });

            fieldLayersRef.current[fieldId] = polygon;

            // Center marker
            if (field.centroid?.coordinates) {
                const [lng, lat] = field.centroid.coordinates;
                const marker = L.circleMarker([lat, lng], {
                    radius: 7,
                    color: "#fff",
                    fillColor: color,
                    fillOpacity: 1,
                    weight: 2,
                }).addTo(map);
                marker.bindTooltip(field.name, { direction: "top", offset: [0, -10] });
                marker.on("click", (e) => {
                    if (e) {
                        L.DomEvent.stopPropagation(e);
                        if (e.originalEvent) {
                            e.originalEvent.stopPropagation();
                            e.originalEvent.preventDefault?.();
                        }
                    }
                    flyToField(field);
                });
                markersRef.current.push(marker);
            }
        });
    }, [savedFields, activeField]);

    /* ── Delete Field (from DB & LocalStorage) ─────────────── */
    const deleteField = async (id, name = "") => {
        if (!id) return;

        // 1. Instantly remove polygon layer from map if it exists
        if (fieldLayersRef.current[id] && mapRef.current) {
            mapRef.current.removeLayer(fieldLayersRef.current[id]);
            delete fieldLayersRef.current[id];
        }

        // 2. Optimistically update React state immediately
        setSavedFields((prev) => prev.filter((f) => f._id !== id && f.id !== id));
        if (activeField?._id === id || activeField?.id === id) {
            setActiveField(null);
        }

        // 3. Remove from localStorage
        try {
            const stored = localStorage.getItem("agrigrow_saved_fields");
            if (stored) {
                const list = JSON.parse(stored).filter((f) => f._id !== id && f.id !== id);
                localStorage.setItem("agrigrow_saved_fields", JSON.stringify(list));
            }
        } catch (_) {}

        // 4. Remove from backend API
        try {
            await fetch(`${API_BASE}/fields/${id}`, {
                method: "DELETE",
                headers: { ...authHeaders() },
            });
        } catch (_) {}

        showSuccess(`Field ${name ? `"${name}" ` : ""}deleted successfully`);
        await fetchFields();
    };

    /* ── Fly to field (Opens saved land boundary) ──────────── */
    const flyToField = (field, targetTab = null) => {
        if (!mapRef.current || !field) return;
        const map = mapRef.current;

        // Clean up any inspect pin or old drawing markers
        if (selectedLandMarkerRef.current) {
            map.removeLayer(selectedLandMarkerRef.current);
            selectedLandMarkerRef.current = null;
        }
        if (drawingLayerRef.current) {
            map.removeLayer(drawingLayerRef.current);
            drawingLayerRef.current = null;
        }
        vertexMarkersRef.current.forEach((m) => map.removeLayer(m));
        vertexMarkersRef.current = [];
        setDrawingMode(false);
        setDrawingPoints([]);
        setCalculatedArea(null);

        // Fly to polygon boundary if coordinates are available
        if (field.boundary?.coordinates?.[0]) {
            const latlngs = fromGeoJSON(field.boundary.coordinates);
            if (latlngs.length >= 3) {
                const bounds = L.latLngBounds(latlngs);
                map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 18, duration: 1.2 });
            } else if (field.centroid?.coordinates) {
                const [lng, lat] = field.centroid.coordinates;
                map.flyTo([lat, lng], FIELD_ZOOM, { duration: 1.2 });
            }
        } else if (field.centroid?.coordinates) {
            const [lng, lat] = field.centroid.coordinates;
            map.flyTo([lat, lng], FIELD_ZOOM, { duration: 1.2 });
        } else if (field.centroid?.lat != null && field.centroid?.lng != null) {
            map.flyTo([field.centroid.lat, field.centroid.lng], FIELD_ZOOM, { duration: 1.2 });
        }

        setActiveField(field);

        // Find centroid coordinates of the selected land to fetch real-time live weather
        let targetLat = null;
        let targetLng = null;
        if (Array.isArray(field.centroid?.coordinates) && field.centroid.coordinates.length >= 2) {
            targetLng = Number(field.centroid.coordinates[0]);
            targetLat = Number(field.centroid.coordinates[1]);
        } else if (field.centroid?.lat != null && field.centroid?.lng != null) {
            targetLat = Number(field.centroid.lat);
            targetLng = Number(field.centroid.lng);
        } else if (field.lat != null && field.lng != null) {
            targetLat = Number(field.lat);
            targetLng = Number(field.lng);
        } else if (field.boundary?.coordinates?.[0]?.[0]) {
            targetLng = Number(field.boundary.coordinates[0][0][0]);
            targetLat = Number(field.boundary.coordinates[0][0][1]);
        }

        // Update selectedLand so all UI panels, title cards, and specs immediately reflect this field
        setSelectedLand({
            lat: targetLat,
            lng: targetLng,
            locationName: field.locationName || field.name || "Selected Farmland",
            soilType: field.soilType || "Fertile Alluvial Loam",
            season: field.season || seasonInfo?.seasonName || "Rabi Season (Wheat, Mustard)",
            irrigation: field.irrigation || "Canal & Tubewell Irrigated",
            elevation: field.elevation || "Level Agricultural Basin (~215m ASL)"
        });

        if (targetLat !== null && targetLng !== null && !isNaN(targetLat) && !isNaN(targetLng)) {
            const locLabel = field.name ? `${field.name}${field.locationName ? ` • ${field.locationName}` : ""}` : (field.locationName || field.name || "Selected Field");
            loadWeatherTelemetry(targetLat, targetLng, locLabel).then((w) => {
                if (w) field.weather = w;
                else if (field.weather && !field.weather.isMock) setWeather(field.weather);
            });
        } else if (field.weather && !field.weather.isMock) {
            setWeather(field.weather);
        }

        setAiAnalysis(field.aiRecommendation ? { recommendation: field.aiRecommendation, weather: field.weather } : null);
        
        // Preserve active tab if user is currently inspecting weather or ai, otherwise open field tab
        if (targetTab) {
            setPanelTab(targetTab);
        } else if (panelTab === "saved") {
            setPanelTab("field");
        }
        setPanelOpen(true);
    };

    /* ── Fetch saved fields on mount & sync with localStorage ── */
    const fetchFields = useCallback(async () => {
        let apiFields = [];
        try {
            const res = await fetch(`${API_BASE}/fields`, {
                headers: { ...authHeaders() },
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                apiFields = data.data;
            }
        } catch (_) {}

        // Read locally saved fields for offline/guest persistence
        let localFields = [];
        try {
            const stored = localStorage.getItem("agrigrow_saved_fields");
            if (stored) localFields = JSON.parse(stored);
        } catch (_) {}

        // Merge without duplicates
        const combined = [...apiFields];
        for (const lf of localFields) {
            if (!combined.some((f) => (f._id && f._id === lf._id) || (f.name === lf.name && f.createdAt === lf.createdAt))) {
                combined.push(lf);
            }
        }

        // Clean out any stale mock flags from previously stored fields so fresh live weather always loads
        combined.forEach((f) => {
            if (f.weather?.isMock) {
                delete f.weather;
            }
        });

        setSavedFields(combined);
        return combined;
    }, [authHeaders]);

    useEffect(() => { 
        fetchFields().then((fields) => {
            // Automatically open and fly to the most recent saved land on initial dashboard open
            if (fields && fields.length > 0 && !hasAutoFlownRef.current) {
                hasAutoFlownRef.current = true;
                setTimeout(() => {
                    flyToField(fields[0]);
                }, 400);
            }
        }); 
    }, [fetchFields]);

    /* ── Fetch initial telemetry for selected farmland on mount ── */
    useEffect(() => {
        if (!weather) {
            loadWeatherTelemetry(31.5204, 74.3587, "Punjab Agricultural Basin, PK");
        }
    }, [loadWeatherTelemetry]);

    /* ── Start Drawing (Unselects all old coordinates & markers) ─ */
    const startDrawing = () => {
        // 1. Completely unselect any previously selected field
        setActiveField(null);

        // 2. Remove inspection pin / old coordinate marker from map
        if (selectedLandMarkerRef.current && mapRef.current) {
            mapRef.current.removeLayer(selectedLandMarkerRef.current);
            selectedLandMarkerRef.current = null;
        }

        // 3. Clear any existing drawing polygon layer
        if (drawingLayerRef.current && mapRef.current) {
            mapRef.current.removeLayer(drawingLayerRef.current);
            drawingLayerRef.current = null;
        }

        // 4. Remove all old vertex marker dots from map
        vertexMarkersRef.current.forEach((m) => mapRef.current?.removeLayer(m));
        vertexMarkersRef.current = [];

        // 5. Reset drawing points, calculations, and inputs
        setDrawingMode(true);
        setDrawingPoints([]);
        setCalculatedArea(null);
        setFieldName("");
        setWeather(null);
        setAiAnalysis(null);
        setPanelTab("field");
        // Keep options panel open but transparent so user can easily see land underneath to draw
        setPanelOpen(true);
    };

    /* ── Undo Last Point ───────────────────────────────────── */
    const undoLastPoint = () => {
        const lastMarker = vertexMarkersRef.current.pop();
        if (lastMarker && mapRef.current) {
            mapRef.current.removeLayer(lastMarker);
        }

        setDrawingPoints((prev) => {
            const next = prev.slice(0, -1);
            if (drawingLayerRef.current && mapRef.current) {
                mapRef.current.removeLayer(drawingLayerRef.current);
                drawingLayerRef.current = null;
            }
            if (next.length >= 2) {
                drawingLayerRef.current = L.polygon(next, {
                    color: "#00ff88", fillColor: "#00ff88", fillOpacity: 0.12,
                    weight: 2.5, dashArray: "8 6",
                }).addTo(mapRef.current);
            }
            if (next.length >= 3) setCalculatedArea(calcArea(next, areaUnit));
            else setCalculatedArea(null);
            return next;
        });
    };

    /* ── Cancel Drawing ────────────────────────────────────── */
    const cancelDrawing = () => {
        setDrawingMode(false);
        setDrawingPoints([]);
        setCalculatedArea(null);
        if (drawingLayerRef.current && mapRef.current) {
            mapRef.current.removeLayer(drawingLayerRef.current);
            drawingLayerRef.current = null;
        }
        vertexMarkersRef.current.forEach((m) => mapRef.current?.removeLayer(m));
        vertexMarkersRef.current = [];
        setPanelOpen(true);
        setPanelHeight(null);
    };

    /* ── Finish Drawing & Keep on Field Tab to Save ────────── */
    const finishDrawing = async () => {
        if (drawingPoints.length < 3) {
            showError("Draw at least 3 points to form a field boundary");
            return;
        }

        setDrawingMode(false);
        // Automatically re-open panel on Field tab so user can see details & save the field!
        setPanelOpen(true);
        setPanelHeight(null);
        setPanelTab("field");

        // Clear vertex dots and render closed field polygon
        vertexMarkersRef.current.forEach((m) => mapRef.current?.removeLayer(m));
        vertexMarkersRef.current = [];

        if (drawingLayerRef.current && mapRef.current) {
            mapRef.current.removeLayer(drawingLayerRef.current);
        }
        if (mapRef.current) {
            drawingLayerRef.current = L.polygon(drawingPoints, {
                color: "#10b981",
                fillColor: "#10b981",
                fillOpacity: 0.22,
                weight: 3,
            }).addTo(mapRef.current);
        }

        // Calculate centroid for weather lookup
        const centroid = calcCentroid(drawingPoints);
        setSelectedLand((prev) => ({
            ...prev,
            lat: centroid.lat,
            lng: centroid.lng,
            locationName: fieldName.trim() || `Farmland (${centroid.lat.toFixed(4)}°, ${centroid.lng.toFixed(4)}°)`,
        }));

        // Fetch live weather telemetry
        await loadWeatherTelemetry(centroid.lat, centroid.lng, fieldName.trim() || "Drawn Farmland");
    };

    /* ── Save Field (Saves to Database & LocalStorage) ──────── */
    const saveField = async () => {
        if (drawingPoints.length < 3) {
            showError("No field boundary drawn — please place at least 3 points first");
            return;
        }
        const name = fieldName.trim() || `Field ${savedFields.length + 1}`;

        const centroid = calcCentroid(drawingPoints);
        const areaVal = calculatedArea || calcArea(drawingPoints, areaUnit) || 1;
        const geoCoords = toGeoJSON(drawingPoints);

        const newField = {
            _id: `field-${Date.now()}`,
            name,
            area: { value: areaVal, unit: areaUnit },
            season: seasonInfo?.name || "Rabi Season (Wheat, Mustard)",
            locationName: selectedLand?.locationName || weather?.locationName || `Farmland (${centroid.lat.toFixed(4)}°, ${centroid.lng.toFixed(4)}°)`,
            centroid: { type: "Point", coordinates: [centroid.lng, centroid.lat] },
            boundary: { type: "Polygon", coordinates: geoCoords },
            weather: weather ? { ...weather } : null,
            aiRecommendation: aiCrops?.recommendation?.summary || null,
            createdAt: new Date().toISOString()
        };

        let savedSuccessfully = false;

        // 1. Try saving to MongoDB via backend API
        try {
            const res = await fetch(`${API_BASE}/fields`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    name,
                    boundary: { type: "Polygon", coordinates: geoCoords },
                }),
            });
            const data = await res.json();
            if (data.success && data.data) {
                newField._id = data.data._id || newField._id;
                savedSuccessfully = true;
            }
        } catch (_) {}

        // 2. Always save to LocalStorage for 100% reliable offline/next-session persistence
        try {
            const stored = localStorage.getItem("agrigrow_saved_fields");
            const list = stored ? JSON.parse(stored) : [];
            const filtered = list.filter(f => f._id !== newField._id && f.name !== newField.name);
            filtered.unshift(newField);
            localStorage.setItem("agrigrow_saved_fields", JSON.stringify(filtered));
            savedSuccessfully = true;
        } catch (_) {}

        if (savedSuccessfully) {
            setActiveField(newField);
            setFieldName("");
            setDrawingPoints([]);
            setCalculatedArea(null);

            if (drawingLayerRef.current && mapRef.current) {
                mapRef.current.removeLayer(drawingLayerRef.current);
                drawingLayerRef.current = null;
            }
            vertexMarkersRef.current.forEach((m) => mapRef.current?.removeLayer(m));
            vertexMarkersRef.current = [];

            await fetchFields();
            showSuccess(`✓ Field "${name}" saved! It is now stored and will open on your dashboard.`);
        } else {
            showError("Failed to save field. Please try again.");
        }
    };

    /* ── Run AI Analysis ───────────────────────────────────── */
    const runTabAnalysis = async (tabType) => {
        // Resolve coordinates from drawn polygon, active saved field, or selected map land
        const centroid = drawingPoints.length >= 3
            ? calcCentroid(drawingPoints)
            : (Array.isArray(activeField?.centroid?.coordinates) && activeField.centroid.coordinates.length >= 2
                ? { lat: Number(activeField.centroid.coordinates[1]), lng: Number(activeField.centroid.coordinates[0]) }
                : (activeField?.centroid?.lat != null && activeField?.centroid?.lng != null
                    ? { lat: Number(activeField.centroid.lat), lng: Number(activeField.centroid.lng) }
                    : (activeField?.lat != null && activeField?.lng != null
                        ? { lat: Number(activeField.lat), lng: Number(activeField.lng) }
                        : (activeField?.boundary?.coordinates?.[0]?.[0]
                            ? { lat: Number(activeField.boundary.coordinates[0][0][1]), lng: Number(activeField.boundary.coordinates[0][0][0]) }
                            : (selectedLand?.lat != null && selectedLand?.lng != null
                                ? { lat: Number(selectedLand.lat), lng: Number(selectedLand.lng) }
                                : null)))));

        if (!centroid) {
            showError("Draw or select a field first");
            return;
        }

        setPanelTab("ai");
        setAiSubTab(tabType);

        const area = calculatedArea || activeField?.area?.value || 1;
        const payload = {
            fieldId: activeField?._id || activeField?.id || null,
            lat: centroid.lat,
            lng: centroid.lng,
            areaAcres: area,
            locationName: weather?.locationName || activeField?.locationName || selectedLand?.locationName || "",
            previousCrops: aiCrops?.recommendation?.fullResponse || "",
            previousDiseases: aiDiseases?.recommendation?.fullResponse || "",
        };

        try {
            if (tabType === 'crops') {
                setLoadingCrops(true);
                try {
                    const res = await fetch(`${API_BASE}/analyze/crops`, {
                        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload),
                    });
                    const data = await res.json();
                    const text = data?.data?.recommendation?.fullResponse;
                    if (data?.success && text && (!text.includes("AI servers are currently busy") || text.length > 250)) {
                        setAiCrops(data.data);
                    } else {
                        setAiCrops(getClientFallbackCrops(weather, seasonInfo, area));
                    }
                } catch {
                    setAiCrops(getClientFallbackCrops(weather, seasonInfo, area));
                } finally {
                    setLoadingCrops(false);
                }
            } else if (tabType === 'diseases') {
                setLoadingDiseases(true);
                try {
                    const res = await fetch(`${API_BASE}/analyze/diseases`, {
                        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload),
                    });
                    const data = await res.json();
                    const text = data?.data?.recommendation?.fullResponse;
                    if (data?.success && text && (!text.includes("AI servers are currently busy") || text.length > 250)) {
                        setAiDiseases(data.data);
                    } else {
                        setAiDiseases(getClientFallbackDiseases(weather, seasonInfo));
                    }
                } catch {
                    setAiDiseases(getClientFallbackDiseases(weather, seasonInfo));
                } finally {
                    setLoadingDiseases(false);
                }
            } else if (tabType === 'tips') {
                setLoadingTips(true);
                try {
                    const res = await fetch(`${API_BASE}/analyze/tips`, {
                        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload),
                    });
                    const data = await res.json();
                    const text = data?.data?.recommendation?.fullResponse;
                    if (data?.success && text && (!text.includes("AI servers are currently busy") || text.length > 250)) {
                        setAiTips(data.data);
                    } else {
                        setAiTips(getClientFallbackTips(weather, seasonInfo, area));
                    }
                } catch {
                    setAiTips(getClientFallbackTips(weather, seasonInfo, area));
                } finally {
                    setLoadingTips(false);
                }
            }
        } catch {
            if (tabType === 'crops') {
                setAiCrops(getClientFallbackCrops(weather, seasonInfo, area));
                setLoadingCrops(false);
            } else if (tabType === 'diseases') {
                setAiDiseases(getClientFallbackDiseases(weather, seasonInfo));
                setLoadingDiseases(false);
            } else if (tabType === 'tips') {
                setAiTips(getClientFallbackTips(weather, seasonInfo, area));
                setLoadingTips(false);
            }
        }
    };

    const runAnalysis = () => runTabAnalysis('crops');

    /* ── Disease Scan ──────────────────────────────────────── */
    const handleScanFile = (f) => {
        if (!f) return;
        const valid = ["image/jpeg", "image/png", "image/webp"];
        if (!valid.includes(f.type)) { showError("Please select a JPG, PNG or WebP image"); return; }
        if (f.size > 10 * 1024 * 1024) { showError("Image must be under 10 MB"); return; }
        setScanFile(f);
        setScanResult(null);
        const reader = new FileReader();
        reader.onload = (e) => setScanPreview(e.target.result);
        reader.readAsDataURL(f);
    };

    const submitScan = async () => {
        if (!scanFile) return;

        setScanLoading(true);
        setScanResult(null);

        const centroid = drawingPoints.length >= 3
            ? calcCentroid(drawingPoints)
            : (activeField?.centroid?.coordinates
                ? { lat: activeField.centroid.coordinates[1], lng: activeField.centroid.coordinates[0] }
                : { lat: 0, lng: 0 });

        const fd = new FormData();
        fd.append("image", scanFile);
        fd.append("fieldId", activeField?._id || "");
        fd.append("lat", centroid.lat);
        fd.append("lng", centroid.lng);

        try {
            const res = await fetch(`${API_BASE}/scan`, {
                method: "POST",
                headers: { ...authHeaders() },
                body: fd,
            });
            const data = await res.json();
            if (data.success) {
                setScanResult(data.data);
            } else {
                showError(data.error || "Scan failed");
            }
        } catch {
            showError("Disease scan request failed");
        }

        setScanLoading(false);
    };

    // deleteField and flyToField defined above

    /* ── Format AI text with markdown-like rendering ──────── */
    const renderAIText = (text) => {
        if (!text) return null;

        // Split into lines and process
        return text.split("\n").map((line, i) => {
            // H2 headers
            if (line.startsWith("## ")) {
                return <h3 key={i} className="ai-heading">{line.replace("## ", "")}</h3>;
            }
            // H3 headers
            if (line.startsWith("### ")) {
                return <h4 key={i} className="ai-subheading">{line.replace("### ", "")}</h4>;
            }
            // Bold text
            if (line.includes("**")) {
                const parts = line.split(/\*\*(.*?)\*\*/g);
                return (
                    <p key={i} className="ai-line">
                        {parts.map((part, j) =>
                            j % 2 === 1 ? <strong key={j}>{part}</strong> : part
                        )}
                    </p>
                );
            }
            // Bullet points
            if (line.trim().startsWith("- ") || line.trim().startsWith("• ")) {
                return <li key={i} className="ai-bullet">{line.replace(/^[\s]*[-•]\s*/, "")}</li>;
            }
            // Empty lines
            if (line.trim() === "") return <br key={i} />;
            // Regular text
            return <p key={i} className="ai-line">{line}</p>;
        });
    };

    /* ── Bottom Sheet Drag Handlers (Mobile) ─────────────────── */
    const handlePointerDown = (e) => {
        if (window.innerWidth > 900) return;
        // Don't start drag if clicking directly on the toggle badge button
        if (e.target.closest(".dash-toggle-badge")) return;

        try {
            e.currentTarget.setPointerCapture(e.pointerId);
        } catch (_) {}
        
        dragStartYRef.current = e.clientY;
        const currentHeight = panelRef.current ? panelRef.current.offsetHeight : (panelHeight || window.innerHeight * 0.55);
        dragStartHeightRef.current = currentHeight;
        isDraggingRef.current = true;
        dragMovedRef.current = false;
        setIsDragging(true);
    };

    const handlePointerMove = (e) => {
        if (!isDraggingRef.current) return;
        if (window.innerWidth > 900) return;
        
        const deltaY = e.clientY - dragStartYRef.current;
        if (Math.abs(deltaY) > 4) {
            dragMovedRef.current = true;
        }
        if (!dragMovedRef.current) return;

        // Fluid drag up and down
        const minHeight = 52;
        const maxHeight = Math.round(window.innerHeight * 0.88);
        const newHeight = Math.max(minHeight, Math.min(maxHeight, dragStartHeightRef.current - deltaY));
        
        setPanelHeight(newHeight);
        if (newHeight > 75) {
            setPanelOpen(true);
        } else {
            setPanelOpen(false);
        }
    };

    const handlePointerUp = (e) => {
        if (!isDraggingRef.current) return;
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch (_) {}

        setIsDragging(false);
        isDraggingRef.current = false;
        const wasDrag = dragMovedRef.current;
        dragMovedRef.current = false;

        if (wasDrag) {
            justDraggedRef.current = true;
            setTimeout(() => {
                justDraggedRef.current = false;
            }, 250);

            const deltaY = e.clientY - dragStartYRef.current;
            const finalHeight = dragStartHeightRef.current - deltaY;

            // 1. Fully close if dragged down all the way to the bottom edge
            if (finalHeight <= 90) {
                setPanelOpen(false);
                setPanelHeight(null);
            }
            // 2. Fully open if dragged near the top
            else if (finalHeight >= window.innerHeight * 0.82) {
                setPanelOpen(true);
                setPanelHeight(Math.round(window.innerHeight * 0.88));
            }
            // 3. Partially open / partially close: stays at the exact dragged height!
            else {
                setPanelOpen(true);
                setPanelHeight(Math.round(finalHeight));
            }
        }
    };

    const handlePointerCancel = (e) => {
        try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        } catch (_) {}
        setIsDragging(false);
        isDraggingRef.current = false;
        dragMovedRef.current = false;
    };

    const handleToggleClick = (e) => {
        // Handled directly if clicking on the badge button
        if (e.target.closest(".dash-toggle-badge")) return;
        if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
        }
        if (panelOpen) {
            setPanelOpen(false);
            setPanelHeight(null);
        } else {
            setPanelOpen(true);
            setPanelHeight(null);
        }
    };

    /* ── Computed Selected Land Details ──────────────────── */
    const currentLat = activeField?.centroid?.coordinates
        ? activeField.centroid.coordinates[1]
        : (drawingPoints.length > 0
            ? calcCentroid(drawingPoints).lat
            : (drawingMode ? null : selectedLand.lat));

    const currentLng = activeField?.centroid?.coordinates
        ? activeField.centroid.coordinates[0]
        : (drawingPoints.length > 0
            ? calcCentroid(drawingPoints).lng
            : (drawingMode ? null : selectedLand.lng));

    const currentArea = activeField?.area?.value ?? (drawingPoints.length >= 3 ? calculatedArea : null);
    const currentAreaUnit = activeField?.area?.unit || areaUnit || "acres";
    const currentSeason = activeField?.season || seasonInfo?.name || selectedLand.season || "Rabi Season (Wheat, Mustard)";
    const currentLandName = drawingMode
        ? (drawingPoints.length > 0 ? `Drawing Boundary (${drawingPoints.length} points placed)` : "New Field Boundary")
        : (activeField?.name || (drawingPoints.length >= 3 ? (fieldName || "Drawn Land Boundary") : (selectedLand?.locationName ? selectedLand.locationName.split(",")[0] : "Selected Farmland")));
    const currentLocationSub = drawingMode
        ? (drawingPoints.length > 0 ? "Click map to add boundary points • Connect at least 3 points" : "Old coordinates cleared • Click anywhere on map to begin drawing boundary")
        : (activeField?.locationName || selectedLand?.locationName || "Punjab Agricultural Belt, Pakistan");

    /* ─────────────────── RENDER ──────────────────────────── */
    return (
        <div className="dashboard">
            {/* ── MAP SECTION ─────────────────────────────── */}
            <div className="dash-map-section">
                <div ref={mapContainerRef} className="dash-map-canvas" id="precision-map" />

                {/* Map controls overlay */}
                <div className={`dash-map-controls ${drawingMode ? "dash-drawing-active" : ""}`}>
                    {/* Top row: Back + Search + Tiles */}
                    <div className="dash-controls-row">
                        {/* Back button */}
                        {onBack && (
                            <button className="dash-ctrl-btn dash-back-btn" onClick={onBack} title="Back to Detector">
                                <span className="dash-back-arrow">←</span>
                                <span>Back</span>
                            </button>
                        )}

                        {/* 🔍 Location Search Bar */}
                        <div ref={searchWrapRef} className="dash-search-wrap">
                            <div className="dash-search-bar">
                                <span className="dash-search-icon">🔍</span>
                                <input
                                    type="text"
                                    className="dash-search-input"
                                    placeholder="Search city, village, or place..."
                                    value={searchQuery}
                                    onChange={(e) => onSearchInput(e.target.value)}
                                    onFocus={() => searchResults.length > 0 && setShowSearchDropdown(true)}
                                    onClick={() => searchResults.length > 0 && setShowSearchDropdown(true)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            searchLocation(searchQuery);
                                        }
                                        if (e.key === "Escape") setShowSearchDropdown(false);
                                    }}
                                />
                                {searchLoading && <span className="dash-search-spinner" />}
                                {searchQuery && !searchLoading && (
                                    <button className="dash-search-clear" onClick={clearSearch}>×</button>
                                )}
                            </div>

                            {/* Search results dropdown */}
                            {showSearchDropdown && searchResults.length > 0 && (
                                <div className="dash-search-dropdown">
                                    {searchResults.map((r, i) => (
                                        <button
                                            key={r.place_id || i}
                                            className="dash-search-result"
                                            onClick={() => selectSearchResult(r)}
                                        >
                                            <span className="search-result-icon">
                                                {r.type === "city" || r.type === "town" ? "🏙️" :
                                                    r.type === "village" || r.type === "hamlet" ? "🏘️" :
                                                        r.type === "country" ? "🌍" :
                                                            r.type === "state" || r.type === "region" ? "📍" :
                                                                "📌"}
                                            </span>
                                            <div className="search-result-text">
                                                <span className="search-result-name">
                                                    {r.display_name?.split(",").slice(0, 2).join(",")}
                                                </span>
                                                <span className="search-result-detail">
                                                    {r.display_name?.split(",").slice(2, 4).join(",").trim()}
                                                </span>
                                            </div>
                                            <span className="search-result-type">{r.type}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Tile layer toggle */}
                        <div className="dash-tile-toggle">
                            {Object.keys(TILES).map((key) => (
                                <button
                                    key={key}
                                    className={`dash-tile-btn ${tileLayer === key ? "active" : ""}`}
                                    onClick={() => setTileLayer(key)}
                                    title={`${key.charAt(0).toUpperCase() + key.slice(1)} view`}
                                >
                                    <span className="dash-tile-icon">{key === "satellite" ? "🛰️" : key === "street" ? "🗺️" : "🏔️"}</span>
                                    <span className="dash-tile-label">{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Drawing controls */}
                    {!drawingMode ? (
                        <button className="dash-ctrl-btn dash-draw-btn" onClick={startDrawing}>
                            <span className="dash-draw-icon">✏️</span>
                            <span>Draw Field Boundary</span>
                        </button>
                    ) : (
                        <div className="dash-draw-controls">
                            <div className="dash-draw-status">
                                <span className="dash-draw-dot" />
                                <span>Click map to place field boundary points</span>
                            </div>
                            <div className="dash-draw-stats">
                                <span className="dash-stat-badge">Points: <strong>{drawingPoints.length}</strong></span>
                                {calculatedArea !== null && (
                                    <span className="dash-draw-area dash-stat-badge">
                                        Area: <strong>{calculatedArea.toFixed(2)}</strong>
                                        <select
                                            value={areaUnit}
                                            onChange={(e) => setAreaUnit(e.target.value)}
                                            className="dash-unit-select"
                                        >
                                            <option value="acres">acres</option>
                                            <option value="hectares">ha</option>
                                            <option value="sqft">sq ft</option>
                                        </select>
                                    </span>
                                )}
                            </div>
                            <div className="dash-draw-actions">
                                <button className="dash-ctrl-btn dash-undo-btn" onClick={undoLastPoint} disabled={drawingPoints.length === 0} title="Undo last point">
                                    ↩ Undo
                                </button>
                                <button className="dash-ctrl-btn dash-finish-btn" onClick={finishDrawing} disabled={drawingPoints.length < 3} title="Finish polygon (minimum 3 points)">
                                    ✓ Finish
                                </button>
                                <button className="dash-ctrl-btn dash-cancel-btn" onClick={cancelDrawing} title="Cancel drawing">
                                    ✕ Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Small floating toggle button to open options when closed (desktop only) */}
                {!panelOpen && (
                    <button
                        type="button"
                        className="dash-floating-options-toggle dash-desktop-only"
                        onClick={() => {
                            setPanelOpen(true);
                            setPanelHeight(null);
                        }}
                        title="Open options panel"
                        aria-label="Open options panel"
                    >
                        <span className="dash-floating-title">🌾 Options</span>
                        <span className="dash-toggle-badge small">▲</span>
                    </button>
                )}

                {/* Map loading overlay */}
                {!mapReady && (
                    <div className="dash-map-loading">
                        <div className="dash-loader" />
                        <p>Loading satellite imagery...</p>
                    </div>
                )}
            </div>

            {/* ── PANEL SECTION ────────────────────────────── */}
            <div 
                ref={panelRef}
                className={`dash-panel ${panelOpen ? "open" : "collapsed"} ${drawingMode ? "dash-panel-drawing-transparent" : ""} ${isDragging ? "is-dragging" : ""}`}
                style={{ height: panelOpen && panelHeight ? `${panelHeight}px` : undefined }}
            >
                {/* Panel toggle (mobile bottom sheet handle) */}
                <button
                    className="dash-panel-toggle"
                    type="button"
                    style={{ touchAction: 'none' }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerCancel}
                    onClick={handleToggleClick}
                    aria-label={panelOpen ? "Collapse control panel" : "Expand control panel"}
                >
                    <div className="dash-drag-handle" />
                    <div className="dash-toggle-inner">
                        <span className="dash-toggle-title">🌾 Precision Agriculture</span>
                        <button
                            type="button"
                            className="dash-toggle-badge"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (panelOpen) {
                                    // Totally close it
                                    setPanelOpen(false);
                                    setPanelHeight(null);
                                } else {
                                    // Totally open it
                                    setPanelOpen(true);
                                    setPanelHeight(null);
                                }
                            }}
                            title={panelOpen ? "Totally close panel" : "Totally open panel"}
                            aria-label={panelOpen ? "Totally close panel" : "Totally open panel"}
                        >
                            {panelOpen ? "▼" : "▲"}
                        </button>
                    </div>
                </button>

                {/* Panel header */}
                <div className="dash-panel-header">
                    <h2>🌾 Precision Agriculture</h2>
                    <p className="dash-panel-sub">AI-Powered Field Analysis</p>
                </div>

                {/* Tab navigation */}
                <div className="dash-tabs">
                    {[
                        { key: "field", icon: "📐", label: "Field" },
                        { key: "weather", icon: "🌤️", label: "Weather" },
                        { key: "ai", icon: "🤖", label: "AI Crops" },
                        { key: "scan", icon: "🔬", label: "Scan" },
                        { key: "saved", icon: "💾", label: "Saved" },
                    ].map((tab) => (
                        <button
                            key={tab.key}
                            className={`dash-tab ${panelTab === tab.key ? "active" : ""}`}
                            onClick={() => setPanelTab(tab.key)}
                        >
                            <span className="tab-icon">{tab.icon}</span>
                            <span className="tab-label">{tab.label}</span>
                        </button>
                    ))}
                </div>

                {/* Panel content */}
                <div className="dash-panel-content">
                    {/* ── FIELD TAB: SELECTED LAND DETAILS ─────────────────── */}
                    {panelTab === "field" && (
                        <div className="dash-card-stack">
                            {/* 📂 Quick selector to open saved fields directly on dashboard */}
                            {savedFields.length > 0 && (
                                <div className="dash-saved-selector-wrap">
                                    <div className="dash-saved-selector-label">
                                        <span className="dash-saved-icon">📂</span>
                                        <span className="dash-saved-text">Open Saved Land:</span>
                                    </div>
                                    <div className="dash-saved-selector-row">
                                        <select
                                            className="dash-saved-select"
                                            value={activeField?._id || activeField?.id || ""}
                                            onChange={(e) => {
                                                const selId = e.target.value;
                                                if (!selId) {
                                                    setActiveField(null);
                                                } else {
                                                    const match = savedFields.find((f) => (f._id || f.id) === selId);
                                                    if (match) flyToField(match);
                                                }
                                            }}
                                        >
                                            <option value="">-- Choose a Saved Land ({savedFields.length}) --</option>
                                            {savedFields.map((f) => {
                                                const fId = f._id || f.id;
                                                return (
                                                    <option key={fId} value={fId}>
                                                        🌾 {f.name} ({f.area?.value ? `${f.area.value.toFixed(1)} ${f.area.unit || "acres"}` : "Saved"})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                        {activeField ? (
                                            <div className="dash-saved-btn-group">
                                                <button
                                                    type="button"
                                                    className="dash-clear-sel-btn"
                                                    onClick={() => {
                                                        setActiveField(null);
                                                        showSuccess("Active land deselected. You can draw a new boundary or pick another land.");
                                                    }}
                                                    title="Deselect active land"
                                                >
                                                    ✕ Deselect
                                                </button>
                                                <button
                                                    type="button"
                                                    className="dash-delete-sel-btn"
                                                    onClick={() => {
                                                        deleteField(activeField._id || activeField.id, activeField.name);
                                                    }}
                                                    title="Delete this saved land"
                                                >
                                                    🗑️ Delete
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="dash-saved-count-pill">{savedFields.length} saved</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="dash-card glass dash-land-card">
                                <div className="dash-land-header">
                                    <div className="dash-land-title-wrap">
                                        <span className="dash-land-icon">📍</span>
                                        <div>
                                            <h3 className="dash-card-title">{currentLandName}</h3>
                                            <span className="dash-land-sub">{currentLocationSub}</span>
                                        </div>
                                    </div>
                                    <span className="dash-land-badge">
                                        {activeField 
                                            ? "💾 Saved Field" 
                                            : (drawingMode 
                                                ? "✏️ Drawing Boundary" 
                                                : (drawingPoints.length >= 3 ? "📐 Boundary Defined" : "🛰️ Selected Land"))}
                                    </span>
                                </div>

                                {/* Primary Land Metrics */}
                                <div className="dash-land-grid">
                                    <div className="dash-land-stat">
                                        <span className="land-stat-label">Coordinates</span>
                                        <span className={`land-stat-val land-stat-mono ${currentLat === null ? "dimmed" : ""}`}>
                                            {currentLat !== null && currentLng !== null
                                                ? `${currentLat.toFixed(4)}°, ${currentLng.toFixed(4)}°`
                                                : "Cleared (Click map to draw)"}
                                        </span>
                                    </div>
                                    <div className="dash-land-stat">
                                        <span className="land-stat-label">Land Area</span>
                                        <span className={`land-stat-val ${currentArea !== null ? "highlight" : ""}`}>
                                            {currentArea !== null 
                                                ? `${currentArea.toFixed(2)} ${currentAreaUnit}` 
                                                : (drawingPoints.length > 0 ? `${drawingPoints.length} points placed` : "Unmeasured")}
                                        </span>
                                    </div>
                                    <div className="dash-land-stat">
                                        <span className="land-stat-label">Crop Season</span>
                                        <span className="land-stat-val">
                                            {currentSeason}
                                        </span>
                                    </div>
                                    <div className="dash-land-stat">
                                        <span className="land-stat-label">Soil Classification</span>
                                        <span className="land-stat-val">
                                            {selectedLand.soilType || "Alluvial Loam / Clay"}
                                        </span>
                                    </div>
                                </div>

                                {/* Environmental & Agronomic Specifications */}
                                <div className="dash-land-specs">
                                    <div className="dash-spec-row">
                                        <span className="spec-label">🌾 Irrigation Source:</span>
                                        <span className="spec-val">{selectedLand.irrigation || "Canal System & Ground Tubewell"}</span>
                                    </div>
                                    <div className="dash-spec-row">
                                        <span className="spec-label">🗺️ Land Topography:</span>
                                        <span className="spec-val">{selectedLand.elevation || "Level Alluvial Basin (~215m ASL)"}</span>
                                    </div>
                                    <div className="dash-spec-row">
                                        <span className="spec-label">📐 Boundary Status:</span>
                                        <span className="spec-val">
                                            {drawingMode
                                                ? (drawingPoints.length >= 3 
                                                    ? `Ready to finish (${drawingPoints.length} points placed)` 
                                                    : (drawingPoints.length > 0 
                                                        ? `Placing points (${drawingPoints.length} placed)` 
                                                        : "Old coordinates unselected • Click map to place 1st point"))
                                                : (drawingPoints.length >= 3 
                                                    ? `✓ Closed Polygon (${drawingPoints.length} points)` 
                                                    : (activeField ? `Saved Boundary (${activeField.boundary?.coordinates?.[0]?.length || 0} pts)` : "Ready to Outline on Map"))}
                                        </span>
                                    </div>
                                    {weather && (
                                        <div className="dash-spec-row">
                                            <span className="spec-label">🌤️ Live Telemetry:</span>
                                            <span className="spec-val">
                                                {weather.temperature}°C • {weather.condition} ({weather.humidity}% Humidity)
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Dedicated Save Field Card if 3+ points drawn and not saved yet */}
                                {drawingPoints.length >= 3 && !activeField && (
                                    <div className="dash-save-field-card">
                                        <div className="dash-save-header">
                                            <div className="dash-save-title">
                                                <span className="dash-save-icon">💾</span>
                                                <div>
                                                    <h4 className="dash-save-h4">Save Drawn Land Boundary</h4>
                                                    <p className="dash-save-sub">Save this land to your dashboard so it opens automatically next time</p>
                                                </div>
                                            </div>
                                            <span className="dash-save-acres-pill">
                                                {calculatedArea ? `${calculatedArea.toFixed(2)} ${areaUnit}` : `${drawingPoints.length} points`}
                                            </span>
                                        </div>
                                        <div className="dash-save-form-row">
                                            <input
                                                type="text"
                                                className="dash-input dash-save-input"
                                                placeholder="Field Name (e.g. North Wheat Parcel)"
                                                value={fieldName}
                                                onChange={(e) => setFieldName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") saveField();
                                                }}
                                            />
                                            <button className="dash-btn primary dash-save-submit-btn" onClick={saveField}>
                                                <span>💾</span>
                                                <span>Save Farmland</span>
                                            </button>
                                        </div>
                                    </div>
                                )}

                            </div>
                        </div>
                    )}

                    {/* ── WEATHER TAB ───────────────────────── */}
                    {panelTab === "weather" && (
                        <div className="dash-card-stack">
                            {/* 📂 Quick selector to inspect saved field weather directly */}
                            {savedFields.length > 0 && (
                                <div className="dash-saved-selector-wrap">
                                    <div className="dash-saved-selector-label">
                                        <span className="dash-saved-icon">🌤️</span>
                                        <span className="dash-saved-text">Field Weather Telemetry:</span>
                                    </div>
                                    <div className="dash-saved-selector-row">
                                        <select
                                            className="dash-saved-select"
                                            value={activeField?._id || activeField?.id || ""}
                                            onChange={(e) => {
                                                const selId = e.target.value;
                                                if (!selId) {
                                                    setActiveField(null);
                                                } else {
                                                    const match = savedFields.find((f) => (f._id || f.id) === selId);
                                                    if (match) flyToField(match, "weather");
                                                }
                                            }}
                                        >
                                            <option value="">-- Select a Field to Show Weather ({savedFields.length}) --</option>
                                            {savedFields.map((f) => {
                                                const fId = f._id || f.id;
                                                return (
                                                    <option key={fId} value={fId}>
                                                        🌾 {f.name} ({f.area?.value ? `${f.area.value.toFixed(1)} ${f.area.unit || "acres"}` : "Saved"})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                        {activeField ? (
                                            <div className="dash-saved-btn-group">
                                                <button
                                                    type="button"
                                                    className="dash-clear-sel-btn"
                                                    onClick={() => {
                                                        setActiveField(null);
                                                    }}
                                                    title="Deselect active land"
                                                >
                                                    ✕ Deselect
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="dash-saved-count-pill">{savedFields.length} saved</span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {weatherLoading && (
                                <div className="dash-card glass">
                                    <div className="dash-loading-state">
                                        <div className="dash-loader" />
                                        <p>Fetching weather data...</p>
                                    </div>
                                </div>
                            )}

                            {weather && !weatherLoading && (
                                <>
                                    {/* Current weather */}
                                    <div className="dash-card glass weather-card">
                                        <div className="weather-hero">
                                            <div className="weather-icon-large">
                                                {WEATHER_ICONS[weather.condition] || "🌡️"}
                                            </div>
                                            <div className="weather-main">
                                                <span className="weather-temp">{weather.temperature}°C</span>
                                                <span className="weather-desc">{weather.conditionDetail || weather.condition}</span>
                                                <span className="weather-location">
                                                    {activeField?.name 
                                                        ? `${activeField.name}${activeField.locationName ? ` • ${activeField.locationName}` : ""}`
                                                        : (weather.locationName || "Your Field")}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="weather-grid">
                                            <div className="weather-item">
                                                <span className="wi-icon">💧</span>
                                                <span className="wi-label">Humidity</span>
                                                <span className="wi-value">{weather.humidity}%</span>
                                            </div>
                                            <div className="weather-item">
                                                <span className="wi-icon">💨</span>
                                                <span className="wi-label">Wind</span>
                                                <span className="wi-value">{weather.windSpeed} m/s</span>
                                            </div>
                                            <div className="weather-item">
                                                <span className="wi-icon">🌡️</span>
                                                <span className="wi-label">Feels Like</span>
                                                <span className="wi-value">{weather.feelsLike}°C</span>
                                            </div>
                                            <div className="weather-item">
                                                <span className="wi-icon">☁️</span>
                                                <span className="wi-label">Clouds</span>
                                                <span className="wi-value">{weather.cloudCoverage}%</span>
                                            </div>
                                            <div className="weather-item">
                                                <span className="wi-icon">🔭</span>
                                                <span className="wi-label">Visibility</span>
                                                <span className="wi-value">{(weather.visibility / 1000).toFixed(1)} km</span>
                                            </div>
                                            <div className="weather-item">
                                                <span className="wi-icon">📊</span>
                                                <span className="wi-label">Pressure</span>
                                                <span className="wi-value">{weather.pressure} hPa</span>
                                            </div>
                                        </div>
                                        {weather.isMock && (
                                            <div className="weather-mock-badge">📋 Sample data — add OPENWEATHER_API_KEY for live weather</div>
                                        )}
                                    </div>

                                    {/* Season info */}
                                    {seasonInfo && (
                                        <div className="dash-card glass">
                                            <h3 className="dash-card-title">🌱 Current Season</h3>
                                            <div className="season-info">
                                                <span className="season-name">{seasonInfo.seasonName}</span>
                                                <span className="season-month">{seasonInfo.monthName}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Forecast */}
                                    {forecast.length > 0 && (
                                        <div className="dash-card glass">
                                            <h3 className="dash-card-title">📅 Forecast</h3>
                                            <div className="forecast-scroll">
                                                {forecast.slice(0, 8).map((f, i) => (
                                                    <div key={i} className="forecast-item">
                                                        <span className="fc-time">
                                                            {new Date(f.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                                        </span>
                                                        <span className="fc-icon">{WEATHER_ICONS[f.condition] || "🌡️"}</span>
                                                        <span className="fc-temp">{Math.round(f.temperature)}°</span>
                                                        <span className="fc-rain">💧{f.pop}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Trigger AI analysis */}
                                    <button className="dash-btn primary full-width" onClick={runAnalysis} disabled={loadingCrops}>
                                        {loadingCrops ? (
                                            <><span className="dash-spinner" /> Analyzing...</>
                                        ) : (
                                            "🤖 Get AI Crop Recommendations"
                                        )}
                                    </button>
                                </>
                            )}

                            {!weather && !weatherLoading && (
                                <div className="dash-empty-state">
                                    <span className="empty-icon">🌤️</span>
                                    <p>{activeField ? `Fetching weather for ${activeField.name}...` : "Select a field to show the weather"}</p>
                                    <p className="empty-sub">
                                        {activeField 
                                            ? "Telemetry data is refreshing for this farmland." 
                                            : "Choose a saved field from the dropdown above, click a field on the map, or draw a new boundary to view live weather."}
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── AI ANALYSIS TAB ───────────────────── */}
                    {panelTab === "ai" && (
                        <div className="dash-card-stack">
                            <div className="dash-card glass">
                                <h3 className="dash-card-title" style={{ marginBottom: "12px" }}>🤖 AI Analysis</h3>
                                
                                <div className="ai-tab-content">
                                    {/* Initial State */}
                                    {!aiCrops && !loadingCrops && (
                                        <div className="dash-empty-state">
                                            <button className="dash-btn primary full-width" onClick={() => runTabAnalysis('crops')}>
                                                Generate Crop Recommendations
                                            </button>
                                        </div>
                                    )}

                                    {/* Crops Section */}
                                    {loadingCrops && (
                                        <div className="dash-loading-state"><div className="dash-loader" /><p>Analyzing optimal crops...</p></div>
                                    )}
                                    {aiCrops && (
                                        <div className="ai-text-content">
                                            {renderAIText(aiCrops.recommendation?.fullResponse)}
                                            
                                            {/* Transition to Diseases */}
                                            {!aiDiseases && !loadingDiseases && (
                                                <button className="dash-btn primary full-width" style={{ marginTop: '16px', marginBottom: '14px' }} onClick={() => runTabAnalysis('diseases')}>
                                                    Next: Analyze Disease Risks 🛡️
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* Diseases Section */}
                                    {loadingDiseases && (
                                        <div className="dash-loading-state"><div className="dash-loader" /><p>Analyzing disease risks...</p></div>
                                    )}
                                    {aiDiseases && (
                                        <div className="ai-text-content" style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                                            {renderAIText(aiDiseases.recommendation?.fullResponse)}
                                            
                                            {/* Transition to Tips */}
                                            {!aiTips && !loadingTips && (
                                                <button className="dash-btn primary full-width" style={{ marginTop: '16px', marginBottom: '14px' }} onClick={() => runTabAnalysis('tips')}>
                                                    Next: View Weather Tips & Season Planning 🌤️
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* Tips Section */}
                                    {loadingTips && (
                                        <div className="dash-loading-state"><div className="dash-loader" /><p>Generating tips & financials...</p></div>
                                    )}
                                    {aiTips && (
                                        <div className="ai-text-content" style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                                            {renderAIText(aiTips.recommendation?.fullResponse)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── SCAN TAB ──────────────────────────── */}
                    {panelTab === "scan" && (
                        <div className="dash-card-stack">
                            <div className="dash-card glass">
                                <h3 className="dash-card-title">🔬 Disease Scanner</h3>
                                <p className="dash-card-desc">
                                    Upload a crop/leaf image for AI-powered disease detection.
                                </p>

                                {/* Upload area */}
                                <div
                                    className="dash-scan-drop"
                                    onClick={() => scanInputRef.current?.click()}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (e.dataTransfer.files?.[0]) handleScanFile(e.dataTransfer.files[0]);
                                    }}
                                >
                                    {scanPreview ? (
                                        <div className="scan-preview-wrap">
                                            <img src={scanPreview} alt="Scan preview" className="scan-preview-img" />
                                            <button
                                                className="scan-remove"
                                                onClick={(e) => { e.stopPropagation(); setScanFile(null); setScanPreview(null); setScanResult(null); }}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="scan-placeholder">
                                            <span className="scan-upload-icon">📷</span>
                                            <p>Drag & drop or click to upload</p>
                                            <p className="scan-upload-sub">JPG, PNG, WebP · Max 10 MB</p>
                                        </div>
                                    )}
                                    <input
                                        ref={scanInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        hidden
                                        onChange={(e) => e.target.files?.[0] && handleScanFile(e.target.files[0])}
                                    />
                                </div>

                                <button
                                    className="dash-btn primary full-width"
                                    disabled={!scanFile || scanLoading}
                                    onClick={submitScan}
                                >
                                    {scanLoading ? (
                                        <><span className="dash-spinner" /> Scanning...</>
                                    ) : (
                                        "🔬 Analyze Image"
                                    )}
                                </button>
                            </div>

                            {/* Scan result */}
                            {scanResult && (
                                <div className="dash-card glass">
                                    <h3 className="dash-card-title">
                                        {scanResult.mlResult?.is_healthy || scanResult.prediction?.isHealthy
                                            ? "✅ Healthy Plant"
                                            : "⚠️ Disease Detected"
                                        }
                                    </h3>
                                    <div className="scan-result-body">
                                        <div className="scan-disease-name">
                                            {scanResult.mlResult?.prediction || scanResult.prediction?.disease || "Unknown"}
                                        </div>
                                        <div className="scan-confidence">
                                            <div className="scan-conf-label">
                                                Confidence: <strong>{(scanResult.mlResult?.confidence || scanResult.prediction?.confidence || 0).toFixed(1)}%</strong>
                                            </div>
                                            <div className="scan-conf-bar">
                                                <div
                                                    className="scan-conf-fill"
                                                    style={{
                                                        width: `${scanResult.mlResult?.confidence || scanResult.prediction?.confidence || 0}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                        {scanResult.mlResult?.description && (
                                            <p className="scan-desc">{scanResult.mlResult.description}</p>
                                        )}
                                        {scanResult.mlResult?.recommendation && (
                                            <p className="scan-rec">{scanResult.mlResult.recommendation}</p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── SAVED FIELDS TAB ──────────────────── */}
                    {panelTab === "saved" && (
                        <div className="dash-card-stack">
                            <div className="dash-card glass">
                                <h3 className="dash-card-title">💾 Saved Fields ({savedFields.length})</h3>
                            </div>

                            {savedFields.length === 0 && (
                                <div className="dash-empty-state">
                                    <span className="empty-icon">📍</span>
                                    <p>No saved fields yet</p>
                                    <p className="empty-sub">
                                        Draw a boundary, name it, and save to build your farm profile.
                                    </p>
                                </div>
                            )}

                            {savedFields.map((field, idx) => {
                                const fId = field._id || field.id;
                                const activeId = activeField?._id || activeField?.id;
                                const isCardActive = Boolean(activeId && activeId === fId);
                                return (
                                <div
                                    key={fId || idx}
                                    className={`dash-card glass saved-field-card ${isCardActive ? "active" : ""}`}
                                    onClick={() => flyToField(field)}
                                >
                                    <div
                                        className="saved-field-color"
                                        style={{ backgroundColor: FIELD_COLORS[idx % FIELD_COLORS.length] }}
                                    />
                                    <div className="saved-field-body">
                                        <h4>{field.name}</h4>
                                        <div className="saved-field-meta">
                                            <span>📐 {field.area?.value?.toFixed(2)} {field.area?.unit || "acres"}</span>
                                            {field.locationName && <span>📍 {field.locationName}</span>}
                                            {field.season && <span>🌱 {field.season}</span>}
                                        </div>
                                    </div>
                                    <div className="saved-field-card-btns">
                                        <button
                                            type="button"
                                            className="dash-open-land-btn"
                                            onClick={(e) => { e.stopPropagation(); flyToField(field); }}
                                            title="Open land on dashboard"
                                        >
                                            Open Land
                                        </button>
                                        <button
                                            type="button"
                                            className="saved-field-delete"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                deleteField(field._id || field.id, field.name);
                                            }}
                                            title="Delete field"
                                            aria-label={`Delete field ${field.name}`}
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* ── NOTIFICATION TOASTS ───────────────────────── */}
            {error && (
                <div className="dash-toast">
                    <span>⚠️</span>
                    <span>{error}</span>
                </div>
            )}
            {successMsg && (
                <div className="dash-toast dash-toast-success">
                    <span>✅</span>
                    <span>{successMsg}</span>
                </div>
            )}
        </div>
    );
}
