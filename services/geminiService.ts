
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

// Compute the minimum fill-scale needed so the transformed image covers
// the entire canvas without black corners.
// Transform chain applied to image coords: T → R → Fs → S(shear) → Z
// For each canvas corner C, inverse maps to image via:
//   a = R^(-1)(C - translate)
//   required Fs ≥ |a.x - skew*a.y| / (w/2)  and  |a.y| / (h/2)
const computeFillScale = (w: number, h: number, rotation: number, tilt: number): number => {
  const rotRad = rotation * Math.PI / 180;
  const skew = tilt !== 0 ? Math.tan((tilt * Math.PI) / 180) * 0.3 : 0;
  // Inverse rotation by -rotRad
  const cosR = Math.cos(-rotRad);
  const sinR = Math.sin(-rotRad);
  const hw = w / 2, hh = h / 2;
  // All 4 canvas corners (canvas coords 0→w, 0→h)
  const corners: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
  let maxFs = 1;
  for (const [cx, cy] of corners) {
    // T^(-1): subtract canvas center
    const tx = cx - hw, ty = cy - hh;
    // R^(-1): apply inverse rotation
    const ax = tx * cosR - ty * sinR;
    const ay = tx * sinR + ty * cosR;
    // Required Fs so S^(-1)(a/Fs) stays in ±(hw, hh)
    const fsX = Math.abs(ax - skew * ay) / hw;
    const fsY = Math.abs(ay) / hh;
    maxFs = Math.max(maxFs, fsX, fsY);
  }
  return maxFs;
};

// Apply geometric transforms (rotation, tilt via skew, zoom) directly on canvas.
// Uses computeFillScale to guarantee zero black corners for any rotation+tilt combo.
const applyGeometricTransforms = (
  base64: string,
  rotation: number,
  tilt: number,
  zoom: number
): Promise<string> => {
  if (rotation === 0 && tilt === 0 && zoom === 0) return Promise.resolve(base64);
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
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2);

      // Step 1: Rotation
      if (rotation !== 0) ctx.rotate((rotation * Math.PI) / 180);

      // Step 2: Fill-scale — computed for rotation+tilt combined,
      // applied between R and S so it compensates both transforms.
      if (rotation !== 0 || tilt !== 0) {
        const fs = computeFillScale(w, h, rotation, tilt);
        if (fs > 1) ctx.scale(fs, fs);
      }

      // Step 3: Tilt as vertical skew
      if (tilt !== 0) {
        const skew = Math.tan((tilt * Math.PI) / 180) * 0.3;
        ctx.transform(1, skew, 0, 1, 0, 0);
      }

      // Step 4: User zoom (additional, on top of fill-scale)
      if (zoom !== 0) {
        const zoomScale = zoom > 0 ? 1 + zoom / 100 : 1 / (1 + Math.abs(zoom) / 100);
        ctx.scale(zoomScale, zoomScale);
      }

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
    rotation: number;
    tilt: number;
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
  // Apply geometric transforms (rotation/tilt/zoom) directly — guaranteed to be visible
  const transformedBase = await applyGeometricTransforms(imageBase64, params.rotation, params.tilt, params.zoom);
  const optimizedBase = await optimizeImage(transformedBase);

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

  // Geometric transforms (rotation/tilt/zoom) already applied to image directly above.
  // AI prompt only handles appearance changes: lighting, shadows, relighting, user instruction.
  const lightingDesc = params.lighting < 30 ? "Low-key, very dark and moody" : params.lighting > 70 ? "High-key, bright and airy commercial" : "Balanced neutral studio";
  const shadowDesc = params.shadow < 30 ? "Extremely soft and diffused, almost shadowless" : params.shadow > 70 ? "Hard, dramatic, high-contrast shadows" : "Natural soft shadows";

  const lightingChanged = params.lighting !== 50;
  const shadowChanged = params.shadow !== 50;
  const hasAppearanceChanges = lightingChanged || shadowChanged || params.relighting || userPrompt.trim();

  const prompt = `
    [ROLE: PROFESSIONAL PHOTO EDITOR & RETOUCHER]

    TASK: Retouch the provided image by applying the following APPEARANCE adjustments. The perspective/zoom have already been set in the image itself — focus only on lighting, shadows, and the user instruction.

    INPUT MAPPING:
    ${inputMap}

    APPEARANCE ADJUSTMENTS TO APPLY:
    ${lightingChanged ? `- LIGHTING: Change to ${lightingDesc} lighting (${params.lighting}/100). This must be VISIBLY different from a standard 50/100 lighting.` : '- LIGHTING: Keep current lighting (no change).'}
    ${shadowChanged ? `- SHADOWS: Change to ${shadowDesc} (${params.shadow}/100). This must be CLEARLY visible in the output.` : '- SHADOWS: Keep current shadow style (no change).'}
    ${params.relighting ? '- RELIGHTING: Apply professional 3-point studio relighting. Add dimensionality and subject separation from background.' : ''}
    ${userPrompt.trim() ? `- USER REQUEST: "${userPrompt}" — Apply EXACTLY as described. This is the highest priority instruction.` : ''}

    REQUIREMENTS:
    - ${hasAppearanceChanges ? 'Output MUST visibly reflect the adjustments above. Do not be subtle — make changes clear and confident.' : 'Output should be a high-quality, clean version of the input with no changes.'}
    - Preserve subject identity, clothing, and all structural details.
    - Photorealistic result — no artifacts, no cut-out look, seamless lighting.
    - Output the FULL image at the same composition as input.
  `;

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

