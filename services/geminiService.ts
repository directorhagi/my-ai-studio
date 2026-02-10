
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
const binarizeMask = (maskBase64: string): Promise<string> => {
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
  const optimizedBase = await optimizeImage(imageBase64);

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

  const angleDesc = `Camera Rotation: ${params.rotation} degrees (Horizontal), Camera Tilt: ${params.tilt} degrees (Vertical). Match the perspective changes realistically.`;
  
  let zoomDesc = "";
  if (params.zoom === 0) {
      zoomDesc = "Field of View: Standard (No Zoom change).";
  } else if (params.zoom > 0) {
      zoomDesc = `ZOOM IN (Telephoto effect): +${params.zoom} level. Crop tighter on the subject, reducing the field of view.`;
  } else {
      zoomDesc = `ZOOM OUT (Wide Angle effect): ${params.zoom} level. Expand the field of view, showing more surroundings (Outpaint if necessary).`;
  }

  const lightingDesc = params.lighting < 30 ? "Low-key, moody lighting" : params.lighting > 70 ? "High-key, bright commercial lighting" : "Balanced studio lighting";
  const shadowDesc = params.shadow < 30 ? "Soft, diffused shadows" : params.shadow > 70 ? "Hard, dramatic shadows" : "Natural shadows";
  const relightingDesc = params.relighting ? "Apply professional relighting to enhance dimensionality and separation." : "Maintain existing lighting direction.";

  const hasChanges = params.rotation !== 0 || params.tilt !== 0 || params.zoom !== 0 ||
    params.lighting !== 50 || params.shadow !== 50 || params.relighting || userPrompt.trim();

  const prompt = `
    [ROLE: PROFESSIONAL PHOTO EDITOR & RETOUCHER]

    TASK: Apply the following specific edits to IMAGE 1. You MUST visibly apply ALL non-zero parameters.

    INPUT MAPPING:
    ${inputMap}

    EDITS TO APPLY (apply ALL of these):
    ${params.rotation !== 0 ? `- CAMERA ROTATION: ${angleDesc} — YOU MUST rotate/shift the camera angle by exactly ${params.rotation} degrees horizontally.` : '- CAMERA ROTATION: 0° (no change needed)'}
    ${params.tilt !== 0 ? `- CAMERA TILT: ${params.tilt > 0 ? 'Tilt camera UP' : 'Tilt camera DOWN'} by ${Math.abs(params.tilt)} degrees. This must be VISIBLE in the output.` : '- CAMERA TILT: 0° (no change needed)'}
    - ZOOM: ${zoomDesc}
    - LIGHTING: ${params.lighting}/100 — ${lightingDesc}. ${params.lighting !== 50 ? 'This MUST be noticeably different from the original.' : ''}
    - SHADOWS: ${params.shadow}/100 — ${shadowDesc}. ${params.shadow !== 50 ? 'This MUST be noticeably different from the original.' : ''}
    - RELIGHTING: ${relightingDesc}
    ${userPrompt.trim() ? `- USER REQUEST: "${userPrompt}" — Apply this EXACTLY as described.` : ''}

    REQUIREMENTS:
    - Apply EVERY non-default parameter visibly and confidently. Do not be subtle.
    - Photorealistic result — no artifacts, no cut-out look.
    - Maintain subject identity and clothing details.
    - ${hasChanges ? 'The output MUST look noticeably different from the input.' : 'Maintain original look.'}
  `;

  parts.push({ text: prompt });

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: modelId || 'gemini-3-pro-image-preview',
      contents: { parts },
      config: {
        seed: finalSeed,
        imageConfig: {
          aspectRatio: aspectRatio || detectedAspectRatio,
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
  const detectedAspectRatio = await detectAspectRatio(imageBase64);
  const optimizedBase = await optimizeImage(imageBase64);
  const binarizedMask = await binarizeMask(maskBase64);
  const optimizedMask = await optimizeImage(binarizedMask);

  const parts: any[] = [
    {
      inlineData: {
        data: optimizedBase.split(',')[1],
        mimeType: getMimeType(optimizedBase)
      }
    },
    {
      inlineData: {
        data: optimizedMask.split(',')[1],
        mimeType: getMimeType(optimizedMask)
      }
    }
  ];

  let inputMap = `
  - IMAGE 1: Original Base Image.
  - IMAGE 2: Mask Image (White = Edit area, Black = Keep area).
  `;
  let currentIndex = 3;

  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
       const optimizedRef = await optimizeImage(ref);
       parts.push({
        inlineData: {
          data: optimizedRef.split(',')[1],
          mimeType: getMimeType(optimizedRef)
        }
      });
      inputMap += `- IMAGE ${currentIndex}: Style/Content Reference for the inpainted area.\n`;
      currentIndex++;
    }
  }

  const prompt = `
    [ROLE: EXPERT PHOTO RETOUCHER & PRECISION INPAINTER]

    TASK: Surgically modify ONLY the masked region of the image. Every pixel outside the mask MUST remain pixel-perfect identical to the original.

    INPUT MAPPING:
    ${inputMap}

    MASK INTERPRETATION:
    - Image 2 is a binary mask: WHITE pixels = the region to modify, BLACK pixels = preserve exactly.
    - CRITICAL: Treat the white region as a precise surgical selection. Only generate/replace content inside white areas.
    - If multiple similar objects exist (e.g., two lights, two chairs), ONLY modify the one(s) overlapping the white mask. Leave all others UNCHANGED.

    EDIT INSTRUCTION: ${userPrompt}

    STRICT REQUIREMENTS:
    1. ALL black-mask pixels in the output MUST be IDENTICAL to IMAGE 1 — no color shift, no lighting change, no blur.
    2. The white-mask region should seamlessly blend with surrounding pixels (match lighting, color temperature, texture, noise).
    3. The boundary between masked and unmasked areas must be invisible (feathered compositing).
    4. ${refImages.length > 0 ? 'Use the reference image(s) to guide the style/content inside the masked area.' : 'Apply the instruction naturally and realistically inside the mask.'}
    5. Output must be photorealistic and high-fidelity.
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

    if (!resultBase64) throw new Error("Inpainting failed. Please try again.");
    return { imageUrl: resultBase64, seed: finalSeed };
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
