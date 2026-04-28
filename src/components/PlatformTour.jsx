import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, ChevronRight, Compass, Target, Crosshair, Navigation, BarChart2, FileText, Layers } from 'lucide-react';
import './PlatformTour.css';

const DEMO_AOI = {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[92.75,26.65],[92.85,26.65],[92.85,26.72],[92.75,26.72],[92.75,26.65]]] },
  properties: { district: 'Sonitpur' },
};

const STEPS = [
  { id:'brand', tab:null, target:'.navbar-brand', title:'Dronacharya Recce System',
    desc:'Welcome to the <strong>AI-powered artillery terrain intelligence</strong> platform built for the Indian Army. This walkthrough will show you the complete recce workflow from mission planning to final deployment report.', delay:4500 },

  { id:'district', tab:'mission', target:'.sidebar .form-select', title:'Step 1 — Select District',
    desc:'Selecting <strong>Sonitpur district</strong>. The system loads satellite imagery, DEM elevation data, road networks, and land cover classification for this operational region.',
    delay:3500, onEnter:(p)=>{ p.setActiveDistrict('Sonitpur'); } },

  { id:'gun', tab:'mission', target:'.sidebar .form-group:nth-child(3) .form-select', title:'Step 2 — Choose Gun System',
    desc:'Selecting <strong>FH-77B Bofors (155mm)</strong>. The AI tailors its terrain scoring — slope limits, platform footprint, and gun separation distances — to this artillery system.',
    delay:3500, onEnter:(p)=>{ p.setMission(m=>({...m, gunType:'BOFORS'})); } },

  { id:'guns', tab:'mission', target:'.sidebar .form-group:nth-child(4) .btn-group', title:'Step 3 — Number of Guns',
    desc:'Setting <strong>6 guns</strong>. The system needs enough flat, concealed area to fit all gun platforms with proper separation between each.',
    delay:3000, onEnter:(p)=>{ p.setMission(m=>({...m, numGuns:6})); } },

  { id:'batt', tab:'mission', target:'.sidebar .form-group:nth-child(5) .btn-group', title:'Step 4 — Number of Batteries',
    desc:'Configuring <strong>2 batteries</strong> (3 guns each). Each battery will be assigned to a separate candidate area for tactical dispersion.',
    delay:3000, onEnter:(p)=>{ p.setMission(m=>({...m, batteries:2})); } },

  { id:'dn', tab:'mission', target:'.sidebar .form-group:nth-child(7) .btn-group', title:'Step 5 — Day/Night Operations',
    desc:'Selecting <strong>Day</strong> operations. Night missions would add thermal concealment and visibility factors to the scoring model.',
    delay:2800, onEnter:(p)=>{ p.setMission(m=>({...m, dayNight:'Day'})); } },

  { id:'season', tab:'mission', target:'.sidebar .form-group:nth-child(8) .form-select', title:'Step 6 — Season',
    desc:'Choosing <strong>Post-Monsoon</strong>. Ground conditions, vegetation density, and river water levels change drastically between seasons — the AI accounts for all of this.',
    delay:2800, onEnter:(p)=>{ p.setMission(m=>({...m, season:'Post-Monsoon'})); } },

  { id:'threat', tab:'mission', target:'.sidebar .form-group:nth-child(9) .btn-group', title:'Step 7 — Threat Level',
    desc:'Setting <strong>Medium threat</strong>. This increases scoring weight on concealment, canopy cover, and distance from settlements to reduce detection risk.',
    delay:3000, onEnter:(p)=>{ p.setMission(m=>({...m, threatLevel:'Medium'})); } },

  { id:'aoi', tab:'mission', target:'.draw-toolbar', title:'Step 8 — Draw Area of Interest',
    desc:'Drawing a custom <strong>AOI polygon</strong> over Sonitpur. The AI will only analyze terrain within this boundary — focusing computation on the commander\'s area of interest.',
    delay:3500, onEnter:(p)=>{ p.setCustomAOI(DEMO_AOI); } },

  { id:'run', tab:'mission', target:'.sidebar .btn-primary', title:'Step 9 — Launch AI Analysis',
    desc:'Clicking <strong>AI PRE-SCREEN</strong> to run the full suitability analysis. The backend processes 27+ parameters across slope, access, concealment, water, soil, and more to rank candidate gun areas.',
    delay:5000, onEnter:(p)=>{ if(p.runAnalysis) p.runAnalysis(); } },

  { id:'terrain', tab:'analysis', target:'.sidebar', title:'Terrain Intelligence Panel',
    desc:'This panel shows the <strong>ESA WorldCover satellite classification</strong> — breaking down the AOI into cropland, forest, grassland, water bodies, built-up areas, and bare ground percentages.',
    delay:4500 },

  { id:'ranked', tab:'analysis', target:'.results-panel', title:'AI-Ranked Gun Areas',
    desc:'Each candidate area is scored on <strong>27+ parameters</strong>: terrain slope, soil bearing, canopy concealment, road proximity, water drainage, settlement distance, and operational fit for the selected gun system.',
    delay:5000 },

  { id:'lc', tab:'analysis', target:'.layer-panel', title:'Layer: Land Cover',
    desc:'Turning on the <strong>landcover layer</strong> — showing ESA WorldCover classification directly on the map. Green = forest, yellow = cropland, pink = built-up, blue = water.',
    delay:3500, onEnter:(p)=>{ p.setLayers(l=>({...l, landcover:true})); } },

  { id:'sl', tab:'analysis', target:'.layer-panel', title:'Layer: Slope Analysis',
    desc:'Enabling the <strong>slope layer</strong> from SRTM DEM data. Artillery requires flat terrain (under 5° for towed guns). Steep slopes appear in red, flat terrain in green.',
    delay:3500, onEnter:(p)=>{ p.setLayers(l=>({...l, slope:true})); } },

  { id:'suit', tab:'analysis', target:'.layer-panel', title:'Layer: Suitability Heatmap',
    desc:'The <strong>AI suitability heatmap</strong> overlays the combined scoring — bright areas are highly suitable for gun deployment, dark areas fail one or more criteria.',
    delay:3500, onEnter:(p)=>{ p.setLayers(l=>({...l, suitability:true})); } },

  { id:'loff', tab:'analysis', target:'.layer-panel', title:'Clearing Layers',
    desc:'Clearing visualization layers. In real operations, you can toggle any combination to build tactical understanding of the terrain.',
    delay:2500, onEnter:(p)=>{ p.setLayers(l=>({...l, landcover:false, slope:false, suitability:false})); } },

  { id:'detail', tab:'analysis', target:'.results-body > div:first-child', title:'#1 Recommended Area — Details',
    desc:'Opening the <strong>top-ranked candidate</strong>. The detail panel shows exact metrics: slope angle, canopy density, gun fit dimensions, road distance, concealment quality, and risk factors.',
    delay:5000, fb:'.results-panel',
    onEnter:(p)=>{ if(p.candidates?.[0]) { p.setSelectedCandidate(p.candidates[0].id); p.setDetailCandidate(p.candidates[0].id); } } },

  { id:'route', tab:'routes', target:'.results-panel .results-header', title:'Route Planning Module',
    desc:'The route planner computes <strong>optimal access routes</strong> from the nearest major highway to the selected gun area — analyzing road class, gradient, and off-road segments.',
    delay:4500, onEnter:(p)=>{ p.setDetailCandidate(null); } },

  { id:'drone', tab:'routes', target:'.results-panel .results-body', title:'Drone Recce Missions',
    desc:'<strong>UAV reconnaissance</strong> missions can be assigned to verify routes and validate ground conditions. Drone waypoints export as GeoJSON or KML for real drone controllers.',
    delay:4500 },

  { id:'dash', tab:'dashboard', target:'.main-content > div', title:'Commander Dashboard',
    desc:'The consolidated <strong>operational dashboard</strong> shows all key metrics at a glance: candidate ratings (GREEN/AMBER/RED), best scores, deployment estimates, route feasibility, and battery allocation status.',
    delay:5000 },

  { id:'report', tab:'reports', target:'.main-content > div', title:'Mission Report',
    desc:'The final <strong>operational report</strong> compiles everything: terrain analysis, ranked candidates, route assessment, drone recce status, risk summary, and battery allocation — ready for commander sign-off.',
    delay:5000 },

  { id:'export', tab:'reports', target:'.report-actions', title:'Export & Share',
    desc:'Download as a <strong>print-ready PDF</strong> or export as KML for integration with military GIS systems. The complete AI-assisted recce workflow is now done.',
    delay:4500, fb:'.main-content > div' },
];

