
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Category, ClothingItem, AspectRatio, StylePreset, ViewType, ImageSize, FitType, PoseType, BackgroundType, GenderType } from "../types";
import { getApiKey } from "./apiKeyStorage";

// --- Helpers ---

// MIME Type detection
const getMimeType = (base64: string) => {
  const match = base64.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,/);
  return match ? match[1] : 'image/png';
};

// Image Optimization (Resize & Compress) to prevent Payload Too Large errors
const optimizeImage = (base64Str: string, maxWidth = 1024): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Resize logic
      if (width > maxWidth || height > maxWidth) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Preserve original format if possible, otherwise PNG. Compress to 0.85 quality.
        const mime = getMimeType(base64Str);
        // Note: toDataURL quality argument only works for image/jpeg and image/webp
        resolve(canvas.toDataURL(mime, 0.85));
      } else {
        // Fallback: return original if canvas context fails
        resolve(base64Str);
      }
    };
    img.onerror = () => {
        // Fallback: return original if loading fails
        console.warn("Image optimization failed, using original.");
        resolve(base64Str);
    };
  });
};

// Binarize mask: threshold each pixel to pure black or white
// Ensures semi-transparent or grey brush strokes become solid for the API
export const binarizeMask = (maskBase64: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(maskBase64); return; }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
        const val = brightness > 64 ? 255 : 0; // threshold at 25%
        data[i] = val; data[i + 1] = val; data[i + 2] = val; data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(maskBase64);
    img.src = maskBase64;
  });
};

// Apply zoom via canvas transform
const applyZoom = (base64: string, zoom: number): Promise<string> => {
  if (zoom === 0) return Promise.resolve(base64);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64); return; }
      ctx.save();
      ctx.translate(w / 2, h / 2);
      const scale = zoom > 0 ? 1 + zoom / 100 : 1 / (1 + Math.abs(zoom) / 100);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(base64);
    img.src = base64;
  });
};

// Create a single image with mask area highlighted (red/pink tint overlay)
// More reliable for Gemini than sending two separate images
const createMaskedPreview = (originalBase64: string, maskBase64: string): Promise<string> => {
  return new Promise((resolve) => {
    let loaded = 0;
    const origImg = new Image();
    const maskImg = new Image();
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      const w = origImg.naturalWidth || origImg.width;
      const h = origImg.naturalHeight || origImg.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(originalBase64); return; }
      // Draw original
      ctx.drawImage(origImg, 0, 0, w, h);
      // Draw mask as red/pink overlay where mask is white
      ctx.drawImage(maskImg, 0, 0, w, h);
      const maskData = ctx.getImageData(0, 0, w, h);
      ctx.drawImage(origImg, 0, 0, w, h);
      const origData = ctx.getImageData(0, 0, w, h);
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < out.data.length; i += 4) {
        const m = maskData.data[i] / 255;
        if (m > 0.1) {
          // Red/magenta tint on masked area
          out.data[i]     = Math.min(255, origData.data[i] * 0.5 + 200 * m);
          out.data[i + 1] = Math.round(origData.data[i + 1] * (1 - m * 0.7));
          out.data[i + 2] = Math.round(origData.data[i + 2] * (1 - m * 0.7));
          out.data[i + 3] = 255;
        } else {
          out.data[i]     = origData.data[i];
          out.data[i + 1] = origData.data[i + 1];
          out.data[i + 2] = origData.data[i + 2];
          out.data[i + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    origImg.onload = onLoad;
    maskImg.onload = onLoad;
    origImg.onerror = () => resolve(originalBase64);
    maskImg.onerror = () => resolve(originalBase64);
    origImg.src = originalBase64;
    maskImg.src = maskBase64;
  });
};

// Detect aspect ratio from base64 image dimensions
const detectAspectRatio = (base64: string): Promise<AspectRatio> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) { resolve("1:1"); return; }
      const ratio = w / h;
      const ratios: { value: AspectRatio; r: number }[] = [
        { value: "1:1",  r: 1 },
        { value: "4:3",  r: 4/3 },
        { value: "16:9", r: 16/9 },
        { value: "21:9", r: 21/9 },
        { value: "5:4",  r: 5/4 },
        { value: "3:2",  r: 3/2 },
        { value: "2:3",  r: 2/3 },
        { value: "9:16", r: 9/16 },
        { value: "3:4",  r: 3/4 },
        { value: "4:5",  r: 4/5 },
      ];
      let closest = ratios[0];
      let minDiff = Math.abs(ratio - ratios[0].r);
      for (const entry of ratios) {
        const diff = Math.abs(ratio - entry.r);
        if (diff < minDiff) { minDiff = diff; closest = entry; }
      }
      resolve(closest.value);
    };
    img.onerror = () => resolve("1:1");
    img.src = base64;
  });
};

