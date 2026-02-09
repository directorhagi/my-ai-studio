
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import { Category, ClothingItem, AppState, AspectRatio, HistoryItem, StylePreset, ImageSize, FitType, PoseType, BackgroundType, ClothingLength, GenderType, BatchItem } from './types';
import { generateFittingImage, generateEditedImage, generateInpainting } from './services/geminiService';
import { hasApiKey, saveApiKey, getMaskedApiKey, deleteApiKey } from './services/apiKeyStorage';
import { onAuthStateChange, signInWithGoogle, signOut } from './services/authService';
import { uploadImageToDrive, listImagesFromDrive, downloadImageFromDrive, downloadMetadataFromDrive, deleteImageFromDrive } from './services/driveService';
import DropZone from './components/DropZone';
import ApiKeyModal from './components/ApiKeyModal';

// --- Types for Navigation ---
type PageType = 'LANDING' | 'STUDIO' | 'EDIT_IMAGE' | 'INPAINTING' | 'LIBRARY';
type LangType = 'KO' | 'EN';

// --- Constants ---
const fitOptions: FitType[] = ["Standard", "Slim", "Oversized", "Loose", "Skinny", "Tailored", "Boxy"];
const poseOptions: PoseType[] = ["Model Standing", "Walking", "Hands in Pocket", "Arms Crossed", "Leaning", "Sitting", "Dynamic", "Rear View"];
const bgOptions: BackgroundType[] = ["Studio Grey", "Solid White", "Urban Street", "Luxury Interior", "Nature/Park", "Beach", "Cyberpunk Neon", "Runway", "Cafe"];
const lengthOptions: ClothingLength[] = ["Micro/Mini", "Short", "Knee-Length", "Midi", "Ankle", "Full/Maxi", "Cropped"];
const genderOptions: GenderType[] = ["Female", "Male", "Unisex"];
const sizes: ImageSize[] = ["1K", "2K", "4K"];
const ratios: AspectRatio[] = ["1:1", "4:3", "16:9", "21:9", "5:4", "3:2", "2:3", "9:16", "3:4", "4:5"];
const standardCategories: Category[] = [
  Category.OUTER, Category.TOP, Category.SET, Category.PANTS, 
  Category.SKIRT, Category.SOCKS, Category.SHOES, Category.BAG, 
  Category.ACC1, Category.ACC2, Category.ACC3, Category.ACC4
];
const optionCategories: Category[] = [Category.GENDER, Category.FIT, Category.BACKGROUND, Category.POSE];

// Models with Status
const models = [
    { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro', status: 'connected' },
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana', status: 'connected' },
    { id: 'z-image', name: 'Z-Image', status: 'error' },
    { id: 'midjourney', name: 'Midjourney', status: 'error' }
];

const changelogData = [
  { version: "v0.6.2-beta", date: "2025-05-24", changes: ["CRITICAL FIX: Restored full App.tsx functionality", "FIXED: Module export errors", "OPTIMIZATION: Consolidated codebase"] },
  { version: "v0.6.1-beta", date: "2025-05-24", changes: ["VERSION MARKING: Saved as BETA V0.6.1", "STABLE: Core features locked"] },
  { version: "v0.5.3-stable", date: "2025-05-24", changes: ["FIXED: Compilation error in App.tsx", "FIXED: Queue item aspect ratio", "POLISH: UI Consistency"] },
  { version: "v0.5.2-hotfix", date: "2025-05-24", changes: ["FIXED: Syntax error in length options", "FIXED: Queue aspect ratio logic"] },
  { version: "v0.5.1-queue", date: "2025-05-24", changes: ["FORCED DARK MODE: Removed light mode toggle", "NEW: Generation Queue (Max 2)", "NEW: Cancel Generation feature"] },
];

// --- Translations ---
const translations = {
    EN: {
        studio: "Studio",
        edit: "Edit",
        inpaint: "Inpaint",
        library: "Library",
        features: "Features",
        showcase: "Showcase",
        pricing: "Pricing",
        login: "Log In",
        signup: "Sign Up",
        launchStudio: "LAUNCH STUDIO",
        openLibrary: "Open Library",
        betaMsg: "Beta 0.6.2 Available",
        heroTitle: "",
        heroDesc: "",
        fittingStudio: "Fitting Studio",
        fittingDesc: "Virtual try-on with advanced fabric physics and lighting adaptation. Upload a model and clothes.",
        enterStudio: "Enter Studio",
        editDesc: "Fine-tune angle, lighting, and shadows. Professional relighting controls.",
        openEditor: "Open Editor",
        inpaintDesc: "Smart erase and generative fill tools. Fix details or modify backgrounds locally.",
        openInpaint: "Open Studio",
        libraryDesc: "Centralized access to all your generated assets, edits, and fitting results.",
        viewLibrary: "View Library",
        config: "Config",
        reset: "Reset",
        front: "Front",
        back: "Back",
        len: "Len",
        generate: "GENERATE", // Unified text
        stop: "STOP",
        refImages: "Ref Images",
        promptPlaceholder: "Describe your styling vision...",
        editPromptPlaceholder: "Describe edit...",
        inpaintPromptPlaceholder: "Describe what to generate...",
        parameters: "Parameters",
        tilt: "Tilt",
        pan: "Pan",
        zoom: "Zoom",
        lighting: "Lighting",
        shadows: "Shadows",
        maskTools: "Mask Tools",
        brush: "Brush",
        eraser: "Eraser",
        brushSize: "Size",
        clearMask: "Clear Mask",
        processing: "Processing",
        generating: "Generating...",
        download: "Download Asset",
        useImage: "Use This Image",
        noItems: "No Items Found",
        noFittings: "No fittings generated yet. Start creating!",
        model: "Model",
        uploadTitle: "Upload Image",
        uploadDesc: "Drag & Drop or Click",
        viewZoom: "View Zoom",
        apiKeyNeeded: "API Key Required",
        privacy: "Privacy Policy",
        terms: "Terms of Service",
        seed: "Seed",
        randomize: "Randomize",
        cancel: "Cancel",
        queueFull: "Queue Full (2/2)",
        categories: {
            [Category.MODEL]: "Model (Face/Full Body)",
            [Category.MODEL_AURORA]: "Aurora",
            [Category.MODEL_ORION]: "Orion",
            [Category.GENDER]: "Gender",
            [Category.OUTER]: "Outerwear",
            [Category.TOP]: "Top",
            [Category.SET]: "Set (Onepiece)",
            [Category.PANTS]: "Pants",
            [Category.SKIRT]: "Skirt",
            [Category.SOCKS]: "Socks",
            [Category.SHOES]: "Shoes",
            [Category.BAG]: "Bag",
            [Category.ACC1]: "Accessory 1",
            [Category.ACC2]: "Accessory 2",
            [Category.ACC3]: "Accessory 3",
            [Category.ACC4]: "Accessory 4",
            [Category.FIT]: "Fit",
            [Category.BACKGROUND]: "Background",
            [Category.POSE]: "Pose"
        },
        options: {
            "Standard": "Standard", "Slim": "Slim", "Oversized": "Oversized", "Loose": "Loose", "Skinny": "Skinny", "Tailored": "Tailored", "Boxy": "Boxy",
            "Model Standing": "Model Standing", "Walking": "Walking", "Hands in Pocket": "Hands in Pocket", "Arms Crossed": "Arms Crossed", "Leaning": "Leaning", "Sitting": "Sitting", "Dynamic": "Dynamic", "Rear View": "Rear View",
            "Studio Grey": "Studio Grey", "Solid White": "Solid White", "Urban Street": "Urban Street", "Luxury Interior": "Luxury Interior", "Nature/Park": "Nature/Park", "Beach": "Beach", "Cyberpunk Neon": "Cyberpunk Neon", "Runway": "Runway", "Cafe": "Cafe",
            "Female": "Female", "Male": "Male", "Unisex": "Unisex"
        }
    },
    KO: {
        studio: "스튜디오",
        edit: "편집",
        inpaint: "인페인팅",
        library: "라이브러리",
        features: "기능",
        showcase: "쇼케이스",
        pricing: "요금제",
        login: "로그인",
        signup: "회원가입",
        launchStudio: "스튜디오 실행",
        openLibrary: "라이브러리 열기",
        betaMsg: "베타 0.6.2 이용 가능",
        heroTitle: "",
        heroDesc: "",
        fittingStudio: "피팅 스튜디오",
        fittingDesc: "고급 원단 물리학과 조명 적응 기술이 적용된 가상 피팅. 모델과 의상을 업로드하세요.",
        enterStudio: "스튜디오 입장",
        editDesc: "각도, 조명, 그림자를 미세 조정합니다. 전문적인 리라이팅 컨트롤.",
        openEditor: "에디터 열기",
        inpaintDesc: "스마트 지우개 및 생성형 채우기 도구. 디테일 수정 또는 배경 변경.",
        openInpaint: "스튜디오 열기",
        libraryDesc: "생성된 모든 자산, 편집 및 피팅 결과에 대한 중앙 집중식 액세스.",
        viewLibrary: "라이브러리 보기",
        config: "설정",
        reset: "초기화",
        front: "앞면",
        back: "뒷면",
        len: "기장",
        generate: "생성하기",
        stop: "중지",
        refImages: "참조 이미지",
        promptPlaceholder: "스타일링 비전을 설명하세요...",
        editPromptPlaceholder: "편집 내용 설명...",
        inpaintPromptPlaceholder: "생성할 내용 설명...",
        parameters: "파라미터",
        tilt: "기울기",
        pan: "이동",
        zoom: "확대",
        lighting: "조명",
        shadows: "그림자",
        maskTools: "마스크 도구",
        brush: "브러시",
        eraser: "지우개",
        brushSize: "크기",
        clearMask: "마스크 지우기",
        processing: "처리 중",
        generating: "생성 중...",
        download: "자산 다운로드",
        useImage: "이 이미지 사용",
        noItems: "항목 없음",
        noFittings: "생성된 피팅이 없습니다. 생성을 시작해보세요!",
        model: "모델",
        uploadTitle: "이미지 업로드",
        uploadDesc: "드래그 & 드롭 또는 클릭",
        viewZoom: "확대 보기",
        apiKeyNeeded: "API 키 필요",
        privacy: "개인정보 처리방침",
        terms: "이용 약관",
        seed: "시드",
        randomize: "무작위",
        cancel: "취소",
        queueFull: "대기열 가득 참 (2/2)",
        categories: {
            [Category.MODEL]: "모델 (얼굴/전신)",
            [Category.MODEL_AURORA]: "오로라",
            [Category.MODEL_ORION]: "오리온",
            [Category.GENDER]: "성별",
            [Category.OUTER]: "아우터",
            [Category.TOP]: "상의",
            [Category.SET]: "세트 (원피스)",
            [Category.PANTS]: "바지",
            [Category.SKIRT]: "치마",
            [Category.SOCKS]: "양말",
            [Category.SHOES]: "신발",
            [Category.BAG]: "가방",
            [Category.ACC1]: "액세서리 1",
            [Category.ACC2]: "액세서리 2",
            [Category.ACC3]: "액세서리 3",
            [Category.ACC4]: "액세서리 4",
            [Category.FIT]: "핏",
            [Category.BACKGROUND]: "배경",
            [Category.POSE]: "포즈"
        },
        options: {
            "Standard": "스탠다드", "Slim": "슬림", "Oversized": "오버사이즈", "Loose": "루즈", "Skinny": "스키니", "Tailored": "테일러드", "Boxy": "박시",
            "Model Standing": "모델 서있음", "Walking": "걷기", "Hands in Pocket": "주머니 손", "Arms Crossed": "팔짱", "Leaning": "기대기", "Sitting": "앉기", "Dynamic": "다이내믹", "Rear View": "뒷모습",
            "Studio Grey": "스튜디오 그레이", "Solid White": "솔리드 화이트", "Urban Street": "도심 거리", "Luxury Interior": "럭셔리 인테리어", "Nature/Park": "자연/공원", "Beach": "해변", "Cyberpunk Neon": "사이버펑크 네온", "Runway": "런웨이", "Cafe": "카페",
            "Female": "여성", "Male": "남성", "Unisex": "유니섹스"
        }
    }
};

// --- Utilities ---
const getNextDownloadFilename = (prefix: string) => {
  const key = 'tnh_save_count';
  let count = parseInt(localStorage.getItem(key) || '0', 10);
  count++;
  localStorage.setItem(key, count.toString());
  const numStr = count.toString().padStart(4, '0');
  return `${prefix}_${numStr}.png`;
};

// Helper for API Key selection
const checkApiKey = async (): Promise<boolean> => {
  try {
    if ((window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        const success = await (window as any).aistudio.openSelectKey();
        return success;
      }
      return true;
    }
    return true;
  } catch (e) {
    console.error("API Key check failed:", e);
    if (e instanceof Error && e.message.includes("Requested entity was not found")) {
        try {
            return await (window as any).aistudio.openSelectKey();
        } catch (retryError) {
            return false;
        }
    }
    return false;
  }
};

// --- Custom Components ---

// Upward Opening Select Component
interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string; disabled?: boolean; status?: string }[];
  icon?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({ value, onChange, options, icon }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div className="relative" ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold uppercase text-slate-300 hover:bg-white/10 transition-colors whitespace-nowrap min-w-[100px] justify-between"
      >
        <div className="flex items-center gap-2">
            {icon && <i className={`fas ${icon}`}></i>}
            {selectedOption?.status && (
                <span className={`w-1.5 h-1.5 rounded-full ${selectedOption.status === 'connected' ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : 'bg-red-500 shadow-[0_0_5px_#ef4444]'}`}></span>
            )}
            <span>{selectedOption?.label}</span>
        </div>
        <i className={`fas fa-chevron-up transition-transform text-[8px] ${isOpen ? 'rotate-180' : ''}`}></i>
      </button>

      {isOpen && (
        <div className="absolute bottom-full mb-2 left-0 w-max min-w-full bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[100] animate-in slide-in-from-bottom-2 fade-in duration-200">
           {options.map((opt) => (
             <button
                key={opt.value}
                disabled={opt.disabled}
                onClick={() => {
                    if (!opt.disabled) {
                        onChange(opt.value);
                        setIsOpen(false);
                    }
                }}
                className={`w-full text-left px-3 py-2 text-[10px] font-bold uppercase flex items-center gap-2 transition-colors ${
                    opt.disabled ? 'opacity-50 cursor-not-allowed bg-white/5' : 
                    opt.value === value ? 'bg-indigo-500 text-white' : 'hover:bg-white/10 text-slate-300'
                }`}
             >
                {opt.status && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${opt.status === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                )}
                {opt.label}
             </button>
           ))}
        </div>
      )}
    </div>
  );
};

