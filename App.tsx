import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, RefreshCw, Plus, X, Video, Image as ImageIcon, Layout, Monitor, Smartphone, Square, Type, CloudRain, Sparkles, Palette, Wand2, Undo, Redo, Layers, Trash2, Move, ImagePlus, Eye, Bold, Italic, Upload, Music, Scissors } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

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

interface WeatherParticle {
  x: number;
  y: number;
  speed: number;
  size: number;
  opacity: number;
  wobble: number; // For snow
}

type BlendMode = 'source-over' | 'screen' | 'overlay' | 'multiply' | 'difference' | 'exclusion' | 'hard-light' | 'soft-light';
type AspectRatioKey = '16:9' | '9:16' | '1:1' | '4:5';
type WeatherType = 'none' | 'snow' | 'rain';
type TextAlign = 'left' | 'center' | 'right';

interface CustomFont {
    name: string;
    url: string;
}

interface TextLayer {
    id: string;
    text: string;
    fontFamily: string;
    fontWeight: string; // '300' | '400' | '800' etc
    fontStyle: string; // 'normal' | 'italic'
    fontSize: number;
    textAlign: TextAlign;
    textColor: string;
    textShadow: boolean;
    x: number; // 0-1 percentage of canvas width
    y: number; // 0-1 percentage of canvas height
    opacity: number;
}

interface LogoLayer {
    image: HTMLImageElement;
    src: string; 
    x: number;
    y: number;
    size: number; 
    opacity: number;
}

// --- Centralized Design State for Undo/Redo ---
interface DesignState {
    duration: number;
    aspectRatio: AspectRatioKey;
    speed: number;
    blurLevel: number;
    blendMode: BlendMode;
    blobOpacity: number;
    colors: string[];
    bgType: 'color' | 'image';
    bgColor: string;
    bgImage: HTMLImageElement | null;
    weatherType: WeatherType;
    weatherIntensity: number;
    textLayers: TextLayer[];
    logo: LogoLayer | null;
    customFonts: CustomFont[];
    audio: File | null;
    audioName: string | null;
    audioDuration: number;
    audioStart: number;
    audioEnd: number;
}

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

const INITIAL_TEXT_LAYER: TextLayer = {
    id: '1',
    text: 'Wave Gen',
    fontFamily: 'Poppins',
    fontWeight: '800',
    fontStyle: 'normal',
    fontSize: 100,
    textAlign: 'center',
    textColor: '#ffffff',
    textShadow: true,
    x: 0.5,
    y: 0.5,
    opacity: 1
};

const INITIAL_DESIGN: DesignState = {
    duration: 10,
    aspectRatio: '16:9',
    speed: 1,
    blurLevel: 120,
    blendMode: 'screen',
    blobOpacity: 1.0,
    colors: [...DEFAULT_COLORS],
    bgType: 'color',
    bgColor: '#000000',
    bgImage: null,
    weatherType: 'none',
    weatherIntensity: 50,
    textLayers: [INITIAL_TEXT_LAYER],
    logo: null,
    customFonts: [],
    audio: null,
    audioName: null,
    audioDuration: 0,
    audioStart: 0,
    audioEnd: 0
};

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

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// --- Main Component ---

