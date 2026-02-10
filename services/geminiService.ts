
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

// Compute fill-scale for two shear transforms (horizontal + vertical).
// Canvas transform chain: translate → scale(Fs) → shearX → skewY → zoom → draw
// Inverse mapping for canvas corner (cx,cy):
//   ty = cy - hh, tx = cx - hw (subtract translation)
//   iy = ty - skewY*tx (inverse of vertical skew)
//   ix = tx - shearX*iy (inverse of horizontal shear)
//   Fs = max(|ix|/hw, |iy|/hh) across all 4 corners
const computeFillScaleForShears = (w: number, h: number, shearX: number, skewY: number): number => {
  const hw = w / 2, hh = h / 2;
  const corners: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
  let maxFs = 1;
  for (const [cx, cy] of corners) {
    const tx = cx - hw, ty = cy - hh;
    const iy = ty - skewY * tx;
    const ix = tx - shearX * iy;
    maxFs = Math.max(maxFs, Math.abs(ix) / hw, Math.abs(iy) / hh);
  }
  return maxFs;
};

// Apply zoom-only canvas transform before sending to AI.
// Rotation and tilt are handled via text prompt to Gemini (3D perspective
// cannot be reproduced with 2D canvas transforms — any shear/skew approach
// causes visible distortion that users perceive as wrong).
const applyGeometricTransforms = (
  base64: string,
  zoom: number
): Promise<string> => {
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
      const zoomScale = zoom > 0 ? 1 + zoom / 100 : 1 / (1 + Math.abs(zoom) / 100);
      ctx.scale(zoomScale, zoomScale);
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
  // Only zoom is applied via canvas. Rotation/tilt go to the AI prompt.
  const transformedBase = await applyGeometricTransforms(imageBase64, params.zoom);
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

  const lightingDesc = params.lighting < 30 ? "Low-key, very dark and moody" : params.lighting > 70 ? "High-key, bright and airy commercial" : "Balanced neutral studio";
  const shadowDesc = params.shadow < 30 ? "Extremely soft and diffused, almost shadowless" : params.shadow > 70 ? "Hard, dramatic, high-contrast shadows" : "Natural soft shadows";

  // Build rotation/tilt instructions for Gemini
  // Key: say "CAMERA ANGLE" not "turn the subject" — avoids Gemini only rotating the face
  let rotationInstruction = '';
  if (params.rotation !== 0) {
    const deg = Math.abs(params.rotation);
    const dir = params.rotation > 0 ? 'right' : 'left';
    const opposite = params.rotation > 0 ? 'left' : 'right';
    const viewDesc = deg < 20 ? `a very slight ${dir}-angle view` :
                     deg < 45 ? `a 3/4 view showing the ${dir} side` :
                     deg < 80 ? `a strong ${dir}-side angle` :
                     `a ${dir} profile view`;
    rotationInstruction = `- CAMERA ANGLE (HORIZONTAL): Re-shoot this fashion photo from ${deg}° to the ${dir}.
  * The camera moves ${deg}° to the ${dir} of the subject.
  * Result: show MORE of the subject's ${dir} shoulder/side, LESS of their ${opposite} side.
  * This affects the ENTIRE BODY equally — torso, arms, clothing, legs, feet all show ${viewDesc}.
  * NOT just the face — this is a FULL BODY perspective/angle change.
  * Keep the same outfit, background, and lighting. Only the viewing angle changes.`;
  }
  let tiltInstruction = '';
  if (params.tilt !== 0) {
    const deg = Math.abs(params.tilt);
    const dir = params.tilt > 0 ? 'upward' : 'downward';
    const shot = params.tilt > 0 ? 'low-angle shot (camera below subject, looking up)' : 'high-angle shot (camera above subject, looking down)';
    tiltInstruction = `- CAMERA ANGLE (VERTICAL): Re-shoot from ${deg}° ${dir} — ${shot}.
  * The ENTIRE BODY reflects this camera tilt, not just the head.`;
  }

  const lightingChanged = params.lighting !== 50;
  const shadowChanged = params.shadow !== 50;
  const hasChanges = lightingChanged || shadowChanged || params.relighting || params.rotation !== 0 || params.tilt !== 0 || userPrompt.trim();

  const prompt = `
    [ROLE: PROFESSIONAL FASHION PHOTOGRAPHER & PHOTO EDITOR]

    TASK: Recreate this fashion photo with the following changes applied.

    INPUT MAPPING:
    ${inputMap}

    CHANGES TO APPLY:
    ${rotationInstruction || '- CAMERA ANGLE (HORIZONTAL): Keep current front-facing angle.'}
    ${tiltInstruction || '- CAMERA ANGLE (VERTICAL): Keep current camera height.'}
    ${lightingChanged ? `- LIGHTING: ${lightingDesc} (${params.lighting}/100). Must be clearly visible.` : '- LIGHTING: Keep current lighting.'}
    ${shadowChanged ? `- SHADOWS: ${shadowDesc} (${params.shadow}/100). Must be clearly visible.` : '- SHADOWS: Keep current shadows.'}
    ${params.relighting ? '- RELIGHTING: Apply professional 3-point studio relighting.' : ''}
    ${userPrompt.trim() ? `- USER REQUEST (TOP PRIORITY): "${userPrompt}" — Apply this EXACTLY and CLEARLY.` : ''}

    OUTPUT REQUIREMENTS:
    - ${hasChanges ? 'ALL changes MUST be clearly visible. Be decisive — do not be subtle.' : 'Output a clean, high-quality version of the input.'}
    - Preserve the exact same clothing, outfit details, and model identity.
    - Photorealistic. No artifacts. Output the COMPLETE image.
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

// Crop the masked region from the original image (with padding).
// Returns the cropped image and its position in the original.
const cropMaskedRegion = (
  imageBase64: string,
  maskBase64: string,
  padding = 60
): Promise<{ cropBase64: string; x: number; y: number; cropW: number; cropH: number; origW: number; origH: number } | null> => {
  return new Promise((resolve) => {
    let loaded = 0;
    const origImg = new Image();
    const maskImg = new Image();
    const onLoad = () => {
      loaded++;
      if (loaded < 2) return;
      const W = origImg.naturalWidth || origImg.width;
      const H = origImg.naturalHeight || origImg.height;
      // Find bounding box of white pixels in mask
      const mc = document.createElement('canvas');
      mc.width = W; mc.height = H;
      const mctx = mc.getContext('2d');
      if (!mctx) { resolve(null); return; }
      mctx.drawImage(maskImg, 0, 0, W, H);
      const mdata = mctx.getImageData(0, 0, W, H).data;
      let minX = W, minY = H, maxX = 0, maxY = 0, hasWhite = false;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (mdata[(y * W + x) * 4] > 128) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            hasWhite = true;
          }
        }
      }
      if (!hasWhite) { resolve(null); return; }
      // Add padding and clamp to image bounds
      const x = Math.max(0, minX - padding);
      const y = Math.max(0, minY - padding);
      const x2 = Math.min(W, maxX + padding);
      const y2 = Math.min(H, maxY + padding);
      const cropW = x2 - x;
      const cropH = y2 - y;
      // Crop from original
      const cc = document.createElement('canvas');
      cc.width = cropW; cc.height = cropH;
      const cctx = cc.getContext('2d');
      if (!cctx) { resolve(null); return; }
      cctx.drawImage(origImg, x, y, cropW, cropH, 0, 0, cropW, cropH);
      resolve({ cropBase64: cc.toDataURL('image/png'), x, y, cropW, cropH, origW: W, origH: H });
    };
    origImg.onload = onLoad;
    maskImg.onload = onLoad;
    origImg.onerror = () => resolve(null);
    maskImg.onerror = () => resolve(null);
    origImg.src = imageBase64;
    maskImg.src = maskBase64;
  });
};

// Paste the edited crop back into the original image, using the mask for blending.
const pasteCropIntoOriginal = (
  originalBase64: string,
  editedCropBase64: string,
  maskBase64: string,
  x: number, y: number, cropW: number, cropH: number
): Promise<string> => {
  return new Promise((resolve) => {
    let loaded = 0;
    const origImg = new Image();
    const cropImg = new Image();
    const maskImg = new Image();
    const onLoad = () => {
      loaded++;
      if (loaded < 3) return;
      const W = origImg.naturalWidth || origImg.width;
      const H = origImg.naturalHeight || origImg.height;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(editedCropBase64); return; }
      // Draw original
      ctx.drawImage(origImg, 0, 0, W, H);
      const origData = ctx.getImageData(0, 0, W, H);
      // Draw scaled edited crop into the crop region
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(origImg, 0, 0, W, H);
      ctx.drawImage(cropImg, x, y, cropW, cropH);
      const composited = ctx.getImageData(0, 0, W, H);
      // Apply mask blending: white mask = use composited, black mask = use original
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(maskImg, 0, 0, W, H);
      const maskData = ctx.getImageData(0, 0, W, H);
      const out = ctx.createImageData(W, H);
      for (let i = 0; i < out.data.length; i += 4) {
        const m = maskData.data[i] / 255;
        out.data[i]     = Math.round(origData.data[i]     * (1 - m) + composited.data[i]     * m);
        out.data[i + 1] = Math.round(origData.data[i + 1] * (1 - m) + composited.data[i + 1] * m);
        out.data[i + 2] = Math.round(origData.data[i + 2] * (1 - m) + composited.data[i + 2] * m);
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    origImg.onload = onLoad; cropImg.onload = onLoad; maskImg.onload = onLoad;
    origImg.onerror = () => resolve(originalBase64);
    cropImg.onerror = () => resolve(originalBase64);
    maskImg.onerror = () => resolve(originalBase64);
    origImg.src = originalBase64;
    cropImg.src = editedCropBase64;
    maskImg.src = maskBase64;
  });
};

// --- Main inpainting function ---
// Strategy: CROP the masked region → send ONLY the crop to Gemini → paste result
// back at the exact original position using mask blending.
//
// Why cropping works:
// - Gemini sees only the selected object (e.g., shoes) at close range
// - It can't place the result in the wrong location (the crop IS the location)
// - Avoids "slippers appearing on the wall" type errors from full-image approach
export const generateInpainting = async (
  imageBase64: string,
  maskBase64: string,
  userPrompt: string,
  refImages: string[] = [],
  modelId: string,
  seed?: number
): Promise<{ imageUrl: string, seed: number; cropInfo?: { x: number; y: number; cropW: number; cropH: number } }> => {
  const ai = getGenAI();
  const finalSeed = resolveSeed(seed);

  const instruction = userPrompt?.trim() || 'Enhance and improve naturally.';

  // 1. Crop the masked region
  const cropData = await cropMaskedRegion(imageBase64, maskBase64, 60);
  if (!cropData) throw new Error('마스크 영역을 인식할 수 없습니다. 편집할 영역을 브러시로 그린 후 다시 시도해주세요.');

  const { cropBase64, x, y, cropW, cropH } = cropData;
  const cropAR = await detectAspectRatio(cropBase64);
  const optimizedCrop = await optimizeImage(cropBase64, 768);

  const parts: any[] = [
    { inlineData: { data: optimizedCrop.split(',')[1], mimeType: getMimeType(optimizedCrop) } }
  ];

  for (const ref of refImages) {
    if (ref && typeof ref === 'string') {
      const opt = await optimizeImage(ref, 512);
      parts.push({ inlineData: { data: opt.split(',')[1], mimeType: getMimeType(opt) } });
    }
  }

  // 2. Ask Gemini to edit only the crop
  const prompt = `You are editing a CROPPED SECTION from a fashion photo.

This image shows a specific area that needs to be modified.

YOUR TASK: "${instruction}"

CRITICAL RULES:
1. This is a CROP — output must match the SAME framing, scale, and position as the input.
2. Apply "${instruction}" clearly and decisively to the content shown.
3. Keep background, lighting, and surroundings consistent.
4. Do NOT reframe, zoom, or change the composition — output must fit back into the original photo.${refImages.length > 0 ? '\n5. Use the reference image for style guidance.' : ''}`;

  parts.push({ text: prompt });

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: modelId || 'gemini-3-pro-image-preview',
      contents: { parts },
      config: { seed: finalSeed, imageConfig: { aspectRatio: cropAR } }
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

    if (!editedCropBase64) throw new Error('인페인팅 실패 — AI가 이미지를 반환하지 않았습니다. API 키를 확인하고 다시 시도해주세요.');

    // 3. Paste the edited crop back into the original at the exact crop position
    const finalImage = await pasteCropIntoOriginal(imageBase64, editedCropBase64, maskBase64, x, y, cropW, cropH);
    return { imageUrl: finalImage, seed: finalSeed, cropInfo: { x, y, cropW, cropH } };

  } catch (error: any) {
    console.error('Gemini Inpainting Error:', error);
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
