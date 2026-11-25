import type { Vis } from "./vis";

export type LocalText = { pt: string; en: string };

export type Step = {
  title: LocalText;
  text: LocalText;
  camera: [number, number, number]; // [lng, lat, zoom]
  layers: Vis;
  sel?: string; // IBGE code of the municipality to highlight
};

const RISK: Vis = { flood: false, sus: false, muni: true };

export const STORY: Step[] = [
  {
    title: {
      pt: "A região em risco",
      en: "The region at risk",
    },
    text: {
      pt: "Região metropolitana de Porto Alegre. Cada município é colorido pelo nível de risco calculado — de baixo (cinza) a crítico (vermelho).",
      en: "Porto Alegre metropolitan region. Each municipality is colored by its computed risk level — from low (gray) to critical (red).",
    },
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: {
      pt: "A chuva recorde",
      en: "The record rainfall",
    },
    text: {
      pt: "Em maio de 2024, em poucos dias choveu o que costuma cair em meses — mais de 600 mm em parte da região, com o solo já saturado.",
      en: "In May 2024, in a few days it rained what usually falls in months — over 600 mm in part of the region, with the soil already saturated.",
    },
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: {
      pt: "Água onde não deveria estar",
      en: "Water where it shouldn't be",
    },
    text: {
      pt: "Em vermelho: área que estava seca e ficou submersa no pico de 11 de maio, detectada por radar de satélite — os rios Guaíba, Gravataí e Jacuí transbordaram.",
      en: "In red: area that was dry and became submerged at the May 11 peak, detected by satellite radar — the Guaíba, Gravataí and Jacuí rivers overflowed.",
    },
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true },
  },
  {
    title: {
      pt: "Para onde a água sempre vai",
      en: "Where the water always goes",
    },
    text: {
      pt: "Em azul: áreas naturalmente inundáveis segundo o terreno (DEM). Onde azul encontra vermelho, a enchente seguiu a lógica do relevo.",
      en: "In blue: naturally floodable areas according to the terrain (DEM). Where blue meets red, the flood followed the logic of the relief.",
    },
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true, sus: true },
  },
  {
    title: {
      pt: "Quem foi afetado",
      en: "Who was affected",
    },
    text: {
      pt: "Clique num município para ver a exposição e o plano de ação. Os vermelhos concentram a maior parte da população exposta.",
      en: "Click a municipality to see exposure and the action plan. The red ones concentrate most of the exposed population.",
    },
    camera: [-51.23, -30.03, 9.5],
    layers: { ...RISK, flood: true },
    sel: "4314902", // Porto Alegre
  },
  {
    title: {
      pt: "Agora é com você",
      en: "Now it's up to you",
    },
    text: {
      pt: "Explore o mapa, ligue e desligue as camadas e clique nos municípios. Cada um tem um plano de ação sugerido.",
      en: "Explore the map, toggle the layers and click the municipalities. Each one has a suggested action plan.",
    },
    camera: [-51.15, -30.05, 9],
    layers: { ...RISK, flood: true },
  },
];
