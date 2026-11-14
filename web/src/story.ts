import type { Vis } from "./vis";

export type Step = {
  title: string;
  text: string;
  camera: [number, number, number]; // [lng, lat, zoom]
  layers: Vis;
  sel?: string; // IBGE code of the municipality to highlight
};

const RISK: Vis = { flood: false, sus: false, muni: true };

export const STORY: Step[] = [
  {
    title: "The region at risk",
    text: "Porto Alegre metropolitan region. Each municipality is colored by its computed risk level — from low (gray) to critical (red).",
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: "The record rainfall",
    text: "In May 2024, in a few days it rained what usually falls in months — over 600 mm in part of the region, with the soil already saturated.",
    camera: [-51.15, -30.05, 9],
    layers: RISK,
  },
  {
    title: "Water where it shouldn't be",
    text: "In red: area that was dry and became submerged at the May 11 peak, detected by satellite radar — the Guaíba, Gravataí and Jacuí rivers overflowed.",
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true },
  },
  {
    title: "Where the water always goes",
    text: "In blue: naturally floodable areas according to the terrain (DEM). Where blue meets red, the flood followed the logic of the relief.",
    camera: [-51.2, -30.05, 10],
    layers: { ...RISK, flood: true, sus: true },
  },
  {
    title: "Who was affected",
    text: "Click a municipality to see exposure and the action plan. The red ones concentrate most of the exposed population.",
    camera: [-51.23, -30.03, 9.5],
    layers: { ...RISK, flood: true },
    sel: "4314902", // Porto Alegre
  },
  {
    title: "Now it's up to you",
    text: "Explore the map, toggle the layers and click the municipalities. Each one has a suggested action plan.",
    camera: [-51.15, -30.05, 9],
    layers: { ...RISK, flood: true },
  },
];
