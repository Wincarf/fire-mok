import type { Vis } from "./vis";

export type Step = {
  title: string;
  text: string;
  camera: [number, number, number]; // [lng, lat, zoom]
  layers: Vis;
  sel?: string; // código IBGE do município a destacar
};

const RISK: Vis = { flood: false, sus: false, muni: true };

export const STORY: Step[] = [
  {
    title: "A região em risco",
    text: "Região metropolitana de Porto Alegre. Cada município está colorido pelo nível de risco calculado — de baixo (verde) a crítico (vermelho).",
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: "A chuva recorde",
    text: "Em maio de 2024 choveu em poucos dias o que costuma chover em meses — mais de 600 mm em parte da região, com o solo já saturado.",
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: "Água onde não devia estar",
    text: "Em vermelho: área que estava seca e ficou submersa no pico de 11 de maio, detectada por radar de satélite — o Guaíba e os rios Gravataí e Jacuí transbordaram.",
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true },
  },
  {
    title: "Onde a água sempre vai",
    text: "Em azul: áreas naturalmente inundáveis segundo o terreno (DEM). Onde o azul encontra o vermelho, a enchente seguiu a lógica do relevo.",
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true, sus: true },
  },
  {
    title: "Quem foi afetado",
    text: "Clique num município para ver exposição e plano de ação. Os vermelhos concentram a maior parte da população exposta.",
    camera: [-51.23, -30.03, 9.5],
    layers: { ...RISK, flood: true },
    sel: "4314902", // Porto Alegre
  },
  {
    title: "Agora é com você",
    text: "Explore o mapa, ligue e desligue as camadas e clique nos municípios. Cada um tem um plano de ação sugerido.",
    camera: [-51.15, -30.05, 9],
    layers: { ...RISK, flood: true },
  },
];
