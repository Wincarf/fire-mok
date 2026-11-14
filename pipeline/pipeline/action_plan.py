"""Deterministic per-municipality action plan (rules, no LLM).

Actions are driven by the risk category plus which component fired.
Portuguese strings — these reach the UI and the manager-facing report.
"""

SEVERITY_ORDER = ["low", "moderate", "high", "critical"]


def build_action_plan(m: dict) -> dict:
    cat = m.get("risk_category", "low")
    actions: list[str] = []
    reasons: list[str] = []

    if cat in ("high", "critical"):
        reasons.append(f"categoria de risco {cat}")
        actions += [
            f"Mobilizar abrigos para ~{m.get('pop_exposed', 0):,}".replace(",", ".") + " pessoas potencialmente expostas",
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

    if m.get("flood_frac", 0) > 0.02:
        reasons.append(f"{100*m['flood_frac']:.1f}% da área municipal com inundação observada")
        actions.append("Priorizar vistorias e desobstrução nos setores com água observada no SAR")
    if m.get("precip_max7d_mm", 0) > 250:
        reasons.append(f"{m['precip_max7d_mm']:.0f} mm em 7 dias")
        actions.append("Monitorar níveis dos rios e reforçar aviso em caso de nova chuva intensa")
    if m.get("soil_moisture_mean", 0) > 0.4:
        reasons.append("solo próximo da saturação")
        actions.append("Atenção a encostas e áreas de infiltração — solo saturado reduz escoamento")
    if m.get("sus_frac", 0) > 0.5:
        reasons.append(f"{100*m['sus_frac']:.0f}% do território em terreno baixo e plano")
        actions.append("Revisar rotas de fuga e pontos de encontro em áreas de várzea")
    if m.get("pop_exposed", 0) > 10_000:
        reasons.append(f"~{m['pop_exposed']:,} pessoas na área potencialmente afetada".replace(",", "."))
        actions.append("Acionar plano de contingência intermunicipal/regional")

    return {
        "municipality": m.get("name", ""),
        "priority": cat,
        "reasons": reasons or ["indicadores dentro da faixa normal"],
        "actions": actions,
    }