const CubeVisualizer: React.FC<{ rotation: number; tilt: number; zoom: number; onChange: (r: number, t: number) => void }> = ({ rotation, tilt, zoom, onChange }) => {
  const isDragging = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startVal = useRef({ r: 0, t: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startMouse.current = { x: e.clientX, y: e.clientY };
    startVal.current = { r: rotation, t: tilt };
    document.body.style.cursor = 'grabbing';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaX = e.clientX - startMouse.current.x;
      const deltaY = e.clientY - startMouse.current.y;
      const sensitivity = 0.5;
      let newRot = startVal.current.r + (deltaX * sensitivity);
      let newTilt = startVal.current.t - (deltaY * sensitivity); 
      if (newRot > 180) newRot -= 360;
      if (newRot < -180) newRot += 360;
      newTilt = Math.max(-90, Math.min(90, newTilt));
      onChange(Math.round(newRot), Math.round(newTilt));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onChange, rotation, tilt]);

  const visualScale = zoom >= 0 ? 1 + (zoom / 100) : 1 / (1 + Math.abs(zoom)/100);

  const cubeStyle: React.CSSProperties = {
    transform: `rotateX(${tilt}deg) rotateY(${rotation}deg) scale(${visualScale})`,
    transformStyle: 'preserve-3d',
  };

  return (
    <div className="w-full h-48 flex items-center justify-center bg-[#0a0a0a] rounded-xl relative overflow-hidden mb-6 border border-white/5 shadow-inner cursor-grab active:cursor-grabbing group" onMouseDown={handleMouseDown}>
       <div className="perspective-container pointer-events-none" style={{ perspective: '800px' }}>
          <div className="cube w-20 h-20 relative transition-transform duration-75 ease-out" style={cubeStyle}>
             <div className="absolute w-20 h-20 bg-slate-800/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'translateZ(40px)' }}>FRONT</div>
             <div className="absolute w-20 h-20 bg-slate-800/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'rotateY(180deg) translateZ(40px)' }}>BACK</div>
             <div className="absolute w-20 h-20 bg-slate-700/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'rotateY(90deg) translateZ(40px)' }}>R</div>
             <div className="absolute w-20 h-20 bg-slate-700/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'rotateY(-90deg) translateZ(40px)' }}>L</div>
             <div className="absolute w-20 h-20 bg-slate-600/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'rotateX(90deg) translateZ(40px)' }}>TOP</div>
             <div className="absolute w-20 h-20 bg-slate-600/80 border border-slate-600/50 flex items-center justify-center text-slate-300 font-bold text-xs" style={{ transform: 'rotateX(-90deg) translateZ(40px)' }}>BTM</div>
          </div>
       </div>
       <div className="absolute top-2 left-2 text-[8px] text-slate-500 font-bold uppercase opacity-50 group-hover:opacity-100 transition-opacity">Drag to Rotate</div>
       <div className="absolute bottom-2 right-2 text-[8px] text-slate-500 font-mono">R:{rotation}° T:{tilt}° Z:{zoom}</div>
    </div>
  );
};

const ImageModal: React.FC<{ src: string; onClose: () => void }> = ({ src, onClose }) => (
  <div className="fixed inset-0 z-[999] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out animate-in fade-in duration-200" onClick={onClose}>
    <img src={src} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300" />
    <button onClick={onClose} className="absolute top-6 right-6 text-white/50 hover:text-white text-4xl transition-colors">&times;</button>
  </div>
);

