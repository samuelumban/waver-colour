import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, RefreshCw, Plus, X, Video, Image as ImageIcon, Upload, Layout, Monitor, Smartphone, Square } from 'lucide-react';

// --- Types ---

interface BlobEntity {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  phaseX: number;
  phaseY: number;
  baseFreqX: number;
  baseFreqY: number;
}

type BlendMode = 'source-over' | 'screen' | 'overlay' | 'multiply' | 'difference' | 'exclusion' | 'hard-light' | 'soft-light';
type AspectRatioKey = '16:9' | '9:16' | '1:1' | '4:5';

const ASPECT_RATIOS: Record<AspectRatioKey, { w: number, h: number, label: string, icon: React.ReactNode }> = {
  '16:9': { w: 1920, h: 1080, label: 'Landscape', icon: <Monitor size={20} /> },
  '9:16': { w: 1080, h: 1920, label: 'Story', icon: <Smartphone size={20} /> },
  '1:1': { w: 1080, h: 1080, label: 'Square', icon: <Square size={20} /> },
  '4:5': { w: 1080, h: 1350, label: 'Portrait', icon: <Layout size={20} /> },
};

// --- Constants ---

const EXPORT_FPS = 60;

const DEFAULT_COLORS = [
  '#FF0080', // Pink
  '#7928CA', // Purple
  '#0070F3', // Blue
  '#00DFD8', // Cyan
  '#FF4D4D', // Red
];

// --- Helper Functions ---

const generateBlobs = (colors: string[], width: number, height: number): BlobEntity[] => {
  return colors.map((color) => ({
    id: Math.random().toString(36).substr(2, 9),
    x: Math.random() * width,
    y: Math.random() * height,
    radius: Math.min(width, height) * (0.4 + Math.random() * 0.4), // Responsive radius
    color,
    phaseX: Math.random() * Math.PI * 2,
    phaseY: Math.random() * Math.PI * 2,
    baseFreqX: Math.ceil(Math.random() * 2), 
    baseFreqY: Math.ceil(Math.random() * 2),
  }));
};

const drawImageCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
    const r = Math.max(w / img.width, h / img.height);
    const nw = img.width * r;
    const nh = img.height * r;
    const cx = (w - nw) * 0.5;
    const cy = (h - nh) * 0.5;
    ctx.drawImage(img, cx, cy, nw, nh);
};

