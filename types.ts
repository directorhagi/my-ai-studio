
export enum Category {
  MODEL = 'MODEL',
  MODEL_AURORA = 'MODEL_AURORA',
  MODEL_ORION = 'MODEL_ORION',
  GENDER = 'GENDER', // Added for no-model generation
  OUTER = 'OUTERWEAR',
  TOP = 'TOP',
  SET = 'SET (ONEPIECE)',
  PANTS = 'PANTS',
  SKIRT = 'SKIRT',
  SOCKS = 'SOCKS',
  SHOES = 'SHOES',
  BAG = 'BAG',
  ACC1 = 'ACCESSORY 1',
  ACC2 = 'ACCESSORY 2',
  ACC3 = 'ACCESSORY 3',
  ACC4 = 'ACCESSORY 4',
  FIT = 'FIT',
  BACKGROUND = 'BACKGROUND',
  POSE = 'POSE'
}

export type ViewType = 'FRONT' | 'BACK';

export type AspectRatio = "1:1" | "4:3" | "16:9" | "21:9" | "5:4" | "3:2" | "2:3" | "9:16" | "3:4" | "4:5";

export type ImageSize = "1K" | "2K" | "4K";

export type StylePreset = "Studio" | "Streetwear" | "Formal" | "Minimalist" | "Cyberpunk" | "Vintage";

export type FitType = "Standard" | "Slim" | "Oversized" | "Loose" | "Skinny" | "Tailored" | "Cropped" | "Boxy";

export type PoseType = "Model Standing" | "Walking" | "Hands in Pocket" | "Arms Crossed" | "Leaning" | "Sitting" | "Dynamic" | "Rear View";

export type BackgroundType = "Studio Grey" | "Solid White" | "Urban Street" | "Luxury Interior" | "Nature/Park" | "Beach" | "Cyberpunk Neon" | "Runway" | "Cafe";

export type ClothingLength = "Micro/Mini" | "Short" | "Knee-Length" | "Midi" | "Ankle" | "Full/Maxi" | "Cropped";

export type GenderType = "Female" | "Male" | "Unisex";

export type GenerationType = 'FITTING' | 'EDIT' | 'INPAINTING';

export interface HistoryItem {
  id: string;
  url: string;
  date: number;
  type: GenerationType;
  preset?: StylePreset;
  view?: ViewType;
  size?: ImageSize;
  liked?: boolean; // Added for Like feature
  // Metadata for inspection
  metadata?: {
    prompt?: string;
    fit?: FitType;
    pose?: PoseType;
    background?: BackgroundType;
    aspectRatio?: AspectRatio;
    modelName?: string;
    gender?: GenderType;
    refImages?: string[]; 
    seed?: number; // Added: Store seed for reproducibility
  };
}

export interface ClothingItem {
  id: string;
  category: Category;
  imageUrl: string;
  name: string;
  length?: ClothingLength; // Optional length property for clothes
}

export interface ViewState {
  modelImage: string | null;
  items: Partial<Record<Category, ClothingItem>>;
}

export interface BatchItem {
    id: string;
    images: string[];
    status: 'loading' | 'completed' | 'error';
    date: number;
    errorMsg?: string;
    aspectRatio: AspectRatio; // Added to persist ratio for the batch
}

export interface AppState {
  currentView: ViewType;
  views: Record<ViewType, ViewState>;
  // isGenerating removed in favor of queue check
  generatedBatches: BatchItem[]; // Using BatchItem interface
  error: null | string;
  aspectRatio: AspectRatio;
  stylePreset: StylePreset;
  imageSize: ImageSize;
  userPrompt: string;
  refImages: string[];
  // Global Options
  selectedFit: FitType;
  selectedPose: PoseType;
  selectedBackground: BackgroundType;
  selectedGender: GenderType;
  selectedModel: string;
  // Seed Control
  seed: number;
  useRandomSeed: boolean;
  // Generation Count
  numberOfImages: number;
}
