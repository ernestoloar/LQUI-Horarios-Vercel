"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { sections as rawSections } from "../data";

type Meeting = [string, string, string, string];
type Section = {
  n: string;
  k: string;
  c: string;
  s: string;
  u: number;
  a: number;
  m: Meeting[];
  e: number;
};
type Schedule = { items: Section[]; equivalents: number };
type Availability = "Cero" | "Pocas" | "Muchas";

const sections = rawSections as unknown as Section[];
const DAYS = ["L", "M", "I", "J", "V", "S"];
const DAY_NAMES: Record<string, string> = {
  L: "Lunes", M: "Martes", I: "Miércoles", J: "Jueves", V: "Viernes", S: "Sábado",
};
const START = 7 * 60;
const END = 21 * 60;
const SCALE = 0.37;
const PAGE_SIZE = 6;

function minutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(2));
}

function timeLabel(time: string) {
  return `${time.slice(0, 2)}:${time.slice(2)}`;
}

function conflicts(left: Meeting[], right: Meeting[]) {
  return left.some(([leftDay, leftStart, leftEnd]) =>
    right.some(([rightDay, rightStart, rightEnd]) =>
      leftDay === rightDay && minutes(leftStart) < minutes(rightEnd) && minutes(rightStart) < minutes(leftEnd),
    ),
  );
}

function signature(items: Section[]) {
  return items
    .map((section) => `${section.k}:${section.m.map(([day, start, end]) => `${day}-${start}-${end}`).sort().join(",")}`)
    .sort()
    .join("|");
}

function buildAnchoredSchedules(pool: Section[], anchorNrc: string) {
  const courseKeys = [...new Set(pool.map((section) => section.k))];
  const anchor = pool.find((section) => section.n === anchorNrc);
  const groups = courseKeys
    .map((key) => {
      const scheduled = pool.filter((section) => section.k === key && section.m.length);
      return anchor && key === anchor.k ? scheduled.filter((section) => section.n === anchor.n) : scheduled;
    })
    .sort((a, b) => a.length - b.length);
  if (groups.some((group) => !group.length)) return [] as Schedule[];

  const selected: Section[] = [];
  const unique = new Map<string, Schedule>();
  function visit(index: number) {
    if (index === groups.length) {
      const key = signature(selected);
      const existing = unique.get(key);
      if (existing) existing.equivalents += 1;
      else unique.set(key, { items: [...selected], equivalents: 1 });
      return;
    }
    for (const section of groups[index]) {
      if (selected.some((item) => conflicts(section.m, item.m))) continue;
      selected.push(section);
      visit(index + 1);
      selected.pop();
    }
  }
  visit(0);
  return [...unique.values()];
}

function classify(count: number): Availability {
  if (!count) return "Cero";
  if (count <= 2) return "Pocas";
  return "Muchas";
}