const CursorSvg = () => (
  <svg viewBox="0 0 24 24" fill="none"><path d="M5.65 2.92L19.08 12.03C19.56 12.35 19.36 13.1 18.79 13.13L12.48 13.46L9.8 19.23C9.56 19.75 8.8 19.67 8.68 19.12L5.05 3.61C4.94 3.12 5.28 2.67 5.65 2.92Z" fill="url(#cg)" stroke="#0ea5e9" strokeWidth="0.8"/><defs><linearGradient id="cg" x1="5" y1="3" x2="15" y2="17" gradientUnits="userSpaceOnUse"><stop stopColor="#38bdf8"/><stop offset="1" stopColor="#0ea5e9"/></linearGradient></defs></svg>
);

function TourWelcome({ onStart, onDismiss }) {
  return (
    <div className="tour-welcome">
      <div className="tour-welcome-card">
        <div className="tour-welcome-icon"><Compass size={28}/></div>
        <div className="tour-welcome-title">Platform Tour</div>
        <div className="tour-welcome-subtitle">Watch the complete AI-powered Gun Area Recce workflow — from mission setup to final report — in an interactive guided demo.</div>
        <div className="tour-welcome-features">
          <div className="tour-welcome-feature"><Target size={14}/> Mission Planning</div>
          <div className="tour-welcome-feature"><Crosshair size={14}/> AI Analysis</div>
          <div className="tour-welcome-feature"><Navigation size={14}/> Route & Drone</div>
          <div className="tour-welcome-feature"><BarChart2 size={14}/> Dashboard</div>
          <div className="tour-welcome-feature"><Layers size={14}/> Intel Layers</div>
          <div className="tour-welcome-feature"><FileText size={14}/> Reports</div>
        </div>
        <div className="tour-welcome-actions">
          <button className="tour-btn-dismiss" onClick={onDismiss}>Skip</button>
          <button className="tour-btn-start" onClick={onStart}><Play size={15}/> Start Tour</button>
        </div>
      </div>
    </div>
  );
}

