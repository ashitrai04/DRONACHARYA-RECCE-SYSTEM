/* ═══════════════════════════════════════════════════════════ */
/*  PLATFORM TOUR — INTERACTIVE GUIDED DEMO                  */
/*  Cinematic product walkthrough for Dronacharya Recce       */
/* ═══════════════════════════════════════════════════════════ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, X, SkipForward, Pause, ChevronRight,
  Compass, Target, Crosshair, Navigation,
  BarChart2, FileText, Shield, Layers, Zap, Map,
} from 'lucide-react';
import './PlatformTour.css';

/* ── STEP DEFINITIONS ── */
const TOUR_STEPS = [
  /* ─── WELCOME / BRAND ─── */
  {
    id: 'brand',
    tab: null,
    target: '.navbar-brand',
    action: 'hover',
    title: 'Welcome to Dronacharya',
    description: 'An <strong>AI-powered artillery terrain intelligence</strong> platform built for the Indian Army. This system automates gun area recce using satellite imagery, terrain analysis, and deep learning.',
    delay: 4500,
  },
  /* ─── MISSION TAB FLOW ─── */
  {
    id: 'district',
    tab: 'mission',
    target: '.sidebar .form-select',
    action: 'highlight',
    title: 'Select Operational District',
    description: 'Choose the operational district. The system loads <strong>satellite-derived terrain data</strong>, road networks, and elevation models for the selected region.',
    delay: 4000,
    onEnter: (props) => {
      props.setActiveDistrict('Sonitpur');
    },
  },
  {
    id: 'gun-system',
    tab: 'mission',
    target: '.sidebar .form-group:nth-child(3) .form-select',
    action: 'highlight',
    title: 'Choose Artillery Platform',
    description: 'Select your gun system. The AI tailors slope, area, and separation analysis to this platform\'s <strong>mobility constraints and deployment footprint</strong>.',
    delay: 4000,
    onEnter: (props) => {
      props.setMission(m => ({ ...m, gunType: 'BOFORS' }));
    },
  },
  {
    id: 'num-guns',
    tab: 'mission',
    target: '.sidebar .btn-group .btn-option:nth-child(2)',
    action: 'click',
    title: 'Set Number of Guns',
    description: 'Configure the <strong>number of guns per deployment</strong>. Quick-set buttons allow rapid parameter entry during field planning.',
    delay: 3500,
    onEnter: (props) => {
      props.setMission(m => ({ ...m, numGuns: 6 }));
    },
  },
  {
    id: 'batteries',
    tab: 'mission',
    target: '.sidebar .form-group:nth-child(5) .btn-group .btn-option:nth-child(2)',
    action: 'click',
    title: 'Configure Batteries',
    description: 'Set the battery count. The system calculates <strong>optimal gun-to-battery allocation</strong> and recommends separate deployment areas for each battery.',
    delay: 3500,
    onEnter: (props) => {
      props.setMission(m => ({ ...m, batteries: 2 }));
    },
  },
  {
    id: 'day-night',
    tab: 'mission',
    target: '.sidebar .form-group:nth-child(7) .btn-group .btn-option:first-child',
    action: 'click',
    title: 'Operational Timing',
    description: 'Select <strong>Day / Night / Both</strong> operations. Night missions apply enhanced concealment and thermal signature parameters to the scoring model.',
    delay: 3500,
  },
  {
    id: 'threat',
    tab: 'mission',
    target: '.sidebar .form-group:nth-child(9) .btn-group .btn-option:nth-child(2)',
    action: 'click',
    title: 'Set Threat Level',
    description: 'Higher threat levels increase weight on <strong>concealment, dispersion, and counter-battery survivability</strong> in the multi-criteria scoring.',
    delay: 3500,
    onEnter: (props) => {
      props.setMission(m => ({ ...m, threatLevel: 'Medium' }));
    },
  },
  {
    id: 'draw-aoi',
    tab: 'mission',
    target: '.draw-toolbar .draw-btn:first-child',
    action: 'hover',
    title: 'Draw Area of Interest',
    description: 'Draw a custom <strong>AOI polygon</strong> on the map to focus analysis on a specific sector, or use the full district boundary for wide-area recce.',
    delay: 4000,
  },
  {
    id: 'ai-prescreen',
    tab: 'mission',
    target: '.sidebar .btn-primary',
    action: 'hover',
    title: 'AI PRE-SCREEN',
    description: 'Click to run the <strong>full suitability analysis</strong> using 27+ terrain, access, and concealment parameters derived from 16+ satellite and GIS datasets. Candidate gun areas are ranked automatically.',
    delay: 5000,
  },
  /* ─── ANALYSIS TAB ─── */
  {
    id: 'analysis-terrain',
    tab: 'analysis',
    target: '.sidebar',
    action: 'hover',
    title: 'Terrain Analysis',
    description: 'The terrain panel displays <strong>ESA WorldCover land cover distribution</strong>, elevation statistics, and classification breakdown computed from satellite data.',
    delay: 4500,
  },
  {
    id: 'analysis-results',
    tab: 'analysis',
    target: '.results-panel',
    action: 'hover',
    title: 'Ranked Gun Areas',
    description: 'Candidate areas are ranked by a <strong>composite suitability score</strong> spanning slope, concealment, access roads, water proximity, soil bearing capacity, and operational parameters.',
    delay: 5000,
  },
  {
    id: 'layer-landcover',
    tab: 'analysis',
    target: '.layer-panel',
    action: 'hover',
    title: 'Intelligence Layers',
    description: 'Toggle map layers to visualize <strong>landcover, slope gradients, road networks, building footprints, and the AI suitability heatmap</strong> across the operational area.',
    delay: 4500,
    onEnter: (props) => {
      props.setLayers(l => ({ ...l, landcover: true, suitability: true }));
    },
  },
  {
    id: 'layer-cleanup',
    tab: 'analysis',
    target: '.layer-panel',
    action: 'none',
    title: 'Layer Visualization',
    description: 'Each layer draws from processed <strong>Sentinel-2, ESA WorldCover, SRTM DEM, and OpenStreetMap</strong> data. Layers can be toggled independently for tactical clarity.',
    delay: 3500,
    onEnter: (props) => {
      // Reset layers after showing them
      props.setLayers(l => ({ ...l, landcover: false, suitability: false }));
    },
  },
  /* ─── ROUTES TAB ─── */
  {
    id: 'routes-tab',
    tab: 'routes',
    target: '.results-panel .results-header',
    action: 'hover',
    title: 'Route Planning',
    description: 'The route planner computes <strong>optimal access routes</strong> from the nearest major road to each candidate gun area, accounting for terrain gradient and road class.',
    delay: 4500,
  },
  {
    id: 'drone-section',
    tab: 'routes',
    target: '.results-panel .results-body',
    action: 'hover',
    title: 'Drone Recce Missions',
    description: 'Assign <strong>UAV reconnaissance</strong> to verify routes and ground-truth candidate areas. Drone waypoints are generated for real-world deployment and can be exported as GeoJSON or KML.',
    delay: 5000,
  },
  /* ─── DASHBOARD TAB ─── */
  {
    id: 'dashboard',
    tab: 'dashboard',
    target: '.dashboard-grid',
    action: 'hover',
    title: 'Commander Dashboard',
    description: 'A consolidated <strong>operational overview</strong> with mission metrics: candidate count by rating, best suitability score, recommended area, deployment time estimates, and route feasibility.',
    delay: 5000,
    fallbackTarget: '.main-content > div',
  },
  {
    id: 'battery-allocation',
    tab: 'dashboard',
    target: '.allocation-table',
    action: 'hover',
    title: 'Battery Allocation',
    description: 'Allocate batteries to candidate areas based on <strong>AI scoring and tactical requirements</strong>. The commander can override automatic recommendations for operational flexibility.',
    delay: 4500,
    fallbackTarget: '.main-content > div',
  },
  /* ─── REPORTS TAB ─── */
  {
    id: 'reports',
    tab: 'reports',
    target: '.report-header',
    action: 'hover',
    title: 'Mission Report',
    description: 'A comprehensive <strong>operational report</strong> summarizing all findings: terrain analysis, ranked candidates, route assessment, drone recce status, risk summary, and battery allocation.',
    delay: 5000,
    fallbackTarget: '.main-content > div',
  },
  {
    id: 'report-download',
    tab: 'reports',
    target: '.report-actions',
    action: 'hover',
    title: 'Export & Share',
    description: 'Download the final report as a <strong>print-ready PDF</strong> or export mission data as KML for integration with military GIS systems and command-level briefings.',
    delay: 4500,
    fallbackTarget: '.main-content > div',
  },
];

