// src/refs/taxonomy.ts
// Canonical 136-category taxonomy backing the media-forge-refs bucket.
// Source: `mc ls local/media-forge-refs` snapshot 2026-05-26.
// Aliases capture common synonyms users type in briefs (lay terms → canonical).

export const CATEGORIES: readonly string[] = [
  'aerial', 'anthropomorphism', 'arc-movement', 'architexture', 'as-object',
  'aspect-ratio-switch', 'bolt-cam', 'boomerang', 'breakdown', 'bullet-time',
  'camera-roll', 'central-framing', 'choreo', 'cinemagraph', 'close-up',
  'collage', 'color-shift', 'conveyor', 'crash-transition', 'cut-ins',
  'datamosh', 'digital-gesture', 'digital-overlay', 'distortions', 'dolly-shot',
  'dolly-zoom', 'double-dolly', 'double-exposure', 'dreamcore', 'duplication',
  'dutch-angle', 'dystopian', 'echo-printing', 'epiphany-shot', 'falling',
  'first-person-pov', 'fisheye', 'fixed-camera', 'flash-cut', 'floating',
  'focal-focus', 'focal-shift', 'fourth-wall', 'fpv-drone', 'freeze-frame',
  'generative', 'glitch', 'ground-shot', 'halation', 'hard-light',
  'haze', 'high-angle', 'infinite', 'interview', 'jump-cut',
  'kaleidoscope', 'lazy-susan', 'light-flash', 'locked-on', 'low-angle',
  'magnification', 'masking', 'match-cut', 'match-motion', 'match-split',
  'maximalism', 'mixed-media', 'model', 'morphing', 'motion-blur',
  'night-vision', 'object-portal', 'omnidirectional', 'over-the-shoulder', 'overhead',
  'pan', 'parallax', 'pass-through', 'pedestal', 'photogrammetry',
  'photography', 'pixel-art', 'probe-lens', 'product', 'profile-shot',
  'projections', 'quick-cuts', 'reflections', 'scale-shift', 'screen-in-screen',
  'set-transition', 'shadow-box', 'shaky-cam', 'silhouette', 'slit-scan',
  'slow-motion', 'snorricam', 'speed-ramping', 'split-diopter', 'split-screen',
  'spotlight', 'step-printing', 'stop-motion', 'stutter', 'stylistic-suck',
  'surrealism', 'tableau-shots', 'thermal', 'tilt', 'tilt-shift',
  'tracking', 'traditional', 'transformation', 'transition', 'trip',
  'trucking', 'two-shot', 'typography', 'ultra-wide-zero-d', 'undercranking',
  'underwater', 'vhs', 'video-game', 'video-portraits', 'vignette',
  'void', 'voyeur', 'wandering', 'whip-pan', 'wide-shot',
  'wierdcore', 'wigglegram', 'worms-eye', 'x-ray', 'zoetrope',
  'zoom-in',
] as const;

const CATEGORY_SET = new Set<string>(CATEGORIES);

const ALIASES: Readonly<Record<string, string>> = {
  'vertigo-effect': 'dolly-zoom',
  'vertigo-shot': 'dolly-zoom',
  'zolly': 'dolly-zoom',
  'matrix-shot': 'bullet-time',
  'time-freeze': 'bullet-time',
  'slo-mo': 'slow-motion',
  'slomo': 'slow-motion',
  'birds-eye': 'overhead',
  'top-down': 'overhead',
  'tilt-down': 'tilt',
  'tilt-up': 'tilt',
  'point-of-view': 'first-person-pov',
  'pov': 'first-person-pov',
  'over-shoulder': 'over-the-shoulder',
  'ots': 'over-the-shoulder',
};

export interface FilmlingoHint {
  category: string;
  canonicalTerms: string[];
  lens?: string[];
  cameraMove?: string[];
  referenceFilms: string[];
  promptSuffix: string;
}

