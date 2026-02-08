
import React, { useState, useCallback } from 'react';

interface DropZoneProps {
  onFileSelect: (base64: string) => void;
  label: string;
  currentImage?: string | null;
  className?: string;
  isDarkMode?: boolean;
  imageFit?: 'cover' | 'contain';
  compact?: boolean;
  multiple?: boolean;
  variant?: 'normal' | 'fullscreen';
}

const DropZone: React.FC<DropZoneProps> = ({ 
  onFileSelect, 
  label, 
  currentImage, 
  className = "", 
  isDarkMode = false,
  imageFit = 'cover',
  compact = false,
  multiple = false,
  variant = 'normal'
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        onFileSelect(e.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      if (multiple) {
        Array.from(files).forEach(processFile);
      } else {
        processFile(files[0]);
      }
    }
  }, [onFileSelect, multiple]);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      if (multiple) {
        Array.from(files).forEach(processFile);
      } else {
        processFile(files[0]);
      }
    }
  };

  // Determine styles based on variant and state
  const baseStyle = "relative group cursor-pointer border border-dashed transition-all duration-700 flex flex-col items-center justify-center overflow-hidden";
  
  let stateClasses = "";
  if (isDragging) {
      stateClasses = `border-indigo-500 bg-indigo-500/10 z-50 ${variant === 'fullscreen' ? 'scale-100' : 'scale-105 shadow-[0_20px_50px_rgba(79,70,229,0.2)]'}`;
  } else {
      if (variant === 'fullscreen') {
          stateClasses = "border-transparent bg-transparent";
      } else {
          stateClasses = isDarkMode 
            ? 'border-slate-800 bg-slate-900/60 hover:border-indigo-500/60 hover:bg-slate-800/80 shadow-inner' 
            : 'border-slate-200 bg-white/60 hover:border-indigo-400/60 hover:bg-indigo-50/50 shadow-sm';
      }
  }

  return (
    <div
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`${baseStyle} ${stateClasses} ${className}`}
    >
      <input
        type="file"
        className="absolute inset-0 opacity-0 cursor-pointer z-10"
        onChange={handleInput}
        accept="image/*"
        multiple={multiple}
      />
      
      {currentImage ? (
        <div className="w-full h-full relative flex items-center justify-center animate-in zoom-in-95 duration-500">
          <img 
            src={currentImage} 
            alt="Preview" 
            className={`w-full h-full ${imageFit === 'contain' ? 'object-contain p-3' : 'object-cover'} rounded-[inherit] drop-shadow-sm`} 
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-all duration-300 rounded-[inherit] backdrop-blur-[2px]">
            <i className="fas fa-pen text-white text-lg mb-1"></i>
            <span className="text-white text-[8px] font-bold uppercase tracking-widest">Edit</span>
          </div>
        </div>
      ) : (
        <div className={`flex flex-col items-center justify-center w-full h-full text-center transition-all duration-300 group-hover:-translate-y-0.5 ${compact ? 'p-0' : 'p-2'}`}>
          <i className={`fas fa-plus transition-colors duration-300 
            ${compact ? 'text-xs' : 'text-lg md:text-xl mb-2 md:mb-3'} 
            ${isDarkMode ? 'text-slate-700 group-hover:text-slate-400' : 'text-slate-300 group-hover:text-indigo-400'}`}>
          </i>
          {label && label !== '+' && (
            <p className={`font-bold uppercase tracking-[0.2em] transition-colors duration-300 
              ${compact ? 'text-[6px] mt-0.5' : 'text-[7px] md:text-[8px]'} 
              ${isDarkMode ? 'text-slate-600 group-hover:text-slate-400' : 'text-slate-400 group-hover:text-indigo-500'}`}>
              {label}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default DropZone;
