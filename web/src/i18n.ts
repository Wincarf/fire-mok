// Landing + guided-story copy in pt-BR and en. The app's technical chrome
// (drawer, HUD, triage panel) stays English for now — this dictionary covers
// the narrative layer a lay visitor meets first.

export type Lang = "pt" | "en";

const STORAGE_KEY = "firemok-lang";

export function detectLang(): Lang {
  try {
    const saved = globalThis.localStorage?.getItem?.(STORAGE_KEY);
    if (saved === "pt" || saved === "en") return saved;
  } catch {
    // private mode / no storage — fall through to navigator
  }
  const nav = globalThis.navigator?.language ?? "";
  return nav.toLowerCase().startsWith("pt") ? "pt" : "en";
}

export function saveLang(l: Lang) {
  try {
    globalThis.localStorage?.setItem?.(STORAGE_KEY, l);
  } catch {
    // storage unavailable — language still applies for this session
  }
}

export const LANDING = {
  pt: {
    dateline: "Rio Grande do Sul — maio de 2024",
    title: "A enchente de 2024, vista do espaço.",
    sub: "Radar de satélite, território e clima num só mapa: onde a água chegou no pico de 11 de maio, quem foi afetado e o que cada município pode fazer agora.",
    statArea: "km² submersos",
    statPop: "pessoas expostas",
    statMunis: "municípios atingidos",
    cta: "Explorar o mapa",
    sources:
      "Sentinel-1 (ESA/Copernicus) · IBGE · WorldPop · Open-Meteo · © OpenStreetMap",
    disclaimer:
      "Escore de triagem para gestores — não é alerta oficial da Defesa Civil.",
  },
  en: {
    dateline: "Rio Grande do Sul, Brazil — May 2024",
    title: "The 2024 flood, seen from space.",
    sub: "Satellite radar, territory and weather in a single map: where the water reached at the May 11 peak, who was affected, and what each municipality can do now.",
    statArea: "km² underwater",
    statPop: "people exposed",
    statMunis: "municipalities hit",
    cta: "Explore the map",
    sources:
      "Sentinel-1 (ESA/Copernicus) · IBGE · WorldPop · Open-Meteo · © OpenStreetMap",
    disclaimer:
      "A triage score for managers — not an official civil-defense alert.",
  },
} as const;

export const STORY_UI = {
  pt: {
    stepOf: (i: number, total: number) => `Passo ${i}/${total}`,
    skip: "pular",
    back: "◂ voltar",
    next: "próximo ▸",
    explore: "explorar ▸",
    restart: "recomeçar",
    timelineTitle: "Linha do tempo · mai–jun 2024",
    sarPeak: "PICO SAR",
    recession: "RECESSÃO",
  },
  en: {
    stepOf: (i: number, total: number) => `Step ${i}/${total}`,
    skip: "skip",
    back: "◂ back",
    next: "next ▸",
    explore: "explore ▸",
    restart: "restart",
    timelineTitle: "Timeline · May–Jun 2024",
    sarPeak: "SAR PEAK",
    recession: "RECESSION",
  },
} as const;
