import type { Vis } from "./vis";

export type Step = {
  title: string;
  text: string;
  camera: [number, number, number]; // [lng, lat, zoom]
  layers: Vis;
  split: number; // % — 100 = só o "antes"; 50 = metade de cada
  sel?: string; // código IBGE do município a destacar
};

const OFF: Vis = { flood: false, mask: false, sus: false, muni: false };

export const STORY: Step[] = [
  {
    title: "A região por radar",
    text: "Esta é a região metropolitana de Porto Alegre vista por radar de satélite — ele enxerga a superfície mesmo debaixo de nuvens.",
    camera: [-51.15, -30.05, 9],
    layers: OFF,
    split: 100,
  },
  {
    title: "A chuva recorde",
    text: "Em maio de 2024 choveu em poucos dias o que costuma chover em meses — mais de 600 mm em parte da região, com o solo já saturado.",
    camera: [-51.15, -30.05, 9],
    layers: OFF,
    split: 100,
  },
  {
    title: "Antes e depois",
    text: "Compare os dois lados: à esquerda, a água normal de junho (recessão); à direita, o pico da enchente em 11 de maio. Água aparece escura no radar.",
    camera: [-51.15, -30.05, 9],
    layers: OFF,
    split: 50,
  },
  {
    title: "Água onde não devia estar",
    text: "Em vermelho: área que estava seca e ficou submersa — cerca de 3 milhões de pixels, ~5% da região. O Guaíba e os rios Gravataí e Jacuí transbordaram.",
    camera: [-51.2, -30.05, 10],
    layers: { ...OFF, flood: true },
    split: 50,
  },
  {
    title: "Quem foi afetado",
    text: "As cores dos municípios mostram o nível de risco calculado — enchente observada, chuva, solo saturado e terreno. Clique num deles para ver exposição e plano de ação.",
    camera: [-51.23, -30.03, 9.5],
    layers: { ...OFF, flood: true, muni: true },
    split: 50,
    sel: "4314902", // Porto Alegre
  },
  {
    title: "Agora é com você",
    text: "Explore os mapas, mexa no limiar de detecção e clique nos municípios. Cada município tem um plano de ação sugerido.",
    camera: [-51.15, -30.05, 9],
    layers: { ...OFF, flood: true, muni: true },
    split: 50,
  },
];
