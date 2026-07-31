"use client";

import { useMemo, useState } from "react";
import { sections as rawSections } from "./data";

type Meeting = [string, string, string, string];
type Section = {
  n: string;
  k: string;
  c: string;
  s: string;
  r: number;
  u: number;
  a: number;
  p: string;
  m: Meeting[];
  e: number;
};

type ScheduleOption = {
  items: Section[];
  equivalents: number;
};

type ScheduleType = "Matutino" | "Vespertino" | "Mixto";

type ViabilityIssue = {
  level: "error" | "warning";
  title: string;
  detail: string;
  courses?: string[];
};

type ScheduleAnalysis = {
  courses: number;
  sections: number;
  unscheduled: number;
  theoretical: number;
  valid: number;
  options: ScheduleOption[];
  byType: Record<ScheduleType, ScheduleOption[]>;
  representatives: Partial<Record<ScheduleType, ScheduleOption>>;
  issues: ViabilityIssue[];
};

const sections = rawSections as unknown as Section[];
const DAYS = ["L", "M", "I", "J", "V", "S"];
const WEEKDAYS = ["L", "M", "I", "J", "V"];
const DAY_NAMES: Record<string, string> = {
  L: "Lunes",
  M: "Martes",
  I: "Miércoles",
  J: "Jueves",
  V: "Viernes",
  S: "Sábado",
};
const START_MINUTE = 7 * 60;
const END_MINUTE = 21 * 60;
const PX_PER_MINUTE = 0.72;
const TYPE_LABEL: Record<ScheduleType, string> = {
  Matutino: "matutina",
  Vespertino: "vespertina",
  Mixto: "mixta",
};

function min(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2));
}

function displayTime(time: string) {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

function meetingsConflict(a: Meeting[], b: Meeting[]) {
  return a.some(([dayA, startA, endA]) =>
    b.some(
      ([dayB, startB, endB]) =>
        dayA === dayB && min(startA) < min(endB) && min(startB) < min(endA),
    ),
  );
}

function buildScheduleAnalysis(pool: Section[]): ScheduleAnalysis {
  const keys = [...new Set(pool.map((section) => section.k))];
  const courseName = new Map(pool.map((section) => [section.k, section.c]));
  const groupsByKey = new Map(
    keys.map((key) => [key, pool.filter((section) => section.k === key && section.m.length > 0)]),
  );
  const unscheduledKeys = keys.filter((key) => !groupsByKey.get(key)?.length);
  const groups = keys.map((key) => groupsByKey.get(key) || []).sort((a, b) => a.length - b.length);
  const chosen: Section[] = [];
  const visualOptions = new Map<string, ScheduleOption>();
  let valid = 0;

  const emptyTypes: Record<ScheduleType, ScheduleOption[]> = {
    Matutino: [],
    Vespertino: [],
    Mixto: [],
  };

  if (unscheduledKeys.length) {
    return {
      courses: keys.length,
      sections: pool.length,
      unscheduled: pool.filter((section) => section.m.length === 0).length,
      theoretical: 0,
      valid: 0,
      options: [],
      byType: emptyTypes,
      representatives: {},
      issues: [{
        level: "error",
        title: "Materias sin horario capturado",
        detail: "No es posible formar un horario completo hasta asignar día y hora a estas materias.",
        courses: unscheduledKeys.map((key) => courseName.get(key) || key),
      }],
    };
  }

  function visit(index: number) {
    if (index === groups.length) {
      valid += 1;
      const signature = chosen
        .map((section) =>
          `${section.k}:${section.m
            .map(([day, start, end]) => `${day}-${start}-${end}`)
            .sort()
            .join(",")}`,
        )
        .sort()
        .join("|");
      const existing = visualOptions.get(signature);
      if (existing) existing.equivalents += 1;
      else visualOptions.set(signature, { items: [...chosen], equivalents: 1 });
      return;
    }
    for (const section of groups[index]) {
      if (chosen.some((other) => meetingsConflict(section.m, other.m))) continue;
      chosen.push(section);
      visit(index + 1);
      chosen.pop();
    }
  }

  visit(0);
  const theoretical = groups.reduce((total, group) => total * group.length, 1);
  const options = [...visualOptions.values()];
  const byType: Record<ScheduleType, ScheduleOption[]> = {
    Matutino: [],
    Vespertino: [],
    Mixto: [],
  };
  options.forEach((option) => byType[scheduleMetrics(option).shift].push(option));
  const rank = (a: ScheduleOption, b: ScheduleOption) => {
    const aa = scheduleMetrics(a);
    const bb = scheduleMetrics(b);
    return aa.idleMinutes - bb.idleMinutes || (aa.last - aa.first) - (bb.last - bb.first) || aa.first - bb.first;
  };
  (Object.keys(byType) as ScheduleType[]).forEach((type) => byType[type].sort(rank));
  const representatives: Partial<Record<ScheduleType, ScheduleOption>> = {};
  (Object.keys(byType) as ScheduleType[]).forEach((type) => {
    if (byType[type][0]) representatives[type] = byType[type][0];
  });

  const issues: ViabilityIssue[] = [];
  if (!valid) {
    const unavoidablePairs: string[] = [];
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const alwaysConflict = groups[i].every((left) => groups[j].every((right) => meetingsConflict(left.m, right.m)));
        if (alwaysConflict) unavoidablePairs.push(`${groups[i][0].c} ↔ ${groups[j][0].c}`);
      }
    }
    issues.push({
      level: "error",
      title: "No existe un horario completo sin traslapes",
      detail: unavoidablePairs.length
        ? "Se detectaron pares de materias cuyas secciones se cruzan en todos los casos."
        : "Las combinaciones parciales generan una cadena de cruces que impide integrar todas las materias.",
      courses: unavoidablePairs.slice(0, 8),
    });
  } else {
    (Object.keys(byType) as ScheduleType[]).forEach((type) => {
      if (!byType[type].length) {
        issues.push({
          level: "warning",
          title: `Sin opción ${TYPE_LABEL[type]}`,
          detail: `Todas las materias sí caben en al menos un horario, pero no puede construirse una alternativa completamente ${TYPE_LABEL[type]}.`,
        });
      }
    });
  }
  return {
    courses: keys.length,
    sections: pool.length,
    unscheduled: pool.filter((section) => section.m.length === 0).length,
    theoretical,
    valid,
    options,
    byType,
    representatives,
    issues,
  };
}