// --- API Client Setup ---

const getGenAI = () => {
  let apiKey = '';

  // 1. PRIORITY: Check localStorage (user's personal API key)
  try {
    const storedKey = getApiKey();
    if (storedKey && storedKey.trim()) {
      apiKey = storedKey.trim();
    }
  } catch (e) {
    console.warn('Failed to read API key from localStorage:', e);
  }

  // 2. Fallback: Check import.meta.env (Vite standard)
  if (!apiKey) {
    try {
      // @ts-ignore
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        // @ts-ignore
        apiKey = import.meta.env.VITE_API_KEY || import.meta.env.API_KEY || '';
      }
    } catch (e) { }
  }

  // 3. Fallback: Check process.env (Node/CRA/Webpack standard)
  if (!apiKey) {
    try {
      // @ts-ignore
      if (typeof process !== 'undefined' && process.env) {
        // @ts-ignore
        apiKey = process.env.VITE_API_KEY ||
                 process.env.REACT_APP_API_KEY ||
                 process.env.NEXT_PUBLIC_API_KEY ||
                 process.env.API_KEY || '';
      }
    } catch (e) { }
  }

  // Strict check
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
        "⚠️ API 키가 설정되지 않았습니다.\n\n" +
        "앱 설정에서 Gemini API 키를 입력해주세요."
    );
  }

  try {
    return new GoogleGenAI({ apiKey });
  } catch (e: any) {
    if (e.message && (e.message.includes("API Key") || e.message.includes("Must be set"))) {
        throw new Error("⚠️ API Key 오류: 키가 유효하지 않거나 비어있습니다.");
    }
    throw e;
  }
};