const App: React.FC = () => {
  // --- State ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>();
  const [isPlaying, setIsPlaying] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  
  // Customization State
  const [duration, setDuration] = useState(10);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioKey>('16:9');
  const [speed, setSpeed] = useState(1); 
  const [blurLevel, setBlurLevel] = useState(120);
  const [blendMode, setBlendMode] = useState<BlendMode>('screen');
  const [colors, setColors] = useState<string[]>(DEFAULT_COLORS);
  
  // Background State
  const [bgType, setBgType] = useState<'color' | 'image'>('color');
  const [bgColor, setBgColor] = useState('#000000');
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  const currentDims = ASPECT_RATIOS[aspectRatio];

  const [blobs, setBlobs] = useState<BlobEntity[]>(() => generateBlobs(DEFAULT_COLORS, 1920, 1080));

  // --- Animation Engine ---

  const draw = useCallback((ctx: CanvasRenderingContext2D, time: number) => {
    const { w, h } = currentDims;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);
    
    // 1. Draw Background
    if (bgType === 'color') {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, w, h);
    } else if (bgType === 'image' && bgImage) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        drawImageCover(ctx, bgImage, 0, 0, w, h);
    } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
    }

    // 2. Apply Blur
    ctx.filter = `blur(${blurLevel}px)`;
    ctx.globalCompositeOperation = blendMode;

    // Speed & Amplitude
    const nominalFreq = Math.max(1, Math.round(speed));
    const amplitudeScale = speed / nominalFreq;

    blobs.forEach((blob) => {
      // Time normalized to Loop Duration
      const t = (time / (duration * 1000)) * Math.PI * 2; 
      
      const effectiveFreqX = blob.baseFreqX * nominalFreq;
      const effectiveFreqY = blob.baseFreqY * nominalFreq;

      const offsetX = Math.sin(t * effectiveFreqX + blob.phaseX) * (w * 0.35) * amplitudeScale;
      const offsetY = Math.cos(t * effectiveFreqY + blob.phaseY) * (h * 0.35) * amplitudeScale;

      const x = (w / 2) + offsetX;
      const y = (h / 2) + offsetY;

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, blob.radius);
      gradient.addColorStop(0, blob.color);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, blob.radius * 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';

  }, [blobs, blurLevel, blendMode, speed, duration, bgType, bgColor, bgImage, currentDims]);

  const animate = useCallback((time: number) => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d', { alpha: false });
      if (ctx) {
        draw(ctx, time);
      }
    }
    if (isPlaying && !isRecording) {
      requestRef.current = requestAnimationFrame(animate);
    }
  }, [draw, isPlaying, isRecording]);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [animate]);

  useEffect(() => {
     setBlobs(generateBlobs(colors, currentDims.w, currentDims.h));
  }, [aspectRatio, colors]); 

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                setBgImage(img);
                setBgType('image');
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    }
  };

  const handleColorChange = (index: number, newColor: string) => {
    const newColors = [...colors];
    newColors[index] = newColor;
    setColors(newColors);
  };

  const addColor = () => {
    if (colors.length < 8) {
      setColors([...colors, '#ffffff']);
    }
  };

  const removeColor = (index: number) => {
    if (colors.length > 2) {
      const newColors = colors.filter((_, i) => i !== index);
      setColors(newColors);
    }
  };

  const regeneratePositions = () => {
    setBlobs(generateBlobs(colors, currentDims.w, currentDims.h));
  };

  const toggleAspectRatio = () => {
    const keys = Object.keys(ASPECT_RATIOS) as AspectRatioKey[];
    const currentIndex = keys.indexOf(aspectRatio);
    const nextIndex = (currentIndex + 1) % keys.length;
    setAspectRatio(keys[nextIndex]);
  };

  // --- Recording Logic ---

  const handleExport = async () => {
    if (!canvasRef.current) return;
    setIsRecording(true);
    setIsPlaying(false);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') 
        ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"' 
        : 'video/webm; codecs=vp9';

    const stream = canvas.captureStream(EXPORT_FPS);
    const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12000000 // Optimized: 12Mbps is sufficient for 1080p60 smooth gradients without excessive file size
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gradient-wave-${aspectRatio.replace(':','-')}-${duration}s.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        URL.revokeObjectURL(url);
        
        setIsRecording(false);
        setIsPlaying(true);
        setRecordingProgress(0);
    };

    recorder.start();

    const totalFrames = duration * EXPORT_FPS;
    const timePerFrame = 1000 / EXPORT_FPS;
    let frame = 0;

    const recordLoop = () => {
        if (frame >= totalFrames) {
            recorder.stop();
            return;
        }

        const currentTime = frame * timePerFrame;
        draw(ctx, currentTime);
        
        requestAnimationFrame(() => {
            frame++;
            setRecordingProgress(Math.round((frame / totalFrames) * 100));
            setTimeout(recordLoop, 0); 
        });
    };

    recordLoop();
  };

  return (
    <div className="flex flex-col h-screen w-full bg-gray-950 text-white font-sans overflow-hidden">
      
      {/* --- TOP HEADER --- */}
      <div className="h-16 shrink-0 bg-gray-850/90 backdrop-blur border-b border-gray-750 flex items-center justify-between px-4 lg:px-8 z-20 shadow-xl relative">
          
          {/* Left: Logo */}
          <div className="font-bold text-xl tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent min-w-[100px]">
             Wave Gen
          </div>

          {/* Center: Aspect Ratio Toggle */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
             <button
                 onClick={toggleAspectRatio}
                 className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-all border border-gray-700 group flex items-center gap-2"
                 disabled={isRecording}
                 title={`Current: ${ASPECT_RATIOS[aspectRatio].label}`}
             >
                 {ASPECT_RATIOS[aspectRatio].icon}
                 <span className="hidden md:block text-xs font-medium text-gray-400 group-hover:text-gray-200">
                     {aspectRatio}
                 </span>
             </button>
          </div>

          {/* Right: Primary Controls */}
          <div className="flex items-center gap-3">
             <button 
                 onClick={() => setIsPlaying(!isPlaying)}
                 className="p-2.5 rounded-full hover:bg-gray-700 text-gray-300 transition-colors"
                 title={isPlaying ? "Pause" : "Play"}
                 disabled={isRecording}
             >
                 {isPlaying ? <Pause size={20} /> : <Play size={20} />}
             </button>
             <button 
                 onClick={regeneratePositions}
                 className="p-2.5 rounded-full hover:bg-gray-700 text-gray-300 transition-colors mr-2"
                 title="Randomize Positions"
                 disabled={isRecording}
             >
                 <RefreshCw size={20} />
             </button>
             <button 
                onClick={handleExport}
                disabled={isRecording}
                className={`
                    h-9 px-4 rounded-full flex items-center gap-2 font-semibold text-sm transition-all shadow-lg
                    ${isRecording 
                        ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                        : 'bg-white text-black hover:bg-gray-200 active:scale-95'
                    }
                `}
            >
                {isRecording ? <RefreshCw className="animate-spin" size={16} /> : <Video size={16} />}
                <span className="hidden sm:inline">{isRecording ? 'Exporting...' : 'Export'}</span>
            </button>
          </div>
      </div>

      {/* --- CANVAS AREA --- */}
      <div className="flex-1 relative flex items-center justify-center bg-[#0d1117] p-4 lg:p-8 overflow-hidden">
        {/* Aspect Ratio Container */}
        <div 
            className="relative shadow-2xl rounded-lg overflow-hidden border border-gray-800 transition-all duration-300 ease-in-out bg-black"
            style={{ 
                aspectRatio: `${currentDims.w}/${currentDims.h}`,
                height: currentDims.h > currentDims.w ? '90%' : 'auto',
                width: currentDims.w >= currentDims.h ? '90%' : 'auto',
                maxWidth: '100%',
                maxHeight: '100%'
            }}
        >
            <canvas
                ref={canvasRef}
                width={currentDims.w}
                height={currentDims.h}
                className="w-full h-full object-contain"
            />
            
            {/* Recording Overlay */}
            {isRecording && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-50">
                    <div className="text-3xl font-bold mb-4 animate-pulse text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                        Rendering
                    </div>
                    <div className="w-48 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-blue-500 transition-all duration-75 ease-linear"
                            style={{ width: `${recordingProgress}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* --- BOTTOM SETTINGS PANEL --- */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 z-10 overflow-y-auto max-h-[40vh]">
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 max-w-7xl mx-auto">
            
            {/* Group 1: Physics & Time */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                     <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Speed</label>
                     <span className="text-xs text-gray-500">{speed.toFixed(1)}x</span>
                </div>
                <input 
                    type="range" min="0.1" max="4.0" step="0.1"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    disabled={isRecording}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                
                <div className="flex items-center justify-between pt-2">
                     <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Duration</label>
                     <span className="text-xs text-gray-500">{duration}s</span>
                </div>
                <input 
                    type="range" min="5" max="60" step="1"
                    value={duration}
                    onChange={(e) => setDuration(parseInt(e.target.value))}
                    disabled={isRecording}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>

            {/* Group 2: Visuals */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                     <label className="text-xs text-gray-400 font-bold uppercase tracking-wider">Blur Intensity</label>
                     <span className="text-xs text-gray-500">{blurLevel}px</span>
                </div>
                <input 
                    type="range" min="0" max="300" step="10"
                    value={blurLevel}
                    onChange={(e) => setBlurLevel(parseInt(e.target.value))}
                    disabled={isRecording}
                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />

                <div className="flex gap-4 pt-2">
                    <div className="flex-1">
                        <label className="block text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Blend Mode</label>
                        <select 
                            value={blendMode}
                            onChange={(e) => setBlendMode(e.target.value as BlendMode)}
                            disabled={isRecording}
                            className="w-full bg-gray-800 text-xs border border-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:border-blue-500 text-gray-300"
                        >
                            <option value="source-over">Normal</option>
                            <option value="screen">Screen</option>
                            <option value="overlay">Overlay</option>
                            <option value="soft-light">Soft Light</option>
                            <option value="multiply">Multiply</option>
                        </select>
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">Background</label>
                         <div className="flex gap-2">
                            {bgType === 'color' ? (
                                <div className="flex-1 flex items-center gap-2 bg-gray-800 rounded-md px-2 py-1 border border-gray-700">
                                     <input 
                                        type="color" 
                                        value={bgColor} 
                                        onChange={(e) => setBgColor(e.target.value)}
                                        className="w-5 h-5 rounded-full cursor-pointer border-none bg-transparent p-0"
                                    />
                                    <button onClick={() => setBgType('image')} className="text-[10px] text-gray-400 hover:text-white ml-auto">Img</button>
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center gap-2 bg-gray-800 rounded-md px-2 py-1 border border-gray-700 overflow-hidden relative">
                                    <label className="cursor-pointer flex items-center gap-2 w-full">
                                        <div className="w-5 h-5 bg-gray-700 rounded-full flex items-center justify-center">
                                           {bgImage ? <ImageIcon size={12}/> : <Upload size={12}/>}
                                        </div>
                                        <span className="text-[10px] text-gray-300 truncate">{bgImage ? 'Set' : 'Upload'}</span>
                                        <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                                    </label>
                                     <button onClick={() => setBgType('color')} className="text-[10px] text-gray-400 hover:text-white absolute right-2 bg-gray-800 pl-2">Col</button>
                                </div>
                            )}
                         </div>
                    </div>
                </div>
            </div>

            {/* Group 3: Palette */}
            <div className="space-y-2">
                 <div className="flex justify-between items-center mb-1">
                     <span className="text-xs text-gray-400 font-bold uppercase tracking-wider">Palette</span>
                     <span className="text-[10px] text-gray-500">{colors.length} Colors</span>
                </div>
                <div className="flex flex-wrap gap-3">
                    {colors.map((color, index) => (
                        <div key={index} className="relative group">
                            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-700 hover:border-gray-500 transition-colors shadow-sm">
                                <input 
                                    type="color" 
                                    value={color}
                                    onChange={(e) => handleColorChange(index, e.target.value)}
                                    className="w-[150%] h-[150%] -m-[25%] cursor-pointer p-0 border-none"
                                    disabled={isRecording}
                                />
                            </div>
                            {colors.length > 2 && (
                                <button 
                                    onClick={() => removeColor(index)}
                                    className="absolute -top-1 -right-1 bg-gray-900 text-gray-400 hover:text-red-400 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity border border-gray-700 shadow-md"
                                >
                                    <X size={10} />
                                </button>
                            )}
                        </div>
                    ))}
                    {colors.length < 8 && (
                        <button 
                            onClick={addColor}
                            disabled={isRecording}
                            className="w-10 h-10 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center text-gray-500 hover:text-white hover:border-gray-500 transition-all"
                        >
                            <Plus size={16} />
                        </button>
                    )}
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default App;