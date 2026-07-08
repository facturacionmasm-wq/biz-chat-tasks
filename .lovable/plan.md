Plan: Ajustar posición del FAB de Aria en móvil para evitar tapar el botón "Más"

Diagnóstico:
- El FAB cerrado de Aria está en `src/components/AIAssistantWidget.tsx`, líneas 73-83.
- Línea 77: `className="fixed bottom-6 right-6 z-50 w-14 h-14 ..."`.
- `bottom-6` = 24px desde el borde inferior de la ventana.
- La barra inferior (`BottomNav.tsx:61`) es `fixed bottom-0`, altura `var(--bottom-nav-height)` = 4.5rem (72px), con clase `safe-area-bottom`.
- Por tanto, en móvil el FAB queda dentro del área de la bottom nav / justo encima del botón "Más", y también puede superponerse al Sheet de "Más opciones".

Cambio propuesto:
- Archivo: `src/components/AIAssistantWidget.tsx`
- Línea: 77
- Reemplazar `bottom-6` por:
  `bottom-[calc(var(--bottom-nav-height)+1.5rem)] sm:bottom-6`

Resultado:
- En móvil: el FAB se posiciona 72px (nav) + 24px (gap) = 96px (6rem) desde el borde inferior, quedando por encima de la bottom nav.
- En escritorio (`sm:` y mayor): se mantiene el offset original `bottom-6`.
- No se toca ninguna otra clase, import ni lógica.

Verificación:
1. Cambiar la clase en la línea 77.
2. Typecheck: `bunx tsgo --noEmit` (no debería arrojar errores; solo cambio de CSS).
3. Ver en preview con viewport móvil que el FAB verde queda arriba del botón "Más" y no tapa el Sheet de "Más opciones".
