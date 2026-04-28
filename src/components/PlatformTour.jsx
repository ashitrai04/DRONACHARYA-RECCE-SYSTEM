import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, ChevronRight, Compass, Target, Crosshair,
  Navigation, BarChart2, FileText, Layers, Zap,
} from 'lucide-react';
import './PlatformTour.css';

/* ── SONITPUR AOI for demo ── */
const DEMO_AOI = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[92.75, 26.65], [92.85, 26.65], [92.85, 26.72], [92.75, 26.72], [92.75, 26.65]]],
  },
  properties: { district: 'Sonitpur' },
};

/* ── STEP DEFINITIONS ── */
const TOUR_STEPS = [
  {
    id: 'welcome-brand', tab: null, target: '.navbar-brand', action: 'hover',
    title: 'Dronacharya Recce System',
    description: 'Welcome to an <strong>AI-powered artillery terrain intelligence</strong> platform. Let us walk you through the complete recce workflow.',
    delay: 4000,
  },
  {
    id: 'select-district', tab: 'mission', target: '.sidebar .form-select', action: 'click',
    title: 'Selecting Operational District',
    description: 'The system is selecting <strong>Sonitpur</strong> — loading satellite-derived terrain data, elevation models, and road networks for this region.',
    delay: 3500,
    onEnter: (p) => { p.setActiveDistrict('Sonitpur'); },
  },
  {
    id: 'gun-system', tab: 'mission', target: '.sidebar .form-group:nth-child(3) .form-select', action: 'click',
    title: 'Choosing Artillery Platform',
    description: 'Selecting the <strong>FH-77B Bofors (155mm)</strong>. The AI will tailor slope, area, and separation requirements to this platform.',
    delay: 3500,
    onEnter: (p) => { p.setMission(m => ({ ...m, gunType: 'BOFORS' })); },
  },
  {
    id: 'num-guns', tab: 'mission', target: '.sidebar .form-group:nth-child(4) .btn-group', action: 'click',
    title: 'Setting Number of Guns',
    description: 'Configuring <strong>6 guns</strong> for this deployment. Quick-set buttons enable rapid parameter entry during field planning.',
    delay: 3000,
    onEnter: (p) => { p.setMission(m => ({ ...m, numGuns: 6 })); },
  },
  {
    id: 'batteries', tab: 'mission', target: '.sidebar .form-group:nth-child(5) .btn-group', action: 'click',
    title: 'Configuring Batteries',
    description: 'Setting <strong>2 batteries</strong>. The system calculates optimal gun-to-battery allocation and recommends separate deployment areas.',
    delay: 3000,
    onEnter: (p) => { p.setMission(m => ({ ...m, batteries: 2 })); },
  },
  {
    id: 'day-night', tab: 'mission', target: '.sidebar .form-group:nth-child(7) .btn-group', action: 'click',
    title: 'Operational Timing → Day',
    description: 'Selecting <strong>Day operations</strong>. Night missions apply enhanced concealment and thermal signature parameters.',
    delay: 2800,
    onEnter: (p) => { p.setMission(m => ({ ...m, dayNight: 'Day' })); },
  },
  {
    id: 'season', tab: 'mission', target: '.sidebar .form-group:nth-child(8) .form-select', action: 'click',
    title: 'Season → Post-Monsoon',
    description: 'Choosing <strong>Post-Monsoon</strong> season. Soil bearing capacity and vegetation density vary significantly by season.',
    delay: 2800,
    onEnter: (p) => { p.setMission(m => ({ ...m, season: 'Post-Monsoon' })); },
  },
  {
    id: 'threat', tab: 'mission', target: '.sidebar .form-group:nth-child(9) .btn-group', action: 'click',
    title: 'Threat Level → Medium',
    description: 'Setting <strong>Medium threat</strong>. Higher levels increase weight on concealment, dispersion, and counter-battery survivability.',
    delay: 3000,
    onEnter: (p) => { p.setMission(m => ({ ...m, threatLevel: 'Medium' })); },
  },
  {
    id: 'draw-aoi', tab: 'mission', target: '.draw-toolbar .draw-btn:first-child', action: 'click',
    title: 'Drawing Area of Interest',
    description: 'An <strong>AOI polygon</strong> is being drawn over the Sonitpur sector to focus analysis on the operational area.',
    delay: 3500,
    onEnter: (p) => { p.setCustomAOI(DEMO_AOI); },
  },
  {
    id: 'ai-prescreen', tab: 'mission', target: '.sidebar .btn-primary', action: 'click',
    title: 'Launching AI PRE-SCREEN',
    description: 'Running <strong>full suitability analysis</strong> using 27+ terrain, access, and concealment parameters derived from 16+ satellite and GIS datasets.',
    delay: 4500,
  },
  {
    id: 'analysis-terrain', tab: 'analysis', target: '.sidebar', action: 'hover',
    title: 'Terrain Intelligence',
    description: 'The terrain panel shows <strong>ESA WorldCover land cover</strong> distribution — classifying cropland, forest, grassland, water bodies, and built-up areas from satellite imagery.',
    delay: 4000,
  },
  {
    id: 'analysis-results', tab: 'analysis', target: '.results-panel', action: 'hover',
    title: 'Ranked Gun Areas',
    description: 'Candidates are ranked by <strong>composite suitability score</strong> — spanning slope, concealment, road access, water proximity, soil capacity, and 20+ more parameters.',
    delay: 4500,
  },
  {
    id: 'layers-toggle', tab: 'analysis', target: '.layer-panel', action: 'click',
    title: 'Intelligence Layers',
    description: 'Toggling <strong>landcover and suitability layers</strong> — visualizing AI-scored terrain fitness, vegetation density, and road networks across the sector.',
    delay: 4000,
    onEnter: (p) => { p.setLayers(l => ({ ...l, landcover: true, suitability: true })); },
  },
  {
    id: 'layers-off', tab: 'analysis', target: '.layer-panel', action: 'none',
    title: 'Layer Controls',
    description: 'Each layer is derived from <strong>Sentinel-2, SRTM DEM, ESA WorldCover, and OpenStreetMap</strong>. Layers toggle independently for tactical clarity.',
    delay: 3000,
    onEnter: (p) => { p.setLayers(l => ({ ...l, landcover: false, suitability: false })); },
  },
  {
    id: 'top-candidate', tab: 'analysis', target: '.results-body > div:first-child',
    action: 'click',
    title: 'Top Recommended Area',
    description: 'Opening the <strong>#1 ranked candidate</strong>. This area has the highest composite score across all terrain and operational parameters.',
    delay: 4000,
    onEnter: (p) => {
      if (p.candidates?.[0]) {
        p.setSelectedCandidate(p.candidates[0].id);
        p.setDetailCandidate(p.candidates[0].id);
      }
    },
    fallbackTarget: '.results-panel',
  },
  {
    id: 'route-tab', tab: 'routes', target: '.results-panel .results-header', action: 'hover',
    title: 'Route Planning',
    description: 'The route module computes <strong>optimal access routes</strong> from the nearest highway to each gun area — accounting for terrain gradient and road class.',
    delay: 4500,
    onEnter: (p) => { p.setDetailCandidate(null); },
  },
  {
    id: 'drone-section', tab: 'routes', target: '.results-panel .results-body', action: 'hover',
    title: 'Drone Recce Missions',
    description: 'Assign <strong>UAV reconnaissance</strong> to verify routes and validate ground conditions. Waypoints export as GeoJSON/KML for drone controllers.',
    delay: 4500,
  },
  {
    id: 'dashboard-metrics', tab: 'dashboard', target: '.main-content > div', action: 'hover',
    title: 'Commander Dashboard',
    description: 'Consolidated <strong>operational overview</strong> with mission metrics: candidate ratings, best scores, deployment time estimates, and route feasibility.',
    delay: 4500,
  },
  {
    id: 'reports-page', tab: 'reports', target: '.main-content > div', action: 'hover',
    title: 'Mission Report',
    description: 'A comprehensive <strong>operational report</strong> ready for commander review — covering terrain analysis, ranked candidates, route assessment, drone recce, risks, and battery allocation.',
    delay: 5000,
  },
  {
    id: 'report-export', tab: 'reports', target: '.report-actions', action: 'hover',
    title: 'Export & Share',
    description: 'Download the report as a <strong>print-ready PDF</strong> or export as KML for military GIS integration. The complete recce workflow is now done.',
    delay: 4500,
    fallbackTarget: '.main-content > div',
  },
];

const CursorSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.65 2.92L19.08 12.03C19.56 12.35 19.36 13.1 18.79 13.13L12.48 13.46L9.8 19.23C9.56 19.75 8.8 19.67 8.68 19.12L5.05 3.61C4.94 3.12 5.28 2.67 5.65 2.92Z"
      fill="url(#cursor-grad)" stroke="#0ea5e9" strokeWidth="0.8" />
    <defs>
      <linearGradient id="cursor-grad" x1="5" y1="3" x2="15" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38bdf8" /><stop offset="1" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
  </svg>
);

function TourWelcome({ onStart, onDismiss }) {
  return (
    <div className="tour-welcome">
      <div className="tour-welcome-card">
        <div className="tour-welcome-icon"><Compass size={28} /></div>
        <div className="tour-welcome-title">Platform Tour</div>
        <div className="tour-welcome-subtitle">
          Watch the complete AI-powered Gun Area Recce workflow — from mission setup to final report — in an interactive guided demo.
        </div>
        <div className="tour-welcome-features">
          <div className="tour-welcome-feature"><Target size={14} /> Mission Planning</div>
          <div className="tour-welcome-feature"><Crosshair size={14} /> AI Analysis</div>
          <div className="tour-welcome-feature"><Navigation size={14} /> Route & Drone</div>
          <div className="tour-welcome-feature"><BarChart2 size={14} /> Dashboard</div>
          <div className="tour-welcome-feature"><Layers size={14} /> Intel Layers</div>
          <div className="tour-welcome-feature"><FileText size={14} /> Reports</div>
        </div>
        <div className="tour-welcome-actions">
          <button className="tour-btn-dismiss" onClick={onDismiss}>Skip</button>
          <button className="tour-btn-start" onClick={onStart}><Play size={15} /> Start Tour</button>
        </div>
      </div>
    </div>
  );
}

