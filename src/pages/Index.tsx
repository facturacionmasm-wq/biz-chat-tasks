// Este archivo existía con datos mock hardcodeados.
// Ahora redirige al Dashboard real que carga datos desde Supabase.
// El routing en App.tsx ya maneja "/" → Dashboard correctamente.
import { Navigate } from 'react-router-dom';

const Index = () => <Navigate to="/" replace />;

export default Index;