// --- Inpainting helpers ---

// Find bounding box of white (painted) pixels in binarized mask.
// Returns {x, y, width, height, origW, origH}.
const getMaskBoundingBox = (maskBase64: string): Promise<{ x: number; y: number; width: number; height: number; origW: number; origH: number }> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const origW = img.naturalWidth || img.width;
      const origH = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = origW; canvas.height = origH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve({ x: 0, y: 0, width: origW, height: origH, origW, origH }); return; }
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, origW, origH).data;
      let minX = origW, minY = origH, maxX = 0, maxY = 0, hasWhite = false;
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          if (data[(y * origW + x) * 4] > 128) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            hasWhite = true;
          }
        }
      }
      if (!hasWhite) {
        // No mask painted — return full image bounds
        resolve({ x: 0, y: 0, width: origW, height: origH, origW, origH });
        return;
      }
      // Add 15% padding so Gemini has context around the selection
      const pw = Math.round((maxX - minX) * 0.15);
      const ph = Math.round((maxY - minY) * 0.15);
      const x = Math.max(0, minX - pw);
      const y = Math.max(0, minY - ph);
      const width = Math.min(origW, maxX + pw) - x;
      const height = Math.min(origH, maxY + ph) - y;
      resolve({ x, y, width, height, origW, origH });
    };
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => {
        const w = img2.naturalWidth || img2.width;
        const h = img2.naturalHeight || img2.height;
        resolve({ x: 0, y: 0, width: w, height: h, origW: w, origH: h });
      };
      img2.onerror = () => resolve({ x: 0, y: 0, width: 0, height: 0, origW: 0, origH: 0 });
      img2.src = maskBase64;
    };
    img.src = maskBase64;
  });
};

// Crop imageBase64 to the given bounding box.
const cropToBoundingBox = (
  imageBase64: string,
  bbox: { x: number; y: number; width: number; height: number }
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = bbox.width; canvas.height = bbox.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(imageBase64); return; }
      ctx.drawImage(img, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(imageBase64);
    img.src = imageBase64;
  });
};

// Place a smaller regionBase64 at bbox position inside a full-size canvas.
// Everything outside bbox is black — compositing step will use original pixels there.
const placeRegionInCanvas = (
  origW: number,
  origH: number,
  regionBase64: string,
  bbox: { x: number; y: number; width: number; height: number }
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = origW; canvas.height = origH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(regionBase64); return; }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, origW, origH);
      ctx.drawImage(img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height, bbox.x, bbox.y, bbox.width, bbox.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(regionBase64);
    img.src = regionBase64;
  });
};

