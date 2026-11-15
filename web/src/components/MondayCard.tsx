import { useState } from "react";
import { fmtInt, fmtKm2, ptDate } from "../format";

type Beat = {
  date: string;
  label: string;
  flood_km2: number;
  munis_affected: number;
  pop_exposed_est: number;
  municipalities: { name: string; flooded_m2: number; pop_exposed_est: number }[];
  facilities?: { schools: number; hospitals: number } | null;
};

type Props = {
  beatData: Beat;
  onClose: () => void;
};

const LABEL_PT: Record<string, string> = {
  peak: "pico da enchente",
  recession: "recessão",
  calm: "leito normal",
};

/** One-click Monday-morning alert card: pt-BR, WhatsApp-ready, real data only. */
export function MondayCard({ beatData, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  const top5 = (beatData.municipalities ?? []).slice(0, 5);
  const lines: string[] = [
    "🚨 *RELATÓRIO DE ENCHENTE — Guaíba/RS*",
    `📅 ${ptDate(beatData.date)} — ${LABEL_PT[beatData.label] ?? beatData.label}`,
    "",
    `🌊 Área alagada detectada: *${fmtKm2(beatData.flood_km2)} km²*`,
    `👥 População exposta (est. areal): *~${fmtInt(beatData.pop_exposed_est)} pessoas*`,
    `🏙️ Municípios atingidos: *${beatData.munis_affected}*`,
  ];
  if (beatData.facilities) {
    lines.push(
      `🏫 Escolas na área alagada: ${beatData.facilities.schools} · 🏥 Hospitais/clínicas: ${beatData.facilities.hospitals}`
    );
  }
  if (top5.length) {
    lines.push("", "*Municípios mais atingidos:*");
    top5.forEach((m, i) => {
      lines.push(
        `${i + 1}. ${m.name} — ${fmtKm2(m.flooded_m2 / 1e6)} km² (~${fmtInt(m.pop_exposed_est)} pessoas)`
      );
    });
  }
  lines.push(
    "",
    "📡 Fontes: Sentinel-1 (ESA/Copernicus) · WorldPop · OpenStreetMap",
    "Fire Mok — NASA Space Apps Challenge"
  );
  const text = lines.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="mt-20 w-full max-w-md rounded-2xl bg-[#e7ffdb] text-[#111b21] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 bg-[#075e54] text-white flex items-center justify-between">
          <span className="font-label-mono-xs text-label-mono-xs tracking-wider uppercase">
            Card de segunda-feira · pt-BR
          </span>
          <button type="button" onClick={onClose} className="material-symbols-outlined text-[18px]" aria-label="Close">
            close
          </button>
        </div>
        <pre className="px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">{text}</pre>
        <div className="px-4 pb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="h-9 px-4 rounded-lg bg-[#25d366] hover:bg-[#20bd5a] text-white text-sm font-medium flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "Copiado!" : "Copiar texto"}
          </button>
          <span className="text-[11px] text-[#55666b]">cola direto no WhatsApp da Defesa Civil</span>
        </div>
      </div>
    </div>
  );
}