const DetailModal: React.FC<{ item: HistoryItem; onClose: () => void; onUseImage?: (item: HistoryItem) => void; onEditImage?: (url: string) => void; onInpaintImage?: (url: string) => void; onToggleLike: (id: string) => void; t: any }> = ({ item, onClose, onUseImage, onEditImage, onInpaintImage, onToggleLike, t }) => {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMousePosition = useRef({ x: 0, y: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);

  const displayItem = {
      ...item,
      url: "[Image Data]", 
      metadata: {
          ...item.metadata,
          refImages: item.metadata?.refImages?.map(() => "[Ref Image Data]") 
      }
  };

  const copySeed = () => {
    if (item.metadata?.seed !== undefined) {
        navigator.clipboard.writeText(item.metadata.seed.toString());
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(prev => Math.min(Math.max(0.5, prev + delta), 5));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
      if (zoom > 1) {
          isDragging.current = true;
          lastMousePosition.current = { x: e.clientX, y: e.clientY };
          document.body.style.cursor = 'grabbing';
      }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      const dx = e.clientX - lastMousePosition.current.x;
      const dy = e.clientY - lastMousePosition.current.y;
      setPosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePosition.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = 'default';
  };

  useEffect(() => {
      if (zoom <= 1) setPosition({ x: 0, y: 0 });
  }, [zoom]);

  return (
    <div className="fixed inset-0 z-[600] bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 md:p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div className="relative w-[95vw] h-[95vh] flex flex-col md:flex-row bg-[#111] rounded-2xl overflow-hidden shadow-2xl border border-white/10" onClick={e => e.stopPropagation()}>
         <div 
            className={`flex-1 bg-black flex items-center justify-center p-4 relative group h-full overflow-hidden ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            ref={imageContainerRef}
         >
            <img 
                src={item.url} 
                className="max-w-full max-h-full object-contain shadow-lg transition-transform duration-75 ease-out" 
                style={{ transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})` }}
                draggable={false}
            />
            <div className="absolute top-4 right-4 flex gap-2">
                <button 
                    onClick={(e) => { e.stopPropagation(); onToggleLike(item.id); }} 
                    className={`w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md transition-all ${item.liked ? 'bg-pink-600 text-white' : 'bg-black/50 text-white/50 hover:text-white hover:bg-black/70'}`}
                >
                    <i className={`fas ${item.liked ? 'fa-heart' : 'fa-heart'}`}></i>
                </button>
                <div className="bg-black/50 text-white px-3 py-2 rounded-full text-xs font-mono backdrop-blur-md pointer-events-none flex items-center">
                    {Math.round(zoom * 100)}%
                </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
            <button onClick={onClose} className="absolute top-4 left-4 w-12 h-12 rounded-full bg-black/50 backdrop-blur text-white hover:text-red-500 text-2xl flex items-center justify-center transition-all hover:bg-white/10 z-50"><i className="fas fa-times"></i></button>
         </div>
         <div className="w-full md:w-96 bg-[#151515] border-l border-white/10 p-6 overflow-y-auto custom-scrollbar flex flex-col h-1/3 md:h-full shrink-0">
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 text-[10px] font-bold uppercase tracking-wider border border-indigo-500/30">{item.type}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{new Date(item.date).toLocaleDateString()} {new Date(item.date).toLocaleTimeString()}</span>
                </div>
                <h3 className="text-2xl font-black text-white mb-6 italic tracking-tight">METADATA</h3>
                <div className="space-y-6">
                   {item.metadata?.prompt && (
                       <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                           <h4 className="text-[9px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-2"><i className="fas fa-quote-left"></i> Prompt</h4>
                           <p className="text-xs text-slate-300 italic leading-relaxed max-h-32 overflow-y-auto custom-scrollbar pr-2">{item.metadata.prompt}</p>
                       </div>
                   )}
                   <div className="grid grid-cols-2 gap-2 mb-4">
                        {[
                            { label: t.model || 'Model', value: item.metadata?.modelName, icon: 'fa-robot' },
                            { label: t.categories?.[Category.GENDER] || 'Gender', value: item.metadata?.gender, icon: 'fa-venus-mars' },
                            { label: t.categories?.[Category.FIT] || 'Fit', value: item.metadata?.fit, icon: 'fa-ruler-combined' },
                            { label: t.categories?.[Category.POSE] || 'Pose', value: item.metadata?.pose, icon: 'fa-user' },
                            { label: t.categories?.[Category.BACKGROUND] || 'Background', value: item.metadata?.background, icon: 'fa-image' },
                            { label: 'Ratio', value: item.metadata?.aspectRatio, icon: 'fa-expand' },
                            { label: 'Size', value: item.size, icon: 'fa-expand-arrows-alt' },
                            { label: 'Style', value: item.preset, icon: 'fa-palette' },
                        ].map((meta, i) => meta.value ? (
                            <div key={i} className="bg-white/5 p-2.5 rounded-xl border border-white/5 flex flex-col justify-center">
                                <span className="text-[9px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-1.5">
                                    <i className={`fas ${meta.icon} text-indigo-500/70`}></i> {meta.label}
                                </span>
                                <span className="text-[10px] text-slate-200 font-bold truncate" title={meta.value}>{meta.value}</span>
                            </div>
                        ) : null)}
                        {item.metadata?.seed !== undefined && (
                            <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 flex flex-col justify-center relative group">
                                <span className="text-[9px] text-slate-500 font-bold uppercase mb-1 flex items-center gap-1.5">
                                    <i className="fas fa-dice text-indigo-500/70"></i> Seed
                                </span>
                                <span className="text-[10px] text-slate-200 font-bold font-mono truncate">{item.metadata.seed}</span>
                                <button onClick={copySeed} className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                    <i className="fas fa-copy"></i>
                                </button>
                            </div>
                        )}
                   </div>
                   {item.metadata?.refImages && item.metadata.refImages.length > 0 && (
                       <div className="mb-4 p-3 bg-white/5 rounded-xl border border-white/5">
                           <h4 className="text-[9px] font-bold text-slate-500 uppercase mb-2 flex items-center gap-2">
                               <i className="fas fa-images"></i> {t.refImages || 'Reference Images'}
                           </h4>
                           <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                               {item.metadata.refImages.map((refImg, idx) => (
                                   <div key={idx} className="w-16 h-16 shrink-0 rounded-lg border border-white/10 overflow-hidden bg-black/20 relative group cursor-pointer" onClick={() => { const w = window.open(""); w?.document.write(`<img src="${refImg}" style="max-width:100%"/>`); }}>
                                       <img src={refImg} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt={`Ref ${idx}`} />
                                   </div>
                               ))}
                           </div>
                       </div>
                   )}
                   <details className="mt-2 border-t border-white/5 pt-4 group">
                        <summary className="text-[9px] font-bold text-slate-500 uppercase cursor-pointer hover:text-white transition-colors list-none flex items-center justify-between">
                            <span>JSON Metadata</span>
                            <i className="fas fa-chevron-down group-open:rotate-180 transition-transform"></i>
                        </summary>
                        <div className="mt-3 p-3 bg-black/50 rounded-lg border border-white/10 overflow-x-auto max-h-60 custom-scrollbar">
                            <pre className="text-[8px] text-green-400 font-mono whitespace-pre-wrap break-all leading-tight">
                                {JSON.stringify(displayItem, null, 2)}
                            </pre>
                        </div>
                   </details>
                </div>
            </div>
            <div className="mt-auto pt-8 space-y-2">
               <button onClick={() => { const a = document.createElement('a'); a.href = item.url; a.download = getNextDownloadFilename('TNH_Library'); a.click(); }} className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg flex items-center justify-center gap-2"><i className="fas fa-download"></i> {t.download}</button>
               {onUseImage && <button onClick={() => onUseImage(item)} className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"><i className="fas fa-reply"></i> {t.useImage}</button>}
               <div className="flex gap-2">
                   {onEditImage && <button onClick={() => onEditImage(item.url)} className="flex-1 py-3 bg-purple-600/20 hover:bg-purple-600 text-purple-200 hover:text-white border border-purple-500/30 hover:border-purple-500 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"><i className="fas fa-sliders-h"></i> {t.edit}</button>}
                   {onInpaintImage && <button onClick={() => onInpaintImage(item.url)} className="flex-1 py-3 bg-pink-600/20 hover:bg-pink-600 text-pink-200 hover:text-white border border-pink-500/30 hover:border-pink-500 rounded-xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"><i className="fas fa-eraser"></i> {t.inpaint}</button>}
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

interface SidebarItemSlotProps {
  catConfig: Category;
  item: ClothingItem | null | undefined;
  selectedValue?: string;
  isDarkMode: boolean;
  onFileSelect: (cat: Category, base64: string) => void;
  onRemoveItem: (cat: Category) => void;
  onLengthChange: (cat: Category, length: ClothingLength) => void;
  onOptionChange: (type: 'fit' | 'pose' | 'bg' | 'gender', val: string) => void;
  layout?: 'full' | 'grid' | 'option';
  t: any;
}

const SidebarItemSlot: React.FC<SidebarItemSlotProps> = React.memo(({ 
  catConfig, item, selectedValue, isDarkMode, 
  onFileSelect, onRemoveItem, onLengthChange, onOptionChange, 
  layout = 'full', t
}) => {
  const isLengthApplicable = [Category.PANTS, Category.SKIRT, Category.SET, Category.OUTER].includes(catConfig);
  const localizedLabel = t.categories && t.categories[catConfig] ? t.categories[catConfig] : catConfig;

  if (layout === 'option') {
    let options: string[] = [];
    let type: 'fit' | 'pose' | 'bg' | 'gender' = 'fit';
    
    if (catConfig === Category.GENDER) { options = genderOptions; type = 'gender'; }
    else if (catConfig === Category.FIT) { options = fitOptions; type = 'fit'; } 
    else if (catConfig === Category.POSE) { options = poseOptions; type = 'pose'; } 
    else if (catConfig === Category.BACKGROUND) { options = bgOptions; type = 'bg'; }

    return (
      <div className="mb-4 border-b border-white/5 pb-4">
         <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{localizedLabel}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
           {options.map(opt => (
             <button key={opt} onClick={() => onOptionChange(type, opt)} className={`px-2 py-1.5 text-[9px] rounded-md font-medium border transition-all truncate text-left ${selectedValue === opt ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-white/5 text-slate-400 border-white/10 hover:border-white/30'}`}>
                {t.options && t.options[opt] ? t.options[opt] : opt}
             </button>
           ))}
        </div>
      </div>
    );
  }

  if (layout === 'grid') {
      return (
        <div className="flex flex-col gap-1 mb-1">
          <div className="flex items-center justify-between px-1 h-3">
             <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider truncate">{localizedLabel}</span>
             {item && (<button onClick={(e) => { e.stopPropagation(); onRemoveItem(catConfig); }} className="text-red-500 hover:text-red-400 text-[9px]"><i className="fas fa-times"></i></button>)}
          </div>
          <div className="aspect-square w-full relative group">
             <DropZone onFileSelect={(b) => onFileSelect(catConfig, b)} label="+" currentImage={item?.imageUrl} isDarkMode={isDarkMode} imageFit="contain" compact={true} className={`w-full h-full rounded-xl border border-slate-800 bg-slate-900/50 ${!item ? 'hover:border-indigo-400' : ''}`} />
             {item && <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_5px_#22c55e]"></div>}
          </div>
          {isLengthApplicable && item && (
             <select value={item.length || ""} onClick={(e) => e.stopPropagation()} onChange={(e) => onLengthChange(catConfig, e.target.value as ClothingLength)} className="w-full mt-0.5 bg-[#151515] border border-white/10 text-slate-300 text-[8px] rounded px-1 py-0.5 focus:outline-none focus:border-indigo-500">
               <option value="" disabled>{t.len}</option>
               {lengthOptions.map(l => <option key={l} value={l}>{l}</option>)}
             </select>
          )}
        </div>
      )
  }

  const heightClass = catConfig === Category.MODEL ? "h-64" : "h-40";

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-1.5 px-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{localizedLabel}</span>
        {item && (<button onClick={(e) => { e.stopPropagation(); onRemoveItem(catConfig); }} className="text-red-500 hover:text-red-400 text-[10px]"><i className="fas fa-times"></i></button>)}
      </div>
      <div className={`w-full relative group ${heightClass}`}>
        <DropZone onFileSelect={(b) => onFileSelect(catConfig, b)} label="+" currentImage={item?.imageUrl} isDarkMode={isDarkMode} imageFit='cover' compact={false} className={`w-full h-full rounded-xl border border-slate-800 bg-slate-900/50 ${!item ? 'hover:border-indigo-400' : ''}`} />
        {item && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full shadow-[0_0_5px_#22c55e]"></div>}
      </div>
    </div>
  );
});

interface FloatingPromptBarProps {
  prompt: string;
  setPrompt: (val: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  disabled: boolean;
  images: string[];
  setImages: React.Dispatch<React.SetStateAction<string[]>>;
  t: any;
  placeholder?: string;
  isDarkMode: boolean;
  selectedModel: string;
  setModel: (val: string) => void;
  selectedRatio: AspectRatio;
  setRatio: (val: AspectRatio) => void;
  selectedSize: ImageSize;
  setSize: (val: ImageSize) => void;
  numberOfImages?: number;
  setNumberOfImages?: (val: number) => void;
}

const FloatingPromptBar: React.FC<FloatingPromptBarProps> = ({ 
    prompt, setPrompt, onGenerate, isGenerating, disabled, images, setImages, t, placeholder, isDarkMode,
    selectedModel, setModel, selectedRatio, setRatio, selectedSize, setSize,
    numberOfImages, setNumberOfImages
}) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);

    const handleFiles = (files: FileList) => {
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (e.target?.result) setImages(prev => [...prev, e.target!.result as string]);
                };
                reader.readAsDataURL(file);
            }
        });
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragItem.current !== null) return; 
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    };

    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if(event.target?.result) setImages(prev => [...prev, event.target!.result as string]);
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        dragItem.current = index;
    };

    const handleDragEnter = (e: React.DragEvent, index: number) => {
        dragOverItem.current = index;
    };

    const handleSort = () => {
        if (dragItem.current === null || dragOverItem.current === null) return;
        const copy = [...images];
        const dragContent = copy[dragItem.current];
        copy.splice(dragItem.current, 1);
        copy.splice(dragOverItem.current, 0, dragContent);
        dragItem.current = null;
        dragOverItem.current = null;
        setImages(copy);
    };

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[95%] md:w-[45%] md:bottom-8 z-50 animate-in slide-in-from-bottom-4 duration-500">
            <div className="bg-[#151515]/90 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl p-4 ring-1 ring-white/5 transition-all">
                 <div className="flex gap-2 mb-3 flex-wrap relative z-20">
                    <CustomSelect 
                        value={selectedModel} 
                        onChange={setModel}
                        icon="fa-robot"
                        options={models.map(m => ({ 
                            value: m.id, 
                            label: m.name, 
                            status: m.status, 
                            disabled: m.status === 'error'
                        }))}
                    />
                    <CustomSelect 
                        value={selectedRatio} 
                        onChange={(v) => setRatio(v as AspectRatio)}
                        options={ratios.map(r => ({ value: r, label: r }))}
                    />
                    <CustomSelect 
                        value={selectedSize} 
                        onChange={(v) => setSize(v as ImageSize)}
                        options={sizes.map(s => ({ value: s, label: s, disabled: s === '4K' }))}
                    />
                    {numberOfImages && setNumberOfImages && (
                        <CustomSelect 
                            value={numberOfImages.toString()}
                            onChange={(v) => setNumberOfImages(parseInt(v))}
                            options={[1, 2, 3, 4].map(n => ({ value: n.toString(), label: `${n}x` }))}
                            icon="fa-layer-group"
                        />
                    )}
                 </div>
                 <div 
                    className="flex gap-2 mb-2 overflow-x-auto custom-scrollbar pb-1 min-h-[3.5rem]"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={handleDrop}
                 >
                    {images.map((img, idx) => (
                        <div 
                            key={idx} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, idx)}
                            onDragEnter={(e) => handleDragEnter(e, idx)}
                            onDragEnd={handleSort}
                            onDragOver={(e) => e.preventDefault()}
                            className="relative group shrink-0 w-11 h-11 rounded-xl overflow-hidden border border-white/20 shadow-sm animate-in fade-in zoom-in duration-300 cursor-pointer"
                        >
                            <img src={img} className="w-full h-full object-cover" />
                            <button onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))} className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/50 hover:bg-red-500 text-white rounded-full text-[8px] flex items-center justify-center transition-colors backdrop-blur-sm opacity-0 group-hover:opacity-100">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                    ))}
                    <DropZone 
                        onFileSelect={(b64) => setImages(prev => [...prev, b64])} 
                        label="+" 
                        compact={true} 
                        multiple={true}
                        className="w-11 h-11 shrink-0 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 transition-colors" 
                        isDarkMode={isDarkMode} 
                    />
                 </div>
                 <div 
                    className="flex items-end gap-2"
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={handleDrop}
                 >
                     <textarea 
                        ref={textareaRef}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onGenerate(); } }}
                        placeholder={placeholder}
                        className="w-full bg-transparent border-none focus:ring-0 text-sm p-1 resize-none text-slate-200 placeholder:text-slate-400"
                        rows={4}
                     />
                     <button 
                        onClick={onGenerate} 
                        disabled={disabled} 
                        className={`mb-1 px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 shadow-lg text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${
                            disabled
                            ? 'bg-slate-700 cursor-not-allowed text-slate-400' 
                            : 'bg-indigo-600 hover:bg-indigo-500 hover:scale-105 active:scale-95 text-white'
                        }`}
                        title={disabled ? t.queueFull : t.generate}
                     >
                         <i className="fas fa-magic"></i>
                         {disabled ? 'FULL' : t.generate}
                     </button>
                 </div>
            </div>
        </div>
    );
};

const NavShortcuts: React.FC<{ current: PageType; onNavigate: (page: PageType) => void; t: any }> = ({ current, onNavigate, t }) => {
  const items: { id: PageType; label: string; icon: string }[] = [
    { id: 'STUDIO', label: t.studio, icon: 'fa-tshirt' },
    { id: 'EDIT_IMAGE', label: t.edit, icon: 'fa-sliders-h' },
    { id: 'INPAINTING', label: t.inpaint, icon: 'fa-eraser' },
    { id: 'LIBRARY', label: t.library, icon: 'fa-th-large' },
  ];

  return (
    <div className="flex items-center gap-1 mx-2 md:mx-4 bg-white/5 p-1 rounded-lg overflow-x-auto no-scrollbar max-w-[50vw] md:max-w-none">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={`px-3 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 whitespace-nowrap ${
            current === item.id 
              ? 'bg-white/10 text-indigo-400 shadow-sm' 
              : 'text-slate-400 hover:text-slate-300 hover:bg-white/5'
          }`}
        >
          <i className={`fas ${item.icon}`}></i>
          <span className="hidden sm:inline">{item.label}</span>
        </button>
      ))}
    </div>
  );
};

interface CommonHeaderProps {
    title: string;
    current: PageType;
    onNavigate: (page: PageType) => void;
    rightControls?: React.ReactNode;
    isDarkMode: boolean;
    handleLogout: () => void;
    toggleTheme: () => void;
    lang: string;
    toggleLang: () => void;
    onMenuToggle?: () => void;
    isMenuOpen?: boolean;
    t: any;
    user: User | null;
    authLoading: boolean;
}

