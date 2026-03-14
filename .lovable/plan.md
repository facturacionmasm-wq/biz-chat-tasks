

## Rediseño Visual: Estilo App Móvil Moderna

El objetivo es transformar la interfaz actual (que luce como un CRM corporativo) a un estilo de app nativa moderna tipo iOS/Android, con esquinas muy redondeadas, espacios amplios, bottom navigation en móvil, y cards con aspecto de app.

### Cambios principales

**1. Sistema de diseño (CSS variables + Tailwind)**
- Aumentar `--radius` de `0.625rem` a `1rem` para esquinas más redondeadas
- Agregar sombras más suaves y difusas (estilo iOS)
- Colores de fondo más cálidos/suaves con gradientes sutiles
- Tipografía más grande y con más peso en títulos
- Separación entre elementos más generosa

**2. Sidebar → Bottom Navigation (móvil)**
- En móvil: reemplazar el drawer lateral por una barra de navegación inferior fija con 5 iconos principales (Dashboard, Llamadas, WhatsApp, Agenda, Más)
- El botón "Más" abre un sheet con el resto de opciones
- En desktop: sidebar se mantiene pero con estilo más limpio y espacioso

**3. Dashboard rediseñado**
- Cards de estadísticas con iconos grandes, gradientes de fondo suaves y esquinas `rounded-2xl`
- Secciones con títulos más grandes y separaciones claras
- Eliminar bordes duros, usar sombras suaves en su lugar
- Agregar ilustraciones/emojis como acentos visuales

**4. Cards y componentes generales**
- `rounded-2xl` en todas las cards principales
- Sombras tipo `shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07)]`
- Quitar bordes visibles, usar solo sombras para separación
- Botones más grandes y redondeados (`rounded-xl`, `py-3`)
- Inputs con fondo gris claro en vez de borde

**5. Header superior**
- Más alto (h-14), con avatar más prominente
- Saludo personalizado como título de página en Dashboard
- Estilo más limpio sin bordes inferiores duros

### Archivos a modificar

| Archivo | Cambio |
|---------|--------|
| `src/index.css` | Variables CSS: radius, sombras, colores más suaves |
| `tailwind.config.ts` | Nuevas utilidades de sombra y radius |
| `src/components/AppLayout.tsx` | Bottom nav en móvil, sidebar refinado en desktop, header modernizado |
| `src/pages/Dashboard.tsx` | Cards con gradientes, layout tipo app, iconos grandes |
| `src/pages/ProjectsPage.tsx` | Cards redondeadas, botones estilo app, espaciado generoso |
| `src/components/ui/card.tsx` | Default `rounded-2xl`, sombra suave sin borde |
| `src/components/ui/button.tsx` | Más padding, esquinas más redondeadas |
| `src/components/ui/input.tsx` | Fondo gris en vez de borde, rounded-xl |

### Ejemplo visual del bottom nav (móvil)

```text
┌──────────────────────────────────┐
│         [Contenido de página]    │
│                                  │
│                                  │
├──────────────────────────────────┤
│  🏠    📞    💬    📅    ⋯     │
│ Home  Calls  WA  Agenda  Más    │
└──────────────────────────────────┘
```

### Ejemplo de card modernizada

```text
┌─────────────────────────────┐
│  ╭───────────────────────╮  │  ← rounded-2xl, sin borde,
│  │  📞  Llamadas hoy     │  │     solo sombra suave
│  │       12               │  │  ← número grande y bold
│  │  ░░░░░░░░░░░░░░░░░░░  │  │  ← barra de progreso sutil
│  ╰───────────────────────╯  │
└─────────────────────────────┘
```