const App: React.FC = () => {
  // --- State ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const requestRef = useRef<number>();
  
  // App Logic State (Not in history)
  const [isPlaying, setIsPlaying] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'visuals' | 'typography' | 'logo' | 'music' | 'weather' | 'ai'>('visuals');
  
  // Design State & History
  const [design, setDesign] = useState<DesignState>(INITIAL_DESIGN);
  const [history, setHistory] = useState<DesignState[]>([INITIAL_DESIGN]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // UI Selection State
  const [activeTextLayerId, setActiveTextLayerId] = useState<string>(INITIAL_TEXT_LAYER.id);

  // AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Derived State
  const currentDims = ASPECT_RATIOS[design.aspectRatio];
  const [blobs, setBlobs] = useState<BlobEntity[]>(() => generateBlobs(DEFAULT_COLORS, 1920, 1080));
  const particlesRef = useRef<WeatherParticle[]>([]);

  // --- History Management ---

  const pushToHistory = useCallback((newDesign: DesignState) => {
      const newHistory = history.slice(0, historyIndex + 1);
      // Limit history size to 50
      if (newHistory.length > 50) newHistory.shift();
      newHistory.push(newDesign);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const updateDesign = (updates: Partial<DesignState>, commit = false) => {
      setDesign(prev => {
          const next = { ...prev, ...updates };
          if (commit) pushToHistory(next);
          return next;
      });
  };

  const undo = () => {
      if (historyIndex > 0) {
          setHistoryIndex(historyIndex - 1);
          setDesign(history[historyIndex + 1]);
      }
  };

  const redo = () => {
      if (historyIndex < history.length - 1) {
          setHistoryIndex(historyIndex + 1);
          setDesign(history[historyIndex + 1]);
      }
  };

  // Debounced history save for things like text input or sliders if needed
  // For sliders, we usually use onMouseUp to commit
  const handleCommit = () => {
      pushToHistory(design);
  };

  // --- Audio Preview Logic ---
  useEffect(() => {
    if (audioPreviewRef.current) {
        if (design.audio) {
            const url = URL.createObjectURL(design.audio);
            audioPreviewRef.current.src = url;
            // Native loop attribute loops the whole file, but we need custom looping for cut segments
            // so we handle looping manually via onTimeUpdate
            audioPreviewRef.current.loop = false; 
            
            if (isPlaying && !isRecording) {
                audioPreviewRef.current.currentTime = design.audioStart;
                audioPreviewRef.current.play().catch(e => console.log("Auto-play prevented", e));
            }
            return () => URL.revokeObjectURL(url);
        } else {
            audioPreviewRef.current.pause();
            audioPreviewRef.current.src = "";
        }
    }
  }, [design.audio]); // Only run when audio file changes

  useEffect(() => {
      if (!audioPreviewRef.current || !design.audio) return;
      
      if (isPlaying && !isRecording) {
          // Check if we are outside the valid range before playing
          if (audioPreviewRef.current.currentTime < design.audioStart || audioPreviewRef.current.currentTime >= design.audioEnd) {
             audioPreviewRef.current.currentTime = design.audioStart;
          }
          audioPreviewRef.current.play().catch(() => {});
      } else {
          audioPreviewRef.current.pause();
      }
  }, [isPlaying, isRecording, design.audioStart, design.audioEnd]); // Also react to start/end changes

  // Enforce loop within Start/End
  const handleAudioTimeUpdate = () => {
      if (!audioPreviewRef.current) return;
      if (audioPreviewRef.current.currentTime >= design.audioEnd) {
          audioPreviewRef.current.currentTime = design.audioStart;
          if (isPlaying && !isRecording) {
            audioPreviewRef.current.play().catch(() => {});
          }
      }
  };


  // --- Logic for Weather ---

  const initWeather = useCallback(() => {
    const count = design.weatherType === 'none' ? 0 : Math.floor(design.weatherIntensity * (design.weatherType === 'rain' ? 5 : 2));
    const newParticles: WeatherParticle[] = [];
    for (let i = 0; i < count; i++) {
        newParticles.push({
            x: Math.random() * currentDims.w,
            y: Math.random() * currentDims.h,
            speed: Math.random() * (design.weatherType === 'rain' ? 20 : 2) + (design.weatherType === 'rain' ? 10 : 0.5),
            size: Math.random() * (design.weatherType === 'rain' ? 3 : 5) + 1,
            opacity: Math.random() * 0.5 + 0.3,
            wobble: Math.random() * Math.PI * 2
        });
    }
    particlesRef.current = newParticles;
  }, [design.weatherType, design.weatherIntensity, currentDims]);

  useEffect(() => {
    initWeather();
  }, [initWeather]);

  // --- Logic for AI Generation ---

  const handleAiGenerate = async () => {
    if (!aiPrompt) return;
    setIsGenerating(true);
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: `${aiPrompt}, realistic style, high resolution, atmospheric, 8k, cinematic lighting` }] },
        });

        // Find image part
        let base64Image = '';
        if (response.candidates && response.candidates[0].content.parts) {
             for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    base64Image = part.inlineData.data;
                    break;
                }
             }
        }

        if (base64Image) {
            const img = new Image();
            img.onload = () => {
                updateDesign({ bgImage: img, bgType: 'image' }, true);
                setIsGenerating(false);
            };
            img.src = `data:image/png;base64,${base64Image}`;
        } else {
            console.error("No image generated");
            setIsGenerating(false);
        }

    } catch (e) {
        console.error("AI Generation failed", e);
        setIsGenerating(false);
    }
  };

  // --- Animation Engine ---

  const drawTextLayers = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    design.textLayers.forEach(layer => {
        if (!layer.text) return;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = layer.opacity;
        
        // Scale font based on canvas width
        const scaleFactor = w / 1920; 
        const finalFontSize = layer.fontSize * scaleFactor;
        
        // Font format: [style] [weight] [size] [family]
        ctx.font = `${layer.fontStyle} ${layer.fontWeight} ${finalFontSize}px "${layer.fontFamily}"`;
        ctx.fillStyle = layer.textColor;
        ctx.textAlign = layer.textAlign;
        ctx.textBaseline = 'middle';
        
        if (layer.textShadow) {
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 20 * scaleFactor;
            ctx.shadowOffsetX = 4 * scaleFactor;
            ctx.shadowOffsetY = 4 * scaleFactor;
        }

        const lines = layer.text.split('\n');
        const lineHeight = finalFontSize * 1.2;
        const totalHeight = lines.length * lineHeight;
        
        // Calculate Position
        const centerX = layer.x * w;
        const centerY = layer.y * h;

        // Adjust starting Y to center the block of text around centerY
        let startY = centerY - (totalHeight / 2) + (lineHeight / 2);

        lines.forEach((line) => {
            ctx.fillText(line, centerX, startY);
            startY += lineHeight;
        });

        ctx.restore();
    });
  };

  const drawLogo = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      if (!design.logo || !design.logo.image) return;
      const { logo } = design;
      
      ctx.save();
      ctx.globalAlpha = logo.opacity;
      
      const imgW = logo.image.width;
      const imgH = logo.image.height;
      const aspect = imgW / imgH;
      
      // Calculate target size (based on width percentage of canvas)
      const targetW = w * logo.size;
      const targetH = targetW / aspect;
      
      const targetX = (logo.x * w) - (targetW / 2);
      const targetY = (logo.y * h) - (targetH / 2);

      ctx.drawImage(logo.image, targetX, targetY, targetW, targetH);
      ctx.restore();
  }

  const drawWeather = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    if (design.weatherType === 'none') return;
    
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    particlesRef.current.forEach(p => {
        p.y += p.speed;
        if (design.weatherType === 'snow') {
            p.x += Math.sin(p.wobble) * 0.5;
            p.wobble += 0.05;
        }

        // Reset if out of bounds
        if (p.y > h) {
            p.y = -10;
            p.x = Math.random() * w;
        }

        ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
        ctx.beginPath();
        
        if (design.weatherType === 'rain') {
            ctx.rect(p.x, p.y, 1, p.size * 5);
        } else {
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        }
        ctx.fill();
    });
    ctx.restore();
  };

  const draw = useCallback((ctx: CanvasRenderingContext2D, time: number) => {
    const { w, h } = currentDims;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);
    
    // 1. Draw Background
    if (design.bgType === 'color') {
        ctx.fillStyle = design.bgColor;
        ctx.fillRect(0, 0, w, h);
    } else if (design.bgType === 'image' && design.bgImage) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        drawImageCover(ctx, design.bgImage, 0, 0, w, h);
    } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
    }

    // 2. Apply Wave/Blobs
    ctx.save(); // Save before blur/blend
    ctx.filter = `blur(${design.blurLevel}px)`;
    ctx.globalCompositeOperation = design.blendMode;
    ctx.globalAlpha = design.blobOpacity; // Apply Visual Opacity

    // --- DECOUPLED SPEED & DURATION LOGIC ---
    // We want the wave to move at a speed defined by `design.speed` (Hz approx),
    // but perfectly loop within `design.duration`.
    // Base frequency target (in Hz): 
    const baseHz = 0.5; 
    const targetFreq = design.speed * baseHz; 
    
    // To loop perfectly, the total number of cycles in the duration must be an integer.
    // Total Cycles = Duration (s) * Frequency (Hz)
    // We calculate the nearest integer number of cycles that maintains the target speed.
    
    blobs.forEach((blob) => {
        // Base cycles for this specific blob based on its random seed
        const blobBaseCycles = blob.baseFreqX; 
        
        // Calculate ideal total cycles for this blob over the full duration
        const idealTotalCycles = blobBaseCycles * targetFreq * design.duration;
        
        // Round to nearest integer (min 1) to ensure perfect loop
        const effectiveTotalCycles = Math.max(1, Math.round(idealTotalCycles));
        
        // Calculate t (0 to 1) for the current frame in the loop
        // time is in ms, duration is in s
        const loopProgress = (time % (design.duration * 1000)) / (design.duration * 1000);
        
        // Angle = progress * 2PI * totalCycles
        const angle = loopProgress * Math.PI * 2 * effectiveTotalCycles;

        // Apply similar logic for Y (using baseFreqY)
        const idealTotalCyclesY = blob.baseFreqY * targetFreq * design.duration;
        const effectiveTotalCyclesY = Math.max(1, Math.round(idealTotalCyclesY));
        const angleY = loopProgress * Math.PI * 2 * effectiveTotalCyclesY;

        const offsetX = Math.sin(angle + blob.phaseX) * (w * 0.35);
        const offsetY = Math.cos(angleY + blob.phaseY) * (h * 0.35);

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
    ctx.restore(); // Restore after blur/blend

    // 3. Draw Weather (Crisp)
    drawWeather(ctx, w, h);

    // 4. Draw Logo
    drawLogo(ctx, w, h);

    // 5. Draw Typography (Crisp)
    drawTextLayers(ctx, w, h);

  }, [blobs, currentDims, design]);

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
     setBlobs(generateBlobs(design.colors, currentDims.w, currentDims.h));
     initWeather();
  }, [design.aspectRatio, design.colors, initWeather]); 

  // --- Handlers ---

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'bg' | 'logo') => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                if (type === 'bg') {
                    updateDesign({ bgImage: img, bgType: 'image' }, true);
                } else {
                    updateDesign({ 
                        logo: { 
                            image: img, 
                            src: img.src,
                            x: 0.5, 
                            y: 0.5, 
                            size: 0.2, 
                            opacity: 1 
                        } 
                    }, true);
                }
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    }
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const url = URL.createObjectURL(file);
          const tempAudio = new Audio(url);
          // Wait for metadata to get duration
          tempAudio.addEventListener('loadedmetadata', () => {
              updateDesign({ 
                  audio: file, 
                  audioName: file.name,
                  audioDuration: tempAudio.duration,
                  audioStart: 0,
                  audioEnd: tempAudio.duration
              }, true);
              URL.revokeObjectURL(url);
          });
      }
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const fontName = file.name.split('.')[0].replace(/[^a-zA-Z0-9]/g, ''); // Clean name
      const reader = new FileReader();
      
      reader.onload = async (event) => {
          if (event.target?.result) {
              try {
                  const fontData = event.target.result as ArrayBuffer;
                  const fontFace = new FontFace(fontName, fontData);
                  await fontFace.load();
                  document.fonts.add(fontFace);
                  
                  // Add to design state and set active layer to this font
                  const newFonts = [...design.customFonts, { name: fontName, url: '' }]; // URL not strictly needed for FontFace obj but good for reference if persistent
                  updateDesign({ customFonts: newFonts });
                  updateActiveLayer({ fontFamily: fontName });
                  handleCommit();
              } catch (err) {
                  console.error("Failed to load font", err);
                  alert("Could not load font. Please ensure it is a valid TTF, OTF, or WOFF file.");
              }
          }
      };
      reader.readAsArrayBuffer(file);
  };

  const handleColorChange = (index: number, newColor: string) => {
    const newColors = [...design.colors];
    newColors[index] = newColor;
    updateDesign({ colors: newColors });
  };

  const addColor = () => {
    if (design.colors.length < 8) {
      updateDesign({ colors: [...design.colors, '#ffffff'] }, true);
    }
  };

  const removeColor = (index: number) => {
    if (design.colors.length > 2) {
      const newColors = design.colors.filter((_, i) => i !== index);
      updateDesign({ colors: newColors }, true);
    }
  };

  const regeneratePositions = () => {
    setBlobs(generateBlobs(design.colors, currentDims.w, currentDims.h));
  };

  const toggleAspectRatio = () => {
    const keys = Object.keys(ASPECT_RATIOS) as AspectRatioKey[];
    const currentIndex = keys.indexOf(design.aspectRatio);
    const nextIndex = (currentIndex + 1) % keys.length;
    updateDesign({ aspectRatio: keys[nextIndex] }, true);
  };

  // --- Text Layer Handlers ---
  const getActiveLayer = () => design.textLayers.find(l => l.id === activeTextLayerId) || design.textLayers[0];

  const updateActiveLayer = (updates: Partial<TextLayer>) => {
      const newLayers = design.textLayers.map(l => 
          l.id === activeTextLayerId ? { ...l, ...updates } : l
      );
      updateDesign({ textLayers: newLayers });
  };

  const addTextLayer = () => {
      const newLayer = { ...INITIAL_TEXT_LAYER, id: Math.random().toString(36).substr(2, 9), text: 'New Text', y: 0.5 + (design.textLayers.length * 0.1) };
      const newLayers = [...design.textLayers, newLayer];
      updateDesign({ textLayers: newLayers }, true);
      setActiveTextLayerId(newLayer.id);
  };

  const removeTextLayer = (id: string) => {
      if (design.textLayers.length <= 1) return;
      const newLayers = design.textLayers.filter(l => l.id !== id);
      updateDesign({ textLayers: newLayers }, true);
      setActiveTextLayerId(newLayers[newLayers.length - 1].id);
  };

  // --- Logo Handlers ---
  const updateLogo = (updates: Partial<LogoLayer>) => {
      if (!design.logo) return;
      updateDesign({ logo: { ...design.logo, ...updates } });
  };

  const removeLogo = () => {
      updateDesign({ logo: null }, true);
  }

  // --- Recording Logic (Real-Time for Audio Sync) ---

  const handleExport = async () => {
    if (!canvasRef.current) return;
    setIsRecording(true);
    setIsPlaying(false); // Pause preview loop

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use H.264 (avc1) for better compatibility and efficiency if available, or VP9
    const mimeType = MediaRecorder.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') 
        ? 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"' 
        : 'video/webm; codecs=vp9';

    // -- Audio Setup --
    let audioTracks: MediaStreamTrack[] = [];
    let audioSource: AudioBufferSourceNode | null = null;
    let audioCtx: AudioContext | null = null;

    if (design.audio) {
        try {
            audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const arrayBuffer = await design.audio.arrayBuffer();
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            
            const dest = audioCtx.createMediaStreamDestination();
            audioSource = audioCtx.createBufferSource();
            audioSource.buffer = audioBuffer;
            
            // Loop the Cut Segment
            audioSource.loop = true; 
            audioSource.loopStart = design.audioStart;
            audioSource.loopEnd = design.audioEnd;
            
            audioSource.connect(dest);
            // We disconnect destination to avoid double playing during render if not needed
            // audioSource.connect(audioCtx.destination); 
            
            audioTracks = dest.stream.getAudioTracks();
        } catch (e) {
            console.error("Audio mixing failed", e);
        }
    }

    // -- Stream Setup --
    const canvasStream = canvas.captureStream(EXPORT_FPS);
    const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...audioTracks
    ]);

    const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        // Optimize Size: 5 Mbps (5000000 bits) is enough for HD gradient animation (High Quality, Low Size)
        videoBitsPerSecond: 5000000 
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
        a.download = `gradient-wave-${design.aspectRatio.replace(':','-')}-${design.duration}s.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
        a.click();
        URL.revokeObjectURL(url);
        
        // Cleanup
        if (audioSource) audioSource.stop();
        if (audioCtx) audioCtx.close();
        
        setIsRecording(false);
        setIsPlaying(true);
        setRecordingProgress(0);
    };

    // -- Real-Time Recording Loop --
    recorder.start();
    
    // Start playing audio at the selected start time
    if (audioSource) audioSource.start(0, design.audioStart);

    const startTime = performance.now();
    const durationMs = design.duration * 1000;
    
    const recordTick = (now: number) => {
        const elapsed = now - startTime;
        
        if (elapsed >= durationMs) {
            recorder.stop();
            return;
        }

        // Draw frame based on actual elapsed time (Real-time render)
        draw(ctx, elapsed);
        
        // Update progress
        setRecordingProgress(Math.min(100, Math.round((elapsed / durationMs) * 100)));
        
        requestAnimationFrame(recordTick);
    };

    requestAnimationFrame(recordTick);
  };

  const activeLayer = getActiveLayer();

  return (
    <div className="flex flex-col h-screen w-full bg-gray-950 text-white font-sans overflow-hidden">
      
      <audio ref={audioPreviewRef} className="hidden" onTimeUpdate={handleAudioTimeUpdate} />

      {/* --- TOP HEADER --- */}
      <div className="h-16 shrink-0 bg-gray-850/90 backdrop-blur border-b border-gray-750 flex items-center justify-between px-4 lg:px-8 z-20 shadow-xl relative">
          
          {/* Left: Logo & Undo/Redo */}
          <div className="flex items-center gap-6">
            <div className="font-bold text-xl tracking-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent min-w-[100px]">
                Wave Gen
            </div>
            <div className="flex items-center gap-2 border-l border-gray-700 pl-6">
                <button onClick={undo} disabled={historyIndex === 0} className="p-2 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-30">
                    <Undo size={18} />
                </button>
                <button onClick={redo} disabled={historyIndex === history.length - 1} className="p-2 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-30">
                    <Redo size={18} />
                </button>
            </div>
          </div>

          {/* Center: Aspect Ratio Toggle */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
             <button
                 onClick={toggleAspectRatio}
                 className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-all border border-gray-700 group flex items-center gap-2"
                 disabled={isRecording}
                 title={`Current: ${ASPECT_RATIOS[design.aspectRatio].label}`}
             >
                 {ASPECT_RATIOS[design.aspectRatio].icon}
                 <span className="hidden md:block text-xs font-medium text-gray-400 group-hover:text-gray-200">
                     {design.aspectRatio}
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
                    <div className="text-5xl font-black text-white mb-6">
                        {recordingProgress}%
                    </div>
                    <div className="w-64 h-2 bg-gray-800 rounded-full overflow-hidden border border-gray-700">
                        <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-75 ease-linear"
                            style={{ width: `${recordingProgress}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* --- BOTTOM SETTINGS PANEL --- */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-800 z-10 overflow-y-auto max-h-[40vh]">
        {/* Tab Navigation */}
        <div className="flex border-b border-gray-800 px-4">
            <button onClick={() => setActiveTab('visuals')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'visuals' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <Palette size={14} /> Visuals
            </button>
            <button onClick={() => setActiveTab('typography')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'typography' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <Type size={14} /> Typography
            </button>
            <button onClick={() => setActiveTab('logo')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'logo' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <ImagePlus size={14} /> Logo
            </button>
            <button onClick={() => setActiveTab('music')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'music' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <Music size={14} /> Music
            </button>
            <button onClick={() => setActiveTab('weather')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'weather' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <CloudRain size={14} /> Weather
            </button>
            <button onClick={() => setActiveTab('ai')} className={`flex items-center gap-2 px-4 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${activeTab === 'ai' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                <Wand2 size={14} /> AI Gen
            </button>
        </div>

        <div className="p-6 max-w-7xl mx-auto min-h-[220px]">
            
            {/* TAB: VISUALS */}
            {activeTab === 'visuals' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="space-y-4">
                        <div className="flex justify-between"><label className="text-xs text-gray-400 font-bold uppercase">Speed</label><span className="text-xs text-gray-500">{design.speed.toFixed(1)}x</span></div>
                        <input type="range" min="0.1" max="4.0" step="0.1" value={design.speed} onChange={(e) => updateDesign({ speed: parseFloat(e.target.value) })} onMouseUp={handleCommit} disabled={isRecording} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        
                        <div className="flex justify-between pt-2"><label className="text-xs text-gray-400 font-bold uppercase">Duration</label><span className="text-xs text-gray-500">{design.duration}s</span></div>
                        <input type="range" min="5" max="90" step="1" value={design.duration} onChange={(e) => updateDesign({ duration: parseInt(e.target.value) })} onMouseUp={handleCommit} disabled={isRecording} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        <p className="text-[10px] text-gray-500 italic">Speed is now independent of duration.</p>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <div className="flex justify-between mb-2"><label className="text-xs text-gray-400 font-bold uppercase">Blur</label><span className="text-xs text-gray-500">{design.blurLevel}px</span></div>
                                <input type="range" min="0" max="300" step="10" value={design.blurLevel} onChange={(e) => updateDesign({ blurLevel: parseInt(e.target.value) })} onMouseUp={handleCommit} disabled={isRecording} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                             </div>
                             <div>
                                <div className="flex justify-between mb-2"><label className="text-xs text-gray-400 font-bold uppercase">Opacity</label><span className="text-xs text-gray-500">{(design.blobOpacity * 100).toFixed(0)}%</span></div>
                                <input type="range" min="0" max="1" step="0.05" value={design.blobOpacity} onChange={(e) => updateDesign({ blobOpacity: parseFloat(e.target.value) })} onMouseUp={handleCommit} disabled={isRecording} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500" />
                             </div>
                        </div>
                        
                        <div className="flex gap-4 pt-2">
                             <div className="flex-1">
                                <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Blend</label>
                                <select value={design.blendMode} onChange={(e) => updateDesign({ blendMode: e.target.value as BlendMode }, true)} disabled={isRecording} className="w-full bg-gray-800 text-xs border border-gray-700 rounded px-2 py-1.5 text-gray-300"><option value="source-over">Normal</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft</option><option value="multiply">Multiply</option></select>
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Bg</label>
                                <div className="flex gap-2">
                                    {design.bgType === 'color' ? (
                                        <div className="flex-1 flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700">
                                            <input type="color" value={design.bgColor} onChange={(e) => updateDesign({ bgColor: e.target.value })} onBlur={handleCommit} className="w-5 h-5 rounded-full cursor-pointer bg-transparent" />
                                            <button onClick={() => updateDesign({ bgType: 'image' }, true)} className="text-[10px] text-gray-400 ml-auto">Img</button>
                                        </div>
                                    ) : (
                                        <div className="flex-1 flex items-center gap-2 bg-gray-800 rounded px-2 py-1 border border-gray-700 overflow-hidden relative">
                                            <label className="cursor-pointer flex items-center gap-2 w-full">
                                                <div className="w-5 h-5 bg-gray-700 rounded-full flex items-center justify-center"><ImageIcon size={12} /></div>
                                                <span className="text-[10px] text-gray-300 truncate">{design.bgImage ? 'Set' : 'Up'}</span>
                                                <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'bg')} className="hidden" />
                                            </label>
                                            <button onClick={() => updateDesign({ bgType: 'color' }, true)} className="text-[10px] text-gray-400 absolute right-2 bg-gray-800 pl-2">Col</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                         <div className="flex justify-between items-center mb-1"><span className="text-xs text-gray-400 font-bold uppercase">Palette</span><span className="text-[10px] text-gray-500">{design.colors.length}</span></div>
                        <div className="flex flex-wrap gap-3">
                            {design.colors.map((color, index) => (
                                <div key={index} className="relative group">
                                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-700 hover:border-gray-500 transition-colors shadow-sm">
                                        <input type="color" value={color} onChange={(e) => handleColorChange(index, e.target.value)} onBlur={handleCommit} className="w-[150%] h-[150%] -m-[25%] cursor-pointer p-0 border-none" disabled={isRecording} />
                                    </div>
                                    {design.colors.length > 2 && <button onClick={() => removeColor(index)} className="absolute -top-1 -right-1 bg-gray-900 text-gray-400 hover:text-red-400 rounded-full p-0.5 opacity-0 group-hover:opacity-100 border border-gray-700"><X size={10} /></button>}
                                </div>
                            ))}
                            {design.colors.length < 8 && <button onClick={addColor} disabled={isRecording} className="w-10 h-10 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center text-gray-500 hover:text-white"><Plus size={16} /></button>}
                        </div>
                    </div>
                </div>
            )}

            {/* TAB: TYPOGRAPHY */}
            {activeTab === 'typography' && (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    
                    {/* Layer List */}
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-800 flex flex-col gap-2 h-full max-h-[200px] overflow-y-auto">
                        <div className="flex justify-between items-center mb-2 px-1">
                            <span className="text-xs font-bold text-gray-400 uppercase">Layers</span>
                            <button onClick={addTextLayer} className="p-1 hover:bg-gray-700 rounded text-blue-400"><Plus size={14} /></button>
                        </div>
                        {design.textLayers.map((layer, i) => (
                            <div key={layer.id} 
                                onClick={() => setActiveTextLayerId(layer.id)}
                                className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer border ${layer.id === activeTextLayerId ? 'bg-gray-700 border-blue-500/50' : 'hover:bg-gray-800 border-transparent'}`}
                            >
                                <div className="flex items-center gap-2 truncate">
                                    <span className="text-gray-500 font-mono">{i+1}</span>
                                    <span className="truncate max-w-[100px]">{layer.text || 'Empty'}</span>
                                </div>
                                <button onClick={(e) => { e.stopPropagation(); removeTextLayer(layer.id); }} className="text-gray-500 hover:text-red-400 p-1"><Trash2 size={12} /></button>
                            </div>
                        ))}
                    </div>

                    {/* Layer Editor */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <textarea 
                                value={activeLayer.text} 
                                onChange={(e) => updateActiveLayer({ text: e.target.value })} 
                                onBlur={handleCommit}
                                placeholder="Enter text..." 
                                className="w-full h-32 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm focus:border-blue-500 focus:outline-none resize-none placeholder-gray-500"
                            />
                            
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => { updateActiveLayer({ fontWeight: activeLayer.fontWeight === '300' ? '400' : '300' }); handleCommit(); }}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-medium border ${activeLayer.fontWeight === '300' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-gray-700 hover:bg-gray-700 text-gray-400'}`}
                                >
                                    Light
                                </button>
                                <button 
                                    onClick={() => { updateActiveLayer({ fontWeight: activeLayer.fontWeight === '800' ? '400' : '800' }); handleCommit(); }}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-medium border ${activeLayer.fontWeight === '800' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-gray-700 hover:bg-gray-700 text-gray-400'}`}
                                >
                                    <Bold size={14} /> Bold
                                </button>
                                <button 
                                    onClick={() => { updateActiveLayer({ fontStyle: activeLayer.fontStyle === 'italic' ? 'normal' : 'italic' }); handleCommit(); }}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-medium border ${activeLayer.fontStyle === 'italic' ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-gray-700 hover:bg-gray-700 text-gray-400'}`}
                                >
                                    <Italic size={14} /> Italic
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Font</label>
                                    <div className="flex gap-2">
                                        <select value={activeLayer.fontFamily} onChange={(e) => { updateActiveLayer({ fontFamily: e.target.value }); handleCommit(); }} className="w-full bg-gray-800 text-xs border border-gray-700 rounded px-2 py-2 text-gray-300">
                                            <optgroup label="Standard">
                                                <option value="Poppins">Poppins</option>
                                                <option value="Lobster">Lobster</option>
                                                <option value="Playwrite NO">Playwrite NO</option>
                                            </optgroup>
                                            {design.customFonts.length > 0 && (
                                                <optgroup label="Custom">
                                                    {design.customFonts.map(f => (
                                                        <option key={f.name} value={f.name}>{f.name}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                        </select>
                                        <label className="flex items-center justify-center p-2 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer border border-gray-600" title="Upload Font (TTF, OTF, WOFF)">
                                            <Upload size={14} className="text-gray-300" />
                                            <input type="file" accept=".ttf,.otf,.woff" onChange={handleFontUpload} className="hidden" />
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Align</label>
                                    <div className="flex bg-gray-800 rounded border border-gray-700 p-1">
                                        {(['left', 'center', 'right'] as const).map(align => (
                                            <button key={align} onClick={() => { updateActiveLayer({ textAlign: align }); handleCommit(); }} className={`flex-1 py-1 rounded text-xs capitalize ${activeLayer.textAlign === align ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                                                {align}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Position X</label>
                                    <input type="range" min="0" max="1" step="0.01" value={activeLayer.x} onChange={(e) => updateActiveLayer({ x: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Position Y</label>
                                    <input type="range" min="0" max="1" step="0.01" value={activeLayer.y} onChange={(e) => updateActiveLayer({ y: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                            </div>

                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Size</label>
                                    <input type="range" min="20" max="400" value={activeLayer.fontSize} onChange={(e) => updateActiveLayer({ fontSize: parseInt(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                                <div className="flex items-center gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Color</label>
                                        <input type="color" value={activeLayer.textColor} onChange={(e) => updateActiveLayer({ textColor: e.target.value })} onBlur={handleCommit} className="w-8 h-8 rounded cursor-pointer bg-transparent border-2 border-gray-700" />
                                    </div>
                                     <div>
                                        <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Opacity</label>
                                        <input type="range" min="0" max="1" step="0.1" value={activeLayer.opacity} onChange={(e) => updateActiveLayer({ opacity: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-20 h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB: LOGO */}
            {activeTab === 'logo' && (
                <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex flex-col items-center justify-center bg-gray-800/30 border-2 border-dashed border-gray-700 rounded-lg p-8 relative hover:border-blue-500 transition-colors">
                        {design.logo ? (
                            <div className="relative w-full h-full flex items-center justify-center">
                                <img src={design.logo.src} className="max-w-full max-h-[140px] object-contain" alt="Logo Preview" />
                                <button onClick={removeLogo} className="absolute top-0 right-0 bg-red-500/20 text-red-400 p-1.5 rounded-full hover:bg-red-500 hover:text-white transition-colors">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ) : (
                             <div className="text-center">
                                <ImagePlus className="mx-auto text-gray-500 mb-2" size={32} />
                                <span className="text-sm text-gray-400 font-medium">Upload Logo</span>
                            </div>
                        )}
                        <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, 'logo')} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>

                    <div className={`space-y-6 ${!design.logo ? 'opacity-50 pointer-events-none' : ''}`}>
                         <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Position X</label>
                                    <input type="range" min="0" max="1" step="0.01" value={design.logo?.x || 0.5} onChange={(e) => updateLogo({ x: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Position Y</label>
                                    <input type="range" min="0" max="1" step="0.01" value={design.logo?.y || 0.5} onChange={(e) => updateLogo({ y: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Size</label>
                                    <input type="range" min="0.05" max="1" step="0.01" value={design.logo?.size || 0.2} onChange={(e) => updateLogo({ size: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Opacity</label>
                                    <input type="range" min="0" max="1" step="0.05" value={design.logo?.opacity || 1} onChange={(e) => updateLogo({ opacity: parseFloat(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg accent-blue-500" />
                                </div>
                         </div>
                    </div>
                </div>
            )}

            {/* TAB: MUSIC */}
            {activeTab === 'music' && (
                <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="flex flex-col items-center justify-center bg-gray-800/30 border-2 border-dashed border-gray-700 rounded-lg p-6 relative hover:border-blue-500 transition-colors group h-full">
                            {design.audioName ? (
                                <div className="flex flex-col items-center gap-3">
                                    <div className="p-4 rounded-full bg-blue-500/20 text-blue-400">
                                        <Music size={32} />
                                    </div>
                                    <div className="text-center">
                                        <p className="font-bold text-lg text-white mb-1 truncate max-w-[200px]" title={design.audioName}>{design.audioName}</p>
                                        <p className="text-xs text-gray-400">
                                            {formatTime(design.audioDuration)} Total Length
                                        </p>
                                    </div>
                                    <button 
                                        onClick={(e) => {
                                            e.preventDefault();
                                            updateDesign({ audio: null, audioName: null, audioDuration: 0, audioStart: 0, audioEnd: 0 }, true);
                                        }}
                                        className="mt-2 px-4 py-2 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white text-sm font-medium transition-colors z-20"
                                    >
                                        Remove Audio
                                    </button>
                                </div>
                            ) : (
                                <div className="text-center">
                                    <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4 text-gray-500 group-hover:text-blue-400 transition-colors">
                                        <Music size={32} />
                                    </div>
                                    <h3 className="text-lg font-bold text-white mb-2">Upload Music</h3>
                                    <p className="text-sm text-gray-400 max-w-xs mx-auto">
                                        MP3, WAV, AAC supported.
                                    </p>
                                </div>
                            )}
                             <input 
                                type="file" 
                                accept="audio/*" 
                                onChange={handleAudioUpload} 
                                className="absolute inset-0 opacity-0 cursor-pointer" 
                                title={design.audioName ? "Click to change file" : "Click to upload"}
                            />
                        </div>

                        {design.audioName && (
                            <div className="flex flex-col justify-center gap-6 p-4 bg-gray-800/20 rounded-lg border border-gray-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Scissors className="text-blue-400" size={18} />
                                        <h4 className="font-bold text-sm text-gray-300">Audio Trim Settings</h4>
                                    </div>
                                    <button
                                        onClick={() => {
                                           if (isPlaying) {
                                               setIsPlaying(false);
                                           } else {
                                               // Jump to start of cut when previewing from trim controls
                                               if (audioPreviewRef.current) {
                                                   audioPreviewRef.current.currentTime = design.audioStart;
                                               }
                                               setIsPlaying(true);
                                           }
                                        }}
                                        className="p-2 rounded-full bg-gray-700 hover:bg-blue-600 text-white transition-colors"
                                        title={isPlaying ? "Pause" : "Preview Cut"}
                                    >
                                        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                                    </button>
                                </div>

                                {/* Start Time Slider */}
                                <div>
                                    <div className="flex justify-between text-xs mb-2">
                                        <span className="text-gray-400 font-bold uppercase">Start</span>
                                        <span className="text-blue-400 font-mono">{formatTime(design.audioStart)}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max={design.audioDuration} 
                                        step="0.1" 
                                        value={design.audioStart} 
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            // Clamp start to always be less than end
                                            if (val < design.audioEnd) {
                                                updateDesign({ audioStart: val });
                                            }
                                        }} 
                                        onMouseUp={handleCommit}
                                        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" 
                                    />
                                </div>

                                {/* End Time Slider */}
                                <div>
                                    <div className="flex justify-between text-xs mb-2">
                                        <span className="text-gray-400 font-bold uppercase">End</span>
                                        <span className="text-purple-400 font-mono">{formatTime(design.audioEnd)}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max={design.audioDuration} 
                                        step="0.1" 
                                        value={design.audioEnd} 
                                        onChange={(e) => {
                                            const val = parseFloat(e.target.value);
                                            // Clamp end to always be more than start
                                            if (val > design.audioStart) {
                                                updateDesign({ audioEnd: val });
                                            }
                                        }} 
                                        onMouseUp={handleCommit}
                                        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500" 
                                    />
                                </div>

                                <div className="text-xs text-center text-gray-500 pt-2 border-t border-gray-800">
                                    Duration: <span className="text-white">{(design.audioEnd - design.audioStart).toFixed(1)}s</span>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex gap-3 items-start">
                        <div className="p-1 text-blue-400 mt-0.5"><Eye size={16} /></div>
                        <div className="text-xs text-blue-200/80 leading-relaxed">
                            <strong>Note:</strong> The trimmed segment will automatically loop if your video duration ({design.duration}s) is longer than the selected audio segment.
                        </div>
                    </div>
                </div>
            )}

            {/* TAB: WEATHER */}
            {activeTab === 'weather' && (
                <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300 py-4">
                    <div className="flex justify-center gap-4">
                         <button 
                            onClick={() => updateDesign({ weatherType: 'none' }, true)} 
                            className={`px-6 py-3 rounded-lg border flex flex-col items-center gap-2 w-32 transition-all ${design.weatherType === 'none' ? 'bg-gray-800 border-blue-500 text-white' : 'border-gray-800 text-gray-500 hover:bg-gray-900'}`}
                        >
                            <span className="text-sm font-bold">None</span>
                        </button>
                        <button 
                            onClick={() => updateDesign({ weatherType: 'snow' }, true)} 
                            className={`px-6 py-3 rounded-lg border flex flex-col items-center gap-2 w-32 transition-all ${design.weatherType === 'snow' ? 'bg-gray-800 border-blue-500 text-white' : 'border-gray-800 text-gray-500 hover:bg-gray-900'}`}
                        >
                            <Sparkles size={20} />
                            <span className="text-sm font-bold">Snow</span>
                        </button>
                         <button 
                            onClick={() => updateDesign({ weatherType: 'rain' }, true)} 
                            className={`px-6 py-3 rounded-lg border flex flex-col items-center gap-2 w-32 transition-all ${design.weatherType === 'rain' ? 'bg-gray-800 border-blue-500 text-white' : 'border-gray-800 text-gray-500 hover:bg-gray-900'}`}
                        >
                            <CloudRain size={20} />
                            <span className="text-sm font-bold">Rain</span>
                        </button>
                    </div>

                    {design.weatherType !== 'none' && (
                        <div className="space-y-2">
                             <div className="flex justify-between"><label className="text-xs text-gray-400 font-bold uppercase">Intensity / Speed</label><span className="text-xs text-gray-500">{design.weatherIntensity}%</span></div>
                             <input type="range" min="10" max="100" value={design.weatherIntensity} onChange={(e) => updateDesign({ weatherIntensity: parseInt(e.target.value) })} onMouseUp={handleCommit} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                        </div>
                    )}
                </div>
            )}

            {/* TAB: AI GENERATION */}
            {activeTab === 'ai' && (
                <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="space-y-4">
                        <label className="block text-xs text-gray-400 font-bold uppercase">Describe background</label>
                        <textarea 
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="e.g. A futuristic neon city, sunset over ocean, cyberpunk street, mystical forest..." 
                            className="w-full h-32 bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm focus:border-blue-500 focus:outline-none resize-none placeholder-gray-600"
                        />
                        <button 
                            onClick={handleAiGenerate}
                            disabled={isGenerating || !aiPrompt}
                            className={`w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${isGenerating || !aiPrompt ? 'bg-gray-800 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 text-white shadow-lg'}`}
                        >
                            {isGenerating ? <RefreshCw className="animate-spin" size={16}/> : <Wand2 size={16}/>}
                            {isGenerating ? 'Generating...' : 'Generate Realistic Background'}
                        </button>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="text-xs text-gray-500 leading-relaxed">
                            <strong className="text-gray-300">Tip:</strong> The generated image will automatically be applied as the background. You can switch back to "Solid Color" in the Visuals tab if needed.
                        </div>
                        {design.bgType === 'image' && design.bgImage && (
                            <div className="mt-auto">
                                <label className="block text-xs text-gray-400 font-bold uppercase mb-2">Current Image</label>
                                <div className="w-full aspect-video rounded-lg overflow-hidden border border-gray-700 relative">
                                    <img src={design.bgImage.src} className="w-full h-full object-cover" alt="Background" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default App;