const FILMLINGO: Readonly<Record<string, FilmlingoHint>> = {
  'dolly-zoom': {
    category: 'dolly-zoom',
    canonicalTerms: ['dolly zoom', 'zolly', 'vertigo effect', 'lens compresses depth'],
    lens: ['50mm', '85mm anamorphic'],
    cameraMove: ['dolly in + zoom out (or inverse)'],
    referenceFilms: ['Vertigo (Hitchcock, 1958)', 'Jaws (Spielberg, 1975)', 'Goodfellas (1990)'],
    promptSuffix: 'dolly zoom à la Vertigo, 50mm anamorphic, subject locked in frame, background compresses',
  },
  'bullet-time': {
    category: 'bullet-time',
    canonicalTerms: ['bullet time', 'time slice', 'frozen orbit'],
    lens: ['50mm array'],
    cameraMove: ['orbital pan around frozen subject'],
    referenceFilms: ['The Matrix (1999)', 'Equilibrium (2002)'],
    promptSuffix: 'bullet-time orbital pan, frozen subject, camera arcs 180 degrees, particles suspended',
  },
  'slow-motion': {
    category: 'slow-motion',
    canonicalTerms: ['slow motion', 'high-speed capture', 'over-cranked'],
    lens: ['varies'],
    cameraMove: ['locked off or smooth tracking'],
    referenceFilms: ['300 (2006)', 'Inception (2010)'],
    promptSuffix: 'slow motion at 240fps, smooth motion blur, droplets visible mid-air',
  },
  'tilt-shift': {
    category: 'tilt-shift',
    canonicalTerms: ['tilt-shift', 'miniature effect', 'shallow plane'],
    lens: ['tilt-shift 24mm'],
    referenceFilms: ['Lemony Snicket (2004) — opening', 'The Social Network (2010) — rowing scene'],
    promptSuffix: 'tilt-shift miniature effect, top and bottom blurred, scene appears as scale model',
  },
  'tracking': {
    category: 'tracking',
    canonicalTerms: ['tracking shot', 'dolly tracking', 'lateral move'],
    cameraMove: ['camera moves parallel to subject'],
    referenceFilms: ['Goodfellas (Copacabana long-take, 1990)', 'Children of Men (2006)'],
    promptSuffix: 'smooth tracking shot, subject moves left-to-right, camera matches pace',
  },
  'close-up': {
    category: 'close-up',
    canonicalTerms: ['close-up', 'CU', 'detail shot'],
    lens: ['85mm', '105mm'],
    referenceFilms: ['Sergio Leone westerns'],
    promptSuffix: 'tight close-up framing face from chin to forehead, shallow depth of field',
  },
  'dutch-angle': {
    category: 'dutch-angle',
    canonicalTerms: ['dutch angle', 'canted angle', 'oblique tilt'],
    referenceFilms: ['The Third Man (1949)', 'Thor (2011)'],
    promptSuffix: 'dutch angle 15 degrees, frame canted, unease',
  },
  'whip-pan': {
    category: 'whip-pan',
    canonicalTerms: ['whip pan', 'swish pan', 'snap pan'],
    cameraMove: ['rapid horizontal pan creating motion blur'],
    referenceFilms: ['Edgar Wright films', 'Kill Bill (2003)'],
    promptSuffix: 'whip pan transition, motion blur streaks, frame snaps to next scene',
  },
  'overhead': {
    category: 'overhead',
    canonicalTerms: ['overhead shot', "bird's eye view", 'top-down'],
    cameraMove: ['camera mounted directly above subject'],
    referenceFilms: ['Busby Berkeley musicals', 'Wes Anderson films'],
    promptSuffix: "overhead bird's eye view, subject centred, geometric composition",
  },
  'first-person-pov': {
    category: 'first-person-pov',
    canonicalTerms: ['first-person POV', 'subjective camera'],
    cameraMove: ['camera placed where character eyes would be'],
    referenceFilms: ['Hardcore Henry (2015)', 'Lady in the Lake (1947)'],
    promptSuffix: 'first-person POV, subject hands visible at bottom of frame, head-mounted camera feel',
  },
};

export function isCategory(value: string): boolean {
  return CATEGORY_SET.has(value);
}

export function normalizeCategory(input: string): string {
  return input.trim().toLowerCase().replace(/[_\s]+/g, '-');
}

export function resolveAliases(input: string): string | null {
  const normalized = normalizeCategory(input);
  if (CATEGORY_SET.has(normalized)) return normalized;
  return ALIASES[normalized] ?? null;
}

export function getFilmlingoHint(category: string): FilmlingoHint | null {
  return FILMLINGO[category] ?? null;
}
