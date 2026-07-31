"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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

type SectionParticipation = {
  course: string;
  section: string;
  nrc: string;
  combinations: number;
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
  participation: {
    never: SectionParticipation[];
    single: SectionParticipation[];
  };
  sectionExamples: Record<string, ScheduleOption>;
  issues: ViabilityIssue[];
};

type RecommendedChange = {
  from: Meeting;
  to: Meeting;
};

type ScheduleRecommendation = {
  id: string;
  section: Section;
  kind: "block" | "section";
  changes: RecommendedChange[];
  newCombinations: number;
  resultingTotal: number;
  example: ScheduleOption;
  dayPattern: string;
  disruption: number;
};

type SectionRecommendation = {
  section: Section;
  suggestions: ScheduleRecommendation[];
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

function compactTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}${String(value % 60).padStart(2, "0")}`;
}

function meetingsConflict(a: Meeting[], b: Meeting[]) {
  return a.some(([dayA, startA, endA]) =>
    b.some(
      ([dayB, startB, endB]) =>
        dayA === dayB && min(startA) < min(endB) && min(startB) < min(endA),
    ),
  );
}

function evaluateTargetSchedule(pool: Section[], target: Section) {
  const keys = [...new Set(pool.map((section) => section.k))].filter((key) => key !== target.k);
  const groups = keys
    .map((key) => pool.filter((section) => section.k === key && section.m.length > 0))
    .sort((a, b) => a.length - b.length);
  const chosen: Section[] = [target];
  let combinations = 0;
  let example: ScheduleOption | undefined;

  function visit(index: number) {
    if (index === groups.length) {
      combinations += 1;
      if (!example) example = { items: [...chosen], equivalents: 1 };
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
  return { combinations, example };
}

function recommendationDisruption(original: Meeting[], proposed: Meeting[], changedBlocks: number) {
  return proposed.reduce((score, meeting, index) => {
    const current = original[index];
    const dayDistance = Math.abs(DAYS.indexOf(meeting[0]) - DAYS.indexOf(current[0]));
    const timeDistance = Math.abs(min(meeting[1]) - min(current[1])) / 60;
    return score + dayDistance * 2 + timeDistance;
  }, changedBlocks * 3);
}

function buildSectionRecommendations(
  pool: Section[],
  analysis: ScheduleAnalysis,
): SectionRecommendation[] {
  return analysis.participation.never.map((item) => {
    const section = pool.find((candidate) => candidate.n === item.nrc)!;
    if (!section.m.length) return { section, suggestions: [] };

    const candidates = new Map<string, ScheduleRecommendation>();

    function consider(proposedMeetings: Meeting[], kind: "block" | "section") {
      const signature = proposedMeetings
        .map(([day, start, end]) => `${day}-${start}-${end}`)
        .join("|");
      if (candidates.has(signature)) return;
      const proposedSection = { ...section, m: proposedMeetings };
      const result = evaluateTargetSchedule(pool, proposedSection);
      if (!result.combinations || !result.example) return;
      const changes = section.m
        .map((from, index) => ({ from, to: proposedMeetings[index] }))
        .filter(({ from, to }) => from[0] !== to[0] || from[1] !== to[1] || from[2] !== to[2]);
      const recommendation: ScheduleRecommendation = {
        id: `${section.n}-${signature}`,
        section,
        kind,
        changes,
        newCombinations: result.combinations,
        resultingTotal: analysis.valid + result.combinations,
        example: result.example,
        dayPattern: proposedMeetings.map((meeting) => meeting[0]).join("-"),
        disruption: recommendationDisruption(section.m, proposedMeetings, changes.length),
      };
      candidates.set(signature, recommendation);
    }

    section.m.forEach((meeting, meetingIndex) => {
      const duration = min(meeting[2]) - min(meeting[1]);
      DAYS.forEach((day) => {
        for (let start = START_MINUTE; start + duration <= END_MINUTE; start += 60) {
          if (day === meeting[0] && start === min(meeting[1])) continue;
          const proposed = section.m.map((current, index) =>
            index === meetingIndex
              ? [day, compactTime(start), compactTime(start + duration), current[3]] as Meeting
              : current,
          );
          consider(proposed, "block");
        }
      });
    });

    if (section.m.length > 1) {
      for (let dayShift = -5; dayShift <= 5; dayShift += 1) {
        for (let hourShift = -13; hourShift <= 13; hourShift += 1) {
          if (!dayShift && !hourShift) continue;
          const proposed = section.m.map((meeting) => {
            const dayIndex = DAYS.indexOf(meeting[0]) + dayShift;
            const start = min(meeting[1]) + hourShift * 60;
            const end = min(meeting[2]) + hourShift * 60;
            if (dayIndex < 0 || dayIndex >= DAYS.length || start < START_MINUTE || end > END_MINUTE) return null;
            return [DAYS[dayIndex], compactTime(start), compactTime(end), meeting[3]] as Meeting;
          });
          if (proposed.every((meeting): meeting is Meeting => meeting !== null)) consider(proposed, "section");
        }
      }
    }

    const ranked = [...candidates.values()].sort(
      (a, b) => b.newCombinations - a.newCombinations || a.disruption - b.disruption,
    );
    const suggestions: ScheduleRecommendation[] = [];
    const usedPatterns = new Set<string>();
    for (const recommendation of ranked) {
      if (usedPatterns.has(recommendation.dayPattern)) continue;
      suggestions.push(recommendation);
      usedPatterns.add(recommendation.dayPattern);
      if (suggestions.length === 3) break;
    }
    return { section, suggestions };
  });
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
  const participationCount = new Map<string, number>();
  const sectionExamples: Record<string, ScheduleOption> = {};
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
      participation: { never: [], single: [] },
      sectionExamples: {},
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
      chosen.forEach((section) => {
        participationCount.set(section.n, (participationCount.get(section.n) || 0) + 1);
        if (!sectionExamples[section.n]) {
          sectionExamples[section.n] = { items: [...chosen], equivalents: 1 };
        }
      });
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

  const scheduledSections = pool.filter((section) => section.m.length > 0);
  const participation = {
    never: scheduledSections
      .filter((section) => !participationCount.get(section.n))
      .map((section) => ({
        course: section.c,
        section: section.s,
        nrc: section.n,
        combinations: 0,
      })),
    single: scheduledSections
      .filter((section) => participationCount.get(section.n) === 1)
      .map((section) => ({
        course: section.c,
        section: section.s,
        nrc: section.n,
        combinations: 1,
      })),
  };

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
    if (participation.never.length) {
      issues.push({
        level: "error",
        title: "Materias con secciones fuera de toda combinación",
        detail: "Las secciones indicadas tienen horario capturado, pero siempre generan al menos un traslape al intentar completar el semestre.",
        courses: participation.never.map(
          (item) => `${item.course} — ${item.section} · NRC ${item.nrc}`,
        ),
      });
    }
    if (participation.single.length) {
      issues.push({
        level: "warning",
        title: "Materias con secciones que solo entran en una combinación",
        detail: "Las secciones indicadas dependen de una única combinación completa; cualquier cambio puede volverlas inviables.",
        courses: participation.single.map(
          (item) => `${item.course} — ${item.section} · NRC ${item.nrc}`,
        ),
      });
    }

    const availableTypeNames = (Object.keys(byType) as ScheduleType[]).filter(
      (type) => byType[type].length,
    );
    if (availableTypeNames.length === 1) {
      issues.push({
        level: "warning",
        title: `Oferta limitada a horario ${TYPE_LABEL[availableTypeNames[0]]}`,
        detail: `El semestre completo únicamente puede construirse como opción ${TYPE_LABEL[availableTypeNames[0]]}; no existen alternativas viables en los otros dos tipos de turno.`,
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
    participation,
    sectionExamples,
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

function Calendar({
  option,
  type,
  eyebrow = "OPCIÓN MÍNIMA REPRESENTATIVA",
  title,
}: {
  option: ScheduleOption;
  type: ScheduleType;
  eyebrow?: string;
  title?: string;
}) {
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
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title || `Opción ${TYPE_LABEL[type]}`}</h2>
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
  const [semester, setSemester] = useState(1);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("Matutino");
  const [selectedConstraintNrc, setSelectedConstraintNrc] = useState("");
  const [selectedRecommendationId, setSelectedRecommendationId] = useState("");
  const analyses = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => {
        const currentSemester = index + 1;
        return buildScheduleAnalysis(sections.filter((section) => section.e === currentSemester));
      }),
    [],
  );
  const analysis = analyses[semester - 1];
  const neverCourseCount = new Set(analysis.participation.never.map((item) => item.course)).size;
  const singleCourseCount = new Set(analysis.participation.single.map((item) => item.course)).size;
  const availableTypes = (["Matutino", "Vespertino", "Mixto"] as ScheduleType[]).filter((type) => analysis.representatives[type]);
  const activeType = analysis.representatives[scheduleType] ? scheduleType : availableTypes[0] || scheduleType;
  const selectedOption = analysis.representatives[activeType];
  const selectedMetrics = selectedOption ? scheduleMetrics(selectedOption) : null;
  const selectedConstraint = [...analysis.participation.never, ...analysis.participation.single]
    .find((item) => item.nrc === selectedConstraintNrc);
  const selectedConstraintSection = sections.find((item) => item.n === selectedConstraintNrc);
  const constraintOption = selectedConstraint ? analysis.sectionExamples[selectedConstraint.nrc] : undefined;
  const semesterPool = useMemo(
    () => sections.filter((section) => section.e === semester),
    [semester],
  );
  const recommendations = useMemo(
    () => buildSectionRecommendations(semesterPool, analysis),
    [semesterPool, analysis],
  );
  const selectedRecommendation = recommendations
    .flatMap((item) => item.suggestions)
    .find((item) => item.id === selectedRecommendationId);

  function chooseSemester(value: number) {
    setSemester(value);
    setSelectedConstraintNrc("");
    setSelectedRecommendationId("");
    const nextAnalysis = analyses[value - 1];
    const nextType = (["Matutino", "Vespertino", "Mixto"] as ScheduleType[]).find((type) => nextAnalysis.representatives[type]);
    if (nextType) setScheduleType(nextType);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LQ</div>
        <div className="brand-copy"><strong>Licenciatura en Química</strong><span>Herramienta de planeación de horarios</span></div>
        <nav className="mode-switch" aria-label="Secciones principales">
          <Link className="active" href="/">Visualizador</Link>
          <Link href="/generador">Generador de horario</Link>
        </nav>
      </header>

      <div className="page-shell">
        <section className="hero compact-hero">
          <div>
            <span className="eyebrow">OFERTA ACADÉMICA LQUI</span>
            <h1>Opciones viables por semestre</h1>
            <p>Verifica las alternativas mínimas matutina, vespertina y mixta, localiza materias que impiden integrar un horario completo y consulta ajustes recomendados.</p>
          </div>
          <div className="config-card" aria-label="Configuración de la consulta">
            <span><small>Ciclo</small><strong>202620 · 2026-B</strong></span>
            <span><small>Centro</small><strong>D · CUCEI</strong></span>
            <span><small>Carrera</small><strong>LQUI</strong></span>
          </div>
        </section>

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
              <div className={analysis.participation.never.length ? "constraint-summary danger" : "constraint-summary"}>
                <span>Materias con limitantes</span>
                <strong>{neverCourseCount + singleCourseCount}</strong>
                <small>{neverCourseCount} fuera de combinaciones · {singleCourseCount} con opción única</small>
              </div>
            </section>

            <section className="constraint-overview" aria-label="Limitantes principales del semestre">
              <article className={analysis.participation.never.length ? "critical" : "clear"}>
                <span>Materias con secciones fuera de toda combinación</span>
                <strong>{neverCourseCount}</strong>
                <small>{analysis.participation.never.length} secciones que requieren revisión</small>
              </article>
              <article className={analysis.participation.single.length ? "fragile" : "clear"}>
                <span>Materias con secciones en una sola combinación</span>
                <strong>{singleCourseCount}</strong>
                <small>{analysis.participation.single.length} secciones con viabilidad frágil</small>
              </article>
              <article className={availableTypes.length === 1 ? "fragile" : "clear"}>
                <span>Tipos de horario disponibles</span>
                <strong>{availableTypes.length} de 3</strong>
                <small>{availableTypes.length ? availableTypes.join(" · ") : "ninguno"}</small>
              </article>
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
                        {issue.courses?.length ? (
                          <ul>
                            {issue.courses.map((course) => {
                              const nrc = course.match(/NRC (\d+)/)?.[1];
                              return (
                                <li key={course}>
                                  {nrc ? (
                                    <button
                                      className={selectedConstraintNrc === nrc ? "active" : ""}
                                      onClick={() => setSelectedConstraintNrc(nrc)}
                                    >
                                      {course}<span>Ver detalle</span>
                                    </button>
                                  ) : course}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="all-clear"><strong>Todas las materias son viables</strong><p>Existe al menos una combinación completa sin traslapes y no hay materias sin horario capturado.</p></div>
              )}
            </section>

            {selectedConstraint && (
              <section className={`constraint-detail panel ${selectedConstraint.combinations === 0 ? "critical" : "fragile"}`}>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">DETALLE DE LA LIMITANTE</span>
                    <h2>{selectedConstraint.course}</h2>
                  </div>
                  <button className="close-detail" onClick={() => setSelectedConstraintNrc("")} aria-label="Cerrar detalle">×</button>
                </div>
                <div className="constraint-detail-summary">
                  <span>Sección <strong>{selectedConstraint.section}</strong></span>
                  <span>NRC <strong>{selectedConstraint.nrc}</strong></span>
                  <span>Combinaciones completas <strong>{selectedConstraint.combinations}</strong></span>
                </div>
                {constraintOption ? (
                  <>
                    <p>Esta es la única combinación completa en la que puede integrarse la sección seleccionada.</p>
                    <Calendar option={constraintOption} type={scheduleMetrics(constraintOption).shift} />
                  </>
                ) : (
                  <div className="zero-option-detail">
                    <strong>No existe un horario completo que incluya esta sección.</strong>
                    <p>Su horario se traslapa con las alternativas necesarias para completar el semestre. Consulta los ajustes hipotéticos recomendados al final de la página.</p>
                    {selectedConstraintSection?.m.length ? (
                      <div className="constraint-meetings">
                        {selectedConstraintSection.m.map((meeting, index) => (
                          <span key={`${meeting[0]}-${index}`}>
                            <strong>{DAY_NAMES[meeting[0]]}</strong> {displayTime(meeting[1])}–{displayTime(meeting[2])} · {meeting[3]}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            )}

          <section className="recommendation-panel panel" id="recomendaciones-ajuste">
            <div className="section-heading recommendation-heading">
              <div>
                <span className="eyebrow">RECOMENDADOR DE CAMBIOS</span>
                <h2>Ajustes que podrían ampliar la compatibilidad</h2>
              </div>
              <span className="hypothetical-badge">Escenario hipotético</span>
            </div>
            <div className="recommendation-disclaimer">
              <strong>Estas propuestas no representan la oferta actual ni modifican SIIAU.</strong>
              <p>Son recomendaciones automáticas de planeación. Conservan la duración de cada bloque y buscan posiciones que permitan integrar la sección en uno o más horarios completos.</p>
            </div>

            {recommendations.length ? (
              <div className="recommendation-list">
                {recommendations.map(({ section, suggestions }) => (
                  <article className="recommendation-course" key={section.n}>
                    <div className="recommendation-course-head">
                      <div>
                        <span>Materia sin horario completo compatible</span>
                        <h3>{section.c}</h3>
                        <small>Sección {section.s} · NRC {section.n} · {section.p}</small>
                      </div>
                      <strong>{suggestions.length ? `${suggestions.length} propuestas` : "Sin ajuste simple"}</strong>
                    </div>
                    <div className="current-meetings">
                      <span>Horario actual</span>
                      {section.m.map((meeting, index) => (
                        <small key={`${section.n}-current-${index}`}>
                          {DAY_NAMES[meeting[0]]} {displayTime(meeting[1])}–{displayTime(meeting[2])}
                        </small>
                      ))}
                    </div>

                    {suggestions.length ? (
                      <div className="suggestion-grid">
                        {suggestions.map((suggestion, index) => (
                          <article className={selectedRecommendationId === suggestion.id ? "suggestion-card selected" : "suggestion-card"} key={suggestion.id}>
                            <div className="suggestion-rank">
                              <span>Recomendación {index + 1}</span>
                              <strong>+{suggestion.newCombinations.toLocaleString("es-MX")}</strong>
                              <small>nuevas combinaciones</small>
                            </div>
                            <strong>{suggestion.kind === "section" ? "Reubicar la sección completa" : "Mover un bloque"}</strong>
                            <div className="change-list">
                              {suggestion.changes.map(({ from, to }, changeIndex) => (
                                <div key={`${suggestion.id}-change-${changeIndex}`}>
                                  <span>{DAY_NAMES[from[0]]} {displayTime(from[1])}–{displayTime(from[2])}</span>
                                  <b aria-hidden="true">→</b>
                                  <strong>{DAY_NAMES[to[0]]} {displayTime(to[1])}–{displayTime(to[2])}</strong>
                                </div>
                              ))}
                            </div>
                            <div className="suggestion-total">
                              Total estimado del semestre: <strong>{suggestion.resultingTotal.toLocaleString("es-MX")}</strong>
                            </div>
                            <button type="button" onClick={() => setSelectedRecommendationId(suggestion.id)}>
                              {selectedRecommendationId === suggestion.id ? "Horario mostrado" : "Ver horario resultante"}
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="no-simple-suggestion">
                        No se encontró una alternativa viable modificando un solo bloque o desplazando uniformemente toda la sección. Este caso requiere revisión manual conjunta con otras materias.
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="all-clear recommendation-clear">
                <strong>No se requieren recomendaciones para este semestre</strong>
                <p>Todas las secciones con horario capturado participan en al menos una combinación completa.</p>
              </div>
            )}

            {selectedRecommendation && (
              <div className="recommended-calendar">
                <Calendar
                  option={selectedRecommendation.example}
                  type={scheduleMetrics(selectedRecommendation.example).shift}
                  eyebrow="VISUALIZACIÓN DE LA RECOMENDACIÓN"
                  title={`${selectedRecommendation.section.c} · ${selectedRecommendation.section.s}`}
                />
                <p>Esta visualización corresponde únicamente al escenario recomendado seleccionado. No representa el horario publicado en SIIAU.</p>
              </div>
            )}
          </section>
      </div>
      <footer>Datos de consulta SIIAU 202620 · Centro D · LQUI · Cupo únicamente informativo</footer>
    </main>
  );
}