// Helper: Retry logic
async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const message = (error.message || JSON.stringify(error)).toLowerCase();
    
    // Handle 'Load failed' specifically (Network/CORS/Size issue)
    if (message.includes('load failed') || message.includes('fetch failed')) {
        throw new Error("네트워크 전송 실패: 이미지 용량이 너무 크거나 인터넷 연결 문제입니다. (자동 최적화 적용됨)");
    }

    let isRetryable = error.status === 503 || error.code === 503 || message.includes('overloaded') || message.includes('503');
    
    if (isRetryable && retries > 0) {
      console.warn(`Transient error (503). Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

// Helper: Generate Random Seed if not provided
const resolveSeed = (seed?: number): number => {
    if (seed !== undefined && seed !== -1) return seed;
    // Generate a secure random integer between 0 and 2,147,483,647 (Java int32 max, usually safe for APIs)
    return Math.floor(Math.random() * 2147483647);
};

// --- Main Functions ---

export const generateFittingImage = async (
  modelBase64: string | null,
  selectedItems: Partial<Record<Category, ClothingItem>>,
  aspectRatio: AspectRatio = "3:4",
  stylePreset: StylePreset = "Studio",
  view: ViewType = 'FRONT',
  imageSize: ImageSize = "1K",
  userPrompt: string = "",
  refImages: string[] = [],
  options: {
    fit: FitType;
    pose: PoseType;
    background: BackgroundType;
    gender: GenderType;
  },
  modelId: string,
  seed?: number,
  numberOfImages: number = 1,
  signal?: AbortSignal // Added Signal
): Promise<{ imageUrls: string[], seeds: number[] }> => {
  const ai = getGenAI();
  const baseSeed = resolveSeed(seed);
  
  // Check signal immediately
  if (signal?.aborted) throw new Error("Cancelled");

  const parts = [];
  let inputMappingDescription = "";
  let currentIndex = 1;
  
  // 1. Model Image
  let modelIndexStr = "GENERATED MODEL";
  if (modelBase64) {
    const optimizedModel = await optimizeImage(modelBase64);
    parts.push({
      inlineData: {
        data: optimizedModel.split(',')[1],
        mimeType: getMimeType(optimizedModel)
      }
    });
    inputMappingDescription += `- IMAGE ${currentIndex}: **MASTER IDENTITY SOURCE (FACE)**. \n   **CRITICAL INSTRUCTION**: This image is likely a **FACE CLOSE-UP** or **HEADSHOT**. You MUST **GENERATE THE FULL BODY** (Neck, Torso, Arms, Legs, Feet) downwards. Do NOT just crop the face. The goal is to show a full outfit on this person.\n`;
    modelIndexStr = `IMAGE ${currentIndex}`;
    currentIndex++;
  } else if (refImages.length > 0) {
    inputMappingDescription += `- NO DEDICATED MODEL SLOT USED. The user has provided Reference Images. \n`;
    modelIndexStr = "THE PERSON FROM REFERENCE IMAGES";
  } else {
    inputMappingDescription += `- NO TARGET MODEL PROVIDED. Generate a realistic ${options.gender} model fitting the clothing.\n`;
  }

  // 2. Clothing Items (Processing concurrently for optimization)
  const configCategories = [
      Category.BACKGROUND, Category.POSE, Category.FIT, Category.GENDER, 
      Category.MODEL, Category.MODEL_AURORA, Category.MODEL_ORION
  ];
  const clothingIndices: number[] = [];

  const clothingEntries = Object.entries(selectedItems).filter(([category, item]) => 
    item && item.imageUrl && !configCategories.includes(category as Category)
  );

  for (const [category, item] of clothingEntries) {
     if (item && item.imageUrl) {
        const optimizedItem = await optimizeImage(item.imageUrl);
        parts.push({
            inlineData: {
              data: optimizedItem.split(',')[1],
              mimeType: getMimeType(optimizedItem)
            }
        });
        
        let itemDesc = `${item.name} (${category})`;
        if (item.length) itemDesc += ` - Length: ${item.length}`;
        
        inputMappingDescription += `- IMAGE ${currentIndex}: **CLOTHING ITEM (${category})**. \n   **INSTRUCTION**: Extract ONLY the clothing. **IGNORE THE FACE** of the model wearing this clothing. Do not let the clothing model's identity bleed into the target.\n`;
        clothingIndices.push(currentIndex);
        currentIndex++;
     }
  }

  // 3. Reference Images
  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
       const optimizedRef = await optimizeImage(ref);
       parts.push({
        inlineData: {
          data: optimizedRef.split(',')[1],
          mimeType: getMimeType(optimizedRef)
        }
      });
      
      if (modelBase64) {
        inputMappingDescription += `- IMAGE ${currentIndex}: **STYLE/POSE REFERENCE ONLY**. Do NOT use the person/identity from this image. Ignore the face in this image. Use only for lighting, mood, or pose reference.\n`;
      } else {
        inputMappingDescription += `- IMAGE ${currentIndex}: **REFERENCE**. If this image contains a clear human subject, treat them as the **TARGET MODEL** (preserve identity). If no person is present, use as style reference.\n`;
      }
      currentIndex++;
    }
  }

  // Check signal before generation
  if (signal?.aborted) throw new Error("Cancelled");

  const viewInstruction = view === 'FRONT' 
    ? "FULL FRONT VIEW: The model is facing the camera." 
    : "FULL REAR VIEW: The model is facing away from the camera. Show back details of clothing.";

  const prompt = `
    [ROLE: MASTER IMAGE COMPOSITOR & FASHION PHOTOGRAPHER]
    
    TASK: Virtual Try-On with **GENERATIVE BODY EXTENSION (OUTPAINTING)**.
    
    *** INPUT MAPPING (STRICT) ***
    ${inputMappingDescription}
    ******************************
    
    **CRITICAL EXECUTION RULES:**
    
    1. **FACE-TO-FULL-BODY GENERATION (HIGHEST PRIORITY)**: 
       - If Image 1 is a face/headshot, you **MUST GENERATE** the rest of the body to fit the requested pose (${options.pose}).
       - **EXTEND THE CANVAS**: Create a neck, shoulders, torso, arms, legs, and feet.
       - **SKIN MATCHING**: The generated body skin tone must **EXACTLY MATCH** the face in Image 1.
       - **NO CLOSE-UPS**: The final output must be a wide shot (Full Body or 3/4 Body) to show the full outfit, even if the input was just a face.
    
    2. **CLOTHING APPLICATION**:
       - Dress the generated body in the items from Images ${clothingIndices.join(', ')}.
       - Fit Type: ${options.fit}.
       - Ensure fabric physics are realistic (drape, wrinkles, weight).
       
    3. **ENVIRONMENT & LIGHTING**:
       - Background: ${options.background}.
       - Lighting: Global Illumination matching the background. 
       - Shadows: Realistic contact shadows for the feet/shoes.
       
    4. **COMPOSITION**:
       - Aspect Ratio: ${aspectRatio}.
       - View: ${viewInstruction}.
       - Style: ${stylePreset}.
    
    USER PROMPT: ${userPrompt ? userPrompt : "None"}
    
    OUTPUT:
    - 8K Photorealistic.
    - Seamless integration of the provided face with the generated body and clothes.
  `;

  parts.push({ text: prompt });

  const generatedImages: string[] = [];
  const generatedSeeds: number[] = [];

  // Execute parallel requests for multiple images
  const generationPromises = Array.from({ length: numberOfImages }).map(async (_, index) => {
    // Check signal inside loop
    if (signal?.aborted) return null;

    const currentSeed = baseSeed + index; 
    
    try {
        const response = await retryOperation(() => ai.models.generateContent({
        model: modelId || 'gemini-3-pro-image-preview',
        contents: { parts },
        config: {
            seed: currentSeed,
            imageConfig: {
            aspectRatio: aspectRatio,
            imageSize: imageSize
            }
        }
        })) as GenerateContentResponse;

        if (signal?.aborted) return null;

        const candidate = response.candidates?.[0];
        if (candidate && candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
                if (part.inlineData) {
                    return { 
                        img: `data:image/png;base64,${part.inlineData.data}`,
                        seed: currentSeed 
                    };
                }
            }
        }
        return null;
    } catch (e) {
        if (signal?.aborted) return null;
        console.error(`Generation failed for image ${index + 1}:`, e);
        return null;
    }
  });

  const results = await Promise.all(generationPromises);
  
  if (signal?.aborted) throw new Error("Cancelled");

  results.forEach(res => {
      if (res) {
          generatedImages.push(res.img);
          generatedSeeds.push(res.seed);
      }
  });

  if (generatedImages.length === 0) throw new Error("이미지 생성에 실패했습니다. (응답 데이터 없음)");
  return { imageUrls: generatedImages, seeds: generatedSeeds };
};

