## Fix: GRANT SELECT en `public.profiles` para `authenticated`

### Contexto
La vista `profiles_safe` (usada por Settings > Equipo) está definida con `security_invoker=on`, por lo que se ejecuta con los permisos del rol del caller. El rol `authenticated` NO tiene GRANT SELECT sobre la tabla base `public.profiles` (`has_table_privilege → false`), por lo que cada request devuelve **403 permission denied for table profiles**. La RLS ya está correctamente configurada (`Tenant users can view team profiles`: `tenant_id = get_user_tenant_id(auth.uid())`) y seguirá filtrando por tenant después del grant.

### Migración
Un solo statement, quirúrgico:

```sql
GRANT SELECT ON public.profiles TO authenticated;
```

No se toca:
- Otros grants existentes (`authenticated` conserva INSERT/UPDATE/DELETE, `service_role` sigue con ALL, `anon` sin cambios).
- Las políticas RLS existentes en `profiles` (siguen filtrando por tenant y por `user_id = auth.uid()` según cada policy).
- La vista `profiles_safe` (queda igual con `security_invoker=on`).
- Cualquier otra tabla, función, trigger, RLS, WhatsApp, Cal.com, ElevenLabs.

### Impacto de seguridad
- `authenticated` seguirá viendo **solo las filas que la RLS permita** (miembros de su propio tenant). El GRANT es un requisito de PostgreSQL para invocar la vista `security_invoker`, pero no expone datos adicionales porque la RLS sigue vigente.
- El super_admin del tenant maestro ya tiene visibilidad a través de la policy existente.

### Archivos afectados
- **Nueva migración**: 1 archivo SQL con el GRANT anterior.
- **Sin cambios de código**: no se toca `SettingsPage.tsx`, ni edge functions, ni tipos.

### Verificación posterior
1. En el navegador, recargar `/settings` > Equipo → la request `GET /rest/v1/profiles_safe?...` debe devolver **200** con las 4 filas (Marco, Didier, Nidia, Carlos Prueba Dos).
2. Confirmar que Carlos aparece con `status: pending_approval` y `department: Ventas`.
3. Confirmar que los otros tenants NO ven las filas del master (RLS sigue activa).

### Fuera de alcance (no se cambia)
- Bug B de ElevenLabs (`elevenlabs-staff-sync` normalización de `request_headers`): ya se aplicó y desplegó en el turno anterior.
- Lógica del `list_status` en `team-management`: ya devuelve lo esperado, no requiere cambios.
