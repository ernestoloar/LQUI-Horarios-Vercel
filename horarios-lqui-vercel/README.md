# Visualizador de viabilidad de horarios LQUI

Aplicación web para apoyar a la coordinación de la Licenciatura en Química de CUCEI en la revisión y planeación de horarios.

## Configuración del ejercicio

- Ciclo: `202620` (calendario 2026-B)
- Centro: `D` (CUCEI)
- Carrera: `LQUI`
- El cupo disponible se presenta de manera informativa y no interviene en el cálculo de combinaciones.

## Funciones principales

- Revisión de los nueve semestres de la malla curricular.
- Hasta tres opciones mínimas y representativas por semestre: matutina, vespertina y mixta.
- Calendario semanal visual con materias, días, horas, NRC, secciones y cupos informativos.
- Validación de que cada opción incluya todas las materias sin traslapes.
- Apartado de errores y observaciones para detectar materias sin horario, cruces inevitables o turnos no disponibles.
- Simulación del cambio provisional de día y hora de una sección.
- Comparación entre el escenario actual y el simulado.

## Archivos que normalmente se modifican

- `app/data.ts`: oferta académica, NRC, secciones, horarios y cupos.
- `app/page.tsx`: cálculos, clasificación de turnos y funcionamiento de la interfaz.
- `app/globals.css`: estilos y presentación visual.

## Subir a GitHub

1. Crea un repositorio vacío, sin README, licencia ni `.gitignore`.
2. Descomprime este archivo y abre una terminal dentro de la carpeta del proyecto.
3. Ejecuta:

```bash
git init
git add .
git commit -m "Versión inicial del visualizador de horarios LQUI"
git branch -M main
git remote add origin URL_DEL_REPOSITORIO
git push -u origin main
```

Reemplaza `URL_DEL_REPOSITORIO` con la dirección HTTPS de tu repositorio.

## Desarrollo local

Requiere Node.js 22 o posterior.

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`.

## Construcción de producción

```bash
npm run build
npm start
```

## Despliegue en Vercel

Importa el repositorio en Vercel o ejecuta:

```bash
npx vercel --prod
```

Vercel detectará automáticamente que se trata de una aplicación Next.js.

## Nota sobre los datos

La oferta incluida corresponde al ciclo, centro y carrera indicados. Los cambios hechos en el simulador son locales y no modifican SIIAU. El cupo no determina si una combinación es viable.