export const generateEditedImage = async (
  imageBase64: string,
  params: {
    zoom: number;
    lighting: number;
    shadow: number;
    relighting: boolean;
  },
  userPrompt: string = "",
  refImages: string[] = [],
  aspectRatio: AspectRatio = "1:1",
  modelId: string,
  seed?: number
): Promise<{ imageUrl: string, seed: number }> => {
  const ai = getGenAI();
  const finalSeed = resolveSeed(seed);
  const detectedAspectRatio = await detectAspectRatio(imageBase64);
  // Apply zoom via canvas
  const zoomedBase = await applyZoom(imageBase64, params.zoom);
  const optimizedBase = await optimizeImage(zoomedBase);

  const parts: any[] = [
    {
      inlineData: {
        data: optimizedBase.split(',')[1],
        mimeType: getMimeType(optimizedBase)
      }
    }
  ];

  let inputMap = "- IMAGE 1: **TARGET IMAGE** to edit.\n";
  let currentIndex = 2;

  // Add Reference Images
  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
       const optimizedRef = await optimizeImage(ref);
       parts.push({
        inlineData: {
          data: optimizedRef.split(',')[1],
          mimeType: getMimeType(optimizedRef)
        }
      });
      inputMap += `- IMAGE ${currentIndex}: **STYLE/LIGHTING REFERENCE**. Use this for atmosphere/vibe. Do NOT copy subject identity.\n`;
      currentIndex++;
    }
  }

  const lightingDesc = params.lighting < 30 ? "Low-key, dark and moody" : params.lighting > 70 ? "High-key, bright and airy" : "Balanced neutral";
  const shadowDesc = params.shadow < 30 ? "Soft and diffused" : params.shadow > 70 ? "Hard and dramatic" : "Natural";

  const lightingChanged = params.lighting !== 50;
  const shadowChanged = params.shadow !== 50;
  const hasChanges = lightingChanged || shadowChanged || params.relighting || userPrompt.trim();

  const prompt = `Edit this fashion photo.

${inputMap}

Changes to apply:
${lightingChanged ? `- Lighting: ${lightingDesc}` : ''}
${shadowChanged ? `- Shadows: ${shadowDesc}` : ''}
${params.relighting ? '- Apply professional studio relighting' : ''}
${userPrompt.trim() ? `- ${userPrompt}` : ''}

${hasChanges ? 'Make changes clearly visible.' : 'Enhance quality.'}
Preserve identity and clothing. Output the complete image.`;

  parts.push({ text: prompt });

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: modelId || 'gemini-3-pro-image-preview',
      contents: { parts },
      config: {
        seed: finalSeed,
        imageConfig: {
          aspectRatio: detectedAspectRatio,
        }
      }
    })) as GenerateContentResponse;

    let resultBase64 = '';
    const candidate = response.candidates?.[0];
    if (candidate && candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          resultBase64 = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!resultBase64) throw new Error("Image editing failed. Please try again.");
    return { imageUrl: resultBase64, seed: finalSeed };
  } catch (error: any) {
    console.error("Gemini Edit Error:", error);
    throw error;
  }
};