const CommonHeader: React.FC<CommonHeaderProps> = ({ title, current, onNavigate, rightControls, isDarkMode, toggleTheme, lang, toggleLang, onMenuToggle, isMenuOpen, t, user, authLoading, handleLogout }) => {

  return (
    <header className="h-14 border-b border-white/5 flex items-center justify-between px-4 lg:px-6 bg-[#111]/90 backdrop-blur-md z-[60] relative transition-colors duration-300">
       <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
             <button onClick={() => onNavigate('LANDING')} className="w-8 h-8 rounded-full bg-white/10 hover:bg-indigo-500 hover:text-white flex items-center justify-center text-slate-400 transition-colors"><i className="fas fa-home text-xs"></i></button>
             {onMenuToggle && (
                <button onClick={onMenuToggle} className="text-slate-400 hover:text-indigo-500 transition-colors w-8 h-8 flex items-center justify-center">
                   <i className={`fas ${isMenuOpen ? 'fa-outdent' : 'fa-indent'}`}></i>
                </button>
             )}
          </div>
          <div className="text-sm lg:text-base font-black italic tracking-tighter text-white whitespace-nowrap">{title}</div>
       </div>
       <div className="absolute left-1/2 -translate-x-1/2">
           <NavShortcuts current={current} onNavigate={onNavigate} t={t} />
       </div>
       <div className="flex items-center gap-2">
          {rightControls}
          <div className="w-px h-4 bg-white/10 mx-2"></div>
          <button onClick={toggleLang} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-slate-500 transition-all text-[10px] font-bold">{lang}</button>
          <div className="w-px h-4 bg-white/10 mx-2"></div>

          {authLoading ? (
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="fas fa-spinner fa-spin text-slate-500 text-sm"></i>
            </div>
          ) : user ? (
            <button
              onClick={handleLogout}
              className="relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer overflow-hidden group bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-indigo-500/50 transition-all duration-300"
            >
              <span className="relative z-10">로그아웃</span>
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </button>
          ) : (
            <button
              onClick={async () => {
                console.log('Login button clicked!');
                try {
                  console.log('Calling signInWithGoogle...');
                  await signInWithGoogle();
                  console.log('Login successful!');
                } catch (error: any) {
                  console.error('Login failed:', error);
                  alert(error.message || '로그인에 실패했습니다.');
                }
              }}
              className="relative px-5 py-2 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer overflow-hidden group bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-indigo-500/50 transition-all duration-300"
            >
              <span className="relative z-10">로그인</span>
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            </button>
          )}
       </div>
    </header>
  );
};