/* ── CURSOR SVG ── */
const CursorSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M5.65 2.92L19.08 12.03C19.56 12.35 19.36 13.1 18.79 13.13L12.48 13.46L9.8 19.23C9.56 19.75 8.8 19.67 8.68 19.12L5.05 3.61C4.94 3.12 5.28 2.67 5.65 2.92Z"
      fill="url(#cursor-grad)"
      stroke="#0ea5e9"
      strokeWidth="0.8"
    />
    <defs>
      <linearGradient id="cursor-grad" x1="5" y1="3" x2="15" y2="17" gradientUnits="userSpaceOnUse">
        <stop stopColor="#38bdf8" />
        <stop offset="1" stopColor="#0ea5e9" />
      </linearGradient>
    </defs>
  </svg>
);

/* ── WELCOME SCREEN ── */
function TourWelcome({ onStart, onDismiss }) {
  return (
    <div className="tour-welcome">
      <div className="tour-welcome-card">
        <div className="tour-welcome-icon">
          <Compass size={26} />
        </div>
        <div className="tour-welcome-title">Platform Tour</div>
        <div className="tour-welcome-subtitle">
          Experience the complete AI-powered Gun Area Recce workflow in an interactive guided demo.
        </div>
        <div className="tour-welcome-features">
          <div className="tour-welcome-feature"><Target size={14} /> Mission Planning</div>
          <div className="tour-welcome-feature"><Crosshair size={14} /> AI Analysis</div>
          <div className="tour-welcome-feature"><Navigation size={14} /> Route Planning</div>
          <div className="tour-welcome-feature"><BarChart2 size={14} /> Dashboard</div>
          <div className="tour-welcome-feature"><Layers size={14} /> Intel Layers</div>
          <div className="tour-welcome-feature"><FileText size={14} /> Reports</div>
        </div>
        <div className="tour-welcome-actions">
          <button className="tour-btn-dismiss" onClick={onDismiss}>Skip</button>
          <button className="tour-btn-start" onClick={onStart}>
            <Play size={15} /> Start Tour
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── MAIN TOUR ENGINE ── */
export default function PlatformTour({
  active,
  onExit,
  setActiveTab,
  setActiveDistrict,
  setMission,
  setLayers,
  setSelectedCandidate,
  setDetailCandidate,
  setAllocations,
  analysisResult,
  candidates,
}) {
  const [phase, setPhase] = useState('welcome'); // 'welcome' | 'running' | 'exiting'
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

  /* ── CLEANUP on unmount ── */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /* ── ESCAPE KEY ── */
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') exitTour();
    };
    if (active) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);

  /* ── EXIT HANDLER ── */
  const exitTour = useCallback(() => {
    setPhase('exiting');
    if (timerRef.current) clearTimeout(timerRef.current);
    localStorage.setItem('dronacharya_tour_seen', 'true');
    setTimeout(() => {
      onExit();
    }, 300);
  }, [onExit]);

  /* ── FIND AND SPOTLIGHT ELEMENT ── */
  const spotlightElement = useCallback((selector, fallback) => {
    let el = document.querySelector(selector);
    if (!el && fallback) el = document.querySelector(fallback);
    if (!el) {
      // Fallback: center of screen
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      setCursorPos({ x: cx, y: cy });
      setSpotlightRect(null);
      positionTooltip(null, cx, cy);
      return null;
    }

    const rect = el.getBoundingClientRect();
    const pad = 8;
    const spotRect = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };

    // Move cursor to center of element
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    setCursorPos({ x: cx, y: cy });
    setSpotlightRect(spotRect);
    positionTooltip(spotRect, cx, cy);

    // Scroll element into view if needed
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    return el;
  }, []);

  /* ── TOOLTIP POSITIONING ── */
  const positionTooltip = (rect, cx, cy) => {
    const tooltipW = 360;
    const tooltipH = 180;
    const margin = 16;

    if (!rect) {
      setTooltipPos({ x: cx - tooltipW / 2, y: cy + 40 });
      return;
    }

    let x, y;
    // Try below
    if (rect.top + rect.height + tooltipH + margin < window.innerHeight) {
      y = rect.top + rect.height + margin;
    }
    // Try above
    else if (rect.top - tooltipH - margin > 0) {
      y = rect.top - tooltipH - margin;
    }
    // Fallback: center
    else {
      y = Math.max(margin, (window.innerHeight - tooltipH) / 2);
    }

    // Horizontal: prefer right-aligned with target
    x = rect.left;
    if (x + tooltipW > window.innerWidth - margin) {
      x = window.innerWidth - tooltipW - margin;
    }
    if (x < margin) x = margin;

    setTooltipPos({ x, y });
  };

  /* ── EXECUTE STEP ── */
  const executeStep = useCallback((index) => {
    const step = TOUR_STEPS[index];
    if (!step) {
      exitTour();
      return;
    }

    setTooltipVisible(false);

    // Switch tab if needed
    if (step.tab && setActiveTab) {
      setActiveTab(step.tab);
    }

    // Run onEnter callback
    if (step.onEnter) {
      step.onEnter({
        setActiveDistrict,
        setMission,
        setLayers,
        setSelectedCandidate,
        setDetailCandidate,
        setAllocations,
      });
    }

    // Wait a tick for DOM to update after tab switch, then spotlight
    setTimeout(() => {
      const el = spotlightElement(step.target, step.fallbackTarget);

      // Simulate click animation
      if (step.action === 'click') {
        setTimeout(() => {
          setClicking(true);
          setRipple({ x: cursorPos.x, y: cursorPos.y, id: Date.now() });
          setTimeout(() => setClicking(false), 150);
        }, 500);
      }

      // Show tooltip after cursor arrives
      setTimeout(() => {
        setTooltipVisible(true);
      }, 600);

      // Auto-advance (if not paused)
      if (!paused) {
        timerRef.current = setTimeout(() => {
          if (!paused && stepRef.current === index) {
            goNext();
          }
        }, step.delay || 4000);
      }
    }, step.tab ? 400 : 150);
  }, [spotlightElement, setActiveTab, setActiveDistrict, setMission, setLayers, setSelectedCandidate, setDetailCandidate, setAllocations, paused, exitTour]);

  /* ── NAVIGATION ── */
  const goNext = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const next = stepRef.current + 1;
    if (next >= totalSteps) {
      exitTour();
      return;
    }
    setStepIndex(next);
  }, [totalSteps, exitTour]);

  /* ── REACT TO STEP CHANGES ── */
  useEffect(() => {
    if (phase === 'running') {
      executeStep(stepIndex);
    }
  }, [stepIndex, phase]);

  /* ── REACT TO PAUSE STATE ── */
  useEffect(() => {
    if (paused) {
      if (timerRef.current) clearTimeout(timerRef.current);
    } else if (phase === 'running') {
      const step = TOUR_STEPS[stepIndex];
      if (step) {
        timerRef.current = setTimeout(() => {
          if (stepRef.current === stepIndex) {
            goNext();
          }
        }, (step.delay || 4000) / 2); // Resume with half-time
      }
    }
  }, [paused]);

  /* ── START TOUR ── */
  const startTour = useCallback(() => {
    setPhase('running');
    setStepIndex(0);
    setPaused(false);
  }, []);

  /* ── DISMISS (from welcome) ── */
  const dismissTour = useCallback(() => {
    localStorage.setItem('dronacharya_tour_seen', 'true');
    onExit();
  }, [onExit]);

  if (!active) return null;

  return (
    <>
      <AnimatePresence>
        {/* ── WELCOME SCREEN ── */}
        {phase === 'welcome' && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <TourWelcome onStart={startTour} onDismiss={dismissTour} />
          </motion.div>
        )}

        {/* ── RUNNING TOUR ── */}
        {phase === 'running' && currentStep && (
          <motion.div
            key="tour"
            className="tour-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* Spotlight cutout */}
            {spotlightRect && (
              <div
                className="tour-spotlight"
                style={{
                  top: spotlightRect.top,
                  left: spotlightRect.left,
                  width: spotlightRect.width,
                  height: spotlightRect.height,
                }}
              />
            )}
            {/* Backdrop (clicking anywhere on dark area exits tour) */}
            {!spotlightRect && (
              <div
                className="tour-backdrop active"
                onClick={exitTour}
              />
            )}

            {/* Animated Cursor */}
            <div
              className={`tour-cursor ${clicking ? 'clicking' : ''}`}
              style={{
                left: cursorPos.x,
                top: cursorPos.y,
              }}
            >
              <CursorSvg />
            </div>

            {/* Ripple effect on click */}
            <AnimatePresence>
              {ripple && (
                <motion.div
                  key={ripple.id}
                  className="tour-cursor-ripple"
                  style={{ left: ripple.x, top: ripple.y }}
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  onAnimationComplete={() => setRipple(null)}
                />
              )}
            </AnimatePresence>

            {/* Tooltip */}
            <AnimatePresence>
              {tooltipVisible && (
                <motion.div
                  key={`tooltip-${stepIndex}`}
                  className="tour-tooltip"
                  style={{
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                  }}
                  initial={{ opacity: 0, y: 8, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.96 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className="tour-tooltip-glow" />
                  <div className="tour-tooltip-header">
                    <span className="tour-tooltip-step-badge">{stepIndex + 1}</span>
                    <span className="tour-tooltip-title">{currentStep.title}</span>
                  </div>
                  <div className="tour-tooltip-body">
                    <p
                      className="tour-tooltip-desc"
                      dangerouslySetInnerHTML={{ __html: currentStep.description }}
                    />
                  </div>
                  <div className="tour-tooltip-footer">
                    <div className="tour-tooltip-progress">
                      <div className="tour-tooltip-progress-bar">
                        <div
                          className="tour-tooltip-progress-fill"
                          style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
                        />
                      </div>
                      <span>{stepIndex + 1}/{totalSteps}</span>
                    </div>
                    <div className="tour-tooltip-actions">
                      <button className="tour-btn tour-btn-skip" onClick={exitTour}>
                        Skip
                      </button>
                      <button
                        className="tour-btn tour-btn-pause"
                        onClick={() => setPaused(p => !p)}
                      >
                        {paused ? <Play size={11} /> : <Pause size={11} />}
                      </button>
                      <button className="tour-btn tour-btn-next" onClick={goNext}>
                        {stepIndex + 1 >= totalSteps ? 'Finish' : 'Next'} <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