export default function PlatformTour({
  active, onExit, setActiveTab, setActiveDistrict, setMission,
  setLayers, setSelectedCandidate, setDetailCandidate, setAllocations,
  setCustomAOI, runAnalysis, analysisResult, candidates,
}) {
  const [phase, setPhase] = useState('welcome');
  const [si, setSi] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cp, setCp] = useState({ x: window.innerWidth/2, y: window.innerHeight/2 });
  const [sr, setSr] = useState(null);
  const [tp, setTp] = useState({ x:0, y:0 });
  const [clicking, setClicking] = useState(false);
  const [ripple, setRipple] = useState(null);
  const [ttVis, setTtVis] = useState(false);
  const timer = useRef(null);
  const siRef = useRef(si);
  siRef.current = si;
  const execRef = useRef(false); // prevents double execution
  const step = STEPS[si] || null;

  useEffect(() => () => { if(timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    const h = e => { if(e.key==='Escape') exit(); };
    if(active) window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active]);

  const exit = useCallback(() => {
    if(timer.current) clearTimeout(timer.current);
    localStorage.setItem('dronacharya_tour_seen','true');
    setPhase('exiting');
    setTimeout(() => onExit(), 200);
  }, [onExit]);

  const posTT = useCallback((rect, cx, cy) => {
    const tw=420, th=200, m=16;
    if(!rect){ setTp({x:cx-tw/2, y:cy+40}); return; }
    let y = rect.top+rect.height+m+th < window.innerHeight ? rect.top+rect.height+m : rect.top-th-m > 0 ? rect.top-th-m : Math.max(m,(window.innerHeight-th)/2);
    let x = rect.left; if(x+tw>window.innerWidth-m) x=window.innerWidth-tw-m; if(x<m) x=m;
    setTp({x,y});
  }, []);

  const spot = useCallback((sel, fb) => {
    let el = sel ? document.querySelector(sel) : null;
    if(!el && fb) el = document.querySelector(fb);
    if(!el){ setCp({x:window.innerWidth/2,y:window.innerHeight/2}); setSr(null); posTT(null,window.innerWidth/2,window.innerHeight/2); return; }
    const r = el.getBoundingClientRect(), pad=8;
    const s = {top:r.top-pad, left:r.left-pad, width:r.width+pad*2, height:r.height+pad*2};
    setCp({x:r.left+r.width/2, y:r.top+r.height/2});
    setSr(s); posTT(s, r.left+r.width/2, r.top+r.height/2);
    if(r.top<0||r.bottom>window.innerHeight) el.scrollIntoView({behavior:'smooth',block:'center'});
  }, [posTT]);

  const goNext = useCallback(() => {
    if(timer.current) clearTimeout(timer.current);
    execRef.current = false;
    const n = siRef.current + 1;
    if(n >= STEPS.length){ exit(); return; }
    setSi(n);
  }, [exit]);

  const execStep = useCallback((idx) => {
    if(execRef.current) return; // prevent double fire
    execRef.current = true;
    const s = STEPS[idx]; if(!s){ exit(); return; }
    setTtVis(false);
    if(s.tab && setActiveTab) setActiveTab(s.tab);
    if(s.onEnter) s.onEnter({ setActiveDistrict, setMission, setLayers, setSelectedCandidate, setDetailCandidate, setAllocations, setCustomAOI, runAnalysis, candidates });
    const wait = s.tab ? 600 : 250;
    setTimeout(() => {
      spot(s.target, s.fb);
      setTimeout(() => setTtVis(true), 500);
      if(!paused){
        timer.current = setTimeout(() => { if(siRef.current===idx) goNext(); }, s.delay||4000);
      }
    }, wait);
  }, [spot, setActiveTab, setActiveDistrict, setMission, setLayers, setSelectedCandidate, setDetailCandidate, setAllocations, setCustomAOI, runAnalysis, candidates, paused, exit, goNext]);

  useEffect(() => {
    if(phase==='running'){ execRef.current=false; execStep(si); }
  }, [si, phase]);

  useEffect(() => {
    if(paused){ if(timer.current) clearTimeout(timer.current); }
    else if(phase==='running'){
      const s=STEPS[si]; if(s){ timer.current=setTimeout(()=>{ if(siRef.current===si) goNext(); }, (s.delay||4000)/2); }
    }
  }, [paused]);

  if(!active) return null;

  return (
    <AnimatePresence>
      {phase==='welcome' && (
        <motion.div key="w" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.3}}>
          <TourWelcome onStart={()=>{setPhase('running');setSi(0);setPaused(false);}} onDismiss={()=>{localStorage.setItem('dronacharya_tour_seen','true');onExit();}} />
        </motion.div>
      )}
      {phase==='running' && step && (
        <motion.div key="t" className="tour-overlay" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.3}}>
          {sr ? <div className="tour-spotlight" style={{top:sr.top,left:sr.left,width:sr.width,height:sr.height}}/> : <div className="tour-backdrop active" onClick={exit}/>}
          <div className={`tour-cursor ${clicking?'clicking':''}`} style={{left:cp.x,top:cp.y}}><CursorSvg/></div>
          <AnimatePresence>
            {ripple && <motion.div key={ripple.id} className="tour-cursor-ripple" style={{left:ripple.x,top:ripple.y}} initial={{opacity:1}} animate={{opacity:0}} transition={{duration:0.6}} onAnimationComplete={()=>setRipple(null)}/>}
          </AnimatePresence>
          <AnimatePresence>
            {ttVis && (
              <motion.div key={`tt${si}`} className="tour-tooltip" style={{left:tp.x,top:tp.y}} initial={{opacity:0,y:8,scale:0.96}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,scale:0.96}} transition={{duration:0.2}}>
                <div className="tour-tooltip-glow"/>
                <div className="tour-tooltip-header">
                  <span className="tour-tooltip-step-badge">{si+1}</span>
                  <span className="tour-tooltip-title">{step.title}</span>
                </div>
                <div className="tour-tooltip-body"><p className="tour-tooltip-desc" dangerouslySetInnerHTML={{__html:step.desc}}/></div>
                <div className="tour-tooltip-footer">
                  <div className="tour-tooltip-progress">
                    <div className="tour-tooltip-progress-bar"><div className="tour-tooltip-progress-fill" style={{width:`${((si+1)/STEPS.length)*100}%`}}/></div>
                    <span>{si+1}/{STEPS.length}</span>
                  </div>
                  <div className="tour-tooltip-actions">
                    <button className="tour-btn tour-btn-skip" onClick={exit}>Skip</button>
                    <button className="tour-btn tour-btn-pause" onClick={()=>setPaused(p=>!p)}>{paused?<Play size={12}/>:<Pause size={12}/>}</button>
                    <button className="tour-btn tour-btn-next" onClick={goNext}>{si+1>=STEPS.length?'Finish':'Next'} <ChevronRight size={13}/></button>
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
