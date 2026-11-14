"""Deterministic per-municipality action plan (rules, no LLM).

Actions are driven by the risk category plus which component fired.
Portuguese strings — these reach the UI and the manager-facing report.
"""

SEVERITY_ORDER = ["low", "moderate", "high", "critical"]


def _num(m: dict, key: str, default: float = 0.0) -> float:
    """GeoJSON round-trips turn NaN/None into strings or null — coerce to a
    finite number so the rule comparisons never crash on unknown values."""
    try:
        x = float(m.get(key, default))
    except (TypeError, ValueError):
        return default
    return default if x != x else x  # nan != nan


def build_action_plan(m: dict) -> dict:
    cat = m.get("risk_category", "low")
    actions: list[str] = []
    reasons: list[str] = []
    pop_exposed = int(_num(m, "pop_exposed"))

    if cat in ("high", "critical"):
        reasons.append(f"categoria de risco {cat}")
        actions += [
            f"Mobilizar abrigos para ~{pop_exposed:,}".replace(",", ".") + " pessoas potencialmente expostas",
            "Pré-posicionar equipes de resgate e embarcações nas áreas de várzea",
            "Emitir aviso preventivo à população das áreas ribeirinhas",
        ]
    elif cat == "moderate":
        reasons.append("categoria de risco moderate")
        actions += [
            "Inspecionar pontos de alagamento recorrente e bocas de lobo",
            "Manter equipes de plantão para ocorrências pontuais",
        ]
    else:
        actions += [
            "Manter rotina de limpeza de drenagem urbana",
            "Atualizar cadastro de áreas de risco no plano diretor",
        ]

    flood_frac = _num(m, "flood_frac")
    if flood_frac > 0.02:
        reasons.append(f"{100*flood_frac:.1f}% da área municipal com inundação observada")
        actions.append("Priorizar vistorias e desobstrução nos setores com água observada no SAR")
    precip_max7d = _num(m, "precip_max7d_mm")
    if precip_max7d > 250:
        reasons.append(f"{precip_max7d:.0f} mm em 7 dias")
        actions.append("Monitorar níveis dos rios e reforçar aviso em caso de nova chuva intensa")
    precip_fc = _num(m, "precip_forecast_max7d_mm")
    if precip_fc > 100:
        reasons.append(f"previsão de {precip_fc:.0f} mm nos próximos 7 dias")
        actions.append("Preparar alerta preventivo para a próxima semana — chuva prevista sobre solo já carregado")
    soil = _num(m, "soil_moisture_mean")
    if soil > 0.4:
        reasons.append("solo próximo da saturação")
        actions.append("Atenção a encostas e áreas de infiltração — solo saturado reduz escoamento")
    sus_frac = _num(m, "sus_frac")
    if sus_frac > 0.5:
        reasons.append(f"{100*sus_frac:.0f}% do território em terreno baixo e plano")
        actions.append("Revisar rotas de fuga e pontos de encontro em áreas de várzea")
    if pop_exposed > 10_000:
        reasons.append(f"~{pop_exposed:,} pessoas na área potencialmente afetada".replace(",", "."))
        actions.append("Acionar plano de contingência intermunicipal/regional")

    return {
        "municipality": m.get("name", ""),
        "priority": cat,
        "reasons": reasons or ["indicadores dentro da faixa normal"],
        "actions": actions,
    }
