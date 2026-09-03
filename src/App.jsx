import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, Link as LinkIcon, Sparkles, CheckCircle2 } from 'lucide-react';

const COL_WIDTH = 300;
const GAP = 16;
const COL_COUNT = 15;
const CHUNK_PADDING = 1500;

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [pan, setPan] = useState({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  
  const containerRef = useRef(null);
  
  const [importUrl, setImportUrl] = useState('');
  const [importState, setImportState] = useState('idle');
  const [importStep, setImportStep] = useState('');
  const [progress, setProgress] = useState(0);
  
  const columnData = useRef(new Map());
  const photoLibrary = useRef([]); 
  const recentlyUsed = useRef([]);
  
  const [touchState, setTouchState] = useState({ pinchDistance: null, panOrigin: null, initialPan: null, initialScale: 1 });

  // -- Event Handlers --
  const handlePointerDown = (e) => {
    if (e.target.closest('.ui-layer') || e.pointerType === 'touch') return; 
    setIsPanning(true);
    containerRef.current?.setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e) => {
    if (isPanning && e.pointerType !== 'touch') {
      setPan(prev => ({ x: prev.x + e.movementX, y: prev.y + e.movementY }));
    }
  };
  const handlePointerUp = (e) => {
    if (e.pointerType === 'touch') return;
    setIsPanning(false);
    if (containerRef.current?.hasPointerCapture(e.pointerId)) {
      containerRef.current.releasePointerCapture(e.pointerId);
    }
  };

  const handleTouchStart = (e) => {
    if (e.target.closest('.ui-layer')) return;
    if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setTouchState({ pinchDistance: dist, initialScale: scale, panOrigin: null, initialPan: null });
    } else if (e.touches.length === 1) {
      setIsPanning(true);
      setTouchState({ 
        panOrigin: { x: e.touches[0].clientX, y: e.touches[0].clientY }, 
        initialPan: { ...pan },
        pinchDistance: null,
        initialScale: scale
      });
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchState.pinchDistance) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const zoomDelta = dist / touchState.pinchDistance;
      const newScale = Math.min(Math.max(touchState.initialScale * zoomDelta, 0.15), 3);
      
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      const newPanX = midX - (midX - pan.x) * (newScale / scale);
      const newPanY = midY - (midY - pan.y) * (newScale / scale);

      setScale(newScale);
      setPan({ x: newPanX, y: newPanY });
      
      setTouchState(prev => ({ ...prev, pinchDistance: dist, initialScale: newScale }));
    } else if (e.touches.length === 1 && touchState.panOrigin && isPanning) {
      const dx = e.touches[0].clientX - touchState.panOrigin.x;
      const dy = e.touches[0].clientY - touchState.panOrigin.y;
      setPan({ x: touchState.initialPan.x + dx, y: touchState.initialPan.y + dy });
    }
  };

  const handleTouchEnd = (e) => {
    if (e.touches.length < 2) setTouchState(prev => ({ ...prev, pinchDistance: null }));
    if (e.touches.length === 0) {
      setIsPanning(false);
      setTouchState({ pinchDistance: null, panOrigin: null, initialPan: null, initialScale: 1 });
    }
  };

  const handleWheel = useCallback((e) => {
    if (e.target.closest('.ui-layer') && !e.ctrlKey && !e.metaKey) return; // Allow normal scrolling in UI
    
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.005;
      const newScale = Math.min(Math.max(scale * (1 + delta), 0.15), 3);
      setPan(prev => ({
        x: e.clientX - (e.clientX - prev.x) * (newScale / scale),
        y: e.clientY - (e.clientY - prev.y) * (newScale / scale)
      }));
      setScale(newScale);
    } else {
      setPan(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  }, [scale, pan]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [handleWheel]);

  // -- INFINITE GENERATION --
  const getRandomUniquePhoto = () => {
    if (photoLibrary.current.length === 0) return null;
    let photo = photoLibrary.current[Math.floor(Math.random() * photoLibrary.current.length)];
    if (photoLibrary.current.length > 20) {
      let attempts = 0;
      while (recentlyUsed.current.includes(photo.url) && attempts < 15) {
        photo = photoLibrary.current[Math.floor(Math.random() * photoLibrary.current.length)];
        attempts++;
      }
    }
    recentlyUsed.current.push(photo.url);
    if (recentlyUsed.current.length > 20) recentlyUsed.current.shift();
    return photo;
  };

  const checkAndLoadGrid = useCallback(() => {
    if (!containerRef.current || photoLibrary.current.length === 0 || importState === 'processing') return;

    const viewLeft = -pan.x / scale;
    const viewTop = -pan.y / scale;
    const viewRight = (-pan.x + window.innerWidth) / scale;
    const viewBottom = (-pan.y + window.innerHeight) / scale;

    const startCol = Math.floor((viewLeft - CHUNK_PADDING) / (COL_WIDTH + GAP));
    const endCol = Math.ceil((viewRight + CHUNK_PADDING) / (COL_WIDTH + GAP));

    let newItems = [];

    for (let c = startCol; c <= endCol; c++) {
      if (!columnData.current.has(c)) {
        const startY = viewTop - (Math.random() * 600);
        columnData.current.set(c, { top: startY, bottom: startY });
      }

      const colState = columnData.current.get(c);

      while (colState.bottom < viewBottom + CHUNK_PADDING) {
        const photo = getRandomUniquePhoto();
        if (!photo) break;
        const height = COL_WIDTH * (photo.trueH / photo.trueW);
        const x = c * (COL_WIDTH + GAP);
        const y = colState.bottom + GAP;
        newItems.push({ id: `bot-${Date.now()}-${Math.random()}`, url: photo.url, title: photo.title, width: COL_WIDTH, height, x, y });
        colState.bottom = y + height;
      }

      while (colState.top > viewTop - CHUNK_PADDING) {
        const photo = getRandomUniquePhoto();
        if (!photo) break;
        const height = COL_WIDTH * (photo.trueH / photo.trueW);
        const x = c * (COL_WIDTH + GAP);
        const y = colState.top - GAP - height;
        newItems.push({ id: `top-${Date.now()}-${Math.random()}`, url: photo.url, title: photo.title, width: COL_WIDTH, height, x, y });
        colState.top = y;
      }
    }

    if (newItems.length > 0) setItems(prev => [...prev, ...newItems]);
  }, [pan, scale, importState]);

  useEffect(() => {
    checkAndLoadGrid();
  }, [checkAndLoadGrid, pan, scale]);

  // -- BULK IMPORT LOGIC --
  const handleImport = async (e) => {
    e.preventDefault();
    if (!importUrl) return;

    setImportState('processing');
    setImportStep('Downloading album data...');
    setProgress(10);
    
    columnData.current.clear();
    photoLibrary.current = [];
    recentlyUsed.current = [];
    setItems([]);
    setScale(1);
    setPan({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    try {
      const response = await fetch(`/api/extract-album`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to extract album');
      
      setImportStep(`Pre-loading ${data.photos.length} photos...`);
      setProgress(40);

      const shuffledPhotos = shuffleArray(data.photos);

      const loadedPhotos = await Promise.all(shuffledPhotos.map((photo, i) => {
        return new Promise(resolve => {
          const img = new Image();
          img.onload = () => {
            if (i % 10 === 0) setProgress(40 + Math.floor((i / shuffledPhotos.length) * 40));
            resolve({ ...photo, trueW: img.width, trueH: img.height });
          };
          img.onerror = () => resolve(null);
          img.src = photo.url;
        });
      }));

      const validPhotos = loadedPhotos.filter(Boolean);
      photoLibrary.current = validPhotos; 
      
      setImportStep('Calculating Masonry layout...');
      setProgress(90);

      const startY = -1500; 
      for (let i = -Math.floor(COL_COUNT/2); i <= Math.floor(COL_COUNT/2); i++) {
        columnData.current.set(i, { top: startY, bottom: startY });
      }

      const newItems = [];
      validPhotos.forEach((photo, idx) => {
        const height = COL_WIDTH * (photo.trueH / photo.trueW);
        
        let shortestCol = 0;
        let minBottom = Infinity;
        for (let c = -Math.floor(COL_COUNT/2); c <= Math.floor(COL_COUNT/2); c++) {
          const bottom = columnData.current.get(c).bottom;
          if (bottom < minBottom) {
            minBottom = bottom;
            shortestCol = c;
          }
        }
        
        const colState = columnData.current.get(shortestCol);
        const x = shortestCol * (COL_WIDTH + GAP);
        const y = colState.bottom + GAP;
        
        newItems.push({ 
          id: `import-${Date.now()}-${idx}`, 
          url: photo.url, 
          title: photo.title, 
          width: COL_WIDTH, 
          height, 
          x: x, 
          y: y 
        });
        
        colState.bottom = y + height;
      });
      
      setItems(newItems);
      setImportState('success');
      setProgress(100);
      
      setTimeout(() => {
        setImportState('idle');
        setProgress(0);
        checkAndLoadGrid();
      }, 1500);

    } catch (error) {
      console.error(error);
      alert(error.message);
      setImportState('idle');
      setProgress(0);
    }
  };

  const handleZoomSlider = (e) => {
    const newScale = parseFloat(e.target.value);
    
    // Zoom into absolute center of viewport
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    
    setPan(prev => ({
      x: centerX - (centerX - prev.x) * (newScale / scale),
      y: centerY - (centerY - prev.y) * (newScale / scale)
    }));
    
    setScale(newScale);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0e0e0e] text-white font-sans">
      <main 
        ref={containerRef} 
        className={`absolute inset-0 touch-none origin-top-left ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: '0 0', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {items.map((item) => (
            <div key={item.id} className="absolute overflow-hidden rounded-[4px] bg-[#1a1a1a] shadow-md animate-in fade-in zoom-in duration-500 pointer-events-none" style={{ left: item.x, top: item.y, width: item.width, height: item.height }}>
              <img src={item.url} alt={item.title} className="w-full h-full object-cover block" />
            </div>
          ))}
        </div>
      </main>
      
      {/* ZOOM SLIDER UI (Top Right) */}
      <div className="ui-layer absolute top-8 right-8 flex flex-col items-center bg-black/30 backdrop-blur-md border border-white/5 rounded-full px-4 py-3 shadow-lg hover:bg-black/50 transition-colors">
        <input 
          type="range" 
          min="0.15" 
          max="3" 
          step="0.05" 
          value={scale} 
          onChange={handleZoomSlider}
          className="w-32 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
        />
      </div>
      
      {/* IMPORT UI (Bottom Center) */}
      <div className="ui-layer fixed bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center z-50 w-[95%] max-w-2xl">
        <form onSubmit={handleImport} className="w-full flex items-center bg-[#1a1a1a]/90 backdrop-blur-md border border-white/10 rounded-full p-1.5 shadow-2xl">
          <div className="pl-4 pr-2 text-gray-400"><LinkIcon size={18} /></div>
          <input 
            type="url" 
            placeholder="Paste public Google Photos album link..." 
            value={importUrl} 
            onChange={(e) => setImportUrl(e.target.value)} 
            disabled={importState === 'processing'}
            className="flex-1 bg-transparent border-none outline-none text-sm text-gray-200 py-2 px-2" 
          />
          <button 
            type="submit" 
            disabled={!importUrl || importState === 'processing'}
            className="bg-white text-black px-6 py-2 rounded-full font-semibold flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            {importState === 'processing' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Generate
          </button>
        </form>

        <div className={`w-full transition-all duration-500 ${importState !== 'idle' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
          <div className="w-full mt-4 bg-gray-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-indigo-500 h-1.5 transition-all duration-300 ease-out" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="mt-2 text-indigo-300 text-sm flex items-center justify-center gap-2 font-medium">
            {importState === 'processing' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} className="text-green-400" />}
            {importState === 'success' ? 'All photos loaded!' : importStep}
          </div>
        </div>
      </div>
    </div>
  );
}