export default function PlatformTour({
  active, onExit, setActiveTab, setActiveDistrict, setMission,
  setLayers, setSelectedCandidate, setDetailCandidate, setAllocations,
  setCustomAOI, analysisResult, candidates,
}) {
  const [phase, setPhase] = useState('welcome');
  const [stepIndex, setStepIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [spotlightRect, setSpotlightRect] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [clicking, setClicking] = useState(false);
  const [ripple, setRipple] = useState(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const timerRef = useRef(null);
  const stepRef = useRef(stepIndex);
  stepRef.current = stepIndex;
  const currentStep = TOUR_STEPS[stepIndex] || null;
  const totalSteps = TOUR_STEPS.length;

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') exitTour(); };
    if (active) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);

  const exitTour = useCallback(() => {
    setPhase('exiting');
    if (timerRef.current) clearTimeout(timerRef.current);
    localStorage.setItem('dronacharya_tour_seen', 'true');
    setTimeout(() => onExit(), 300);
  }, [onExit]);

  const positionTooltip = useCallback((rect, cx, cy) => {
    const tw = 400, th = 200, m = 16;
    if (!rect) { setTooltipPos({ x: cx - tw / 2, y: cy + 40 }); return; }
    let y = rect.top + rect.height + m < window.innerHeight - th
      ? rect.top + rect.height + m
      : rect.top - th - m > 0 ? rect.top - th - m : Math.max(m, (window.innerHeight - th) / 2);
    let x = rect.left;
    if (x + tw > window.innerWidth - m) x = window.innerWidth - tw - m;
    if (x < m) x = m;
    setTooltipPos({ x, y });
  }, []);

  const spotlightElement = useCallback((selector, fallback) => {
    let el = selector ? document.querySelector(selector) : null;
    if (!el && fallback) el = document.querySelector(fallback);
    if (!el) {
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      setCursorPos({ x: cx, y: cy });
      setSpotlightRect(null);
      positionTooltip(null, cx, cy);
      return null;
    }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const sr = { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
    setCursorPos({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    setSpotlightRect(sr);
    positionTooltip(sr, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return el;
  }, [positionTooltip]);

  const goNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const next = stepRef.current + 1;
    if (next >= totalSteps) { exitTour(); return; }
    setStepIndex(next);
  }, [totalSteps, exitTour]);

  const executeStep = useCallback((index) => {
    const step = TOUR_STEPS[index];
    if (!step) { exitTour(); return; }
    setTooltipVisible(false);
    if (step.tab && setActiveTab) setActiveTab(step.tab);
    if (step.onEnter) {
      step.onEnter({ setActiveDistrict, setMission, setLayers, setSelectedCandidate, setDetailCandidate, setAllocations, setCustomAOI, candidates });
    }
    setTimeout(() => {
      spotlightElement(step.target, step.fallbackTarget);
      if (step.action === 'click') {
        setTimeout(() => {
          setClicking(true);
          setRipple({ x: cursorPos.x, y: cursorPos.y, id: Date.now() });
          setTimeout(() => setClicking(false), 150);
        }, 500);
      }
      setTimeout(() => setTooltipVisible(true), 600);
      if (!paused) {
        timerRef.current = setTimeout(() => {
          if (stepRef.current === index) goNext();
        }, step.delay || 4000);
      }
    }, step.tab ? 500 : 200);
  }, [spotlightElement, setActiveTab, setActiveDistrict, setMission, setLayers, setSelectedCandidate, setDetailCandidate, setAllocations, setCustomAOI, candidates, paused, exitTour, goNext, cursorPos]);

  useEffect(() => {
    if (phase === 'running') executeStep(stepIndex);
  }, [stepIndex, phase]);

  useEffect(() => {
    if (paused) { if (timerRef.current) clearTimeout(timerRef.current); }
    else if (phase === 'running') {
      const step = TOUR_STEPS[stepIndex];
      if (step) {
        timerRef.current = setTimeout(() => {
          if (stepRef.current === stepIndex) goNext();
        }, (step.delay || 4000) / 2);
      }
    }
  }, [paused]);

  const startTour = useCallback(() => { setPhase('running'); setStepIndex(0); setPaused(false); }, []);
  const dismissTour = useCallback(() => { localStorage.setItem('dronacharya_tour_seen', 'true'); onExit(); }, [onExit]);

  if (!active) return null;

  return (
    <AnimatePresence>
      {phase === 'welcome' && (
        <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <TourWelcome onStart={startTour} onDismiss={dismissTour} />
        </motion.div>
      )}
      {phase === 'running' && currentStep && (
        <motion.div key="tour" className="tour-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          {spotlightRect && (
            <div className="tour-spotlight" style={{ top: spotlightRect.top, left: spotlightRect.left, width: spotlightRect.width, height: spotlightRect.height }} />
          )}
          {!spotlightRect && <div className="tour-backdrop active" onClick={exitTour} />}
          <div className={`tour-cursor ${clicking ? 'clicking' : ''}`} style={{ left: cursorPos.x, top: cursorPos.y }}>
            <CursorSvg />
          </div>
          <AnimatePresence>
            {ripple && (
              <motion.div key={ripple.id} className="tour-cursor-ripple" style={{ left: ripple.x, top: ripple.y }}
                initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}
                onAnimationComplete={() => setRipple(null)} />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {tooltipVisible && (
              <motion.div key={`tt-${stepIndex}`} className="tour-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}
                initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ duration: 0.25 }}>
                <div className="tour-tooltip-glow" />
                <div className="tour-tooltip-header">
                  <span className="tour-tooltip-step-badge">{stepIndex + 1}</span>
                  <span className="tour-tooltip-title">{currentStep.title}</span>
                </div>
                <div className="tour-tooltip-body">
                  <p className="tour-tooltip-desc" dangerouslySetInnerHTML={{ __html: currentStep.description }} />
                </div>
                <div className="tour-tooltip-footer">
                  <div className="tour-tooltip-progress">
                    <div className="tour-tooltip-progress-bar">
                      <div className="tour-tooltip-progress-fill" style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }} />
                    </div>
                    <span>{stepIndex + 1}/{totalSteps}</span>
                  </div>
                  <div className="tour-tooltip-actions">
                    <button className="tour-btn tour-btn-skip" onClick={exitTour}>Skip</button>
                    <button className="tour-btn tour-btn-pause" onClick={() => setPaused(p => !p)}>
                      {paused ? <Play size={12} /> : <Pause size={12} />}
                    </button>
                    <button className="tour-btn tour-btn-next" onClick={goNext}>
                      {stepIndex + 1 >= totalSteps ? 'Finish' : 'Next'} <ChevronRight size={13} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