// --- Main inpainting function ---
// Strategy: crop just the masked region → send clean crop + context to Gemini
// → place result back at bbox → client-side compositing with mask.
// This avoids asking Gemini to "interpret a mask image", which it cannot do reliably.
export const generateInpainting = async (
  imageBase64: string,
  maskBase64: string,
  userPrompt: string,
  refImages: string[] = [],
  modelId: string,
  seed?: number
): Promise<{ imageUrl: string, seed: number }> => {
  const ai = getGenAI();
  const finalSeed = resolveSeed(seed);

  // 1. Find the bounding box of the painted region
  const bbox = await getMaskBoundingBox(maskBase64);
  if (bbox.width === 0 || bbox.height === 0) {
    throw new Error("No mask area detected. Please paint the region you want to modify.");
  }

  // 2. Crop just the masked region from the original (Gemini gets a focused crop)
  const croppedRegion = await cropToBoundingBox(imageBase64, bbox);
  const optimizedCrop = await optimizeImage(croppedRegion);

  // 3. Also send full original as context so Gemini can match lighting/color
  const optimizedContext = await optimizeImage(imageBase64);

  const editInstruction = userPrompt?.trim() || 'Improve and refine this region naturally.';

  const parts: any[] = [
    // IMAGE 1: The specific region to transform (Gemini's "canvas")
    {
      inlineData: {
        data: optimizedCrop.split(',')[1],
        mimeType: getMimeType(optimizedCrop)
      }
    },
    // IMAGE 2: Full original for lighting/color context
    {
      inlineData: {
        data: optimizedContext.split(',')[1],
        mimeType: getMimeType(optimizedContext)
      }
    }
  ];

  // Optional reference images
  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
      const optimizedRef = await optimizeImage(ref);
      parts.push({
        inlineData: {
          data: optimizedRef.split(',')[1],
          mimeType: getMimeType(optimizedRef)
        }
      });
    }
  }

  const prompt = `
You are a photo editor. You have been given a cropped region from a photo (IMAGE 1) that needs to be transformed.

TASK: Apply this transformation to IMAGE 1: "${editInstruction}"

CONTEXT: IMAGE 2 is the full original photo that IMAGE 1 was cropped from. Use it ONLY as a reference to match the lighting, color temperature, and visual style — so your result will look natural when placed back into the scene.
${refImages.length > 0 ? 'Additional reference images are provided for style guidance.' : ''}

REQUIREMENTS:
- Apply "${editInstruction}" directly and visibly to the content in IMAGE 1.
- Match the lighting and color grade of IMAGE 2 so the result blends naturally.
- Output ONLY a modified version of IMAGE 1 (same crop dimensions).
- Be decisive — make the change clearly visible. Do not be subtle.
- Photorealistic result, no artifacts.
  `;

  parts.push({ text: prompt });

  // Use aspect ratio from the crop, not the full image
  const croppedAspectRatio = await detectAspectRatio(croppedRegion);

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: modelId || 'gemini-3-pro-image-preview',
      contents: { parts },
      config: {
        seed: finalSeed,
        imageConfig: { aspectRatio: croppedAspectRatio }
      }
    })) as GenerateContentResponse;

    let croppedResult = '';
    const candidate = response.candidates?.[0];
    if (candidate && candidate.content && candidate.content.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData) {
          croppedResult = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!croppedResult) throw new Error("Inpainting failed. Please try again.");

    // 4. Place the generated region back at the original bbox position
    // compositeMaskResult will then blend this with the original using the mask
    const fullSizeResult = await placeRegionInCanvas(bbox.origW, bbox.origH, croppedResult, bbox);
    return { imageUrl: fullSizeResult, seed: finalSeed };

  } catch (error: any) {
    console.error("Gemini Inpainting Error:", error);
    throw error;
  }
};

/**
 * Composite inpaint result with original image using the mask.
 * White mask pixels → use result. Black mask pixels → use original.
 * Guarantees pixel-perfect preservation of non-masked areas.
 */
export const compositeMaskResult = (
  originalBase64: string,
  resultBase64: string,
  maskBase64: string
): Promise<string> => {
  return new Promise((resolve) => {
    let loaded = 0;
    const origImg = new Image();
    const resultImg = new Image();
    const maskImg = new Image();

    const onLoad = () => {
      loaded++;
      if (loaded < 3) return;

      const w = origImg.naturalWidth || origImg.width;
      const h = origImg.naturalHeight || origImg.height;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(resultBase64); return; }

      // Draw original → get pixel data
      ctx.drawImage(origImg, 0, 0, w, h);
      const origData = ctx.getImageData(0, 0, w, h);

      // Draw result (scaled to original size) → get pixel data
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(resultImg, 0, 0, w, h);
      const resData = ctx.getImageData(0, 0, w, h);

      // Draw mask (scaled to original size) → get pixel data
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(maskImg, 0, 0, w, h);
      const maskData = ctx.getImageData(0, 0, w, h);

      // Composite: blend based on mask brightness
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < out.data.length; i += 4) {
        const m = maskData.data[i] / 255; // 0=original, 1=result
        out.data[i]     = Math.round(origData.data[i]     * (1 - m) + resData.data[i]     * m);
        out.data[i + 1] = Math.round(origData.data[i + 1] * (1 - m) + resData.data[i + 1] * m);
        out.data[i + 2] = Math.round(origData.data[i + 2] * (1 - m) + resData.data[i + 2] * m);
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    origImg.onload = onLoad;
    resultImg.onload = onLoad;
    maskImg.onload = onLoad;
    origImg.onerror = () => resolve(resultBase64);
    resultImg.onerror = () => resolve(resultBase64);
    maskImg.onerror = () => resolve(resultBase64);

    origImg.src = originalBase64;
    resultImg.src = resultBase64;
    maskImg.src = maskBase64;
  });
};