// --- Mask-based inpainting with crop+composite approach ---
// 1. Find mask bounding box
// 2. Crop that region with padding
// 3. Send cropped region to Gemini
// 4. Composite result back using mask as alpha
export const generateMaskedInpaint = async (
  originalBase64: string,
  maskBase64: string, // White = area to edit, Black = keep
  editPrompt: string,
  refImages: string[] = [],
  modelId: string,
  seed?: number
): Promise<{ imageUrl: string, seed: number }> => {
  const ai = getGenAI();
  const finalSeed = resolveSeed(seed);

  // Helper: Load image as ImageData
  const loadImageData = (base64: string): Promise<{ data: ImageData, width: number, height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        resolve({ data: ctx.getImageData(0, 0, img.width, img.height), width: img.width, height: img.height });
      };
      img.src = base64;
    });
  };

  // Find bounding box of white pixels in mask
  const findMaskBounds = (maskData: ImageData): { x: number, y: number, w: number, h: number } | null => {
    const { data, width, height } = maskData;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    let hasMask = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        // Check if pixel is white (or close to white) - mask area
        if (data[idx] > 128 || data[idx + 1] > 128 || data[idx + 2] > 128) {
          hasMask = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!hasMask) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  };

  // Load original and mask
  const [original, mask] = await Promise.all([
    loadImageData(originalBase64),
    loadImageData(maskBase64)
  ]);

  // Find mask bounds
  const bounds = findMaskBounds(mask.data);
  if (!bounds) {
    throw new Error('마스크 영역이 없습니다. 편집할 영역을 브러시로 칠해주세요.');
  }

  // Add padding around the bounds (30% of the crop size, min 50px)
  const padX = Math.max(50, Math.round(bounds.w * 0.3));
  const padY = Math.max(50, Math.round(bounds.h * 0.3));

  const cropX = Math.max(0, bounds.x - padX);
  const cropY = Math.max(0, bounds.y - padY);
  const cropW = Math.min(original.width - cropX, bounds.w + padX * 2);
  const cropH = Math.min(original.height - cropY, bounds.h + padY * 2);

  // Crop the region from original image
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d')!;

  const origImg = new Image();
  await new Promise<void>((resolve) => {
    origImg.onload = () => resolve();
    origImg.src = originalBase64;
  });
  cropCtx.drawImage(origImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const croppedBase64 = cropCanvas.toDataURL('image/png');

  // Detect aspect ratio of cropped region
  const cropAR = cropW > cropH * 1.2 ? "16:9" : cropH > cropW * 1.2 ? "9:16" : "1:1";

  // Prepare parts for Gemini
  const optimizedCrop = await optimizeImage(croppedBase64, 1024);
  const parts: any[] = [
    { inlineData: { data: optimizedCrop.split(',')[1], mimeType: getMimeType(optimizedCrop) } }
  ];

  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
      const opt = await optimizeImage(ref, 512);
      parts.push({ inlineData: { data: opt.split(',')[1], mimeType: getMimeType(opt) } });
    }
  }

  const instruction = editPrompt?.trim() || 'Edit this region';
  const prompt = `Edit this cropped region of a fashion photo.

TASK: ${instruction}

IMPORTANT:
- This is a CROPPED portion of a larger image
- Apply the change to the MAIN SUBJECT in this crop
- Maintain the same angle, lighting, and style
- Output the edited version at the same size`;

  parts.push({ text: prompt });

  // Call Gemini
  const response = await retryOperation(() => ai.models.generateContent({
    model: modelId || 'gemini-3-pro-image-preview',
    contents: { parts },
    config: { seed: finalSeed, imageConfig: { aspectRatio: cropAR as any } }
  })) as GenerateContentResponse;

  let editedCropBase64 = '';
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.inlineData) {
        editedCropBase64 = `data:image/png;base64,${part.inlineData.data}`;
        break;
      }
    }
  }

  if (!editedCropBase64) throw new Error('AI가 편집된 이미지를 생성하지 못했습니다.');

  // Now composite: paste edited crop back onto original using mask as alpha
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = original.width;
  finalCanvas.height = original.height;
  const finalCtx = finalCanvas.getContext('2d')!;

  // Draw original
  finalCtx.drawImage(origImg, 0, 0);

  // Load edited crop
  const editedImg = new Image();
  await new Promise<void>((resolve) => {
    editedImg.onload = () => resolve();
    editedImg.src = editedCropBase64;
  });

  // Create a temporary canvas for the edited region with mask alpha
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cropW;
  tempCanvas.height = cropH;
  const tempCtx = tempCanvas.getContext('2d')!;

  // Draw the edited image scaled to crop size
  tempCtx.drawImage(editedImg, 0, 0, cropW, cropH);

  // Get pixel data
  const tempData = tempCtx.getImageData(0, 0, cropW, cropH);
  const maskImg = new Image();
  await new Promise<void>((resolve) => {
    maskImg.onload = () => resolve();
    maskImg.src = maskBase64;
  });

  // Get mask data for the crop region
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = cropW;
  maskCanvas.height = cropH;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.drawImage(maskImg, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  const cropMaskData = maskCtx.getImageData(0, 0, cropW, cropH);

  // Apply mask as alpha with feathering
  for (let i = 0; i < tempData.data.length; i += 4) {
    // Use mask brightness as alpha (white = full replacement)
    const maskAlpha = Math.max(cropMaskData.data[i], cropMaskData.data[i + 1], cropMaskData.data[i + 2]) / 255;
    tempData.data[i + 3] = Math.round(maskAlpha * 255);
  }
  tempCtx.putImageData(tempData, 0, 0);

  // Draw the masked edited region onto final
  finalCtx.drawImage(tempCanvas, cropX, cropY);

  return { imageUrl: finalCanvas.toDataURL('image/png'), seed: finalSeed };
};