function scheduleMetrics(option: ScheduleOption) {
  const meetings = option.items.flatMap((section) =>
    section.m.map((meeting) => ({ section, meeting })),
  );
  const minutes = meetings.map(({ meeting }) => min(meeting[1]));
  const ends = meetings.map(({ meeting }) => min(meeting[2]));
  const daysUsed = new Set(meetings.map(({ meeting }) => meeting[0]));
  const idleMinutes = DAYS.reduce((total, day) => {
    const dayMeetings = meetings.filter(({ meeting }) => meeting[0] === day);
    if (dayMeetings.length < 2) return total;
    const first = Math.min(...dayMeetings.map(({ meeting }) => min(meeting[1])));
    const last = Math.max(...dayMeetings.map(({ meeting }) => min(meeting[2])));
    const classMinutes = dayMeetings.reduce(
      (sum, { meeting }) => sum + min(meeting[2]) - min(meeting[1]),
      0,
    );
    return total + Math.max(0, last - first - classMinutes);
  }, 0);
  return {
    first: Math.min(...minutes),
    last: Math.max(...ends),
    idleMinutes,
    daysUsed,
    freeWeekdays: WEEKDAYS.filter((day) => !daysUsed.has(day)),
    hasSaturday: daysUsed.has("S"),
    shift: (Math.max(...ends) <= 15 * 60
      ? "Matutino"
      : Math.min(...minutes) >= 13 * 60
        ? "Vespertino"
        : "Mixto") as ScheduleType,
  };
}

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function clockLabel(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function Calendar({ option, type }: { option: ScheduleOption; type: ScheduleType }) {
  const metrics = scheduleMetrics(option);
  const colorByCourse = new Map(
    [...option.items]
      .sort((a, b) => a.c.localeCompare(b.c))
      .map((section, index) => [section.k, index % 9]),
  );
  const hours = Array.from(
    { length: (END_MINUTE - START_MINUTE) / 60 + 1 },
    (_, index) => START_MINUTE + index * 60,
  );
  const calendarHeight = (END_MINUTE - START_MINUTE) * PX_PER_MINUTE;

  return (
    <section className="calendar-card" aria-label="Horario semanal seleccionado">
      <div className="calendar-heading">
        <div>
          <span className="eyebrow">OPCIÓN MÍNIMA REPRESENTATIVA</span>
          <h2>Opción {TYPE_LABEL[type]}</h2>
        </div>
        <div className="schedule-tags">
          <span className="tag success">Sin traslapes</span>
          <span className="tag">{metrics.shift}</span>
          {metrics.hasSaturday && <span className="tag warning">Incluye sábado</span>}
        </div>
      </div>

      <div className="calendar-scroll">
        <div className="calendar-grid" style={{ minWidth: 980 }}>
          <div className="calendar-corner">Hora</div>
          {DAYS.map((day) => (
            <div className="calendar-day-head" key={day}>
              <strong>{DAY_NAMES[day]}</strong>
              <span>{metrics.daysUsed.has(day) ? "Con clases" : "Día libre"}</span>
            </div>
          ))}
          <div className="time-rail" style={{ height: calendarHeight }}>
            {hours.slice(0, -1).map((hour) => (
              <span key={hour} style={{ top: (hour - START_MINUTE) * PX_PER_MINUTE - 7 }}>
                {clockLabel(hour)}
              </span>
            ))}
          </div>
          {DAYS.map((day) => (
            <div className={`day-lane ${metrics.daysUsed.has(day) ? "" : "is-free"}`} key={day} style={{ height: calendarHeight }}>
              {hours.slice(0, -1).map((hour) => (
                <i className="hour-line" key={hour} style={{ top: (hour - START_MINUTE) * PX_PER_MINUTE }} />
              ))}
              {!metrics.daysUsed.has(day) && <span className="free-day-label">Sin clases</span>}
              {option.items.flatMap((section) =>
                section.m
                  .filter((meeting) => meeting[0] === day)
                  .map((meeting, index) => {
                    const start = min(meeting[1]);
                    const end = min(meeting[2]);
                    return (
                      <article
                        className={`calendar-class tone-${colorByCourse.get(section.k)}`}
                        key={`${section.n}-${day}-${index}`}
                        style={{
                          top: (start - START_MINUTE) * PX_PER_MINUTE + 2,
                          height: Math.max(35, (end - start) * PX_PER_MINUTE - 4),
                        }}
                        title={`${section.c} · ${section.s} · NRC ${section.n} · ${section.a} lugares disponibles`}
                      >
                        <time>{displayTime(meeting[1])}–{displayTime(meeting[2])}</time>
                        <strong>{section.c}</strong>
                        <span>{section.s} · {meeting[3]}</span>
                        <small>Cupo {section.a}/{section.u}</small>
                      </article>
                    );
                  }),
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [mode, setMode] = useState<"viewer" | "simulator">("viewer");
  const [semester, setSemester] = useState(1);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("Matutino");
  const analyses = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => {
        const currentSemester = index + 1;
        return buildScheduleAnalysis(sections.filter((section) => section.e === currentSemester));
      }),
    [],
  );
  const analysis = analyses[semester - 1];
  const availableTypes = (["Matutino", "Vespertino", "Mixto"] as ScheduleType[]).filter((type) => analysis.representatives[type]);
  const activeType = analysis.representatives[scheduleType] ? scheduleType : availableTypes[0] || scheduleType;
  const selectedOption = analysis.representatives[activeType];
  const selectedMetrics = selectedOption ? scheduleMetrics(selectedOption) : null;

  const [simSemester, setSimSemester] = useState(1);
  const simPool = useMemo(() => sections.filter((section) => section.e === simSemester), [simSemester]);
  const [selectedNrc, setSelectedNrc] = useState(sections.find((section) => section.e === 1 && section.m.length)?.n || "");
  const selectedSection = simPool.find((section) => section.n === selectedNrc && section.m.length) || simPool.find((section) => section.m.length);
  const [meetingIndex, setMeetingIndex] = useState(0);
  const baseMeeting = selectedSection?.m[meetingIndex] || selectedSection?.m[0];
  const [newDay, setNewDay] = useState(baseMeeting?.[0] || "L");
  const [newStart, setNewStart] = useState(baseMeeting ? displayTime(baseMeeting[1]) : "08:00");
  const [newEnd, setNewEnd] = useState(baseMeeting ? displayTime(baseMeeting[2]) : "09:55");

  function chooseSemester(value: number) {
    setSemester(value);
    const nextAnalysis = analyses[value - 1];
    const nextType = (["Matutino", "Vespertino", "Mixto"] as ScheduleType[]).find((type) => nextAnalysis.representatives[type]);
    if (nextType) setScheduleType(nextType);
  }

  function updateSimSemester(value: number) {
    const next = sections.find((section) => section.e === value && section.m.length);
    setSimSemester(value);
    setSelectedNrc(next?.n || "");
    setMeetingIndex(0);
    const meeting = next?.m[0];
    if (meeting) {
      setNewDay(meeting[0]);
      setNewStart(displayTime(meeting[1]));
      setNewEnd(displayTime(meeting[2]));
    }
  }

  function updateSelectedSection(nrc: string) {
    const next = simPool.find((section) => section.n === nrc);
    setSelectedNrc(nrc);
    setMeetingIndex(0);
    const meeting = next?.m[0];
    if (meeting) {
      setNewDay(meeting[0]);
      setNewStart(displayTime(meeting[1]));
      setNewEnd(displayTime(meeting[2]));
    }
  }

  function updateMeeting(index: number) {
    const meeting = selectedSection?.m[index];
    setMeetingIndex(index);
    if (meeting) {
      setNewDay(meeting[0]);
      setNewStart(displayTime(meeting[1]));
      setNewEnd(displayTime(meeting[2]));
    }
  }

  const simulation = useMemo(() => {
    const current = analyses[simSemester - 1].valid;
    if (!selectedSection || !baseMeeting) return { current, proposed: current, conflicts: [] as Section[] };
    const compactStart = newStart.replace(":", "");
    const compactEnd = newEnd.replace(":", "");
    if (min(compactStart) >= min(compactEnd)) return { current, proposed: current, conflicts: [] as Section[] };
    const movedPool = simPool.map((section) => {
      if (section.n !== selectedSection.n) return section;
      return {
        ...section,
        m: section.m.map((meeting, index) =>
          index === meetingIndex ? [newDay, compactStart, compactEnd, meeting[3]] as Meeting : meeting,
        ),
      };
    });
    const proposed = buildScheduleAnalysis(movedPool).valid;
    const moved = movedPool.find((section) => section.n === selectedSection.n)!;
    const conflicts = movedPool.filter(
      (section) => section.k !== moved.k && section.m.length && meetingsConflict(moved.m, section.m),
    );
    return { current, proposed, conflicts };
  }, [analyses, simSemester, simPool, selectedSection, baseMeeting, meetingIndex, newDay, newStart, newEnd]);
  const delta = simulation.proposed - simulation.current;

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LQ</div>
        <div className="brand-copy"><strong>Licenciatura en Química</strong><span>Herramienta de planeación de horarios 0000</span></div>
        <nav className="mode-switch" aria-label="Secciones principales">
          <button className={mode === "viewer" ? "active" : ""} onClick={() => setMode("viewer")}>Visualizador</button>
          <button className={mode === "simulator" ? "active" : ""} onClick={() => setMode("simulator")}>Simulador de cambios</button>
        </nav>
      </header>

      <div className="page-shell">
        <section className="hero compact-hero">
          <div>
            <span className="eyebrow">OFERTA ACADÉMICA LQUI</span>
            <h1>{mode === "viewer" ? "Opciones viables por semestre" : "Simulador de cambios"}</h1>
            <p>{mode === "viewer" ? "Verifica las alternativas mínimas matutina, vespertina y mixta, y localiza materias o cruces que impiden integrar un horario completo." : "Mueve provisionalmente un bloque y mide cuántas opciones compatibles se ganan o se pierden."}</p>
          </div>
          <div className="config-card" aria-label="Configuración de la consulta">
            <span><small>Ciclo</small><strong>202620 · 2026-B</strong></span>
            <span><small>Centro</small><strong>D · CUCEI</strong></span>
            <span><small>Carrera</small><strong>LQUI</strong></span>
          </div>
        </section>

        {mode === "viewer" ? (
          <>
            <nav className="semester-tabs visual-tabs" aria-label="Elegir semestre">
              {analyses.map((item, index) => (
                <button className={semester === index + 1 ? "active" : ""} key={index} onClick={() => chooseSemester(index + 1)}>
                  <span>{index + 1}º</span>
                  <small>{item.valid ? `${Object.keys(item.representatives).length} ${Object.keys(item.representatives).length === 1 ? "opción" : "opciones"}` : "Revisar"}</small>
                  {item.issues.some((issue) => issue.level === "error") && <i className="status-dot error" aria-label="Con errores" />}
                </button>
              ))}
            </nav>

            <section className="visual-summary">
              <div className={analysis.valid ? "featured success-card" : "featured error-card"}>
                <span>Viabilidad del semestre</span>
                <strong>{analysis.valid ? "Viable" : "Con errores"}</strong>
                <small>{analysis.valid ? "Todas las materias caben sin traslapes" : "No se puede integrar el horario completo"}</small>
              </div>
              <div><span>Opciones mínimas viables</span><strong>{Object.keys(analysis.representatives).length} de 3</strong><small>matutina, vespertina y mixta</small></div>
              <div><span>Combinaciones de secciones</span><strong>{analysis.valid.toLocaleString("es-MX")}</strong><small>todas sin traslapes</small></div>
              <div><span>Materias verificadas</span><strong>{analysis.courses}</strong><small>según la malla del semestre</small></div>
            </section>

            <section className="minimal-options" aria-label="Opciones mínimas de horario">
              {(["Matutino", "Vespertino", "Mixto"] as ScheduleType[]).map((type) => {
                const count = analysis.byType[type].length;
                return (
                  <button
                    key={type}
                    className={`${activeType === type && count ? "active" : ""} ${!count ? "unavailable" : ""}`}
                    disabled={!count}
                    onClick={() => setScheduleType(type)}
                  >
                    <span>{type}</span>
                    <strong>{count ? "Opción viable" : "No disponible"}</strong>
                    <small>{count ? `${count.toLocaleString("es-MX")} variantes compatibles` : "Consultar revisión de viabilidad"}</small>
                  </button>
                );
              })}
            </section>

            {selectedMetrics && (
              <section className="selected-option-summary">
                <div><span>Jornada</span><strong>{clockLabel(selectedMetrics.first)}–{clockLabel(selectedMetrics.last)}</strong></div>
                <div><span>Huecos acumulados</span><strong>{minutesLabel(selectedMetrics.idleMinutes)}</strong></div>
                <div><span>Días utilizados</span><strong>{selectedMetrics.daysUsed.size}</strong></div>
                <div><span>Sábado</span><strong>{selectedMetrics.hasSaturday ? "Con clases" : "Libre"}</strong></div>
              </section>
            )}

            {selectedOption ? (
              <>
                <Calendar option={selectedOption} type={activeType} />
                <p className="equivalent-note">Se muestra únicamente la alternativa más compacta de este tipo. Representa {analysis.byType[activeType].length.toLocaleString("es-MX")} variantes compatibles de secciones.</p>
              </>
            ) : (
              <div className="empty-state"><strong>No hay un horario completo viable</strong><p>Revisa los hallazgos siguientes para identificar la materia o el cruce que debe corregirse.</p></div>
            )}

            <section className="viability-panel panel">
              <div className="section-heading">
                <div><span className="eyebrow">REVISIÓN DE VIABILIDAD</span><h2>Errores y observaciones</h2></div>
                <span className={`review-count ${analysis.issues.some((issue) => issue.level === "error") ? "has-errors" : ""}`}>
                  {analysis.issues.length ? `${analysis.issues.length} hallazgos` : "Sin errores"}
                </span>
              </div>
              {analysis.issues.length ? (
                <div className="issue-list">
                  {analysis.issues.map((issue, index) => (
                    <article className={`issue ${issue.level}`} key={`${issue.title}-${index}`}>
                      <div className="issue-icon" aria-hidden="true">{issue.level === "error" ? "!" : "i"}</div>
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail}</p>
                        {issue.courses?.length ? <ul>{issue.courses.map((course) => <li key={course}>{course}</li>)}</ul> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="all-clear"><strong>Todas las materias son viables</strong><p>Existe al menos una combinación completa sin traslapes y no hay materias sin horario capturado.</p></div>
              )}
            </section>
          </>
        ) : (
          <section className="simulator-layout">
            <div className="sim-form panel">
              <div className="section-heading compact-heading"><div><span className="eyebrow">ESCENARIO PROPUESTO</span><h2>Mover una sección</h2></div><span className="step-tag">No modifica SIIAU</span></div>
              <label><span>Semestre</span><select value={simSemester} onChange={(event) => updateSimSemester(Number(event.target.value))}>{analyses.map((_, index) => <option key={index} value={index + 1}>{index + 1}º semestre</option>)}</select></label>
              <label><span>Sección</span><select value={selectedSection?.n || ""} onChange={(event) => updateSelectedSection(event.target.value)}>{simPool.filter((section) => section.m.length).map((section) => <option key={section.n} value={section.n}>{section.c} · {section.s} · NRC {section.n}</option>)}</select></label>
              {selectedSection && selectedSection.m.length > 1 && <label><span>Bloque a modificar</span><select value={meetingIndex} onChange={(event) => updateMeeting(Number(event.target.value))}>{selectedSection.m.map((meeting, index) => <option key={index} value={index}>{DAY_NAMES[meeting[0]]} {displayTime(meeting[1])}–{displayTime(meeting[2])}</option>)}</select></label>}
              <div className="current-slot"><span>Horario actual</span><strong>{baseMeeting ? `${DAY_NAMES[baseMeeting[0]]} ${displayTime(baseMeeting[1])}–${displayTime(baseMeeting[2])}` : "Sin horario"}</strong><small>{baseMeeting?.[3]}</small></div>
              <fieldset><legend>Nuevo horario provisional</legend><label><span>Día</span><select value={newDay} onChange={(event) => setNewDay(event.target.value)}>{DAYS.map((day) => <option key={day} value={day}>{DAY_NAMES[day]}</option>)}</select></label><div className="time-fields"><label><span>Inicio</span><input type="time" value={newStart} onChange={(event) => setNewStart(event.target.value)} /></label><label><span>Fin</span><input type="time" value={newEnd} onChange={(event) => setNewEnd(event.target.value)} /></label></div></fieldset>
              <p className="fine-print">El cupo es informativo y no modifica el cálculo. Solo se consideran secciones del centro D con horario capturado.</p>
            </div>
            <div className="sim-results">
              <article className="comparison-card panel">
                <div className="section-heading compact-heading"><div><span className="eyebrow">IMPACTO INMEDIATO</span><h2>Actual vs. simulado</h2></div><span className={`impact-badge ${delta < 0 ? "negative" : delta > 0 ? "positive" : "neutral"}`}>{delta > 0 ? "Cambio favorable" : delta < 0 ? "Cambio desfavorable" : "Cambio neutral"}</span></div>
                <div className="comparison-numbers"><div><span>Actual</span><strong>{simulation.current.toLocaleString("es-MX")}</strong><small>combinaciones sin cruce</small></div><div className="arrow">→</div><div><span>Simulado</span><strong>{simulation.proposed.toLocaleString("es-MX")}</strong><small>combinaciones sin cruce</small></div><div className={`delta ${delta < 0 ? "negative" : delta > 0 ? "positive" : ""}`}><span>Diferencia</span><strong>{delta > 0 ? "+" : ""}{delta.toLocaleString("es-MX")}</strong><small>opciones</small></div></div>
              </article>
              <article className="affected-card panel">
                <div className="section-heading compact-heading"><div><span className="eyebrow">CRUCES DIRECTOS</span><h2>Secciones que coinciden con el cambio</h2></div><strong>{simulation.conflicts.length}</strong></div>
                {simulation.conflicts.length ? <div className="conflict-list">{simulation.conflicts.slice(0, 8).map((section) => <div key={section.n}><span>{section.c}</span><strong>{section.s} · NRC {section.n}</strong><small>{section.m.map((meeting) => `${DAY_NAMES[meeting[0]].slice(0, 3)} ${displayTime(meeting[1])}–${displayTime(meeting[2])}`).join(" · ")}</small></div>)}</div> : <div className="empty-state"><strong>Sin cruces directos</strong><p>El bloque propuesto no coincide con otras secciones del mismo semestre.</p></div>}
              </article>
            </div>
          </section>
        )}
      </div>
      <footer>Datos de consulta SIIAU 202620 · Centro D · LQUI · Cupo únicamente informativo</footer>
    </main>
  );
}