function MiniCalendar({ schedule, index }: { schedule: Schedule; index: number }) {
  const colors = new Map(
    [...schedule.items].sort((a, b) => a.c.localeCompare(b.c)).map((section, itemIndex) => [section.k, itemIndex % 9]),
  );
  const height = (END - START) * SCALE;
  return (
    <article className="generated-schedule">
      <div className="generated-schedule-head">
        <div><span>OPCIÓN {index}</span><strong>{schedule.items.length} materias sin traslapes</strong></div>
        {schedule.equivalents > 1 && <small>{schedule.equivalents} combinaciones equivalentes</small>}
      </div>
      <div className="mini-week-scroll">
        <div className="mini-week">
          {DAYS.map((day) => <strong className="mini-day-head" key={day}>{DAY_NAMES[day].slice(0, 3)}</strong>)}
          {DAYS.map((day) => (
            <div className="mini-day" key={day} style={{ height }}>
              {schedule.items.flatMap((section) => section.m.filter((meeting) => meeting[0] === day).map((meeting, meetingIndex) => {
                const start = minutes(meeting[1]);
                const end = minutes(meeting[2]);
                return (
                  <div
                    className={`mini-class tone-${colors.get(section.k)}`}
                    key={`${section.n}-${meetingIndex}`}
                    style={{ top: (start - START) * SCALE, height: Math.max(29, (end - start) * SCALE - 2) }}
                    title={`${section.c} · ${section.s} · NRC ${section.n}`}
                  >
                    <b>{timeLabel(meeting[1])}–{timeLabel(meeting[2])}</b>
                    <span>{section.c}</span>
                    <small>{section.s}</small>
                  </div>
                );
              }))}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export default function ScheduleGenerator() {
  const [semester, setSemester] = useState(1);
  const pool = useMemo(() => sections.filter((section) => section.e === semester), [semester]);
  const courses = useMemo(() => {
    const unique = new Map<string, string>();
    pool.forEach((section) => unique.set(section.k, section.c));
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [pool]);
  const [courseKey, setCourseKey] = useState(() => sections.find((section) => section.e === 1)?.k || "");
  const courseSections = pool.filter((section) => section.k === courseKey && section.m.length);
  const [anchorNrc, setAnchorNrc] = useState("");
  const [page, setPage] = useState(1);
  const anchor = pool.find((section) => section.n === anchorNrc);
  const schedules = useMemo(() => buildAnchoredSchedules(pool, anchorNrc), [pool, anchorNrc]);
  const pageCount = Math.max(1, Math.ceil(schedules.length / PAGE_SIZE));
  const visibleSchedules = schedules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const compatibility = useMemo(() => courses.map(([key, name]) => {
    const candidates = pool.filter((section) => section.k === key && section.m.length);
    const compatible = anchor
      ? key === anchor.k
        ? candidates.filter((section) => section.n === anchor.n)
        : candidates.filter((section) => !conflicts(anchor.m, section.m))
      : candidates;
    return { key, name, count: compatible.length, status: classify(compatible.length) };
  }), [anchor, courses, pool]);

  function changeSemester(value: number) {
    const nextPool = sections.filter((section) => section.e === value);
    const nextCourse = nextPool[0]?.k || "";
    setSemester(value);
    setCourseKey(nextCourse);
    setAnchorNrc("");
    setPage(1);
  }

  function changeCourse(value: string) {
    setCourseKey(value);
    setAnchorNrc("");
    setPage(1);
  }

  function changeAnchor(value: string) {
    setAnchorNrc(value);
    setPage(1);
  }

  return (
    <main>
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">LQ</div>
        <div className="brand-copy"><strong>Licenciatura en Química</strong><span>Herramienta de planeación de horarios</span></div>
        <nav className="mode-switch" aria-label="Secciones principales">
          <Link href="/">Visualizador y simulador</Link>
          <Link className="active" href="/generador">Generador de horario</Link>
        </nav>
      </header>

      <div className="page-shell generator-shell">
        <section className="hero compact-hero">
          <div>
            <span className="eyebrow">ANÁLISIS ALREDEDOR DE UNA MATERIA</span>
            <h1>Generador de horario</h1>
            <p>Selecciona una materia y uno de sus horarios ofertados para revisar qué tan flexible es el resto del semestre y recorrer todas las combinaciones completas que se alinean con ella.</p>
          </div>
          <div className="config-card" aria-label="Configuración de la consulta">
            <span><small>Ciclo</small><strong>202620 · 2026-B</strong></span>
            <span><small>Centro</small><strong>D · CUCEI</strong></span>
            <span><small>Carrera</small><strong>LQUI</strong></span>
          </div>
        </section>

        <section className="generator-controls panel">
          <label><span>1. Semestre</span><select value={semester} onChange={(event) => changeSemester(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => <option key={index} value={index + 1}>{index + 1}º semestre</option>)}</select></label>
          <label><span>2. Materia ancla</span><select value={courseKey} onChange={(event) => changeCourse(event.target.value)}>{courses.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label><span>3. Sección y horario</span><select value={anchorNrc} onChange={(event) => changeAnchor(event.target.value)}><option value="">Todas las secciones de la materia</option>{courseSections.map((section) => <option key={section.n} value={section.n}>{section.s} · NRC {section.n} · {section.m.map((meeting) => `${DAY_NAMES[meeting[0]].slice(0, 3)} ${timeLabel(meeting[1])}–${timeLabel(meeting[2])}`).join(" / ")}</option>)}</select></label>
        </section>

        <section className="generator-summary">
          <article className={schedules.length ? "available" : "blocked"}><span>Horarios completos compatibles</span><strong>{schedules.length.toLocaleString("es-MX")}</strong><small>{anchor ? `anclados a ${anchor.s} · NRC ${anchor.n}` : "considerando cualquier sección de la materia"}</small></article>
          {(["Cero", "Pocas", "Muchas"] as Availability[]).map((status) => <article className={status.toLowerCase()} key={status}><span>{status} opciones</span><strong>{compatibility.filter((item) => item.status === status).length}</strong><small>{status === "Cero" ? "0 secciones compatibles" : status === "Pocas" ? "1–2 secciones compatibles" : "3 o más secciones compatibles"}</small></article>)}
        </section>

        <section className="availability-panel panel">
          <div className="section-heading"><div><span className="eyebrow">MAPA DE FLEXIBILIDAD</span><h2>Opciones de las materias alrededor del ancla</h2></div><span className="step-tag">{compatibility.length} materias</span></div>
          <div className="availability-grid">{compatibility.map((item) => <article className={item.status.toLowerCase()} key={item.key}><span>{item.name}</span><strong>{item.count}</strong><small>{item.key === courseKey ? "Materia ancla" : `${item.status} opciones`}</small></article>)}</div>
        </section>

        <section className="generated-results">
          <div className="section-heading">
            <div><span className="eyebrow">HORARIOS VIABLES</span><h2>Todas las alternativas visuales</h2></div>
            {schedules.length > PAGE_SIZE && <div className="generator-pagination"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>←</button><span>Página {page} de {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage((value) => value + 1)}>→</button></div>}
          </div>
          {visibleSchedules.length ? <div className="generated-grid">{visibleSchedules.map((schedule, index) => <MiniCalendar key={`${page}-${index}`} schedule={schedule} index={(page - 1) * PAGE_SIZE + index + 1} />)}</div> : <div className="empty-state blocked-state"><strong>No existe un horario completo con esta selección</strong><p>El mapa superior muestra las materias sin secciones compatibles. Puedes elegir otra sección de la materia ancla o probar el cambio en el simulador.</p></div>}
        </section>
      </div>
      <footer>Datos de consulta SIIAU 202620 · Centro D · LQUI · Cupo únicamente informativo</footer>
    </main>
  );
}