// --- Simple text-based image editing (for when no mask is used) ---
export const generateImageEdit = async (
  imageBase64: string,
  editPrompt: string,
  refImages: string[] = [],
  modelId: string,
  seed?: number
): Promise<{ imageUrl: string, seed: number }> => {
  const ai = getGenAI();
  const finalSeed = resolveSeed(seed);
  const optimized = await optimizeImage(imageBase64);
  const detectedAR = await detectAspectRatio(imageBase64);

  const parts: any[] = [
    { inlineData: { data: optimized.split(',')[1], mimeType: getMimeType(optimized) } }
  ];

  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
      const opt = await optimizeImage(ref, 512);
      parts.push({ inlineData: { data: opt.split(',')[1], mimeType: getMimeType(opt) } });
    }
  }

  const instruction = editPrompt?.trim() || 'Enhance this image';

  const prompt = `Edit this fashion photo.

CHANGE: ${instruction}

Rules:
1. Apply the change clearly and obviously.
2. Keep everything else the same as much as possible.
3. Output the complete edited photo.`;

  parts.push({ text: prompt });

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: modelId || 'gemini-3-pro-image-preview',
      contents: { parts },
      config: { seed: finalSeed, imageConfig: { aspectRatio: detectedAR } }
    })) as GenerateContentResponse;

    let resultBase64 = '';
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          resultBase64 = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!resultBase64) throw new Error('이미지 편집 실패 — AI가 이미지를 반환하지 않았습니다.');
    return { imageUrl: resultBase64, seed: finalSeed };

  } catch (error: any) {
    console.error('Gemini Edit Error:', error);
    throw error;
  }
};