const LandingPage: React.FC<{ onNavigate: (page: PageType) => void; t: any; user: User | null; handleLogout: () => void }> = ({ onNavigate, t, user, handleLogout }) => {
    // ... logic same ...
    const [showHistory, setShowHistory] = useState(false);
    const [showChangelog, setShowChangelog] = useState(false);
    const changelogRef = useRef<HTMLDivElement>(null);
  
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (changelogRef.current && !changelogRef.current.contains(event.target as Node)) {
          setShowChangelog(false);
        }
      };
      if (showChangelog) document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showChangelog]);

  return (
    <div className="min-h-screen bg-[#050505] text-white overflow-y-auto font-sans selection:bg-indigo-500 selection:text-white flex flex-col relative" style={{
        backgroundImage: 'radial-gradient(circle, #ffffff15 1px, transparent 1px)',
        backgroundSize: '24px 24px'
    }}>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none -z-0"></div>

      <nav className="w-full z-50 bg-transparent pt-6">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-center relative">
          <div className="w-full flex items-center justify-center relative">
             <div className="flex items-center gap-2 cursor-pointer group" onClick={() => onNavigate('LANDING')}>
                 <span className="flex items-center gap-2 text-white">
                    <span style={{ fontFamily: 'Inter, sans-serif' }} className="text-3xl font-normal tracking-tight opacity-90">MY AI STUDIO</span>
                 </span>
             </div>
             <div className="absolute right-0 flex gap-3">
                 {user ? (
                   <button
                     onClick={handleLogout}
                     className="relative px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer overflow-hidden group bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-indigo-500/50 transition-all duration-300"
                   >
                     <span className="relative z-10">로그아웃</span>
                     <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                   </button>
                 ) : (
                   <button
                     onClick={async () => {
                       console.log('Landing Login button clicked!');
                       try {
                         await signInWithGoogle();
                         console.log('Login successful!');
                       } catch (error: any) {
                         console.error('Login failed:', error);
                         alert(error.message || '로그인에 실패했습니다.');
                       }
                     }}
                     className="relative px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer overflow-hidden group bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:shadow-lg hover:shadow-indigo-500/50 transition-all duration-300"
                   >
                     <span className="relative z-10">로그인</span>
                     <div className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                   </button>
                 )}
             </div>
          </div>
        </div>
      </nav>
      
      <main className="flex-1 flex flex-col justify-center items-center relative z-10 w-full max-w-7xl mx-auto px-6 py-20">
        {!user && (
          <div className="mb-8 px-6 py-4 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-center">
            <i className="fas fa-lock text-indigo-400 text-2xl mb-2"></i>
            <p className="text-sm text-white font-bold mb-1">로그인이 필요합니다</p>
            <p className="text-xs text-slate-300">Google 로그인 후 모든 기능을 사용할 수 있습니다</p>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full">
          <div
            onClick={() => user ? onNavigate('STUDIO') : alert('로그인이 필요합니다')}
            className={`group relative h-80 rounded-3xl bg-[#111] border border-white/10 p-1 overflow-hidden transition-all duration-300 ${user ? 'cursor-pointer hover:border-indigo-500/50' : 'cursor-not-allowed opacity-60'}`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/90 z-10"></div><div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1539109136881-3be0616acf4b?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700"></div>
            <div className="absolute bottom-0 left-0 w-full p-6 z-20"><div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center mb-4 text-white shadow-lg group-hover:scale-110 transition-transform"><i className="fas fa-tshirt"></i></div><h3 className="text-2xl font-bold mb-2 text-white">{t.fittingStudio}</h3><p className="text-sm text-slate-300 mb-4 line-clamp-2">{t.fittingDesc}</p><div className="flex items-center text-indigo-400 text-xs font-bold uppercase tracking-wider group-hover:translate-x-2 transition-transform">{t.enterStudio} <i className="fas fa-arrow-right ml-2"></i></div></div>
          </div>
          <div
            onClick={() => user ? onNavigate('EDIT_IMAGE') : alert('로그인이 필요합니다')}
            className={`group relative h-80 rounded-3xl bg-[#111] border border-white/10 p-1 overflow-hidden transition-all duration-300 ${user ? 'cursor-pointer hover:border-purple-500/50' : 'cursor-not-allowed opacity-60'}`}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/90 z-10"></div><div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700"></div>
            <div className="absolute bottom-0 left-0 w-full p-6 z-20"><div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center mb-4 text-white shadow-lg group-hover:scale-110 transition-transform"><i className="fas fa-sliders-h"></i></div><h3 className="text-2xl font-bold mb-2 text-white">{t.edit}</h3><p className="text-sm text-slate-300 mb-4 line-clamp-2">{t.editDesc}</p><div className="flex items-center text-purple-400 text-xs font-bold uppercase tracking-wider group-hover:translate-x-2 transition-transform">{t.openEditor} <i className="fas fa-arrow-right ml-2"></i></div></div>
          </div>
          <div
            onClick={() => user ? onNavigate('INPAINTING') : alert('로그인이 필요합니다')}
            className={`group relative h-80 rounded-3xl bg-[#111] border border-white/10 p-1 overflow-hidden transition-all duration-300 ${user ? 'cursor-pointer hover:border-pink-500/50' : 'cursor-not-allowed opacity-60'}`}
          >
             <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/90 z-10"></div><div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700"></div>
             <div className="absolute bottom-0 left-0 w-full p-6 z-20"><div className="w-10 h-10 rounded-xl bg-pink-600 flex items-center justify-center mb-4 text-white shadow-lg group-hover:scale-110 transition-transform"><i className="fas fa-eraser"></i></div><h3 className="text-2xl font-bold mb-2 text-white">{t.inpaint}</h3><p className="text-sm text-slate-300 mb-4 line-clamp-2">{t.inpaintDesc}</p><div className="flex items-center text-pink-400 text-xs font-bold uppercase tracking-wider group-hover:translate-x-2 transition-transform">{t.openInpaint} <i className="fas fa-arrow-right ml-2"></i></div></div>
          </div>
          <div
            onClick={() => user ? onNavigate('LIBRARY') : alert('로그인이 필요합니다')}
            className={`group relative h-80 rounded-3xl bg-[#111] border border-white/10 p-1 overflow-hidden transition-all duration-300 ${user ? 'cursor-pointer hover:border-blue-500/50' : 'cursor-not-allowed opacity-60'}`}
          >
             <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/90 z-10"></div><div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1513542789411-b6a5d4f31634?q=80&w=1000&auto=format&fit=crop')] bg-cover bg-center opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700"></div>
             <div className="absolute bottom-0 left-0 w-full p-6 z-20"><div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center mb-4 text-white shadow-lg group-hover:scale-110 transition-transform"><i className="fas fa-th-large"></i></div><h3 className="text-2xl font-bold mb-2 text-white">{t.library}</h3><p className="text-sm text-slate-300 mb-4 line-clamp-2">{t.libraryDesc}</p><div className="flex items-center text-blue-400 text-xs font-bold uppercase tracking-wider group-hover:translate-x-2 transition-transform">{t.viewLibrary} <i className="fas fa-arrow-right ml-2"></i></div></div>
          </div>
        </div>
      </main>
      
      <footer className="bg-transparent py-6 px-6 z-50 relative mt-auto">
         <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] text-slate-600 uppercase tracking-wider">
                <span>© 2026 MY AI STUDIO. ALL RIGHTS RESERVED.</span>
                <div className="relative" ref={changelogRef}>
                    <button 
                        onClick={() => setShowChangelog(!showChangelog)}
                        className="ml-2 opacity-50 hover:opacity-100 hover:text-white transition-all border-b border-dotted border-slate-600 hover:border-white"
                    >
                        v0.6.2-beta
                    </button>
                    {showChangelog && (
                        <div className="absolute bottom-full left-0 mb-3 w-72 bg-[#111]/95 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-2xl z-[100] animate-in slide-in-from-bottom-2 fade-in duration-200 text-left">
                           <div className="flex justify-between items-center mb-3 pb-2 border-b border-white/10">
                                <h3 className="text-[10px] font-black text-white tracking-widest">VERSION HISTORY</h3>
                                <button onClick={() => setShowChangelog(false)} className="text-slate-500 hover:text-white transition-colors"><i className="fas fa-times"></i></button>
                            </div>
                            <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                               {changelogData.map((log, i) => (
                                   <div key={i} className="relative pl-3 border-l border-white/10">
                                       <div className="absolute left-[-1.5px] top-1.5 w-0.5 h-0.5 bg-indigo-500 rounded-full"></div>
                                       <div className="flex justify-between items-baseline mb-1">
                                           <span className="text-[10px] font-bold text-indigo-400">{log.version}</span>
                                           <span className="text-[8px] text-slate-500 font-mono">{log.date}</span>
                                       </div>
                                       <ul className="space-y-0.5">
                                           {log.changes.map((c, idx) => (
                                               <li key={idx} className="text-[9px] text-slate-300 leading-relaxed text-left flex items-start">
                                                <span className="mr-1 opacity-50">-</span> {c}
                                               </li>
                                           ))}
                                       </ul>
                                   </div>
                               ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-6">
                <div className="flex gap-4">
                    <a href="#" className="text-[10px] text-slate-500 hover:text-white transition-colors uppercase tracking-wider">{t.terms}</a>
                    <a href="#" className="text-[10px] text-slate-500 hover:text-white transition-colors uppercase tracking-wider">{t.privacy}</a>
                </div>
                <div className="w-px h-3 bg-white/10 hidden md:block"></div>
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-[10px] text-slate-500 font-mono">System Operational</span>
                </div>
            </div>
         </div>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
    const [currentPage, setCurrentPage] = useState<PageType>('LANDING');
    const [lang, setLang] = useState<LangType>('EN');
    const [isDarkMode, setIsDarkMode] = useState(true); // FORCED TRUE
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [detailItem, setDetailItem] = useState<HistoryItem | null>(null);
    const [showZoom, setShowZoom] = useState<string | null>(null);
    const [showApiKeyModal, setShowApiKeyModal] = useState(false);
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    const [sidebarWidth, setSidebarWidth] = useState(340);
    const [isResizing, setIsResizing] = useState(false);
    
    const [isMobileSettingsOpen, setIsMobileSettingsOpen] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    const [canvasTransform, setCanvasTransform] = useState({ scale: 1, x: 0, y: 0 });
    const isSpacePressed = useRef(false);
    const isPanningRef = useRef(false);
    const startPanMouse = useRef({ x: 0, y: 0 });
    const startPanOffset = useRef({ x: 0, y: 0 });

    const t = translations[lang];
    const cancelControllers = useRef<Record<string, AbortController>>({});

    useEffect(() => {
        const root = window.document.documentElement;
        root.classList.add('dark');
    }, []);

    // Check for API key on mount
    useEffect(() => {
        if (!hasApiKey()) {
            setShowApiKeyModal(true);
        }
    }, []);

    // Listen to auth state changes
    useEffect(() => {
        const unsubscribe = onAuthStateChange((user) => {
            setUser(user);
            setAuthLoading(false);
            if (user) {
                console.log('User signed in:', user.email);
            } else {
                console.log('User signed out');
            }
        });

        return () => unsubscribe();
    }, []);

    const handleApiKeySave = (apiKey: string) => {
        const success = saveApiKey(apiKey);
        if (success) {
            setShowApiKeyModal(false);
        } else {
            alert('API 키 저장에 실패했습니다. 다시 시도해주세요.');
        }
    };

    const handleLogout = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Logout failed:', error);
        }
    };

    // Google Drive functions
    const saveToDrive = async (imageUrl: string, fileName: string, metadata?: any) => {
        if (!user) {
            throw new Error('User not logged in');
        }

        try {
            console.log('[Drive] Fetching image blob from:', imageUrl.substring(0, 50) + '...');
            // Convert image URL to blob
            const response = await fetch(imageUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
            }
            const blob = await response.blob();
            console.log('[Drive] Blob created:', blob.type, blob.size, 'bytes');

            // Upload to Drive
            console.log('[Drive] Uploading to Drive:', fileName);
            await uploadImageToDrive(blob, fileName, metadata);
            console.log('[Drive] Upload complete:', fileName);
        } catch (error: any) {
            console.error('[Drive] Failed to save to Drive:', error);
            throw error;
        }
    };

    const downloadFromDrive = async (fileId: string, fileName: string) => {
        if (!user) {
            return;
        }

        try {
            const blob = await downloadImageFromDrive(fileId);
            const url = URL.createObjectURL(blob);

            // Download file
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error: any) {
            console.error('Failed to download from Drive:', error);
            alert(error.message || 'Drive 다운로드에 실패했습니다.');
        }
    };

    // Add item to history and automatically save to Drive
    const addToHistoryAndDrive = async (item: HistoryItem) => {
        // Add to local history first
        setHistory(prev => [item, ...prev]);

        // Save to Drive in background (don't block UI)
        if (user) {
            console.log('[Drive] Auto-saving to Drive:', item.type, item.date);
            const fileName = `${item.type}_${item.date}.png`;
            const metadata = {
                type: item.type,
                date: item.date,
                preset: item.preset,
                view: item.view,
                size: item.size,
                ...item.metadata
            };

            try {
                await saveToDrive(item.url, fileName, metadata);
                console.log('[Drive] Successfully saved to Drive:', fileName);
            } catch (error) {
                console.error('[Drive] Failed to auto-save to Drive:', error);
                // Show error to user
                alert('Drive 자동 저장 실패: ' + (error as Error).message);
            }
        }
    };

    // Add multiple items to history and Drive
    const addMultipleToHistoryAndDrive = async (items: HistoryItem[]) => {
        // Add to local history first
        setHistory(prev => [...items, ...prev]);

        // Save to Drive in background
        if (user) {
            console.log('[Drive] Auto-saving multiple images to Drive:', items.length);
            for (const item of items) {
                const fileName = `${item.type}_${item.date}.png`;
                const metadata = {
                    type: item.type,
                    date: item.date,
                    preset: item.preset,
                    view: item.view,
                    size: item.size,
                    ...item.metadata
                };

                try {
                    await saveToDrive(item.url, fileName, metadata);
                    console.log('[Drive] Successfully saved:', fileName);
                } catch (error) {
                    console.error('[Drive] Failed to save:', fileName, error);
                }
            }
        }
    };

    // Convert Drive image to HistoryItem format
    const convertDriveImageToHistoryItem = async (driveImage: any): Promise<HistoryItem> => {
        try {
            // Download image to create local URL
            const blob = await downloadImageFromDrive(driveImage.id);
            const url = URL.createObjectURL(blob);

            // Download metadata from companion .json file
            const fullMetadata = await downloadMetadataFromDrive(driveImage.name);

            // If no metadata file exists, fall back to basic info
            if (!fullMetadata) {
                return {
                    id: driveImage.id,
                    url: url,
                    date: new Date(driveImage.createdTime).getTime(),
                    type: 'FITTING',
                    liked: false,
                    metadata: {
                        prompt: driveImage.description || '',
                    }
                };
            }

            return {
                id: driveImage.id,
                url: url,
                date: fullMetadata.date || new Date(driveImage.createdTime).getTime(),
                type: fullMetadata.type || 'FITTING',
                preset: fullMetadata.preset,
                view: fullMetadata.view,
                size: fullMetadata.size,
                liked: false,
                metadata: {
                    prompt: fullMetadata.prompt,
                    fit: fullMetadata.fit,
                    pose: fullMetadata.pose,
                    background: fullMetadata.background,
                    aspectRatio: fullMetadata.aspectRatio,
                    modelName: fullMetadata.modelName,
                    gender: fullMetadata.gender,
                    seed: fullMetadata.seed,
                    refImages: fullMetadata.refImages, // Now preserved!
                }
            };
        } catch (error) {
            console.error('Failed to convert Drive image:', error);
            throw error;
        }
    };

    // Auto-load all images from Drive on login
    useEffect(() => {
        const loadDriveImages = async () => {
            if (user) {
                try {
                    console.log('[Drive] Loading images from Drive...');
                    const driveImages = await listImagesFromDrive();
                    console.log('[Drive] Found', driveImages.length, 'images');

                    const historyItems: HistoryItem[] = [];
                    for (const driveImage of driveImages) {
                        try {
                            const item = await convertDriveImageToHistoryItem(driveImage);
                            historyItems.push(item);
                        } catch (error) {
                            console.error('[Drive] Failed to load image:', driveImage.name, error);
                        }
                    }

                    setHistory(historyItems);
                    console.log('[Drive] Loaded', historyItems.length, 'images to library');
                } catch (error) {
                    console.error('[Drive] Failed to load images from Drive:', error);
                }
            } else {
                setHistory([]);
            }
        };

        loadDriveImages();
    }, [user]);

    const [studioState, setStudioState] = useState<AppState>({
        currentView: 'FRONT',
        views: { 'FRONT': { modelImage: null, items: {} }, 'BACK': { modelImage: null, items: {} } },
        generatedBatches: [], 
        error: null,
        aspectRatio: '2:3',
        stylePreset: 'Studio',
        imageSize: '2K',
        userPrompt: '',
        refImages: [],
        selectedFit: 'Standard',
        selectedPose: 'Model Standing',
        selectedBackground: 'Studio Grey',
        selectedGender: 'Female',
        selectedModel: 'gemini-3-pro-image-preview',
        seed: -1,
        useRandomSeed: true,
        numberOfImages: 1 
    });

    const studioHistoryRef = useRef<AppState[]>([]);
    const [undoTrigger, setUndoTrigger] = useState(0); 

    const inpaintHistoryRef = useRef<ImageData[]>([]);
    const inpaintHistoryStep = useRef<number>(-1);

    const saveStudioState = (newState: AppState) => {
        if (studioHistoryRef.current.length > 20) {
            studioHistoryRef.current.shift();
        }
        const last = studioHistoryRef.current[studioHistoryRef.current.length - 1];
        if (JSON.stringify(last) !== JSON.stringify(newState)) {
             studioHistoryRef.current.push(newState);
        }
    };

    useEffect(() => {
        if(studioHistoryRef.current.length === 0) {
            studioHistoryRef.current.push(studioState);
        }
    }, []);

    const performInpaintUndo = () => {
        if (inpaintHistoryStep.current > 0) {
            inpaintHistoryStep.current--;
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx && inpaintHistoryRef.current[inpaintHistoryStep.current]) {
                ctx.putImageData(inpaintHistoryRef.current[inpaintHistoryStep.current], 0, 0);
            }
        }
    };

    const performUndo = useCallback(() => {
        if (currentPage === 'STUDIO' && studioHistoryRef.current.length > 1) {
            studioHistoryRef.current.pop();
            const previousState = studioHistoryRef.current[studioHistoryRef.current.length - 1];
            setStudioState(previousState);
            setUndoTrigger(prev => prev + 1);
        } else if (currentPage === 'INPAINTING') {
            performInpaintUndo();
        }
    }, [currentPage]);

    useEffect(() => {
        const handler = setTimeout(() => {
            saveStudioState(studioState);
        }, 500);
        return () => clearTimeout(handler);
    }, [studioState]);


    const [editImage, setEditImage] = useState<string | null>(null);
    const [editParams, setEditParams] = useState({ rotation: 0, tilt: 0, zoom: 0, lighting: 50, shadow: 50, relighting: false });
    const [editPrompt, setEditPrompt] = useState('');
    const [editResult, setEditResult] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editRefImages, setEditRefImages] = useState<string[]>([]);

    const [inpaintBase, setInpaintBase] = useState<string | null>(null);
    const [inpaintPrompt, setInpaintPrompt] = useState('');
    const [inpaintResult, setInpaintResult] = useState<string | null>(null);
    const [isInpainting, setIsInpainting] = useState(false);
    const [inpaintRefImages, setInpaintRefImages] = useState<string[]>([]);
    const [inpaintTool, setInpaintTool] = useState<'brush' | 'eraser'>('brush');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(20);
    const [cursorMode, setCursorMode] = useState<'default' | 'grab' | 'grabbing'>('default');
    
    const lastDrawPos = useRef<{x: number, y: number} | null>(null);

    const handleReuse = (item: HistoryItem) => {
        if(item.metadata?.seed !== undefined) {
             setStudioState(prev => ({ ...prev, seed: item.metadata!.seed!, useRandomSeed: false }));
        }
        setDetailItem(null);
    };

    const toggleLike = (id: string) => {
        setHistory(prev => prev.map(item => item.id === id ? { ...item, liked: !item.liked } : item));
        if (detailItem && detailItem.id === id) {
            setDetailItem(prev => prev ? { ...prev, liked: !prev.liked } : null);
        }
    };

    const handleDownload = (e: React.MouseEvent, url: string) => {
        e.stopPropagation();
        const a = document.createElement('a');
        a.href = url;
        a.download = getNextDownloadFilename('TNH_Studio');
        a.click();
    };

    const startResizing = useCallback(() => setIsResizing(true), []);
    const stopResizing = useCallback(() => setIsResizing(false), []);
    const resize = useCallback((e: MouseEvent) => {
        if (isResizing) {
            const newWidth = e.clientX;
            if (newWidth >= 280 && newWidth <= 600) {
                setSidebarWidth(newWidth);
            }
        }
    }, [isResizing]);

    const handleRouteToEdit = (url: string) => {
        setEditImage(url);
        setCurrentPage('EDIT_IMAGE');
        setDetailItem(null); 
    };

    const handleRouteToInpaint = (url: string) => {
        setInpaintBase(url);
        setCurrentPage('INPAINTING');
        setDetailItem(null); 
    };

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                performUndo();
            }

            if (e.code === 'Space') {
                if (!isSpacePressed.current) {
                    isSpacePressed.current = true;
                    setCursorMode('grab');
                }
            }
            if (currentPage === 'INPAINTING') {
                if (e.key === '+' || e.key === '=') {
                    setCanvasTransform(prev => ({ ...prev, scale: Math.min(prev.scale + 0.1, 5) }));
                }
                if (e.key === '-') {
                    setCanvasTransform(prev => ({ ...prev, scale: Math.max(prev.scale - 0.1, 0.1) }));
                }
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                isSpacePressed.current = false;
                setCursorMode('default');
                isPanningRef.current = false; 
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [currentPage, performUndo]);

    useEffect(() => {
        const handleResize = () => {
            const mobile = window.innerWidth < 768;
            setIsMobile(mobile);
            if (!mobile) setIsMobileSettingsOpen(false);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const handleStudioFile = (cat: Category, b64: string) => {
        setStudioState(prev => ({
            ...prev,
            views: {
                ...prev.views,
                [prev.currentView]: {
                    ...prev.views[prev.currentView],
                    items: { ...prev.views[prev.currentView], items: { ...prev.views[prev.currentView].items, [cat]: { id: Date.now().toString(), category: cat, imageUrl: b64, name: 'Item' } } }
                },
                ...((cat === Category.MODEL || cat === Category.MODEL_AURORA || cat === Category.MODEL_ORION) ? { 
                    [prev.currentView === 'FRONT' ? 'BACK' : 'FRONT']: { 
                        ...prev.views[prev.currentView === 'FRONT' ? 'BACK' : 'FRONT'], 
                        modelImage: b64 
                    } 
                } : {})
            }
        }));
    };

    const handleStudioRemove = (cat: Category) => {
        setStudioState(prev => {
             const newItems = { ...prev.views[prev.currentView].items };
             delete newItems[cat];
             return { ...prev, views: { ...prev.views, [prev.currentView]: { ...prev.views[prev.currentView], items: newItems } } };
        });
    };

    const handleCancelGeneration = (batchId: string) => {
        if (cancelControllers.current[batchId]) {
            cancelControllers.current[batchId].abort();
            delete cancelControllers.current[batchId];
        }
        setStudioState(prev => ({
            ...prev,
            generatedBatches: prev.generatedBatches.filter(b => b.id !== batchId)
        }));
    };

    const generateStudio = async () => {
        const activeBatches = studioState.generatedBatches.filter(b => b.status === 'loading');
        if (activeBatches.length >= 2) return;

        if (!await checkApiKey()) return;
        
        const batchId = Date.now().toString();
        const controller = new AbortController();
        cancelControllers.current[batchId] = controller;

        const newBatch: BatchItem = {
            id: batchId,
            images: Array(studioState.numberOfImages).fill("placeholder"),
            status: 'loading',
            date: Date.now(),
            aspectRatio: studioState.aspectRatio // Store current ratio
        };

        setStudioState(prev => ({ 
            ...prev, 
            error: null,
            generatedBatches: [newBatch, ...prev.generatedBatches] 
        }));

        try {
            const currentViewState = studioState.views[studioState.currentView];
            
            const modelImg = currentViewState.items[Category.MODEL_AURORA]?.imageUrl 
                          || currentViewState.items[Category.MODEL_ORION]?.imageUrl 
                          || currentViewState.items[Category.MODEL]?.imageUrl 
                          || null;

            const seedToUse = studioState.useRandomSeed ? undefined : studioState.seed;

            const result = await generateFittingImage(
                modelImg,
                currentViewState.items,
                studioState.aspectRatio,
                studioState.stylePreset,
                studioState.currentView,
                studioState.imageSize,
                studioState.userPrompt,
                studioState.refImages,
                { fit: studioState.selectedFit, pose: studioState.selectedPose, background: studioState.selectedBackground, gender: studioState.selectedGender },
                studioState.selectedModel,
                seedToUse,
                studioState.numberOfImages,
                controller.signal
            );
            
            setStudioState(prev => ({
                ...prev,
                generatedBatches: prev.generatedBatches.map(b => 
                    b.id === batchId 
                    ? { ...b, images: result.imageUrls, status: 'completed' } 
                    : b
                )
            }));
            
            const newHistoryItems: HistoryItem[] = result.imageUrls.map((url, index) => ({
                id: batchId + "_" + index,
                url: url,
                date: Date.now(),
                type: 'FITTING',
                liked: false,
                preset: studioState.stylePreset, view: studioState.currentView, size: studioState.imageSize,
                metadata: {
                    prompt: studioState.userPrompt,
                    fit: studioState.selectedFit,
                    pose: studioState.selectedPose,
                    background: studioState.selectedBackground,
                    gender: studioState.selectedGender,
                    modelName: studioState.selectedModel,
                    aspectRatio: studioState.aspectRatio,
                    refImages: studioState.refImages,
                    seed: result.seeds[index]
                }
            }));
            addMultipleToHistoryAndDrive(newHistoryItems);
            
            delete cancelControllers.current[batchId];

        } catch (e: any) {
            if (e.message !== "Cancelled") {
                console.error("Gen Error:", e);
                setStudioState(prev => ({ 
                    ...prev, 
                    generatedBatches: prev.generatedBatches.map(b => 
                         b.id === batchId ? { ...b, status: 'error', errorMsg: e.message } : b
                    ),
                    error: e.message 
                }));
                delete cancelControllers.current[batchId];
            }
        }
    };

    const runEdit = async () => {
        if (isEditing || !editImage) return;
        if (!await checkApiKey()) return;
        setIsEditing(true);
        try {
            const seedToUse = studioState.useRandomSeed ? undefined : studioState.seed;
            const result = await generateEditedImage(editImage, editParams, editPrompt, editRefImages, studioState.aspectRatio, studioState.selectedModel, seedToUse);
            setEditResult(result.imageUrl);
            
            const newItem: HistoryItem = {
                id: Date.now().toString(), url: result.imageUrl, date: Date.now(), type: 'EDIT', liked: false,
                metadata: { prompt: editPrompt, refImages: editRefImages, modelName: studioState.selectedModel, seed: result.seed }
            };
            addToHistoryAndDrive(newItem);
            setDetailItem(newItem);
            
        } catch(e) { console.error(e); } finally { setIsEditing(false); }
    };

    const runInpaint = async () => {
        if (isInpainting || !inpaintBase || !canvasRef.current) return;
        if (!await checkApiKey()) return;
        setIsInpainting(true);
        try {
            const seedToUse = studioState.useRandomSeed ? undefined : studioState.seed;
            const mask = canvasRef.current.toDataURL('image/png');
            const result = await generateInpainting(inpaintBase, mask, inpaintPrompt, inpaintRefImages, studioState.selectedModel, seedToUse);
            setInpaintResult(result.imageUrl);
            
            const newItem: HistoryItem = {
                id: Date.now().toString(), url: result.imageUrl, date: Date.now(), type: 'INPAINTING', liked: false,
                metadata: { prompt: inpaintPrompt, refImages: inpaintRefImages, modelName: studioState.selectedModel, seed: result.seed }
            };
            addToHistoryAndDrive(newItem);
            setDetailItem(newItem);
            
        } catch(e) { console.error(e); } finally { setIsInpainting(false); }
    };

    const handleImageLoad = () => {
        if (imgRef.current && canvasRef.current) {
            canvasRef.current.width = imgRef.current.naturalWidth;
            canvasRef.current.height = imgRef.current.naturalHeight;
            const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                inpaintHistoryRef.current = [ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)];
                inpaintHistoryStep.current = 0;
            }
            setCanvasTransform({ scale: 1, x: 0, y: 0 });
        }
    };

    const saveInpaintHistory = () => {
        if (!canvasRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        const newData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
        const newHistory = inpaintHistoryRef.current.slice(0, inpaintHistoryStep.current + 1);
        newHistory.push(newData);
        if (newHistory.length > 20) newHistory.shift();
        inpaintHistoryRef.current = newHistory;
        inpaintHistoryStep.current = newHistory.length - 1;
    };

    const handleCanvasContainerWheel = (e: React.WheelEvent) => {
        if (!inpaintBase) return;
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setCanvasTransform(prev => ({
            ...prev,
            scale: Math.min(Math.max(0.1, prev.scale + delta), 5)
        }));
    };

    const handleCanvasMouseDown = (e: React.MouseEvent) => {
        if (isSpacePressed.current || e.button === 1) {
            e.preventDefault();
            isPanningRef.current = true;
            setCursorMode('grabbing');
            startPanMouse.current = { x: e.clientX, y: e.clientY };
            startPanOffset.current = { x: canvasTransform.x, y: canvasTransform.y };
        } else {
            setIsDrawing(true);
            if (canvasRef.current) {
                const rect = canvasRef.current.getBoundingClientRect();
                const scaleX = canvasRef.current.width / rect.width;
                const scaleY = canvasRef.current.height / rect.height;
                const x = (e.clientX - rect.left) * scaleX;
                const y = (e.clientY - rect.top) * scaleY;
                
                lastDrawPos.current = { x, y };

                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = inpaintTool === 'eraser' ? 'black' : 'white';
                    ctx.beginPath();
                    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
    };

    const handleCanvasMouseMove = (e: React.MouseEvent) => {
        if (isPanningRef.current) {
            const dx = e.clientX - startPanMouse.current.x;
            const dy = e.clientY - startPanMouse.current.y;
            setCanvasTransform(prev => ({
                ...prev,
                x: startPanOffset.current.x + dx,
                y: startPanOffset.current.y + dy
            }));
            return;
        }

        if (!canvasRef.current) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = canvasRef.current.width / rect.width;
        const scaleY = canvasRef.current.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        if (cursorRef.current) {
            cursorRef.current.style.left = `${e.clientX}px`;
            cursorRef.current.style.top = `${e.clientY}px`;
            const visualDiameter = (brushSize / scaleX) * 2;
            cursorRef.current.style.width = `${visualDiameter}px`;
            cursorRef.current.style.height = `${visualDiameter}px`;
        }

        if (isDrawing && !isSpacePressed.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx && lastDrawPos.current) {
                ctx.strokeStyle = inpaintTool === 'eraser' ? 'black' : 'white';
                ctx.lineWidth = brushSize * 2; 
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(lastDrawPos.current.x, lastDrawPos.current.y);
                ctx.lineTo(x, y);
                ctx.stroke();
                lastDrawPos.current = { x, y };
            }
        }
    };

    const handleCanvasMouseUp = () => {
        isPanningRef.current = false;
        if (isDrawing) {
            setIsDrawing(false);
            saveInpaintHistory();
            lastDrawPos.current = null;
        }
        if (isSpacePressed.current) {
             setCursorMode('grab');
        } else {
             setCursorMode('default');
        }
    };

    // Require login - show landing page if not logged in or if on landing page
    if (currentPage === 'LANDING' || !user) {
        return <LandingPage onNavigate={user ? setCurrentPage : () => {}} t={t} user={user} handleLogout={handleLogout} />;
    }

    const dotCanvasStyle = {
        backgroundImage: 'radial-gradient(circle, #ffffff15 1px, transparent 1px)',
        backgroundSize: '24px 24px'
    };

    const activeGenerationsCount = studioState.generatedBatches.filter(b => b.status === 'loading').length;
    const isQueueFull = activeGenerationsCount >= 2;

    return (
        <div className="dark">
            <div 
                className="bg-[#050505] min-h-screen text-slate-200 font-sans transition-colors duration-300 flex flex-col h-screen overflow-hidden"
                style={dotCanvasStyle}
            >
                <CommonHeader
                    title={currentPage === 'STUDIO' ? t.studio : currentPage === 'EDIT_IMAGE' ? t.edit : currentPage === 'INPAINTING' ? t.inpaint : currentPage === 'LIBRARY' ? t.library : currentPage}
                    current={currentPage}
                    onNavigate={setCurrentPage}
                    isDarkMode={true}
                    toggleTheme={() => {}}
                    lang={lang}
                    toggleLang={() => setLang(lang === 'EN' ? 'KO' : 'EN')}
                    t={t}
                    user={user}
                    authLoading={authLoading}
                    handleLogout={handleLogout}
                />
                
                <main className="flex-1 overflow-hidden relative flex flex-col md:flex-row">
                    {currentPage === 'STUDIO' && (
                        <div className="flex w-full h-full overflow-hidden relative">
                             <button 
                                onClick={() => setIsMobileSettingsOpen(true)}
                                className="md:hidden absolute top-4 left-4 z-30 w-10 h-10 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center animate-in fade-in zoom-in"
                            >
                                <i className="fas fa-sliders-h"></i>
                            </button>

                            {isMobileSettingsOpen && (
                                <div className="fixed inset-0 bg-black/80 z-[60] md:hidden backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsMobileSettingsOpen(false)}></div>
                            )}

                            <div 
                                style={{ width: isMobile ? undefined : sidebarWidth }} 
                                className={`
                                    flex-shrink-0 z-[70] transition-transform duration-300 ease-out
                                    fixed inset-y-0 left-0 h-full w-[85vw] bg-[#0a0a0a] shadow-2xl md:shadow-none md:bg-transparent
                                    md:relative md:h-auto md:w-auto md:translate-x-0
                                    ${isMobileSettingsOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                                `}
                            >
                                <div className="absolute inset-0 md:top-4 md:left-4 md:bottom-8 md:right-2 bg-[#0a0a0a]/95 md:dark:bg-[#0a0a0a]/90 backdrop-blur-xl border-r md:border border-white/10 md:rounded-2xl shadow-xl overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">{t.config}</h3>
                                        <button onClick={() => setIsMobileSettingsOpen(false)} className="md:hidden text-slate-500"><i className="fas fa-times"></i></button>
                                        <div className="hidden md:flex bg-white/10 rounded p-0.5">
                                            <button onClick={() => setStudioState(p => ({...p, currentView: 'FRONT'}))} className={`px-2 py-0.5 text-[9px] font-bold rounded ${studioState.currentView === 'FRONT' ? 'bg-indigo-600 shadow-sm text-white' : 'text-slate-500'}`}>{t.front}</button>
                                            <button onClick={() => setStudioState(p => ({...p, currentView: 'BACK'}))} className={`px-2 py-0.5 text-[9px] font-bold rounded ${studioState.currentView === 'BACK' ? 'bg-indigo-600 shadow-sm text-white' : 'text-slate-500'}`}>{t.back}</button>
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto p-4 custom-scrollbar flex-1">
                                        <div className="mb-4 border-b border-white/5 pb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.seed}</span>
                                                <label className="flex items-center gap-1 cursor-pointer">
                                                    <input type="checkbox" checked={studioState.useRandomSeed} onChange={e => setStudioState(p => ({ ...p, useRandomSeed: e.target.checked }))} className="w-3 h-3 rounded border-white/20 bg-transparent checked:bg-indigo-500" />
                                                    <span className="text-[9px] font-medium text-slate-500">{t.randomize}</span>
                                                </label>
                                            </div>
                                            <input 
                                                type="number" 
                                                value={studioState.seed === -1 ? '' : studioState.seed} 
                                                onChange={e => setStudioState(p => ({ ...p, seed: parseInt(e.target.value) || 0 }))} 
                                                disabled={studioState.useRandomSeed}
                                                placeholder={studioState.useRandomSeed ? "Random" : "Enter Seed"}
                                                className={`w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 font-mono transition-opacity ${studioState.useRandomSeed ? 'opacity-50' : 'opacity-100'}`}
                                            />
                                        </div>

                                        <div className="mb-4 border-b border-white/5 pb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                                    <i className="fas fa-key"></i>
                                                    API Key
                                                </span>
                                            </div>
                                            <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 mb-2">
                                                <div className="text-[10px] text-slate-500 font-mono">{getMaskedApiKey()}</div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setShowApiKeyModal(true)}
                                                    className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[9px] font-bold py-1.5 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                                                >
                                                    <i className="fas fa-edit"></i>
                                                    Change
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (confirm('API 키를 삭제하시겠습니까? 다시 입력해야 앱을 사용할 수 있습니다.')) {
                                                            deleteApiKey();
                                                            setShowApiKeyModal(true);
                                                        }
                                                    }}
                                                    className="flex-1 bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-red-400 text-[9px] font-bold py-1.5 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                    Delete
                                                </button>
                                            </div>
                                        </div>

                                        {optionCategories.map(cat => <SidebarItemSlot key={cat} catConfig={cat} item={null} selectedValue={studioState[cat === Category.GENDER ? 'selectedGender' : cat === Category.FIT ? 'selectedFit' : cat === Category.BACKGROUND ? 'selectedBackground' : 'selectedPose']} isDarkMode={true} onFileSelect={handleStudioFile} onRemoveItem={handleStudioRemove} onLengthChange={() => {}} onOptionChange={(type, val) => setStudioState(p => ({ ...p, [type === 'fit' ? 'selectedFit' : type === 'pose' ? 'selectedPose' : type === 'bg' ? 'selectedBackground' : 'selectedGender']: val }))} layout="option" t={t} />)}

                                        <div className="grid grid-cols-2 gap-x-2 gap-y-6">
                                            {standardCategories.filter(c => c !== Category.MODEL).map(cat => (
                                                <SidebarItemSlot key={cat} catConfig={cat} item={studioState.views[studioState.currentView].items[cat]} isDarkMode={true} onFileSelect={handleStudioFile} onRemoveItem={handleStudioRemove} onLengthChange={(c, l) => setStudioState(p => ({ ...p, views: { ...p.views, [p.currentView]: { ...p.views[p.currentView], items: { ...p.views[p.currentView].items, [c]: { ...p.views[p.currentView].items[c]!, length: l } } } } }))} onOptionChange={() => {}} layout='grid' t={t} />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                
                                <div 
                                    className="hidden md:flex absolute top-4 right-0 bottom-8 w-4 cursor-col-resize z-50 items-center justify-center group hover:bg-indigo-500/5 rounded-r-xl transition-colors"
                                    onMouseDown={startResizing}
                                >
                                    <div className="w-1 h-8 bg-slate-700 rounded-full group-hover:bg-indigo-500 transition-colors"></div>
                                </div>
                            </div>

                            <div className="flex-1 flex flex-col min-w-0 bg-transparent relative w-full h-full">
                                {studioState.error && (
                                    <div className="absolute top-4 left-4 right-4 z-50 p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                                        <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                                            <i className="fas fa-exclamation-triangle text-red-500"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-0.5">Generation Failed</h4>
                                            <p className="text-xs text-red-300/80 whitespace-pre-wrap">{studioState.error}</p>
                                        </div>
                                        <button onClick={() => setStudioState(p => ({...p, error: null}))} className="text-red-400 hover:text-red-200 transition-colors">
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                )}
                                
                                <div className="absolute inset-0 z-0 overflow-y-auto custom-scrollbar bg-[#050505] p-0 pb-40">
                                    {studioState.generatedBatches.length > 0 ? (
                                        <div className="flex flex-col w-full">
                                            {studioState.generatedBatches.map((batch) => (
                                                <div key={batch.id} className="w-full flex flex-wrap border-b border-white/5 last:border-b-0">
                                                    {batch.status === 'loading' ? (
                                                        batch.images.map((_, idx) => (
                                                            <div 
                                                                key={idx} 
                                                                className="relative group w-1/4 border-r border-white/5 last:border-r-0 bg-white/5 flex flex-col items-center justify-center p-4 transition-all"
                                                                style={{ aspectRatio: batch.aspectRatio ? batch.aspectRatio.replace(':', '/') : '3/4' }}
                                                            >
                                                                <div className="w-8 h-8 rounded-full border-2 border-indigo-500/30 border-t-indigo-500 animate-spin mb-3"></div>
                                                                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest animate-pulse">Generating...</span>
                                                                
                                                                <button 
                                                                    onClick={() => handleCancelGeneration(batch.id)}
                                                                    className="mt-4 px-3 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[9px] font-bold uppercase tracking-wider border border-red-500/30 transition-all flex items-center gap-1.5"
                                                                >
                                                                    <i className="fas fa-times"></i> {t.cancel}
                                                                </button>
                                                            </div>
                                                        ))
                                                    ) : batch.status === 'error' ? (
                                                        <div className="w-full p-4 flex flex-col items-center justify-center bg-red-500/5 aspect-[4/1]">
                                                            <i className="fas fa-exclamation-circle text-red-500 text-xl mb-2"></i>
                                                            <p className="text-xs text-red-400">Generation Failed</p>
                                                            <p className="text-[10px] text-red-500/50 mt-1">{batch.errorMsg || "Unknown Error"}</p>
                                                        </div>
                                                    ) : (
                                                        batch.images.map((imgUrl, idx) => {
                                                            const historyItem = history.find(h => h.url === imgUrl);
                                                            return (
                                                                <div 
                                                                    key={idx} 
                                                                    onClick={() => setDetailItem(historyItem || null)} 
                                                                    className="relative group w-1/4 border-r border-white/5 last:border-r-0 shadow-lg hover:border-indigo-500/50 transition-all cursor-pointer min-w-0 bg-black/20 flex items-center justify-center"
                                                                >
                                                                    <img 
                                                                        src={imgUrl} 
                                                                        className="block max-w-full h-auto max-h-[65vh] object-contain mx-auto" 
                                                                    />
                                                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                                                        <button onClick={(e) => { e.stopPropagation(); if(historyItem) toggleLike(historyItem.id); }} className={`w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-colors text-[10px] ${historyItem?.liked ? 'bg-pink-600 text-white' : 'bg-black/50 text-white/70 hover:bg-black/70'}`}><i className="fas fa-heart"></i></button>
                                                                        <button onClick={(e) => handleDownload(e, imgUrl)} className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-colors text-[10px] bg-black/50 text-white/70 hover:text-white hover:bg-black/70"><i className="fas fa-download"></i></button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="h-full w-full flex flex-col items-center justify-center text-slate-500 animate-in fade-in duration-500 min-h-[50vh]">
                                            <i className="fas fa-magic text-4xl mb-4 opacity-20"></i>
                                            <p className="text-xs font-bold uppercase tracking-widest opacity-50">Ready to Generate</p>
                                        </div>
                                    )}
                                </div>

                                <FloatingPromptBar 
                                    prompt={studioState.userPrompt} 
                                    setPrompt={s => setStudioState(p => ({...p, userPrompt: s}))}
                                    onGenerate={generateStudio}
                                    isGenerating={activeGenerationsCount > 0}
                                    disabled={isQueueFull} 
                                    images={studioState.refImages}
                                    setImages={imgs => setStudioState(p => ({...p, refImages: typeof imgs === 'function' ? imgs(p.refImages) : imgs}))}
                                    t={t}
                                    placeholder={t.promptPlaceholder}
                                    isDarkMode={true}
                                    selectedModel={studioState.selectedModel}
                                    setModel={m => setStudioState(p => ({...p, selectedModel: m}))}
                                    selectedRatio={studioState.aspectRatio}
                                    setRatio={r => setStudioState(p => ({...p, aspectRatio: r}))}
                                    selectedSize={studioState.imageSize}
                                    setSize={s => setStudioState(p => ({...p, imageSize: s}))}
                                    numberOfImages={studioState.numberOfImages}
                                    setNumberOfImages={n => setStudioState(p => ({...p, numberOfImages: n}))}
                                />
                            </div>
                        </div>
                    )}
                    
                    {currentPage === 'EDIT_IMAGE' && (
                        <div className="flex w-full h-full overflow-hidden relative">
                             <button onClick={() => setIsMobileSettingsOpen(true)} className="md:hidden absolute top-4 left-4 z-30 w-10 h-10 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center animate-in fade-in zoom-in"><i className="fas fa-sliders-h"></i></button>
                             {isMobileSettingsOpen && (<div className="fixed inset-0 bg-black/80 z-[60] md:hidden backdrop-blur-sm" onClick={() => setIsMobileSettingsOpen(false)}></div>)}
                            <div style={{ width: isMobile ? undefined : sidebarWidth }} className={`flex-shrink-0 z-[70] transition-transform duration-300 ease-out fixed inset-y-0 left-0 h-full w-[85vw] bg-[#0a0a0a] shadow-2xl md:shadow-none md:bg-transparent md:relative md:h-auto md:w-auto md:translate-x-0 ${isMobileSettingsOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
                                <div className="absolute inset-0 md:top-4 md:left-4 md:bottom-8 md:right-2 bg-[#0a0a0a]/95 backdrop-blur-xl border-r md:border border-white/10 md:rounded-2xl shadow-xl overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">{t.parameters}</h3>
                                        <button onClick={() => setIsMobileSettingsOpen(false)} className="md:hidden text-slate-500"><i className="fas fa-times"></i></button>
                                    </div>
                                    <div className="overflow-y-auto p-4 custom-scrollbar flex-1">
                                        <div className="mb-4 border-b border-white/5 pb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.seed}</span>
                                                <label className="flex items-center gap-1 cursor-pointer">
                                                    <input type="checkbox" checked={studioState.useRandomSeed} onChange={e => setStudioState(p => ({ ...p, useRandomSeed: e.target.checked }))} className="w-3 h-3 rounded border-white/20 bg-transparent checked:bg-indigo-500" />
                                                    <span className="text-[9px] font-medium text-slate-500">{t.randomize}</span>
                                                </label>
                                            </div>
                                            <input type="number" value={studioState.seed === -1 ? '' : studioState.seed} onChange={e => setStudioState(p => ({ ...p, seed: parseInt(e.target.value) || 0 }))} disabled={studioState.useRandomSeed} placeholder={studioState.useRandomSeed ? "Random" : "Enter Seed"} className={`w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 font-mono transition-opacity ${studioState.useRandomSeed ? 'opacity-50' : 'opacity-100'}`} />
                                        </div>
                                        <CubeVisualizer rotation={editParams.rotation} tilt={editParams.tilt} zoom={editParams.zoom} onChange={(r, ti) => setEditParams(p => ({ ...p, rotation: r, tilt: ti }))} />
                                        <div className="space-y-6 mb-6">
                                            <div><label className="text-[9px] font-bold uppercase text-slate-500 mb-2 block">{t.zoom}</label><input type="range" min="-50" max="100" value={editParams.zoom} onChange={e => setEditParams(p => ({ ...p, zoom: parseInt(e.target.value) }))} className="w-full accent-indigo-500" /></div>
                                            <div><label className="text-[9px] font-bold uppercase text-slate-500 mb-2 block">{t.lighting}</label><input type="range" min="0" max="100" value={editParams.lighting} onChange={e => setEditParams(p => ({ ...p, lighting: parseInt(e.target.value) }))} className="w-full accent-yellow-500" /></div>
                                            <div><label className="text-[9px] font-bold uppercase text-slate-500 mb-2 block">{t.shadows}</label><input type="range" min="0" max="100" value={editParams.shadow} onChange={e => setEditParams(p => ({ ...p, shadow: parseInt(e.target.value) }))} className="w-full accent-slate-500" /></div>
                                        </div>
                                    </div>
                                </div>
                                <div className="hidden md:flex absolute top-4 right-0 bottom-8 w-4 cursor-col-resize z-50 items-center justify-center group hover:bg-indigo-500/5 rounded-r-xl transition-colors" onMouseDown={startResizing}><div className="w-1 h-8 bg-slate-700 rounded-full group-hover:bg-indigo-500 transition-colors"></div></div>
                            </div>
                             <div className="flex-1 flex flex-col min-w-0 bg-transparent relative w-full h-full">
                                <div className="absolute inset-0 z-0">
                                    {!editImage ? (
                                        <DropZone onFileSelect={setEditImage} label={t.uploadTitle} isDarkMode={true} variant="fullscreen" className="w-full h-full pb-20" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center p-6 pb-40">
                                            <div className="relative w-full h-full flex items-center justify-center">
                                                <img src={editResult || editImage} className="max-h-full max-w-full rounded-lg shadow-2xl object-contain" />
                                                {isEditing && <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg"><i className="fas fa-circle-notch fa-spin text-white text-3xl"></i></div>}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <FloatingPromptBar prompt={editPrompt} setPrompt={setEditPrompt} onGenerate={runEdit} isGenerating={isEditing} disabled={!editImage} images={editRefImages} setImages={setEditRefImages} t={t} placeholder={t.editPromptPlaceholder} isDarkMode={true} selectedModel={studioState.selectedModel} setModel={m => setStudioState(p => ({...p, selectedModel: m}))} selectedRatio={studioState.aspectRatio} setRatio={r => setStudioState(p => ({...p, aspectRatio: r}))} selectedSize={studioState.imageSize} setSize={s => setStudioState(p => ({...p, imageSize: s}))} />
                             </div>
                        </div>
                    )}

                    {currentPage === 'INPAINTING' && (
                        <div className="flex w-full h-full overflow-hidden relative">
                             <button onClick={() => setIsMobileSettingsOpen(true)} className="md:hidden absolute top-4 left-4 z-30 w-10 h-10 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center animate-in fade-in zoom-in"><i className="fas fa-sliders-h"></i></button>
                             {isMobileSettingsOpen && (<div className="fixed inset-0 bg-black/80 z-[60] md:hidden backdrop-blur-sm" onClick={() => setIsMobileSettingsOpen(false)}></div>)}
                            <div style={{ width: isMobile ? undefined : sidebarWidth }} className={`flex-shrink-0 z-[70] transition-transform duration-300 ease-out fixed inset-y-0 left-0 h-full w-[85vw] bg-[#0a0a0a] shadow-2xl md:shadow-none md:bg-transparent md:relative md:h-auto md:w-auto md:translate-x-0 ${isMobileSettingsOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
                                <div className="absolute inset-0 md:top-4 md:left-4 md:bottom-8 md:right-2 bg-[#0a0a0a]/95 backdrop-blur-xl border-r md:border border-white/10 md:rounded-2xl shadow-xl overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">{t.maskTools}</h3>
                                        <button onClick={() => setIsMobileSettingsOpen(false)} className="md:hidden text-slate-500"><i className="fas fa-times"></i></button>
                                    </div>
                                    <div className="overflow-y-auto p-4 custom-scrollbar flex-1">
                                        <div className="mb-4 border-b border-white/5 pb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{t.seed}</span>
                                                <label className="flex items-center gap-1 cursor-pointer">
                                                    <input type="checkbox" checked={studioState.useRandomSeed} onChange={e => setStudioState(p => ({ ...p, useRandomSeed: e.target.checked }))} className="w-3 h-3 rounded border-white/20 bg-transparent checked:bg-indigo-500" />
                                                    <span className="text-[9px] font-medium text-slate-500">{t.randomize}</span>
                                                </label>
                                            </div>
                                            <input type="number" value={studioState.seed === -1 ? '' : studioState.seed} onChange={e => setStudioState(p => ({ ...p, seed: parseInt(e.target.value) || 0 }))} disabled={studioState.useRandomSeed} placeholder={studioState.useRandomSeed ? "Random" : "Enter Seed"} className={`w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-slate-300 font-mono transition-opacity ${studioState.useRandomSeed ? 'opacity-50' : 'opacity-100'}`} />
                                        </div>
                                        <div className="mb-6"><label className="text-[9px] font-bold uppercase text-slate-500 mb-2 block">{t.brushSize}</label><div className="flex items-center gap-3"><input type="range" min="5" max="100" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="flex-1 accent-pink-500" /><span className="text-xs font-mono w-8 text-right text-slate-400">{brushSize}px</span></div></div>
                                        <div className="grid grid-cols-2 gap-2 mb-6">
                                            <button onClick={() => setInpaintTool('brush')} className={`py-3 rounded-lg text-xs font-bold uppercase transition-all flex flex-col items-center gap-1 ${inpaintTool === 'brush' ? 'bg-pink-600 text-white shadow-lg shadow-pink-500/30' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}><i className="fas fa-paint-brush"></i> {t.brush}</button>
                                            <button onClick={() => setInpaintTool('eraser')} className={`py-3 rounded-lg text-xs font-bold uppercase transition-all flex flex-col items-center gap-1 ${inpaintTool === 'eraser' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-white/5 text-slate-500 hover:bg-white/10'}`}><i className="fas fa-eraser"></i> {t.eraser}</button>
                                        </div>
                                        <button onClick={() => { setInpaintResult(null); const ctx = canvasRef.current?.getContext('2d'); if(ctx && canvasRef.current) { ctx.fillStyle='black'; ctx.fillRect(0,0,canvasRef.current.width, canvasRef.current.height); saveInpaintHistory(); } }} className="w-full py-2 mb-6 bg-white/10 hover:bg-white/20 text-slate-300 rounded-lg text-xs font-bold uppercase transition-colors">{t.clearMask}</button>
                                    </div>
                                </div>
                                <div className="hidden md:flex absolute top-4 right-0 bottom-8 w-4 cursor-col-resize z-50 items-center justify-center group hover:bg-indigo-500/5 rounded-r-xl transition-colors" onMouseDown={startResizing}><div className="w-1 h-8 bg-slate-700 rounded-full group-hover:bg-indigo-500 transition-colors"></div></div>
                            </div>
                            <div className="flex-1 flex flex-col min-w-0 bg-transparent relative w-full h-full select-none overflow-hidden" onWheel={handleCanvasContainerWheel} onMouseDown={handleCanvasMouseDown} onMouseMove={handleCanvasMouseMove} onMouseUp={handleCanvasMouseUp} onMouseLeave={handleCanvasMouseUp} style={{ cursor: cursorMode, touchAction: 'none' }}>
                                <div className="absolute inset-0 z-0 flex items-center justify-center">
                                    {!inpaintBase ? (
                                        <DropZone onFileSelect={(b) => setInpaintBase(b)} label={t.uploadTitle} isDarkMode={true} variant="fullscreen" className="w-full h-full pb-20 !cursor-default" />
                                    ) : (
                                        <div className="relative w-full h-full flex items-center justify-center p-6 pb-40 overflow-hidden">
                                            <div style={{ transform: `translate(${canvasTransform.x}px, ${canvasTransform.y}px) scale(${canvasTransform.scale})`, transformOrigin: 'center', transition: isPanningRef.current ? 'none' : 'transform 0.1s ease-out' }} className="relative shadow-2xl">
                                                <img ref={imgRef} src={inpaintResult || inpaintBase} onLoad={handleImageLoad} className="pointer-events-none select-none max-w-none" style={{ display: 'block', maxHeight: '80vh', maxWidth: '80vw' }} />
                                                <canvas ref={canvasRef} className="absolute inset-0 touch-none" style={{ mixBlendMode: 'screen', opacity: 0.6 }} />
                                            </div>
                                            {inpaintBase && !inpaintResult && !isSpacePressed.current && (<div ref={cursorRef} className="fixed pointer-events-none rounded-full border border-white bg-white/20 z-[100] -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(0,0,0,0.5)]" style={{ width: brushSize, height: brushSize }} />)}
                                            {isInpainting && <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-[50] rounded-lg"><i className="fas fa-circle-notch fa-spin text-white text-3xl"></i></div>}
                                        </div>
                                    )}
                                </div>
                                <FloatingPromptBar prompt={inpaintPrompt} setPrompt={setInpaintPrompt} onGenerate={runInpaint} isGenerating={isInpainting} disabled={!inpaintBase} images={inpaintRefImages} setImages={setInpaintRefImages} t={t} placeholder={t.inpaintPromptPlaceholder} isDarkMode={true} selectedModel={studioState.selectedModel} setModel={m => setStudioState(p => ({...p, selectedModel: m}))} selectedRatio={studioState.aspectRatio} setRatio={r => setStudioState(p => ({...p, aspectRatio: r}))} selectedSize={studioState.imageSize} setSize={s => setStudioState(p => ({...p, imageSize: s}))} />
                            </div>
                        </div>
                    )}

                    {currentPage === 'LIBRARY' && (
                        <div className="w-full h-full overflow-y-auto custom-scrollbar p-0 pt-4 pb-10">
                            <div className="flex flex-wrap content-start">
                                {history.map(item => (
                                    <div key={item.id} onClick={() => setDetailItem(item)} className="relative group overflow-hidden bg-black/20 border border-white/5 shadow-lg hover:border-indigo-500/50 transition-all cursor-pointer w-1/2 md:w-1/4 aspect-[3/4]">
                                        <img src={item.url} className="w-full h-full object-cover" loading="lazy" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                                            <span className="text-[10px] text-white font-bold uppercase tracking-wider mb-1">{item.type}</span>
                                            {item.metadata?.prompt && (
                                                <span className="text-[8px] text-slate-300 mb-1 line-clamp-2">{item.metadata.prompt}</span>
                                            )}
                                            <span className="text-[8px] text-slate-400 font-mono">{new Date(item.date).toLocaleDateString()}</span>
                                        </div>
                                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={(e) => { e.stopPropagation(); toggleLike(item.id); }} className={`w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-all text-[10px] ${item.liked ? 'bg-pink-600 text-white' : 'bg-black/50 text-white/50 hover:text-white hover:bg-black/70'}`}><i className="fas fa-heart"></i></button>
                                            <button onClick={(e) => handleDownload(e, item.url)} className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-all text-[10px] bg-black/50 text-white/50 hover:text-white hover:bg-black/70"><i className="fas fa-download"></i></button>
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    if (!confirm('이미지를 삭제하시겠습니까? Google Drive에서도 삭제됩니다.')) {
                                                        return;
                                                    }
                                                    // Remove from local history
                                                    setHistory(prev => prev.filter(h => h.id !== item.id));
                                                    // Remove from Drive if exists
                                                    try {
                                                        await deleteImageFromDrive(item.id);
                                                    } catch (error) {
                                                        console.error('Failed to delete from Drive:', error);
                                                    }
                                                }}
                                                className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-all text-[10px] bg-black/50 text-white/50 hover:text-white hover:bg-red-600"
                                                title="삭제"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {history.length === 0 && (
                                    <div className="w-full h-96 flex flex-col items-center justify-center text-slate-500 opacity-50">
                                        <i className="fas fa-images text-4xl mb-4"></i>
                                        <p className="text-sm font-bold uppercase tracking-widest">생성된 이미지가 없습니다</p>
                                        <p className="text-xs mt-2">Studio, Edit, Inpaint에서 이미지를 생성해보세요</p>
                                        <p className="text-xs text-indigo-400 mt-1">모든 이미지는 자동으로 Google Drive에 저장됩니다</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
                {detailItem && (<DetailModal item={detailItem} onClose={() => setDetailItem(null)} onUseImage={handleReuse} onEditImage={handleRouteToEdit} onInpaintImage={handleRouteToInpaint} onToggleLike={toggleLike} t={t} />)}
                {showZoom && <ImageModal src={showZoom} onClose={() => setShowZoom(null)} />}
                {showApiKeyModal && <ApiKeyModal onSave={handleApiKeySave} isDarkMode={true} />}
            </div>
        </div>
    );
};
